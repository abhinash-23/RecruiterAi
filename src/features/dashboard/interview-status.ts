import type { InterviewRow, InterviewStatus } from "@/services/hr"

/**
 * The API's interview lifecycle, in order, with the wording staff see.
 *
 * Shared so the Interviews list, its filter and the dashboard can't drift into
 * calling the same state three different things.
 */
export const STATUS_OPTIONS: Array<{ value: InterviewStatus; label: string }> = [
  { value: "created", label: "Invited" },
  { value: "consent_given", label: "Consent given" },
  { value: "in_progress", label: "In progress" },
  { value: "completed", label: "Completed" },
  { value: "expired", label: "Expired" },
  { value: "abandoned", label: "Abandoned" },
  { value: "consent_refused", label: "Consent refused" },
  { value: "superseded", label: "Superseded" },
]

export const STATUS_LABEL: Record<string, string> = Object.fromEntries(
  STATUS_OPTIONS.map((option) => [option.value, option.label])
)

/** Maps the API's lifecycle onto the badge component's visual vocabulary. */
export function badgeStatus(status: string) {
  if (status === "completed") return "completed"
  if (status === "in_progress" || status === "consent_given") return "ongoing"
  if (status === "created") return "scheduled"
  return "disabled"
}

/**
 * The badge for a whole row, which knows one thing the status alone doesn't:
 * a **draft** is `created` too, but nothing has been sent, so calling it
 * "Invited" would tell a recruiter the candidate has a link they don't have.
 */
export function rowBadge(row: Pick<InterviewRow, "status" | "isDraft">): {
  status: string
  label: string
} {
  if (row.isDraft) return { status: "draft", label: "Draft" }
  return {
    status: badgeStatus(row.status),
    label: STATUS_LABEL[row.status] ?? row.status,
  }
}
