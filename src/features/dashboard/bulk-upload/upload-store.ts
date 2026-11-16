import * as React from "react"

import { ApiError } from "@/services/http-client"
import {
  BULK_LIMITS,
  markResumesUploaded,
  putToStorage,
  startResumeBatch,
  type ResumeBatchStart,
  type ResumeUploadSlot,
  type ResumeRejection,
} from "@/services/hr"

/**
 * The browser half of a bulk upload, kept **outside React** on purpose.
 *
 * Thousands of files take minutes to send, and the recruiter won't sit on the
 * dialog for that: they close it, open another job, come back. Held in a
 * component, the upload would keep running while its progress vanished with
 * the component. Here it belongs to the tab, one per job, and any screen can
 * read it through {@link useUploadRun}.
 *
 * Only the sending lives here. Once a file is handed over, the server's own
 * batch status (polled) is the truth about it.
 */

export type UploadPhase =
  /** Opening the batch. */
  | "starting"
  | "uploading"
  | "done"
  | "cancelled"
  /** Stopped by an error; what was already sent is still processed. */
  | "failed"

export interface UploadRun {
  jobId: string
  batchId: string | null
  phase: UploadPhase
  /** Files handed to the server to describe. */
  total: number
  /** Files that reached storage and were handed over. */
  uploaded: number
  /** Everything that never reached the server: checks here, its own, storage. */
  notUploaded: ResumeRejection[]
  error: string | null
}

/** Thrown by {@link startBulkUpload} when this server has no bulk upload. */
export class BulkUploadUnavailableError extends Error {
  constructor() {
    super("Bulk upload isn't available on this server yet.")
  }
}

/* ------------------------------------------------------------ the store - */

const runs = new Map<string, UploadRun>()
const controllers = new Map<string, AbortController>()
const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function update(jobId: string, changes: Partial<UploadRun>) {
  const current = runs.get(jobId)
  if (!current) return
  runs.set(jobId, { ...current, ...changes })
  emit()
  guardUnload()
}

/** The upload for one job in this tab, or null. */
export function useUploadRun(jobId: string | undefined): UploadRun | null {
  return React.useSyncExternalStore(subscribe, () =>
    jobId ? (runs.get(jobId) ?? null) : null
  )
}

export function isUploading(run: UploadRun | null): boolean {
  return run?.phase === "starting" || run?.phase === "uploading"
}

/** Forgets a finished upload, so the panel goes back to the server's view. */
export function clearUploadRun(jobId: string) {
  const run = runs.get(jobId) ?? null
  if (isUploading(run)) return
  runs.delete(jobId)
  emit()
}

/** Stops sending. Files already in storage are still handed over. */
export function cancelUpload(jobId: string) {
  controllers.get(jobId)?.abort()
}

/* ------------------------------------------- leaving mid-upload - */

function onBeforeUnload(event: BeforeUnloadEvent) {
  event.preventDefault()
}

let guarding = false

/** Asks before the tab closes while anything is still being sent. */
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
  rejected: ResumeRejection[]
}

/** The server's rules, applied before anything is sent. */
export function checkFiles(files: File[]): CheckedFiles {
  const accepted: File[] = []
  const rejected: ResumeRejection[] = []
  for (const file of files) {
    const name = file.name.toLowerCase()
    if (!BULK_LIMITS.extensions.some((ext) => name.endsWith(ext))) {
      rejected.push({ name: file.name, error: "Not a PDF, DOCX or TXT file" })
    } else if (file.size === 0) {
      rejected.push({ name: file.name, error: "The file is empty" })
    } else if (file.size > BULK_LIMITS.maxFileBytes) {
      rejected.push({ name: file.name, error: "Over the 10 MB limit" })
    } else {
      accepted.push(file)
    }
  }
  return { accepted, rejected }
}

/* ------------------------------------------------------------ the run - */

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size)
    out.push(items.slice(i, i + size))
  return out
}

/** Runs `worker` over `items`, `limit` at a time. */
async function pool<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>
) {
  let next = 0
  const lanes = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (next < items.length) await worker(items[next++])
    }
  )
  await Promise.all(lanes)
}

const describe = (files: File[]) =>
  files.map((file) => ({ name: file.name, size: file.size }))

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : "Something went wrong."

/**
 * Starts uploading `files` to a new batch on `jobId`.
 *
 * Resolves once the batch is open, so the caller can close its dialog; the
 * sending carries on behind it. Rejects without starting anything if the batch
 * can't be opened, with {@link BulkUploadUnavailableError} when the server
 * doesn't have bulk upload at all.
 *
 * `rejected` are files already turned away here, listed with the rest.
 */
export async function startBulkUpload(
  jobId: string,
  files: File[],
  rejected: ResumeRejection[] = []
): Promise<void> {
  if (isUploading(runs.get(jobId) ?? null)) {
    throw new Error("An upload is already running for this job.")
  }
  if (files.length === 0) throw new Error("Choose at least one Resume file.")

  const parts = chunks(files, BULK_LIMITS.filesPerCall)

  let first: ResumeBatchStart
  try {
    first = await startResumeBatch(jobId, describe(parts[0]))
  } catch (error) {
    if (
      error instanceof ApiError &&
      (error.status === 404 || error.status === 405 || error.status === 503)
    ) {
      throw new BulkUploadUnavailableError()
    }
    throw error
  }

  const controller = new AbortController()
  controllers.set(jobId, controller)
  runs.set(jobId, {
    jobId,
    batchId: first.batchId,
    phase: "uploading",
    total: files.length,
    uploaded: 0,
    notUploaded: [...rejected],
    error: null,
  })
  emit()
  guardUnload()

  void send(jobId, parts, first, controller.signal)
}

async function send(
  jobId: string,
  parts: File[][],
  first: ResumeBatchStart,
  signal: AbortSignal
) {
  const batchId = first.batchId
  let uploaded = 0
  const notUploaded = [...(runs.get(jobId)?.notUploaded ?? [])]

  // Progress lands in a burst of thousands; React hears about it at most a few
  // times a second.
  let flushTimer: number | null = null
  const flush = () => {
    flushTimer = null
    update(jobId, { uploaded, notUploaded: [...notUploaded] })
  }
  const scheduleFlush = () => {
    if (flushTimer === null) flushTimer = window.setTimeout(flush, 250)
  }

  try {
    for (let index = 0; index < parts.length; index++) {
      if (signal.aborted) break
      const part = parts[index]
      const opened =
        index === 0
          ? first
          : await startResumeBatch(jobId, describe(part), batchId)

      notUploaded.push(...opened.rejected)

      // Slots come back in the order the files were sent, minus any the
      // server refused. With none refused, pair them by position — exact even
      // when two files share a name. Otherwise by name, in sending order.
      const byPosition = opened.uploads.length === part.length
      const slotFile = new Map<ResumeUploadSlot, File>()
      if (byPosition) {
        opened.uploads.forEach((slot, i) => slotFile.set(slot, part[i]))
      }
      const byName = new Map<string, File[]>()
      if (!byPosition) {
        for (const file of part) {
          byName.set(file.name, [...(byName.get(file.name) ?? []), file])
        }
      }

      const done: string[] = []
      await pool(opened.uploads, BULK_LIMITS.parallelUploads, async (slot) => {
        if (signal.aborted) return
        const file = slotFile.get(slot) ?? byName.get(slot.name)?.shift()
        if (!file) {
          notUploaded.push({ name: slot.name, error: "File not found to send" })
          return
        }
        try {
          await putToStorage(slot, file, signal)
          done.push(slot.itemId)
          uploaded++
        } catch (error) {
          if (!signal.aborted) {
            notUploaded.push({ name: file.name, error: errorText(error) })
          }
        }
        scheduleFlush()
      })

      // Handed over per call rather than at the end, so the first thousand
      // are being read while the next thousand are still going up — and a
      // cancelled upload still gets what it had already sent.
      if (done.length > 0) await markResumesUploaded(batchId, done)
    }

    if (flushTimer !== null) window.clearTimeout(flushTimer)
    update(jobId, {
      uploaded,
      notUploaded,
      phase: signal.aborted ? "cancelled" : "done",
    })
  } catch (error) {
    if (flushTimer !== null) window.clearTimeout(flushTimer)
    update(jobId, {
      uploaded,
      notUploaded,
      phase: signal.aborted ? "cancelled" : "failed",
      error: signal.aborted ? null : errorText(error),
    })
  } finally {
    controllers.delete(jobId)
  }
}
