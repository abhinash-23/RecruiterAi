import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import { isMissingEndpoint } from "@/services/http-client"
import { saveFile } from "@/lib/save-file"

import {
  downloadInterviewReport,
  downloadInterviewReports,
  getFeedbackEmail,
  resendFeedbackEmail,
  type ReportFilters,
} from "./reports"

export const reportKeys = {
  feedbackEmail: (interviewId: string) =>
    ["interviews", interviewId, "feedback-email"] as const,
}

/** How often a queued or sending email is re-read. The backend suggests 3–5 s. */
const FEEDBACK_POLL_MS = 4_000

/** Said once, for a backend that hasn't shipped reports yet. */
const NOT_YET =
  "PDF reports aren't available on this server yet. They will be after the next backend release."

function reportError(error: Error) {
  toast.error(isMissingEndpoint(error) ? NOT_YET : error.message)
}

/** One candidate's PDF, saved under the server's file name. */
export function useDownloadReport() {
  return useMutation({
    mutationFn: async (interviewId: string) => {
      const file = await downloadInterviewReport(interviewId)
      saveFile(file.blob, file.filename)
      return file
    },
    onError: reportError,
  })
}

/**
 * A ZIP of many. The server builds one ZIP at a time, so the caller should
 * keep its button disabled while this is pending — a second press would only
 * queue behind the first.
 */
export function useDownloadReports() {
  return useMutation({
    mutationFn: async (filters: ReportFilters) => {
      const file = await downloadInterviewReports(filters)
      saveFile(file.blob, file.filename)
      return file
    },
    onSuccess: (file) => toast.success(`Downloaded ${file.filename}`),
    onError: reportError,
  })
}

/**
 * The candidate feedback email for one interview. Re-read every few seconds
 * while it is queued or being written, and left alone otherwise — a sent or
 * failed email doesn't change unless someone presses Resend, which
 * invalidates this.
 *
 * `data` is null on a backend without the feature.
 */
export function useFeedbackEmail(interviewId: string | undefined) {
  return useQuery({
    queryKey: reportKeys.feedbackEmail(interviewId ?? ""),
    queryFn: () => getFeedbackEmail(interviewId!),
    enabled: Boolean(interviewId),
    retry: false,
    refetchInterval: (query) => {
      const status = query.state.data?.status
      return status === "pending" || status === "sending"
        ? FEEDBACK_POLL_MS
        : false
    },
  })
}

export function useResendFeedbackEmail(interviewId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: () => resendFeedbackEmail(interviewId),
    onSuccess: () => {
      toast.success(
        "Feedback email queued. It usually goes out within a minute."
      )
      void client.invalidateQueries({
        queryKey: reportKeys.feedbackEmail(interviewId),
      })
    },
    onError: (error: Error) => toast.error(error.message),
  })
}
