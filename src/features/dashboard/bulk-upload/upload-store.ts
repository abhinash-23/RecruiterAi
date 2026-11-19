import * as React from "react"

import { ApiError } from "@/services/http-client"
import {
  INTAKE_LIMITS,
  uploadCandidates,
  type IntakeResult,
} from "@/services/hr"

/**
 * A Resume upload to one job, from this tab, kept **outside React** on
 * purpose: a thousand files take minutes, and the recruiter closes the dialog,
 * opens another job and comes back. Held in a component, the upload would keep
 * running while its progress vanished with it. Here it belongs to the tab, one
 * per job, and any screen reads it through {@link useUploadRun}.
 *
 * **One endpoint:** `POST /hr/jobs/{id}/candidates/upload`, at most 20 files
 * and 25 MB a request. **Three requests in flight**: each time one returns,
 * the next starts. The backend accepts parallel requests to the same job; a
 * Resume that lands in two of them is added once and reported as `duplicate`
 * by the other.
 *
 * Everything the screen shows is added up from the responses here. Scoring
 * runs on the server afterwards and is read off the job's own counts.
 */

/** Requests in flight at once. */
export const PARALLEL_REQUESTS = 3
/** Before the one retry of a request that failed on the network or with a 5xx. */
export const RETRY_DELAY_MS = 2000

/** Codes worth sending again: the file may go through the second time. */
const RETRYABLE_CODES = new Set(["save_failed", "invalid_email"])

export type UploadPhase = "uploading" | "done" | "cancelled"

/** One file that didn't become a candidate, and why. */
export interface UploadProblem {
  name: string
  /**
   * The server's code (`duplicate`, `invalid_email`, `save_failed`, …),
   * `not_sent` for files whose request never got through, or `skipped` for
   * files turned away here before sending.
   */
  code: string
  error: string
}

export interface UploadRun {
  jobId: string
  phase: UploadPhase
  /** Files being sent: what was picked, minus {@link skipped}. */
  total: number
  /** Files whose request has returned. */
  uploaded: number
  /** Candidates added, summed over the responses. */
  created: number
  /** Requests in flight right now. */
  inFlight: number
  /** Turned away here: wrong type, empty, over 10 MB or the 1,000 cap. */
  skipped: UploadProblem[]
  /** The responses' `errors[]`: duplicates and files the server refused. */
  problems: UploadProblem[]
  /** Requests that failed twice (or were cancelled): "Not sent — try again". */
  notSent: UploadProblem[]
}

/* ------------------------------------------------------------ the store - */

const runs = new Map<string, UploadRun>()
/** The files a retry would send again, kept beside the run. */
const retryFiles = new Map<string, { notSent: File[]; failed: File[] }>()
const cancelled = new Set<string>()
const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) listener()
  guardUnload()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function update(jobId: string, change: (run: UploadRun) => UploadRun) {
  const current = runs.get(jobId)
  if (!current) return
  runs.set(jobId, change(current))
  emit()
}

/** The upload for one job in this tab, or null. */
export function useUploadRun(jobId: string | undefined): UploadRun | null {
  return React.useSyncExternalStore(subscribe, () =>
    jobId ? (runs.get(jobId) ?? null) : null
  )
}

export function isUploading(run: UploadRun | null): boolean {
  return run?.phase === "uploading"
}

/** Forgets a finished upload, so the panel goes away. */
export function clearUploadRun(jobId: string) {
  if (isUploading(runs.get(jobId) ?? null)) return
  runs.delete(jobId)
  retryFiles.delete(jobId)
  emit()
}

/**
 * Stops starting requests. The ones in flight finish and are counted; the
 * rest are listed as not sent, so Retry can send them later.
 */
export function cancelUpload(jobId: string) {
  if (isUploading(runs.get(jobId) ?? null)) cancelled.add(jobId)
}

/** What a retry would send: not-sent files and `save_failed`/`invalid_email`. */
export function retryableCount(run: UploadRun): number {
  return (
    run.notSent.length +
    run.problems.filter((item) => RETRYABLE_CODES.has(item.code)).length
  )
}

/* --------------------------------------------- leaving mid-upload - */

function onBeforeUnload(event: BeforeUnloadEvent) {
  event.preventDefault()
}

let guarding = false

/**
 * Asks before the tab closes while requests are still going. Leaving anyway
 * is safe: the same folder uploaded again comes back as duplicates for what
 * already arrived. Once every request has returned, scoring carries on on the
 * server and the tab can go.
 */
function guardUnload() {
  const busy = [...runs.values()].some(isUploading)
  if (busy && !guarding) window.addEventListener("beforeunload", onBeforeUnload)
  if (!busy && guarding) {
    window.removeEventListener("beforeunload", onBeforeUnload)
  }
  guarding = busy
}

/* ------------------------------------------------------- checks here - */

export interface CheckedFiles {
  accepted: File[]
  rejected: Array<{ name: string; error: string }>
}

/** The server's rules for one file, applied before anything is sent. */
export function checkFiles(files: File[]): CheckedFiles {
  const accepted: File[] = []
  const rejected: CheckedFiles["rejected"] = []
  for (const file of files) {
    const name = file.name.toLowerCase()
    if (!INTAKE_LIMITS.extensions.some((ext) => name.endsWith(ext))) {
      rejected.push({ name: file.name, error: "Not a PDF, DOCX or TXT file" })
    } else if (file.size === 0) {
      rejected.push({ name: file.name, error: "The file is empty" })
    } else if (file.size > INTAKE_LIMITS.maxFileBytes) {
      rejected.push({ name: file.name, error: "Over the 10 MB limit" })
    } else {
      accepted.push(file)
    }
  }
  return { accepted, rejected }
}

/** Requests of at most 20 files and 25 MB, in the order picked. */
export function groupFiles(files: File[]): File[][] {
  const groups: File[][] = []
  let current: File[] = []
  let bytes = 0
  for (const file of files) {
    if (
      current.length > 0 &&
      (current.length >= INTAKE_LIMITS.maxFiles ||
        bytes + file.size > INTAKE_LIMITS.maxRequestBytes)
    ) {
      groups.push(current)
      current = []
      bytes = 0
    }
    current.push(file)
    bytes += file.size
  }
  if (current.length > 0) groups.push(current)
  return groups
}

/* ------------------------------------------------------------ the run - */

const wait = (ms: number) =>
  new Promise<void>((resolve) => window.setTimeout(resolve, ms))

/** No response at all, or a 5xx: a second try might go through. */
function worthRetrying(error: unknown): boolean {
  return (
    error instanceof ApiError && (error.status === 0 || error.status >= 500)
  )
}

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : "Something went wrong."

/** One request, retried once after 2 s if the network or the server failed. */
async function sendOnce(jobId: string, files: File[]): Promise<IntakeResult> {
  try {
    return await uploadCandidates(jobId, files)
  } catch (error) {
    if (!worthRetrying(error)) throw error
    await wait(RETRY_DELAY_MS)
    return uploadCandidates(jobId, files)
  }
}

/** Adds one response to the run, and keeps the files a retry would resend. */
function record(jobId: string, files: File[], result: IntakeResult) {
  const byName = new Map<string, File[]>()
  for (const file of files) {
    byName.set(file.name, [...(byName.get(file.name) ?? []), file])
  }
  const problems: UploadProblem[] = result.errors.map((error) => {
    const name = error.filename ?? error.email ?? "Unnamed file"
    const code = error.code ?? "failed"
    if (RETRYABLE_CODES.has(code)) {
      const file = byName.get(name)?.shift()
      if (file) retryFiles.get(jobId)?.failed.push(file)
    }
    return { name, code, error: error.error }
  })
  update(jobId, (run) => ({
    ...run,
    uploaded: run.uploaded + files.length,
    created: run.created + result.created.length,
    problems: [...run.problems, ...problems],
  }))
}

function markNotSent(jobId: string, files: File[], reason: string) {
  retryFiles.get(jobId)?.notSent.push(...files)
  update(jobId, (run) => ({
    ...run,
    notSent: [
      ...run.notSent,
      ...files.map((file) => ({
        name: file.name,
        code: "not_sent",
        error: reason,
      })),
    ],
  }))
}

/**
 * Sends one group. A `413` (too big for the server) is split in two and each
 * half sent on its own; a single file that is still too big is not sent.
 */
async function sendGroup(jobId: string, files: File[]): Promise<void> {
  try {
    record(jobId, files, await sendOnce(jobId, files))
  } catch (error) {
    if (error instanceof ApiError && error.status === 413) {
      if (files.length === 1) {
        markNotSent(jobId, files, "Too large for the server")
        return
      }
      const half = Math.ceil(files.length / 2)
      await sendGroup(jobId, files.slice(0, half))
      await sendGroup(jobId, files.slice(half))
      return
    }
    markNotSent(jobId, files, `Not sent — try again. ${errorText(error)}`)
  }
}

/** Sends `groups`, {@link PARALLEL_REQUESTS} at a time, then settles the run. */
async function sendAll(jobId: string, groups: File[][]) {
  let next = 0
  const lane = async () => {
    while (next < groups.length) {
      const group = groups[next++]
      if (cancelled.has(jobId)) {
        markNotSent(jobId, group, "Cancelled before it was sent")
        continue
      }
      update(jobId, (run) => ({ ...run, inFlight: run.inFlight + 1 }))
      try {
        await sendGroup(jobId, group)
      } finally {
        update(jobId, (run) => ({ ...run, inFlight: run.inFlight - 1 }))
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(PARALLEL_REQUESTS, groups.length) }, lane)
  )
  const wasCancelled = cancelled.delete(jobId)
  update(jobId, (run) => ({
    ...run,
    phase: wasCancelled ? "cancelled" : "done",
  }))
}

/**
 * Starts uploading `files` to `jobId`. Returns at once: the requests carry on
 * in this tab, and the job page shows their progress.
 *
 * `skipped` are files already turned away by {@link checkFiles}, listed with
 * the rest so the totals add up to what was picked.
 */
export function startUpload(
  jobId: string,
  files: File[],
  skipped: Array<{ name: string; error: string }> = []
) {
  if (isUploading(runs.get(jobId) ?? null)) {
    throw new Error("An upload is already running for this job.")
  }
  if (files.length === 0) throw new Error("Choose at least one Resume file.")
  if (files.length > INTAKE_LIMITS.maxFilesPerUpload) {
    throw new Error(
      `At most ${INTAKE_LIMITS.maxFilesPerUpload.toLocaleString("en-IN")} files in one upload. Upload the rest separately.`
    )
  }

  cancelled.delete(jobId)
  retryFiles.set(jobId, { notSent: [], failed: [] })
  runs.set(jobId, {
    jobId,
    phase: "uploading",
    total: files.length,
    uploaded: 0,
    created: 0,
    inFlight: 0,
    skipped: skipped.map((item) => ({ ...item, code: "skipped" })),
    problems: [],
    notSent: [],
  })
  emit()
  void sendAll(jobId, groupFiles(files))
}

/**
 * Sends again what may go through now: files whose request never got through,
 * and files refused with `save_failed` or `invalid_email`. Their old entries
 * leave the report; whatever happens this time is added as new.
 */
export function retryUpload(jobId: string) {
  const run = runs.get(jobId)
  const files = retryFiles.get(jobId)
  if (!run || isUploading(run) || !files) return
  const resend = [...files.notSent, ...files.failed]
  if (resend.length === 0) return

  const failedCount = files.failed.length
  retryFiles.set(jobId, { notSent: [], failed: [] })
  cancelled.delete(jobId)
  runs.set(jobId, {
    ...run,
    phase: "uploading",
    // The refused ones had come back, so they were counted as uploaded.
    uploaded: run.uploaded - failedCount,
    problems: run.problems.filter((item) => !RETRYABLE_CODES.has(item.code)),
    notSent: [],
  })
  emit()
  void sendAll(jobId, groupFiles(resend))
}

/* ------------------------------------------------------------ the report - */

/** A heading per code, in the order the report lists them. */
export const PROBLEM_LABELS: Record<string, string> = {
  duplicate: "Already in this job",
  invalid_email: "No valid email in the Resume",
  save_failed: "Couldn't be saved",
  not_sent: "Not sent — try again",
  skipped: "Skipped (not sent)",
}

export function problemLabel(code: string): string {
  if (PROBLEM_LABELS[code]) return PROBLEM_LABELS[code]
  const words = code.replace(/[_-]+/g, " ").trim().toLowerCase()
  return words ? words[0].toUpperCase() + words.slice(1) : "Not added"
}

/** Every file that didn't become a candidate, for the report and its CSV. */
export function allProblems(run: UploadRun): UploadProblem[] {
  return [...run.problems, ...run.notSent, ...run.skipped]
}

/** Duplicates aside, every server refusal and every file not sent. */
export function failedCount(run: UploadRun): number {
  return (
    run.problems.filter((item) => item.code !== "duplicate").length +
    run.notSent.length
  )
}

export function duplicateCount(run: UploadRun): number {
  return run.problems.filter((item) => item.code === "duplicate").length
}

/** The report as CSV: file, code, reason. */
export function problemsCsv(run: UploadRun): string {
  const cell = (value: string) => `"${value.replace(/"/g, '""')}"`
  const rows = allProblems(run).map((item) =>
    [item.name, item.code, item.error].map(cell).join(",")
  )
  return ["File,Code,Reason", ...rows].join("\r\n")
}
