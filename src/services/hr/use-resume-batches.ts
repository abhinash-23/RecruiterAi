import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { toast } from "sonner"

import type { AnalysisStatus } from "./jobs"
import {
  batchSettled,
  getCandidatePage,
  getResumeBatch,
  getResumeBatchFailures,
  listResumeBatches,
  retryResumeBatch,
} from "./resume-batches"
import { hrKeys } from "./use-hr"

export const resumeBatchKeys = {
  /** Under the job, so refreshing the job refreshes its batch list too. */
  history: (jobId: string) => ["hr", "jobs", jobId, "resume-batches"] as const,
  batch: (batchId: string) => ["hr", "resume-batches", batchId] as const,
  failures: (batchId: string) =>
    ["hr", "resume-batches", batchId, "failures"] as const,
}

/** The server reads and scores in the background; this is how often to ask. */
const BATCH_POLL_MS = 4000

/** How often a page of the shortlist re-reads while it is still filling. */
const PAGE_POLL_MS = 5000

export function useResumeBatchHistory(jobId: string | undefined) {
  return useQuery({
    queryKey: resumeBatchKeys.history(jobId ?? ""),
    queryFn: () => listResumeBatches(jobId!),
    enabled: Boolean(jobId),
    // A server without bulk upload answers 404: that is "no batches", not an
    // error worth a retry or a message.
    retry: false,
  })
}

/**
 * One batch, polled until it settles (see {@link batchSettled}) — and regardless while `sending`:
 * a batch whose files are still going up can read as "done" with nothing in
 * it yet.
 */
export function useResumeBatch(
  batchId: string | null | undefined,
  sending = false
) {
  return useQuery({
    queryKey: resumeBatchKeys.batch(batchId ?? ""),
    queryFn: () => getResumeBatch(batchId!),
    enabled: Boolean(batchId),
    refetchInterval: (query) =>
      sending || !query.state.data || !batchSettled(query.state.data)
        ? BATCH_POLL_MS
        : false,
  })
}

export function useResumeBatchFailures(
  batchId: string | null | undefined,
  enabled: boolean
) {
  return useQuery({
    queryKey: resumeBatchKeys.failures(batchId ?? ""),
    queryFn: () => getResumeBatchFailures(batchId!),
    enabled: Boolean(batchId) && enabled,
  })
}

export function useRetryResumeBatch(jobId: string | undefined) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: retryResumeBatch,
    onSuccess: (requeued, batchId) => {
      toast.success(
        requeued > 0
          ? `${requeued} failed ${requeued === 1 ? "file" : "files"} sent back to be read again.`
          : "Nothing to retry."
      )
      void client.invalidateQueries({
        queryKey: resumeBatchKeys.failures(batchId),
      })
      void client.invalidateQueries({
        queryKey: resumeBatchKeys.batch(batchId),
      })
      if (jobId) {
        void client.invalidateQueries({ queryKey: hrKeys.job(jobId) })
      }
    },
    onError: (error: Error) => toast.error(error.message),
  })
}

/**
 * One page of the ranked shortlist, for a job too big to load whole. Keeps
 * the previous page on screen while the next one loads, and re-reads itself
 * while `live` (a batch still being scored, or rows on it still pending).
 */
export function useCandidatePage(
  jobId: string | undefined,
  options: {
    limit: number
    offset: number
    status?: AnalysisStatus
    enabled: boolean
    live: boolean
  }
) {
  return useQuery({
    queryKey: [
      ...hrKeys.shortlist(jobId ?? ""),
      "page",
      options.status ?? "all",
      options.offset,
      options.limit,
    ],
    queryFn: () =>
      getCandidatePage(jobId!, {
        limit: options.limit,
        offset: options.offset,
        status: options.status,
      }),
    enabled: Boolean(jobId) && options.enabled,
    placeholderData: keepPreviousData,
    refetchInterval: (query) =>
      options.live ||
      query.state.data?.candidates.some((c) => c.analysisStatus === "pending")
        ? PAGE_POLL_MS
        : false,
  })
}
