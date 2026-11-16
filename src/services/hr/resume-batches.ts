/**
 * ============================================================================
 * BULK RESUME UPLOAD — `/api/hr/.../resume-batches`
 * ============================================================================
 * For a job with more Resumes than the 20-file upload takes: up to 1000 files
 * per call, as many calls as it needs, into one batch.
 *
 *   1. `POST /hr/jobs/{jobId}/resume-batches` with names and sizes only. The
 *      reply holds one signed Cloud Storage URL per accepted file.
 *   2. `PUT` each file to its URL, **straight from the browser**. No bearer
 *      token: the signature in the URL is the permission. The API never sees
 *      the bytes.
 *   3. `POST /hr/resume-batches/{batchId}/uploaded` with the ids that made it.
 *   4. Poll `GET /hr/resume-batches/{batchId}` while the server reads and
 *      scores them.
 *
 * ⚠️ Step 2 needs the bucket's CORS to allow `PUT` from this site's origin. A
 * bucket without it fails every upload in the browser while every API call
 * succeeds, so that is the first thing to check when uploads fail but the
 * batch was created.
 *
 * Field names are read in both camel and snake case, as the other recent
 * endpoints are: a silent miss on a progress field reads as "stuck at 0%".
 */

import { currentAccessToken } from "@/services/auth-service"
import { apiFetch, type RequestOptions } from "@/services/http-client"

import type { AnalysisStatus, Candidate } from "./jobs"

/* ========================================================================== */
/*  Limits                                                                    */
/* ========================================================================== */

export const BULK_LIMITS = {
  /** Files described per `resume-batches` call. More continue the batch. */
  filesPerCall: 1000,
  /** Uploads in flight at once. */
  parallelUploads: 8,
  /** Retries after the first try, per file. */
  uploadRetries: 3,
  maxFileBytes: 10 * 1024 * 1024,
  /** Lower-case, with the dot. */
  extensions: [".pdf", ".docx", ".txt"],
  acceptedFileTypes: ".pdf,.docx,.txt",
} as const

/* ========================================================================== */
/*  Types                                                                     */
/* ========================================================================== */

/** One file the server accepted, and where to put it. */
export interface ResumeUploadSlot {
  itemId: string
  name: string
  url: string
  method: string
  headers: Record<string, string>
}

export interface ResumeRejection {
  name: string
  error: string
}

export interface ResumeBatchStart {
  batchId: string
  uploads: ResumeUploadSlot[]
  rejected: ResumeRejection[]
}

/** Where a batch is, server side. */
export interface ResumeBatchStatus {
  batchId: string
  totalFiles: number
  queued: number
  processing: number
  candidatesCreated: number
  duplicates: number
  failed: number
  analyzed: number
  analysisPending: number
  /** 0–100, the server's own figure. */
  percent: number
  /** Every file read: the shortlist has everyone it is going to get. */
  extractionDone: boolean
  /** Every score in. Nothing left to wait for. */
  analysisDone: boolean
  /**
   * Files described when the batch was opened that never arrived in storage.
   * All of them, with nothing created, is an upload that failed outright.
   */
  awaitingUpload: number
  /** Null when the server doesn't say. */
  createdAt: string | null
}

/** One file the server didn't turn into a candidate, and why. */
export interface ResumeBatchFailure {
  filename: string
  /** `duplicate`: someone with that email already applied to this job. */
  status: "failed" | "duplicate"
  error: string
}

/**
 * Nothing more will happen to this batch: every file that arrived has been
 * read, and every candidate it made has been scored.
 *
 * Not just `analysisDone`: a batch that created no one, because nothing
 * arrived or nothing could be read, has nothing to score and may never report
 * that flag. Waiting on it polled for ever.
 */
export function batchSettled(status: ResumeBatchStatus): boolean {
  return (
    status.extractionDone &&
    (status.candidatesCreated === 0 || status.analysisDone)
  )
}

/** Settled with not one file having reached storage. */
export function batchNeverArrived(status: ResumeBatchStatus): boolean {
  return (
    batchSettled(status) &&
    status.awaitingUpload > 0 &&
    status.candidatesCreated + status.duplicates + status.failed === 0
  )
}

export interface CandidatePage {
  total: number
  limit: number
  offset: number
  /** Ranked best-first by the server. */
  candidates: Candidate[]
}

/* ========================================================================== */
/*  Reading the wire                                                          */
/* ========================================================================== */

type Raw = Record<string, unknown>

function asObject(value: unknown): Raw {
  return value && typeof value === "object" ? (value as Raw) : {}
}

function pick(raw: Raw, ...keys: string[]): unknown {
  for (const key of keys) if (raw[key] !== undefined) return raw[key]
  return undefined
}

function num(raw: Raw, ...keys: string[]): number {
  const value = pick(raw, ...keys)
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

function str(raw: Raw, ...keys: string[]): string {
  const value = pick(raw, ...keys)
  return typeof value === "string" ? value : value == null ? "" : String(value)
}

function bool(raw: Raw, ...keys: string[]): boolean {
  return pick(raw, ...keys) === true
}

/** A list, whether it comes bare or wrapped in an envelope. */
function list(value: unknown, ...keys: string[]): unknown[] {
  if (Array.isArray(value)) return value
  const wrapped = pick(asObject(value), ...keys)
  return Array.isArray(wrapped) ? wrapped : []
}

/** Server timestamps come without a zone and are UTC. */
function toUtcIso(value: string): string {
  return /(?:Z|[+-]\d{2}:?\d{2})$/.test(value) ? value : `${value}Z`
}

function toStatus(value: unknown): ResumeBatchStatus {
  const raw = asObject(value)
  const createdAt = str(raw, "createdAt", "created_at")
  return {
    batchId: str(raw, "batchId", "batch_id", "id"),
    totalFiles: num(raw, "totalFiles", "total_files"),
    queued: num(raw, "queued"),
    processing: num(raw, "processing"),
    candidatesCreated: num(raw, "candidatesCreated", "candidates_created"),
    duplicates: num(raw, "duplicates"),
    failed: num(raw, "failed"),
    analyzed: num(raw, "analyzed"),
    analysisPending: num(raw, "analysisPending", "analysis_pending"),
    percent: Math.min(100, Math.max(0, num(raw, "percent"))),
    extractionDone: bool(raw, "extractionDone", "extraction_done"),
    analysisDone: bool(raw, "analysisDone", "analysis_done"),
    awaitingUpload: num(raw, "awaitingUpload", "awaiting_upload"),
    createdAt: createdAt ? toUtcIso(createdAt) : null,
  }
}

function toSlot(value: unknown): ResumeUploadSlot {
  const raw = asObject(value)
  const headers: Record<string, string> = {}
  for (const [key, header] of Object.entries(asObject(raw.headers))) {
    if (typeof header === "string") headers[key] = header
  }
  return {
    itemId: str(raw, "itemId", "item_id", "id"),
    name: str(raw, "name", "filename"),
    url: str(raw, "url"),
    method: str(raw, "method") || "PUT",
    headers,
  }
}

function toRejection(value: unknown): ResumeRejection {
  const raw = asObject(value)
  return {
    name: str(raw, "name", "filename"),
    error: str(raw, "error", "detail") || "Rejected",
  }
}

/* ========================================================================== */
/*  Calls                                                                     */
/* ========================================================================== */

function authed<T>(path: string, options: Omit<RequestOptions, "token"> = {}) {
  return apiFetch<T>(path, { ...options, token: currentAccessToken() })
}

function requireId(value: string, name: string): string {
  const id = value?.trim()
  if (!id) throw new Error(`Missing ${name}. Cannot build the request URL.`)
  return encodeURIComponent(id)
}

/**
 * Opens a batch, or adds to one with `batchId`. Names and sizes only: at most
 * {@link BULK_LIMITS.filesPerCall} per call.
 */
export async function startResumeBatch(
  jobId: string,
  files: Array<{ name: string; size: number }>,
  batchId?: string
): Promise<ResumeBatchStart> {
  const raw = asObject(
    await authed<unknown>(
      `/hr/jobs/${requireId(jobId, "job id")}/resume-batches`,
      {
        method: "POST",
        body: { ...(batchId ? { batchId } : {}), files },
      }
    )
  )
  return {
    batchId: str(raw, "batchId", "batch_id") || batchId || "",
    uploads: list(raw.uploads).map(toSlot),
    rejected: list(raw.rejected).map(toRejection),
  }
}

/** Hands the uploaded files to the server to read and score. */
export async function markResumesUploaded(
  batchId: string,
  itemIds: string[]
): Promise<void> {
  await authed(
    `/hr/resume-batches/${requireId(batchId, "batch id")}/uploaded`,
    {
      method: "POST",
      body: { itemIds },
    }
  )
}

export async function getResumeBatch(
  batchId: string
): Promise<ResumeBatchStatus> {
  // Wrapped as `{ batch: {...} }`. Read bare too, in case that ever changes.
  const raw = asObject(
    await authed<unknown>(
      `/hr/resume-batches/${requireId(batchId, "batch id")}`
    )
  )
  const status = toStatus(raw.batch ?? raw)
  return { ...status, batchId: status.batchId || batchId }
}

/** Every batch uploaded to a job. Newest first. */
export async function listResumeBatches(
  jobId: string
): Promise<ResumeBatchStatus[]> {
  const raw = await authed<unknown>(
    `/hr/jobs/${requireId(jobId, "job id")}/resume-batches`
  )
  return (
    list(raw, "batches", "items", "resumeBatches", "resume_batches")
      .map(toStatus)
      .filter((batch) => batch.batchId)
      // Newest first, as the server sends it. Re-sorted only when every batch
      // carries a date to sort by.
      .sort((a, b) =>
        a.createdAt && b.createdAt ? b.createdAt.localeCompare(a.createdAt) : 0
      )
  )
}

export async function getResumeBatchFailures(
  batchId: string
): Promise<ResumeBatchFailure[]> {
  const raw = await authed<unknown>(
    `/hr/resume-batches/${requireId(batchId, "batch id")}/failures?limit=1000`
  )
  return list(raw, "failures", "items").map((value) => {
    const item = asObject(value)
    const duplicate = str(item, "status") === "duplicate"
    return {
      filename: str(item, "filename", "name") || "Unnamed file",
      status: duplicate ? "duplicate" : "failed",
      error:
        str(item, "error", "detail") ||
        (duplicate ? "Already applied to this job" : "Couldn't be read"),
    }
  })
}

/** Puts a batch's failed files back in the queue. Returns how many went. */
export async function retryResumeBatch(batchId: string): Promise<number> {
  const raw = asObject(
    await authed<unknown>(
      `/hr/resume-batches/${requireId(batchId, "batch id")}/retry`,
      { method: "POST" }
    )
  )
  return num(raw, "requeued")
}

/**
 * One page of a job's ranked shortlist: the list for a job too big to load in
 * one go. Same candidate shape as {@link getShortlist}.
 */
export async function getCandidatePage(
  jobId: string,
  options: { limit: number; offset: number; status?: AnalysisStatus }
): Promise<CandidatePage> {
  const query = new URLSearchParams({
    limit: String(options.limit),
    offset: String(options.offset),
  })
  if (options.status) query.set("status", options.status)

  const raw = asObject(
    await authed<unknown>(
      `/hr/jobs/${requireId(jobId, "job id")}/candidates/page?${query}`
    )
  )
  const candidates = list(raw.candidates) as Candidate[]
  return {
    total: num(raw, "total", "count"),
    limit: num(raw, "limit") || options.limit,
    offset: num(raw, "offset"),
    candidates: candidates.map((candidate) => ({
      ...candidate,
      createdAt: toUtcIso(candidate.createdAt),
    })),
  }
}

/** A link to the original file, valid for 15 minutes. Fetch it per click. */
export async function getResumeFileUrl(candidateId: string): Promise<string> {
  const raw = asObject(
    await authed<unknown>(
      `/hr/candidates/${requireId(candidateId, "candidate id")}/resume-file`
    )
  )
  const url = str(raw, "url")
  if (!url) throw new Error("The server didn't return a link to the Resume.")
  return url
}

/* ========================================================================== */
/*  The upload itself                                                         */
/* ========================================================================== */

/** Thrown when a file couldn't be put after every retry. */
export class StorageUploadError extends Error {}

const wait = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(resolve, ms)
    signal?.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timer)
        reject(signal.reason)
      },
      { once: true }
    )
  })

/**
 * Puts one file to its signed URL, retrying {@link BULK_LIMITS.uploadRetries}
 * times with a growing pause. No Authorization header: Cloud Storage would
 * refuse a signed request that carries one.
 */
export async function putToStorage(
  slot: ResumeUploadSlot,
  file: File,
  signal?: AbortSignal
): Promise<void> {
  let last = "Upload failed"
  for (let attempt = 0; attempt <= BULK_LIMITS.uploadRetries; attempt++) {
    if (attempt > 0) await wait(1000 * 2 ** (attempt - 1), signal)
    try {
      const response = await fetch(slot.url, {
        method: slot.method,
        headers: slot.headers,
        body: file,
        signal,
      })
      if (response.ok) return
      last = `Storage answered ${response.status}`
      // An expired or wrong signature: asking again gets the same answer.
      if (response.status === 403) break
    } catch (error) {
      if (signal?.aborted) throw error
      last = "Couldn't reach storage"
    }
  }
  throw new StorageUploadError(last)
}
