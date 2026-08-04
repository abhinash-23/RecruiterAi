/**
 * ============================================================================
 * JOBS AND THEIR CANDIDATE FUNNEL — `/api/hr/*`
 * ============================================================================
 * The recruiting funnel, in the order it happens:
 *
 *   job → candidates in → automatic analysis → ranked shortlist → schedule
 *
 * **Everything hangs off a job.** There is no flat "all candidates" endpoint:
 * a candidate exists as an application to one job, and the same person applying
 * twice is two candidate records. Any screen listing candidates must therefore
 * pick a job first.
 *
 * Scope comes from the bearer token, never from a URL:
 *   - an **HR** sees only the jobs and candidates they created;
 *   - an **admin** sees everything in their company.
 * A colleague's job reads as 404, not 403 — indistinguishable from "gone", by
 * design. Never filter by user id on the client.
 */

import { currentAccessToken } from "@/services/auth-service"
import { apiFetch, type RequestOptions } from "@/services/http-client"

/* ========================================================================== */
/*  Types                                                                     */
/* ========================================================================== */

export type JobStatus = "open" | "closed"

export interface Job {
  jobId: string
  title: string
  /** What the candidate is told they're interviewing for. Defaults to `title`. */
  role: string
  jobDescription: string
  status: JobStatus
  createdBy: string
  createdAt: string
  updatedAt: string
}

/** Funnel counts returned alongside a single job. */
export interface JobCandidateCounts {
  total: number
  pending: number
  analyzed: number
  failed: number
}

export interface JobDetail {
  job: Job
  candidates: JobCandidateCounts
}

export type AnalysisStatus = "pending" | "analyzed" | "failed"

/** One application to one job — a shortlist row. */
export interface Candidate {
  candidateId: string
  jobId: string
  name: string
  email: string
  phone: string
  analysisStatus: AnalysisStatus
  /** 0–100, or null until analysis finishes. */
  fitScore: number | null
  /**
   * Which engine produced `fitScore`. `keyword_fallback` scores are on a
   * different scale from `llm` ones and must not be compared directly.
   */
  analyzerVersion: "llm" | "keyword_fallback" | null
  recommendation: string | null
  /** Set once the candidate has been scheduled. */
  interviewId: string | null
  sourceFilename: string | null
  createdAt: string
}

export interface Shortlist {
  count: number
  /**
   * True when the list mixes `llm` and `keyword_fallback` scores. The UI must
   * warn, because the two scales aren't comparable.
   */
  mixedAnalyzerVersions: boolean
  /** Already ranked best-first by the server. Do not re-sort by score. */
  candidates: Candidate[]
}

export interface CandidateDetail {
  candidate: Candidate & { resumeText: string }
  /** Full analyzer output. Shape varies by analyzer version. */
  analysis: Record<string, unknown> | null
}

/** One row of a typed/pasted candidate intake batch. */
export interface CandidateIntakeRow {
  email: string
  name?: string
  phone?: string
  /** The server rejects the **whole batch** below 30 characters — see below. */
  resumeText: string
}

/** Per-item rejection from a batch call. */
export interface BatchError {
  index?: number
  email?: string
  filename?: string
  error: string
}

export interface IntakeResult {
  created: Candidate[]
  errors: BatchError[]
  queuedForAnalysis: number
  message: string
}

export interface ScheduleInput {
  candidateIds: string[]
  /** Minutes the sitting may take. Falls back to the company default. */
  timeMinutes?: number
  /** How long the invitation link stays valid. Falls back to the default. */
  linkExpiryHours?: number
}

export interface ScheduledInterview {
  candidateId: string
  interviewId: string
  /** Contains the interview id, email, name and role as query params. */
  interviewLink: string
  otpCode: string
  /** When false, show the link and code so the recruiter can send them. */
  emailSent: boolean
}

export interface ScheduleResult {
  scheduled: ScheduledInterview[]
  errors: BatchError[]
  message: string
}

/* ========================================================================== */
/*  Limits the server enforces — mirrored so the UI can stop bad input early   */
/* ========================================================================== */

export const JOB_LIMITS = {
  titleMin: 2,
  titleMax: 255,
  descriptionMin: 30,
  descriptionMax: 20_000,
} as const

export const INTAKE_LIMITS = {
  /** Rows per typed batch. */
  maxRows: 50,
  /**
   * Minimum résumé length. **This one is schema-level**: a single short row
   * 422s the entire request rather than coming back as a per-item error, so it
   * has to be caught before sending.
   */
  resumeMin: 30,
  /** Files per upload, and the per-file ceiling. */
  maxFiles: 20,
  maxFileBytes: 10 * 1024 * 1024,
  acceptedFileTypes: ".pdf,.docx,.txt",
} as const

export const SCHEDULE_LIMITS = {
  maxCandidates: 20,
} as const

/* ========================================================================== */
/*  Wire format                                                               */
/* ========================================================================== */

interface JobEnvelope {
  status: string
  job: Job
}
interface JobDetailEnvelope extends JobEnvelope {
  candidates: JobCandidateCounts
}
interface JobListEnvelope {
  status: string
  count: number
  jobs: Job[]
}
interface ShortlistEnvelope {
  status: string
  count: number
  mixedAnalyzerVersions: boolean
  candidates: Candidate[]
}
interface CandidateDetailEnvelope {
  status: string
  candidate: Candidate & { resumeText: string }
  analysis: Record<string, unknown> | null
}
interface IntakeEnvelope {
  status: string
  created: Candidate[]
  errors: BatchError[]
  queuedForAnalysis: number
  message: string
}
interface ScheduleEnvelope {
  status: string
  scheduled: ScheduledInterview[]
  errors: BatchError[]
  message: string
}

function authed<T>(path: string, options: Omit<RequestOptions, "token"> = {}) {
  return apiFetch<T>(path, { ...options, token: currentAccessToken() })
}

/**
 * Staff-domain timestamps are ISO strings with no timezone
 * (`"2026-08-03T08:00:04.529211"`), which `new Date()` reads as local time.
 * Server time is UTC.
 */
function toUtcIso(value: string): string {
  return /(?:Z|[+-]\d{2}:?\d{2})$/.test(value) ? value : `${value}Z`
}

function normaliseJob(job: Job): Job {
  return {
    ...job,
    createdAt: toUtcIso(job.createdAt),
    updatedAt: toUtcIso(job.updatedAt),
  }
}

function normaliseCandidate<T extends Candidate>(candidate: T): T {
  return { ...candidate, createdAt: toUtcIso(candidate.createdAt) }
}

/**
 * Guards against an empty path segment. `/api/hr/jobs//candidates` triggers a
 * redirect that **drops the Authorization header**, surfacing as a baffling 401
 * rather than a missing-id error.
 */
function requireId(value: string, name: string): string {
  const id = value?.trim()
  if (!id) throw new Error(`Missing ${name} — cannot build the request URL.`)
  return encodeURIComponent(id)
}

/* ========================================================================== */
/*  Jobs                                                                      */
/* ========================================================================== */

export async function listJobs(options: {
  status?: JobStatus
  limit?: number
} = {}): Promise<Job[]> {
  const query = new URLSearchParams()
  if (options.status) query.set("status", options.status)
  if (options.limit !== undefined) query.set("limit", String(options.limit))

  const suffix = query.size > 0 ? `?${query}` : ""
  const response = await authed<JobListEnvelope>(`/hr/jobs${suffix}`)
  return response.jobs.map(normaliseJob)
}

/** One job plus the funnel counts for its header. */
export async function getJob(jobId: string): Promise<JobDetail> {
  const response = await authed<JobDetailEnvelope>(
    `/hr/jobs/${requireId(jobId, "job id")}`
  )
  return { job: normaliseJob(response.job), candidates: response.candidates }
}

export async function createJob(input: {
  title: string
  jobDescription: string
  role?: string
}): Promise<Job> {
  const response = await authed<JobEnvelope>("/hr/jobs", {
    method: "POST",
    body: {
      title: input.title.trim(),
      job_description: input.jobDescription.trim(),
      ...(input.role?.trim() ? { role: input.role.trim() } : {}),
    },
  })
  return normaliseJob(response.job)
}

export async function updateJob(
  jobId: string,
  input: {
    title?: string
    role?: string
    jobDescription?: string
    status?: JobStatus
  }
): Promise<Job> {
  const body: Record<string, string> = {}
  if (input.title !== undefined) body.title = input.title.trim()
  if (input.role !== undefined) body.role = input.role.trim()
  if (input.jobDescription !== undefined) {
    body.job_description = input.jobDescription.trim()
  }
  if (input.status !== undefined) body.status = input.status

  const response = await authed<JobEnvelope>(
    `/hr/jobs/${requireId(jobId, "job id")}`,
    { method: "PATCH", body }
  )
  return normaliseJob(response.job)
}

/* ========================================================================== */
/*  Candidates                                                                */
/* ========================================================================== */

/**
 * Adds typed/pasted candidates to a job and queues them for analysis.
 *
 * Two different failure modes, and they behave differently:
 *
 *  - **Schema failures kill the batch.** A résumé under 30 characters, or a
 *    malformed email, returns 422 and nothing is created. Validate before
 *    calling — `INTAKE_LIMITS.resumeMin` is here for that.
 *  - **Semantic failures are per-item.** A duplicate application comes back in
 *    `errors` while the rest of the batch is created. Render both halves.
 */
export async function addCandidates(
  jobId: string,
  rows: CandidateIntakeRow[]
): Promise<IntakeResult> {
  const response = await authed<IntakeEnvelope>(
    `/hr/jobs/${requireId(jobId, "job id")}/candidates`,
    {
      method: "POST",
      body: {
        candidates: rows.map((row) => ({
          email: row.email.trim().toLowerCase(),
          name: row.name?.trim() ?? "",
          phone: row.phone?.trim() ?? "",
          resume_text: row.resumeText.trim(),
        })),
      },
    }
  )

  return {
    created: response.created.map(normaliseCandidate),
    errors: response.errors,
    queuedForAnalysis: response.queuedForAnalysis,
    message: response.message,
  }
}

/**
 * Uploads résumé files; identity is extracted from the documents themselves.
 *
 * With exactly one file, `email`/`name`/`phone` override what was extracted —
 * with several, they are ignored, so the UI should only offer them for a
 * single-file upload.
 */
export async function uploadCandidates(
  jobId: string,
  files: File[],
  overrides?: { email?: string; name?: string; phone?: string }
): Promise<IntakeResult> {
  const form = new FormData()
  for (const file of files) form.append("files", file)

  if (files.length === 1 && overrides) {
    if (overrides.email) form.append("email", overrides.email.trim())
    if (overrides.name) form.append("name", overrides.name.trim())
    if (overrides.phone) form.append("phone", overrides.phone.trim())
  }

  const response = await authed<IntakeEnvelope>(
    `/hr/jobs/${requireId(jobId, "job id")}/candidates/upload`,
    { method: "POST", body: form }
  )

  return {
    created: response.created.map(normaliseCandidate),
    errors: response.errors,
    queuedForAnalysis: response.queuedForAnalysis,
    message: response.message,
  }
}

/** The ranked shortlist. Already best-first — preserve the server's order. */
export async function getShortlist(jobId: string): Promise<Shortlist> {
  const response = await authed<ShortlistEnvelope>(
    `/hr/jobs/${requireId(jobId, "job id")}/candidates`
  )
  return {
    count: response.count,
    mixedAnalyzerVersions: response.mixedAnalyzerVersions,
    candidates: response.candidates.map(normaliseCandidate),
  }
}

export async function getCandidate(
  candidateId: string
): Promise<CandidateDetail> {
  const response = await authed<CandidateDetailEnvelope>(
    `/hr/candidates/${requireId(candidateId, "candidate id")}`
  )
  return {
    candidate: normaliseCandidate(response.candidate),
    analysis: response.analysis,
  }
}

/** Re-queues one candidate — the retry for `failed`, or after editing the JD. */
export async function reanalyseCandidate(candidateId: string): Promise<void> {
  await authed(
    `/hr/candidates/${requireId(candidateId, "candidate id")}/reanalyze`,
    { method: "POST" }
  )
}

/* ========================================================================== */
/*  Scheduling                                                                */
/* ========================================================================== */

/**
 * Invites candidates to sit their interview. The link and one-time code are
 * emailed automatically.
 *
 * There is deliberately **no calendar**: the candidate gets a validity window
 * and sits whenever they like inside it. Don't build a slot picker.
 *
 * Partial success is normal — an already-scheduled candidate lands in `errors`
 * while the rest go through.
 */
export async function scheduleCandidates(
  jobId: string,
  input: ScheduleInput
): Promise<ScheduleResult> {
  const response = await authed<ScheduleEnvelope>(
    `/hr/jobs/${requireId(jobId, "job id")}/schedule`,
    {
      method: "POST",
      body: {
        candidate_ids: input.candidateIds,
        ...(input.timeMinutes !== undefined
          ? { time_minutes: input.timeMinutes }
          : {}),
        ...(input.linkExpiryHours !== undefined
          ? { link_expiry_hours: input.linkExpiryHours }
          : {}),
      },
    }
  )

  return {
    scheduled: response.scheduled,
    errors: response.errors,
    message: response.message,
  }
}

/* ========================================================================== */
/*  Standalone résumé analysis                                                */
/* ========================================================================== */

export interface ResumeAnalysis {
  fitScore: number | null
  recommendation: string | null
  analyzerVersion: string | null
  /** Everything else the analyzer returned; shape varies by version. */
  raw: Record<string, unknown>
}

/**
 * Scores one résumé against one job description without creating anything.
 *
 * Same engine as the pipeline. On the dev instance the LLM proxy is
 * unreachable, so this falls back to keyword scoring and can take ~20 seconds —
 * the UI needs a patient loading state, not a spinner that implies a second.
 */
export async function analyseResume(input: {
  resumeText: string
  jobDescription: string
  role?: string
}): Promise<ResumeAnalysis> {
  const raw = await authed<Record<string, unknown>>("/analyze-resume", {
    method: "POST",
    body: {
      resume_text: input.resumeText.trim(),
      job_description: input.jobDescription.trim(),
      ...(input.role?.trim() ? { role: input.role.trim() } : {}),
    },
  })

  return {
    fitScore: typeof raw.fit_score === "number" ? raw.fit_score : null,
    recommendation:
      typeof raw.recommendation === "string" ? raw.recommendation : null,
    analyzerVersion:
      typeof raw.analyzer_version === "string" ? raw.analyzer_version : null,
    raw,
  }
}

/** Matches the server's ceiling on both text fields. */
export const RESUME_ANALYSIS_MAX_CHARS = 8000
