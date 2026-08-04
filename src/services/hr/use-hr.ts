/**
 * React Query bindings for the HR funnel. Pages talk to these, never to the
 * service functions directly.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import {
  addCandidates,
  analyseResume,
  createJob,
  getCandidate,
  getJob,
  getShortlist,
  listJobs,
  reanalyseCandidate,
  scheduleCandidates,
  updateJob,
  uploadCandidates,
  type CandidateIntakeRow,
  type JobStatus,
  type ScheduleInput,
} from "./jobs"
import {
  createInterview,
  getInterviewReport,
  listInterviews,
  sendInterviewInvite,
  type InterviewStatus,
} from "./interviews"

export const hrKeys = {
  jobs: ["hr", "jobs"] as const,
  job: (jobId: string) => ["hr", "jobs", jobId] as const,
  shortlist: (jobId: string) => ["hr", "jobs", jobId, "candidates"] as const,
  candidate: (candidateId: string) => ["hr", "candidates", candidateId] as const,
  interviews: ["interviews"] as const,
  interview: (interviewId: string) => ["interviews", interviewId] as const,
}

/**
 * How often the shortlist refetches while any candidate is still being
 * analysed. Analysis runs in the background and takes seconds to ~20s on the
 * keyword fallback, so the page polls rather than making the user reload.
 */
const ANALYSIS_POLL_MS = 4000

/* ------------------------------------------------------------------ reads - */

export function useJobs(options: { status?: JobStatus } = {}) {
  return useQuery({
    queryKey: [...hrKeys.jobs, options.status ?? "all"],
    queryFn: () => listJobs(options),
  })
}

export function useJob(jobId: string | undefined) {
  return useQuery({
    queryKey: hrKeys.job(jobId ?? ""),
    queryFn: () => getJob(jobId!),
    enabled: Boolean(jobId),
  })
}

/** The ranked shortlist, polling itself while analysis is outstanding. */
export function useShortlist(jobId: string | undefined) {
  return useQuery({
    queryKey: hrKeys.shortlist(jobId ?? ""),
    queryFn: () => getShortlist(jobId!),
    enabled: Boolean(jobId),
    refetchInterval: (query) =>
      query.state.data?.candidates.some(
        (candidate) => candidate.analysisStatus === "pending"
      )
        ? ANALYSIS_POLL_MS
        : false,
  })
}

export function useCandidate(candidateId: string | undefined) {
  return useQuery({
    queryKey: hrKeys.candidate(candidateId ?? ""),
    queryFn: () => getCandidate(candidateId!),
    enabled: Boolean(candidateId),
  })
}

export function useInterviews(
  options: { status?: InterviewStatus; limit?: number } = {}
) {
  return useQuery({
    queryKey: [...hrKeys.interviews, options.status ?? "all", options.limit ?? 0],
    queryFn: () => listInterviews(options),
  })
}

export function useInterviewReport(interviewId: string | undefined) {
  return useQuery({
    queryKey: hrKeys.interview(interviewId ?? ""),
    queryFn: () => getInterviewReport(interviewId!),
    enabled: Boolean(interviewId),
    retry: false,
  })
}

/* -------------------------------------------------------------- mutations - */

export function useJobMutations() {
  const client = useQueryClient()
  const refreshJobs = () => {
    void client.invalidateQueries({ queryKey: hrKeys.jobs })
  }
  const reportError = (error: Error) => toast.error(error.message)

  return {
    create: useMutation({
      mutationFn: createJob,
      onSuccess: (job) => {
        toast.success(`${job.title} created.`)
        refreshJobs()
      },
      onError: reportError,
    }),

    update: useMutation({
      mutationFn: ({
        jobId,
        input,
      }: {
        jobId: string
        input: Parameters<typeof updateJob>[1]
      }) => updateJob(jobId, input),
      onSuccess: (job) => {
        toast.success(
          job.status === "closed" ? `${job.title} closed.` : `${job.title} updated.`
        )
        refreshJobs()
        void client.invalidateQueries({ queryKey: hrKeys.job(job.jobId) })
      },
      onError: reportError,
    }),
  }
}

export function useCandidateMutations(jobId: string | undefined) {
  const client = useQueryClient()

  const refresh = () => {
    if (!jobId) return
    void client.invalidateQueries({ queryKey: hrKeys.shortlist(jobId) })
    void client.invalidateQueries({ queryKey: hrKeys.job(jobId) })
  }
  const reportError = (error: Error) => toast.error(error.message)

  /** Batch calls report partial success, so say what actually happened. */
  const reportBatch = (created: number, errors: number, noun: string) => {
    if (created > 0) toast.success(`${created} ${noun} added.`)
    if (errors > 0) {
      toast.warning(
        `${errors} ${errors === 1 ? "row was" : "rows were"} rejected — see the list below.`
      )
    }
    if (created === 0 && errors === 0) toast.info("Nothing to add.")
  }

  return {
    add: useMutation({
      mutationFn: (rows: CandidateIntakeRow[]) => addCandidates(jobId!, rows),
      onSuccess: (result) => {
        reportBatch(result.created.length, result.errors.length, "candidate(s)")
        refresh()
      },
      onError: reportError,
    }),

    upload: useMutation({
      mutationFn: (files: File[]) => uploadCandidates(jobId!, files),
      onSuccess: (result) => {
        reportBatch(result.created.length, result.errors.length, "résumé(s)")
        refresh()
      },
      onError: reportError,
    }),

    reanalyse: useMutation({
      mutationFn: reanalyseCandidate,
      onSuccess: () => {
        toast.success("Re-queued for analysis.")
        refresh()
      },
      onError: reportError,
    }),

    schedule: useMutation({
      mutationFn: (input: ScheduleInput) => scheduleCandidates(jobId!, input),
      onSuccess: (result) => {
        if (result.scheduled.length > 0) {
          toast.success(
            `${result.scheduled.length} interview(s) scheduled and emailed.`
          )
        }
        for (const error of result.errors) toast.warning(error.error)
        refresh()
        void client.invalidateQueries({ queryKey: hrKeys.interviews })
      },
      onError: reportError,
    }),
  }
}

/**
 * Creates a one-off interview, outside the job funnel.
 *
 * Invalidates the interviews list rather than the jobs one: nothing about a job
 * changed, because this interview belongs to none.
 */
export function useCreateInterview() {
  const client = useQueryClient()

  return useMutation({
    mutationFn: createInterview,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: hrKeys.interviews })
    },
    onError: (error: Error) => toast.error(error.message),
  })
}

/** Emails one interview invitation. See {@link sendInterviewInvite}. */
export function useSendInterviewInvite() {
  return useMutation({
    mutationFn: sendInterviewInvite,
    onError: (error: Error) => toast.error(error.message),
  })
}

/** Standalone résumé scoring — no job, nothing persisted. */
export function useResumeAnalysis() {
  return useMutation({
    mutationFn: analyseResume,
    onError: (error: Error) => toast.error(error.message),
  })
}
