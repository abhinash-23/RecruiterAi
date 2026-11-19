/**
 * React Query bindings for the HR funnel. Pages talk to these, never to the
 * service functions directly.
 */

import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import { creditShortfall } from "@/services/billing/billing"
import { refreshCreditReads } from "@/services/credit-reads"
import { refreshDerivedReads } from "@/services/derived-reads"

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
  updateJobCandidate,
  type CandidateIntakeRow,
  type JobCandidateCounts,
  type JobStatus,
  type ScheduleInput,
} from "./jobs"
import {
  createInterview,
  getInterviewReport,
  getLiveVitals,
  inviteInterview,
  isLiveInterview,
  listInterviews,
  updateInterviewCandidate,
  type InterviewStatus,
} from "./interviews"

export const hrKeys = {
  jobs: ["hr", "jobs"] as const,
  job: (jobId: string) => ["hr", "jobs", jobId] as const,
  shortlist: (jobId: string) => ["hr", "jobs", jobId, "candidates"] as const,
  candidate: (candidateId: string) =>
    ["hr", "candidates", candidateId] as const,
  interviews: ["interviews"] as const,
  interview: (interviewId: string) => ["interviews", interviewId] as const,
  liveInterviews: ["interviews", "live"] as const,
  liveVitals: (sessionId: string) => ["vitals", "live", sessionId] as const,
}

/**
 * How often a job's counts are re-read while any of its candidates is still
 * being scored. The counts are a small reply; the candidate list itself is
 * re-read from them, at most every 30 s — see `useShortlistSync`.
 */
const JOB_POLL_MS = 10_000

/**
 * Toasts a failure, except a `402 insufficient_credits`: the dialog that made
 * the call shows that one itself, with the numbers and what to do about it.
 */
function reportUnlessShortfall(error: Error) {
  if (creditShortfall(error)) return
  toast.error(error.message)
}

/* ------------------------------------------------------------------ reads - */

export function useJobs(options: { status?: JobStatus } = {}) {
  return useQuery({
    queryKey: [...hrKeys.jobs, options.status ?? "all"],
    queryFn: () => listJobs(options),
  })
}

/**
 * One job and its candidate counts. Polls every 10 s while a score is still
 * pending, or while `live` (an upload from this tab is adding candidates).
 */
export function useJob(
  jobId: string | undefined,
  options: { live?: boolean } = {}
) {
  return useQuery({
    queryKey: hrKeys.job(jobId ?? ""),
    queryFn: () => getJob(jobId!),
    enabled: Boolean(jobId),
    refetchInterval: (query) =>
      options.live || (query.state.data?.candidates.pending ?? 0) > 0
        ? JOB_POLL_MS
        : false,
  })
}

/**
 * A job's whole candidate list, ranked best-first by the server, for every job
 * whatever its size: paging, search and filters happen in the browser.
 *
 * It doesn't poll. While scores come in, the page re-reads it when the job's
 * counts move, at most every 30 s (`useShortlistSync`): for 1,000 candidates
 * it is about 600 KB, and the counts are what changes.
 */
export function useShortlist(
  jobId: string | undefined,
  options: { enabled?: boolean } = {}
) {
  return useQuery({
    queryKey: hrKeys.shortlist(jobId ?? ""),
    queryFn: () => getShortlist(jobId!),
    enabled: Boolean(jobId) && (options.enabled ?? true),
  })
}

/** The candidate list is re-read at most this often while scores come in. */
export const LIST_REFRESH_MS = 30_000

/**
 * The job's candidate list, kept in step with the job's counts (which poll
 * every 10 s, see {@link useJob}) instead of polling itself:
 *
 *  - when `total` or `analyzed` has moved since the list was read, it is read
 *    again — at once if the last read is 30 s old, otherwise when it will be;
 *  - and once more when `pending` reaches 0, so the final scores show.
 *
 * Waits for the counts before the first read.
 */
export function useSyncedShortlist(
  jobId: string | undefined,
  counts: JobCandidateCounts | undefined
) {
  const list = useShortlist(jobId, { enabled: counts !== undefined })
  const { refetch, dataUpdatedAt, isFetching } = list

  const signature = counts ? `${counts.total}:${counts.analyzed}` : null
  /** The counts as they were when the list on screen was read. */
  const readAt = React.useRef<{ at: number; signature: string | null }>({
    at: 0,
    signature: null,
  })

  React.useEffect(() => {
    if (!signature || !dataUpdatedAt || isFetching) return
    if (readAt.current.at !== dataUpdatedAt) {
      // A fresh read: it matches the counts of this moment.
      readAt.current = { at: dataUpdatedAt, signature }
      return
    }
    if (signature === readAt.current.signature) return
    const due = Math.max(0, dataUpdatedAt + LIST_REFRESH_MS - Date.now())
    const timer = window.setTimeout(() => void refetch(), due)
    return () => window.clearTimeout(timer)
  }, [signature, dataUpdatedAt, isFetching, refetch])

  // Scoring just finished: the last scores, now, not up to 30 s later.
  const pending = counts?.pending ?? 0
  const previousPending = React.useRef(pending)
  React.useEffect(() => {
    if (previousPending.current > 0 && pending === 0 && dataUpdatedAt) {
      void refetch()
    }
    previousPending.current = pending
  }, [pending, dataUpdatedAt, refetch])

  return list
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
    queryKey: [
      ...hrKeys.interviews,
      options.status ?? "all",
      options.limit ?? 0,
    ],
    queryFn: () => listInterviews(options),
    // A resume fit is analysed in the background for ~10–15 s after an
    // interview is created, and the list doesn't push updates: re-read it
    // while any row is still being analysed, and stop once none is.
    refetchInterval: (query) =>
      query.state.data?.some((row) => row.fit?.status === "pending")
        ? FIT_POLL_MS
        : false,
  })
}

/** How often the interviews list is re-read while a resume fit is pending. */
const FIT_POLL_MS = 15_000

/**
 * How often the live list refreshes. A sitting starts and ends on the
 * candidate's schedule, so the page has to notice on its own; 10s keeps a card
 * from lingering long after someone finished without polling for its own sake.
 */
const LIVE_POLL_MS = 10_000

/** How often the staff-side vitals fallback is re-read. Frames arrive every 3s. */
const VITALS_POLL_MS = 8000

/**
 * Interviews someone may be sitting right now.
 *
 * Filtered here rather than through `?status=` — `openapi.json` says that
 * parameter takes a comma-separated list, but that form is unverified against
 * the live server, and a mis-parse would show an empty page rather than an
 * obvious error. The unfiltered list is one request either way.
 */
export function useLiveInterviews() {
  return useQuery({
    queryKey: hrKeys.liveInterviews,
    queryFn: () => listInterviews(),
    refetchInterval: LIVE_POLL_MS,
    select: (rows) => rows.filter(isLiveInterview),
  })
}

/**
 * One live sitting, from the same cached list the cards came from — so opening
 * a card costs no request, and the row simply disappears when the candidate
 * finishes, which is exactly the signal the watch page needs.
 */
export function useLiveInterviewRow(interviewId: string | undefined) {
  return useQuery({
    queryKey: hrKeys.liveInterviews,
    queryFn: () => listInterviews(),
    refetchInterval: LIVE_POLL_MS,
    select: (rows) =>
      rows.find(
        (row) => row.interviewId === interviewId && isLiveInterview(row)
      ) ?? null,
  })
}

/**
 * Vitals for a sitting in progress — the fallback for when peer-to-peer can't
 * form, since the candidate relays their own readings over it when it can.
 *
 * Never retried and never surfaced as an error: see {@link getLiveVitals} for
 * why a rejection here means "nothing to show", not "something is broken".
 */
export function useLiveVitals(sessionId: string | null | undefined) {
  return useQuery({
    queryKey: hrKeys.liveVitals(sessionId ?? ""),
    queryFn: () => getLiveVitals(sessionId!),
    enabled: Boolean(sessionId),
    refetchInterval: VITALS_POLL_MS,
    retry: false,
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
    refreshDerivedReads(client)
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
          job.status === "closed"
            ? `${job.title} closed.`
            : `${job.title} updated.`
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

  // One prefix, not three: `hrKeys.job` and `hrKeys.shortlist` both extend
  // `hrKeys.jobs`, so this reaches the shortlist, the job and the list the user
  // returns to — which carries per-job candidate counts of its own.
  const refresh = () => {
    void client.invalidateQueries({ queryKey: hrKeys.jobs })
    refreshDerivedReads(client)
  }
  const reportError = (error: Error) => toast.error(error.message)

  /** Batch calls report partial success, so say what actually happened. */
  const reportBatch = (created: number, errors: number, noun: string) => {
    if (created > 0) toast.success(`${created} ${noun} added.`)
    if (errors > 0) {
      toast.warning(
        `${errors} ${errors === 1 ? "row was" : "rows were"} rejected. See the list below.`
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

    /** Only before scheduling — see {@link updateJobCandidate}. */
    edit: useMutation({
      mutationFn: ({
        candidateId,
        changes,
      }: {
        candidateId: string
        changes: Parameters<typeof updateJobCandidate>[2]
      }) => updateJobCandidate(jobId!, candidateId, changes),
      onSuccess: (candidate) => {
        toast.success(`${candidate.name || candidate.email} updated.`)
        refresh()
        void client.invalidateQueries({
          queryKey: hrKeys.candidate(candidate.candidateId),
        })
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
      /**
       * The schedule call carries `voice_mode: true` itself — see
       * {@link scheduleCandidates}.
       *
       * **This used to `PATCH` the job onto voice first, and no longer needs
       * to.** That was a workaround for a real gap: `/schedule` took no
       * `voice_mode`, so an interview created by it inherited the job's — which
       * defaults to `false`, so every job created before voice existed
       * scheduled typed interviews for ever. The same product handed two
       * candidates two different interviews depending on whether a recruiter
       * used New interview or Schedule.
       *
       * The backend closed it on 2026-09-09: the schedule request now takes an
       * optional `voice_mode` that **overrides the job for that batch**, which
       * makes it symmetric with create-interview. So the flag goes in the one
       * call that creates the interviews, and the job no longer has to be
       * edited as a side effect of inviting candidates — which also cost an
       * extra request and an Activity Logs entry every time.
       */
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
        // Scheduling charges the whole batch up front.
        refreshCreditReads(client)
      },
      onError: reportUnlessShortfall,
    }),
  }
}

/**
 * Creates a one-off interview, outside the job funnel — **as a draft**: nothing
 * reaches the candidate until {@link useInviteInterview} sends it.
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
      refreshDerivedReads(client)
    },
    onError: (error: Error) => toast.error(error.message),
  })
}

/**
 * Sends — or re-sends — one interview's invitation. See {@link inviteInterview}.
 *
 * Refetches the list because sending is not inert on the server side: the row
 * stops being a draft, and its invitation time and expiry move, while the
 * recruiter is looking straight at it.
 */
export function useInviteInterview() {
  const client = useQueryClient()

  return useMutation({
    mutationFn: inviteInterview,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: hrKeys.interviews })
      refreshDerivedReads(client)
      // A draft's first send is what charges it.
      refreshCreditReads(client)
    },
    onError: reportUnlessShortfall,
  })
}

/** Corrects a draft's candidate. See {@link updateInterviewCandidate}. */
export function useUpdateInterviewCandidate() {
  const client = useQueryClient()

  return useMutation({
    mutationFn: ({
      interviewId,
      changes,
    }: {
      interviewId: string
      changes: Parameters<typeof updateInterviewCandidate>[1]
    }) => updateInterviewCandidate(interviewId, changes),
    onSuccess: () => {
      toast.success("Candidate details updated.")
      void client.invalidateQueries({ queryKey: hrKeys.interviews })
    },
    onError: (error: Error) => toast.error(error.message),
  })
}

/** Standalone Resume scoring — no job, nothing persisted. */
export function useResumeAnalysis() {
  return useMutation({
    mutationFn: analyseResume,
    onError: (error: Error) => toast.error(error.message),
  })
}
