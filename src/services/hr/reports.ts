/**
 * ============================================================================
 * RESULT REPORTS AND THE CANDIDATE FEEDBACK EMAIL
 * ============================================================================
 *
 *   GET  /api/interviews/{id}/report                   one candidate's PDF
 *   POST /api/interviews/reports                       a ZIP of many
 *   GET  /api/interviews/{id}/feedback-email           the email's status
 *   POST /api/interviews/{id}/feedback-email/resend    send it (again)
 *
 * Same access rule as the results page: HR sees their own interviews, admin
 * the company's, and anything else is a 404 — never a 403, so ids can't be
 * probed. The super admin is refused outright; the platform owner never sees
 * candidate data.
 *
 * Every time printed in a report is in the reader's own zone, so every
 * download sends `tz_offset_minutes`. It also decides where a date filter's
 * days begin and end.
 */

import { currentAccessToken } from "@/services/auth-service"
import {
  apiDownload,
  apiFetch,
  isMissingEndpoint,
  type DownloadedFile,
} from "@/services/http-client"
import { tzOffsetMinutes } from "@/lib/save-file"

/* ========================================================================== */
/*  Reports                                                                   */
/* ========================================================================== */

/** The verdicts a ZIP can be narrowed to. Note the space in `NOT SELECTED`. */
export type ReportVerdict = "SELECTED" | "NOT SELECTED"

/** The server's ceiling for one ZIP; more is a 422 asking to narrow it. */
export const REPORT_LIMITS = {
  maxPerZip: 200,
  /** Measured by the backend: roughly this long to render each report. */
  secondsPerReport: 0.3,
} as const

/**
 * Filters for a ZIP. All optional, and they combine — every one given must
 * match. Nothing at all downloads everything the caller can see.
 */
export interface ReportFilters {
  /** The rows ticked. Ones the caller can't see are ignored, not refused. */
  interviewIds?: string[]
  jobId?: string
  /** `YYYY-MM-DD`, in the reader's own days. */
  completedFrom?: string
  /** `YYYY-MM-DD`, inclusive. */
  completedTo?: string
  result?: ReportVerdict
}

/** One completed interview's report. A 409 if it has no result yet. */
export function downloadInterviewReport(
  interviewId: string
): Promise<DownloadedFile> {
  const id = encodeURIComponent(interviewId.trim())
  return apiDownload(
    `/interviews/${id}/report?tz_offset_minutes=${tzOffsetMinutes()}`,
    { token: currentAccessToken(), fallbackName: "interview_report.pdf" }
  )
}

/**
 * A ZIP: a ranked summary PDF first, then one report per candidate, best
 * score first. Interviews without a result are skipped, not refused; a
 * selection that matches nothing is a 404 with its own sentence.
 */
export function downloadInterviewReports(
  filters: ReportFilters
): Promise<DownloadedFile> {
  const body: Record<string, unknown> = { tz_offset_minutes: tzOffsetMinutes() }
  if (filters.interviewIds?.length) body.interview_ids = filters.interviewIds
  if (filters.jobId) body.job_id = filters.jobId
  if (filters.completedFrom) body.completed_from = filters.completedFrom
  if (filters.completedTo) body.completed_to = filters.completedTo
  if (filters.result) body.result = filters.result

  return apiDownload("/interviews/reports", {
    method: "POST",
    body,
    token: currentAccessToken(),
    fallbackName: "Interview_results.zip",
  })
}

/* ========================================================================== */
/*  Candidate feedback email                                                  */
/* ========================================================================== */

export type FeedbackEmailStatus =
  "none" | "pending" | "sending" | "sent" | "failed"

/** The backend gives up after this many tries; Resend starts the count again. */
export const FEEDBACK_MAX_ATTEMPTS = 8

export type FeedbackResourceKind = "video" | "course" | "article"

const RESOURCE_KINDS: readonly FeedbackResourceKind[] = [
  "video",
  "course",
  "article",
]

export interface FeedbackResource {
  title: string
  /** The channel or site, e.g. "freeCodeCamp.org". */
  provider: string
  /** Null when the backend sent an unknown kind (or none). */
  kind: FeedbackResourceKind | null
  url: string
}

export interface FeedbackImprovement {
  area: string
  advice: string
  /** 0–2 links; always empty for a selected candidate. */
  resources: FeedbackResource[]
}

/** Exactly what the candidate received, or will. */
export interface FeedbackEmailContent {
  subject: string
  strengths: string[]
  improvements: FeedbackImprovement[]
}

export interface FeedbackEmailState {
  status: FeedbackEmailStatus
  outcome: "selected" | "not_selected" | null
  to: string | null
  /** Epoch millis of the last successful send. */
  sentAt: number | null
  attempts: number
  /** Technical; for admins, never the candidate-facing copy. */
  lastError: string | null
  /** Null until the email has been written. */
  email: FeedbackEmailContent | null
}

interface RawFeedbackEmail {
  status?: string
  outcome?: string | null
  to?: string | null
  sent_at?: string | null
  attempts?: number | null
  last_error?: string | null
  email?: {
    subject?: string
    strengths?: unknown
    improvements?: unknown
  } | null
}

function toUtcMillis(value: string | null | undefined): number | null {
  if (!value) return null
  const iso = /(?:Z|[+-]\d{2}:?\d{2})$/.test(value) ? value : `${value}Z`
  const ms = Date.parse(iso)
  return Number.isNaN(ms) ? null : ms
}

const STATUSES: readonly FeedbackEmailStatus[] = [
  "none",
  "pending",
  "sending",
  "sent",
  "failed",
]

function toFeedbackEmail(raw: RawFeedbackEmail): FeedbackEmailState {
  const status = STATUSES.includes(raw.status as FeedbackEmailStatus)
    ? (raw.status as FeedbackEmailStatus)
    : "none"
  const email = raw.email
  const strings = (value: unknown) =>
    Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : []

  return {
    status,
    outcome:
      raw.outcome === "selected" || raw.outcome === "not_selected"
        ? raw.outcome
        : null,
    to: raw.to ?? null,
    sentAt: toUtcMillis(raw.sent_at),
    attempts: raw.attempts ?? 0,
    lastError: raw.last_error ?? null,
    email: email
      ? {
          subject: email.subject ?? "",
          strengths: strings(email.strengths),
          improvements: (Array.isArray(email.improvements)
            ? email.improvements
            : []
          ).map((item) => {
            const entry = (item ?? {}) as Record<string, unknown>
            const resources = Array.isArray(entry.resources)
              ? entry.resources
              : []
            return {
              area: typeof entry.area === "string" ? entry.area : "",
              advice: typeof entry.advice === "string" ? entry.advice : "",
              resources: resources
                .map((resource) => (resource ?? {}) as Record<string, unknown>)
                .filter((resource) => typeof resource.url === "string")
                .map((resource) => ({
                  title:
                    typeof resource.title === "string"
                      ? resource.title
                      : String(resource.url),
                  provider:
                    typeof resource.provider === "string"
                      ? resource.provider
                      : "",
                  kind: RESOURCE_KINDS.includes(
                    resource.kind as FeedbackResourceKind
                  )
                    ? (resource.kind as FeedbackResourceKind)
                    : null,
                  url: String(resource.url),
                })),
            }
          }),
        }
      : null,
  }
}

/**
 * The feedback email's state, or **null on a backend without the feature**
 * — the card hides itself rather than reporting a missing endpoint as a
 * missing interview.
 */
export async function getFeedbackEmail(
  interviewId: string
): Promise<FeedbackEmailState | null> {
  try {
    const raw = await apiFetch<RawFeedbackEmail>(
      `/interviews/${encodeURIComponent(interviewId)}/feedback-email`,
      { token: currentAccessToken() }
    )
    return toFeedbackEmail(raw)
  } catch (error) {
    if (isMissingEndpoint(error)) return null
    throw error
  }
}

/**
 * Sends the email — the first one for an interview that never had one, else
 * **the same email again**, not a rewritten one. Answers at once with
 * `pending`; the status moves on in the background.
 */
export async function resendFeedbackEmail(interviewId: string): Promise<void> {
  await apiFetch(
    `/interviews/${encodeURIComponent(interviewId)}/feedback-email/resend`,
    { method: "POST", token: currentAccessToken() }
  )
}
