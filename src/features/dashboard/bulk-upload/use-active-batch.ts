import * as React from "react"
import { useQueryClient } from "@tanstack/react-query"

import {
  batchSettled,
  hrKeys,
  resumeBatchKeys,
  useResumeBatch,
  useResumeBatchHistory,
} from "@/services/hr"

import { clearUploadRun, isUploading, useUploadRun } from "./upload-store"

const DISMISSED_KEY = "recruiterai.bulk-upload.dismissed"

/** How long a finished batch keeps its place on the job page. */
const RECENT_MS = 24 * 60 * 60 * 1000

function readDismissed(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? "[]")
    return Array.isArray(raw) ? raw.filter((id) => typeof id === "string") : []
  } catch {
    return []
  }
}

function writeDismissed(ids: string[]) {
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify(ids.slice(-50)))
  } catch {
    // Private mode: the panel just comes back next visit.
  }
}

/**
 * The batch a job's page shows: this tab's own upload if there is one, else
 * the job's latest batch until the recruiter dismisses it.
 *
 * Also keeps the rest of the page in step: each time the batch's counts move,
 * the job (its stat cards and shortlist) is re-read, so new candidates appear
 * without a reload.
 */
export function useActiveBatch(jobId: string | undefined) {
  const client = useQueryClient()
  const run = useUploadRun(jobId)
  const history = useResumeBatchHistory(jobId)
  const [dismissed, setDismissed] = React.useState(readDismissed)
  // Read once: "within the day" is judged from when the page was opened.
  const [openedAt] = React.useState(() => Date.now())

  /* The job's latest batch comes back on its own while it is still running,
     or finished within the day; an older, finished one stays in History. */
  const latest = history.data?.[0]
  const recent =
    latest?.createdAt != null &&
    openedAt - new Date(latest.createdAt).getTime() < RECENT_MS
  const batchId =
    run?.batchId ??
    (latest &&
    !dismissed.includes(latest.batchId) &&
    (!batchSettled(latest) || recent)
      ? latest.batchId
      : null)
  const sending = isUploading(run)
  /* This tab sent the files and not one arrived: the server has nothing to
     report on, and asking it would only show a batch waiting for ever. */
  const nothingSent =
    run !== null && !sending && run.uploaded === 0 && run.phase !== "cancelled"
  const batch = useResumeBatch(nothingSent ? null : batchId, sending)
  const status = batch.data ?? null

  // A new batch belongs in the history list.
  React.useEffect(() => {
    if (!jobId || !run?.batchId) return
    void client.invalidateQueries({ queryKey: resumeBatchKeys.history(jobId) })
  }, [client, jobId, run?.batchId])

  /* The moment sending stops, ask again. A status read while files were still
     going up says they are all still awaited, which on its own is exactly how
     a failed upload looks — and settles, so polling would stop on it. */
  const wasSending = React.useRef(sending)
  React.useEffect(() => {
    if (wasSending.current && !sending && batchId) {
      void client.invalidateQueries({
        queryKey: resumeBatchKeys.batch(batchId),
      })
    }
    wasSending.current = sending
  }, [client, sending, batchId])

  const signature = status
    ? [
        status.candidatesCreated,
        status.duplicates,
        status.failed,
        status.analyzed,
      ].join("-")
    : ""
  const previous = React.useRef(signature)
  React.useEffect(() => {
    if (!jobId || !signature || previous.current === signature) {
      previous.current = signature
      return
    }
    previous.current = signature
    void client.invalidateQueries({ queryKey: hrKeys.job(jobId) })
  }, [client, jobId, signature])

  const dismiss = () => {
    if (!jobId || sending) return
    if (batchId) {
      const next = [...dismissed.filter((id) => id !== batchId), batchId]
      setDismissed(next)
      writeDismissed(next)
    }
    clearUploadRun(jobId)
  }

  /** Still being read or scored: the shortlist is filling in. */
  const processing =
    sending || (status !== null && !batchSettled(status) && batchId !== null)

  return {
    run,
    nothingSent,
    sending,
    batchId,
    status,
    history: history.data ?? [],
    processing,
    dismiss,
  }
}

export type ActiveBatch = ReturnType<typeof useActiveBatch>
