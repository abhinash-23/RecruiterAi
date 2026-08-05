/**
 * ============================================================================
 * INTERVIEWS AND RESULTS (staff side) — `/api/interviews`, `/api/get-results`
 * ============================================================================
 * What recruiters see *after* scheduling. The candidate-facing half of the
 * interview engine lives in `@/services/interview`.
 *
 * ⚠️ **These rows are only tenant-scoped when the tenant has data isolation
 * enforced.** A client created without it reads every other client's
 * interviews. See `setTenancyEnforcement` in `@/services/super-admin`.
 *
 * Timestamps here are **Unix epoch seconds** (floats), not the ISO strings the
 * staff-domain endpoints use — the interview engine predates that convention.
 * Everything below converts to millis so `new Date()` works.
 */

import { currentAccessToken } from "@/services/auth-service"
import { apiFetch, type RequestOptions } from "@/services/http-client"
import { toVitalsReport, type VitalsReport } from "@/services/interview"

/* ========================================================================== */
/*  Types                                                                     */
/* ========================================================================== */

export type InterviewStatus =
  | "created"
  | "consent_given"
  | "in_progress"
  | "completed"
  | "expired"
  | "abandoned"
  | "superseded"
  | "consent_refused"

/**
 * The statuses that mean someone may be sitting the interview *right now* —
 * what the Live Interviews page lists.
 *
 * `consent_given` is included on purpose: the candidate has agreed and is on
 * the camera step, seconds from publishing. Listing them only once they reach
 * `in_progress` would have the card appear at the same moment the recruiter
 * needed to already be watching.
 */
export const LIVE_STATUSES: InterviewStatus[] = ["consent_given", "in_progress"]

export function isLiveInterview(row: InterviewRow): boolean {
  return LIVE_STATUSES.includes(row.status)
}

/** Who scheduled it. `null` for machine-key or legacy rows. */
export interface InterviewCreator {
  userId: string
  fullName: string
  email: string
}

export interface InterviewRow {
  interviewId: string
  candidateName: string
  candidateEmail: string
  role: string
  status: InterviewStatus
  sessionId: string | null
  /** Epoch millis. */
  createdAt: number
  /** Epoch millis — when the invitation link stops working. */
  expiryAt: number
  linkExpiryHours: number
  overallScore: number | null
  result: string | null
  /** Epoch millis, or null while unfinished. */
  completedAt: number | null
  answered: number | null
  hasResults: boolean
  createdBy: InterviewCreator | null
}

export interface RoundBreakdown {
  round: string
  score: number
  outOf: number
  percentage: number
  questionsAnswered: number
}

export interface QuestionDetail {
  index: number
  roundName: string
  question: string
  answer: string
  score: number | null
  feedback: string | null
}

/** Consent as recorded during the sitting. */
export interface ConsentRecord {
  given: boolean
  text: string
  ipAddress: string
  /** Epoch millis. */
  at: number | null
}

/** The report body. Null until the sitting finishes. */
export interface InterviewResults {
  overallScore: number
  /**
   * The server's verbatim outcome string. Note it is `"NOT SELECTED"` with a
   * **space**, not the underscored form the docs show — use `selected` rather
   * than comparing this yourself.
   */
  result: string
  /** True only for an explicit selection; anything else counts as not selected. */
  selected: boolean
  roundBreakdown: RoundBreakdown[]
  questionDetails: QuestionDetail[]
  vitalsReport: Record<string, unknown> | null
  /**
   * The recording to play back, when the sitting was recorded and the
   * deployment has storage configured. Null means there is nothing to play.
   */
  recordingSessionId: string | null
  answered: number
  totalQuestions: number
  totalRounds: number
  /** Epoch millis. */
  completedAt: number | null
}

export interface InterviewReport {
  interviewId: string
  candidateName: string
  candidateEmail: string
  role: string
  status: InterviewStatus
  consent: ConsentRecord | null
  /** Epoch millis. */
  createdAt: number
  linkExpiryHours: number
  /** ISO string, unlike the epoch fields around it. */
  linkExpiresAt: string | null
  createdBy: InterviewCreator | null
  results: InterviewResults | null
}

/* ========================================================================== */
/*  Wire format — snake_case, unlike the staff-domain endpoints                */
/* ========================================================================== */

interface RawInterviewRow {
  interview_id: string
  candidate_name: string
  candidate_email: string
  role: string
  status: InterviewStatus
  session_id: string | null
  created_at: number
  expiry_at: number
  link_expiry_hours: number
  overall_score: number | null
  result: string | null
  /** ISO string here, unlike the epoch `created_at`/`expiry_at` beside it. */
  completed_at: number | string | null
  answered: number | null
  has_results: boolean
  createdBy: InterviewCreator | null
}

interface ListEnvelope {
  status: string
  count: number
  interviews: RawInterviewRow[]
}

/**
 * The report as the server actually sends it. Three fields differ from the API
 * docs and each one bites silently:
 *
 *  - `round_breakdown` is an **object keyed by round name**, not an array.
 *    `.map()` on it throws.
 *  - `completed_at` is an **ISO string** here, even though the sibling
 *    `created_at`/`expiry_at` fields on the same endpoint are epoch floats.
 *  - `result` reads `"NOT SELECTED"` — a space, not the documented underscore.
 */
interface RawResults {
  overall_score: number
  overall_score_pct?: number
  result: string
  round_breakdown?: Record<
    string,
    {
      score?: number
      out_of?: number
      percentage?: number
      questions_answered?: number
    }
  >
  question_details?: Array<{
    index?: number
    round_name?: string
    question?: string
    answer?: string
    score?: number | null
    feedback?: string | null
  }>
  vitals_report?: Record<string, unknown> | null
  answered?: number
  total_questions?: number
  total_rounds?: number
  completed_at?: number | string | null
  /**
   * Present once a recording has been finalised and linked. The docs don't
   * name it, and the field has been seen in both cases — read either, since
   * guessing one and being wrong just silently hides the video.
   */
  recording_session_id?: string | null
  recordingSessionId?: string | null
}

/** Consent arrives as a record, not the boolean the docs describe. */
interface RawConsent {
  consent_given?: boolean
  consent_text?: string
  ip_address?: string
  timestamp?: number
  timestamp_iso?: string
}

interface ReportEnvelope {
  status: string
  interview_id: string
  candidate_name: string
  candidate_email: string
  role: string
  interview_status: InterviewStatus
  consent: RawConsent | null
  created_at: number
  link_expiry_hours: number
  link_expires_at: string | null
  createdBy: InterviewCreator | null
  results: RawResults | null
}

function authed<T>(path: string, options: Omit<RequestOptions, "token"> = {}) {
  return apiFetch<T>(path, { ...options, token: currentAccessToken() })
}

/** Epoch **seconds** (possibly fractional) → millis, preserving null. */
function toMillis(seconds: number | null | undefined): number | null {
  return typeof seconds === "number" ? Math.round(seconds * 1000) : null
}

function toRow(raw: RawInterviewRow): InterviewRow {
  return {
    interviewId: raw.interview_id,
    candidateName: raw.candidate_name,
    candidateEmail: raw.candidate_email,
    role: raw.role,
    status: raw.status,
    sessionId: raw.session_id,
    createdAt: toMillis(raw.created_at) ?? 0,
    expiryAt: toMillis(raw.expiry_at) ?? 0,
    linkExpiryHours: raw.link_expiry_hours,
    overallScore: raw.overall_score,
    result: raw.result,
    // Flexible, not `toMillis`: this one field arrives as an ISO string on an
    // endpoint whose other timestamps are epoch floats, so the strict reader
    // returned null for every row and the column it fed showed only dashes.
    completedAt: toMillisFlexible(raw.completed_at),
    answered: raw.answered,
    hasResults: raw.has_results,
    createdBy: raw.createdBy,
  }
}

/** Handles either of the two timestamp conventions this endpoint mixes. */
function toMillisFlexible(
  value: number | string | null | undefined
): number | null {
  if (typeof value === "number") return Math.round(value * 1000)
  if (typeof value === "string") {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? null : parsed
  }
  return null
}

/**
 * True only for an explicit selection.
 *
 * Compares on a normalised form because the server sends `"NOT SELECTED"` while
 * the docs promise `"NOT_SELECTED"` — matching either literal directly means a
 * rejection could read as a pass the day the other spelling appears.
 *
 * Exported so list views that only have the raw `result` string off
 * `GET /api/interviews` decide the same way the report does.
 */
export function isSelectedResult(result: string | null): boolean {
  if (!result) return false
  return result.trim().replace(/[\s_]+/g, "_").toUpperCase() === "SELECTED"
}

function toResults(raw: RawResults | null): InterviewResults | null {
  if (!raw) return null

  return {
    overallScore: raw.overall_score,
    result: raw.result,
    selected: isSelectedResult(raw.result),
    // Keyed by round name, so the key *is* the round.
    roundBreakdown: Object.entries(raw.round_breakdown ?? {}).map(
      ([round, entry]) => ({
        round,
        score: entry.score ?? 0,
        outOf: entry.out_of ?? 0,
        percentage: entry.percentage ?? 0,
        questionsAnswered: entry.questions_answered ?? 0,
      })
    ),
    questionDetails: (raw.question_details ?? []).map((entry, position) => ({
      index: entry.index ?? position,
      roundName: entry.round_name ?? "",
      question: entry.question ?? "",
      answer: entry.answer ?? "",
      score: entry.score ?? null,
      feedback: entry.feedback ?? null,
    })),
    vitalsReport: raw.vitals_report ?? null,
    recordingSessionId:
      raw.recording_session_id ?? raw.recordingSessionId ?? null,
    answered: raw.answered ?? 0,
    totalQuestions: raw.total_questions ?? 0,
    totalRounds: raw.total_rounds ?? 0,
    completedAt: toMillisFlexible(raw.completed_at),
  }
}

function toConsent(raw: RawConsent | null): ConsentRecord | null {
  if (!raw) return null
  return {
    given: raw.consent_given === true,
    text: raw.consent_text ?? "",
    ipAddress: raw.ip_address ?? "",
    at: toMillisFlexible(raw.timestamp_iso ?? raw.timestamp),
  }
}

/* ========================================================================== */
/*  Calls                                                                     */
/* ========================================================================== */

export async function listInterviews(
  options: { status?: InterviewStatus; limit?: number } = {}
): Promise<InterviewRow[]> {
  const query = new URLSearchParams()
  if (options.status) query.set("status", options.status)
  if (options.limit !== undefined) query.set("limit", String(options.limit))

  const suffix = query.size > 0 ? `?${query}` : ""
  const response = await authed<ListEnvelope>(`/interviews${suffix}`)
  return response.interviews.map(toRow)
}

/**
 * The full report for one interview. `results` is null until the candidate
 * finishes — the header fields are populated from the moment it's scheduled.
 */
export async function getInterviewReport(
  interviewId: string
): Promise<InterviewReport> {
  const id = interviewId?.trim()
  if (!id) throw new Error("Missing interview id — cannot build the request URL.")

  const response = await authed<ReportEnvelope>(
    `/get-results/${encodeURIComponent(id)}`
  )

  return {
    interviewId: response.interview_id,
    candidateName: response.candidate_name,
    candidateEmail: response.candidate_email,
    role: response.role,
    status: response.interview_status,
    consent: toConsent(response.consent),
    createdAt: toMillis(response.created_at) ?? 0,
    linkExpiryHours: response.link_expiry_hours,
    linkExpiresAt: response.link_expires_at,
    createdBy: response.createdBy,
    results: toResults(response.results),
  }
}

export interface CreatedInterview {
  interviewId: string
  /** The candidate's link. Null when the server didn't return one. */
  interviewLink: string | null
  /** The one-time code, when the response carries it. */
  otpCode: string | null
  emailSent: boolean
  message: string
}

/**
 * Creates one interview outright, with no job and no candidate record.
 *
 * The scheduler runs the same logic underneath; the API docs call this "the
 * machine-integration path" because it's what a client's own backend calls. It
 * is the only way to invite someone ad hoc — there's nothing to shortlist, so
 * such an interview carries **no fit score and belongs to no job**.
 *
 * Only the name and email are required: `time_minutes`, `rounds` and
 * `link_expiry_hours` resolve from the company's interview defaults when left
 * out, so sending them empty is different from sending them wrong.
 */
export async function createInterview(input: {
  candidateName: string
  candidateEmail: string
  role?: string
  jobDescription?: string
  resumeText?: string
  timeMinutes?: number
  linkExpiryHours?: number
  rounds?: string[]
}): Promise<CreatedInterview> {
  const body: Record<string, unknown> = {
    candidate_name: input.candidateName.trim(),
    candidate_email: input.candidateEmail.trim(),
  }

  if (input.role?.trim()) body.role = input.role.trim()
  if (input.jobDescription?.trim()) {
    body.job_description = input.jobDescription.trim()
  }
  if (input.resumeText?.trim()) body.resume_text = input.resumeText.trim()
  if (input.timeMinutes !== undefined) body.time_minutes = input.timeMinutes
  if (input.linkExpiryHours !== undefined) {
    body.link_expiry_hours = input.linkExpiryHours
  }
  if (input.rounds?.length) body.rounds = input.rounds

  // Both spellings read, because this endpoint sits on the interview engine
  // (snake_case) while the staff scheduler that wraps the same logic answers in
  // camelCase — and the docs don't pin down which this one uses.
  const response = await authed<{
    status?: string
    message?: string
    interview_id?: string
    interviewId?: string
    interview_link?: string
    interviewLink?: string
    otp_code?: string
    otpCode?: string
    email_sent?: boolean
    emailSent?: boolean
  }>("/create-interview", { method: "POST", body })

  return {
    interviewId: response.interview_id ?? response.interviewId ?? "",
    interviewLink: response.interview_link ?? response.interviewLink ?? null,
    otpCode: response.otp_code ?? response.otpCode ?? null,
    emailSent: response.email_sent ?? response.emailSent ?? false,
    message: response.message ?? "Interview created.",
  }
}

/**
 * Emails an interview invitation.
 *
 * Note what this endpoint is **not**: it doesn't create or look up an
 * interview, and it has no channel switch — `SendInterviewReq` is
 * `{candidate_email, candidate_name, role, interview_url}` and nothing else.
 * It sends one email containing the URL you hand it, which is why the caller
 * has to supply the link rather than an interview id.
 */
export async function sendInterviewInvite(input: {
  candidateEmail: string
  candidateName: string
  role?: string
  interviewUrl: string
}): Promise<{ message: string }> {
  const response = await authed<{ status?: string; message?: string }>(
    "/send-interview",
    {
      method: "POST",
      body: {
        candidate_email: input.candidateEmail,
        candidate_name: input.candidateName,
        role: input.role?.trim() || "General",
        interview_url: input.interviewUrl,
      },
    }
  )
  return { message: response.message ?? "Invitation sent." }
}

/**
 * The vitals a sitting has produced **so far**, read with the staff token.
 *
 * `GET /api/vitals/report/{session_id}` is documented under the candidate's own
 * calls, but `openapi.json` lists `HTTPBearer` among its accepted schemes and
 * its description says it answers "from the hot cache or … the last persisted
 * snapshot" — i.e. it does not wait for the sitting to end. That makes it the
 * one live reading a recruiter can get without a peer connection, which matters
 * because peer-to-peer fails on a minority of networks.
 *
 * ⚠️ Unverified against a live sitting: whether a staff bearer clears the
 * endpoint's ownership check is untested. Callers must treat a rejection as
 * "no readings yet", never as an error worth showing.
 */
export async function getLiveVitals(
  sessionId: string
): Promise<VitalsReport | null> {
  const id = sessionId?.trim()
  if (!id) return null

  const raw = await authed<Record<string, unknown>>(
    `/vitals/report/${encodeURIComponent(id)}`
  )
  return toVitalsReport(raw)
}

/** Time-limited playback URL for a finished interview's recording. */
export async function getRecordingPlaybackUrl(
  recordingSessionId: string
): Promise<string | null> {
  const id = recordingSessionId?.trim()
  if (!id) return null

  const response = await authed<{ status: string; playbackUrl?: string }>(
    `/recordings/${encodeURIComponent(id)}/playback-url`
  )
  return response.playbackUrl ?? null
}
