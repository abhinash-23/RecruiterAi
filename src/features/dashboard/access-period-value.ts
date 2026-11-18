import { format } from "date-fns"

import type { AccessPeriod } from "@/services/super-admin"

/**
 * What the access picker holds. `keep` is offered only when re-enabling an
 * admin whose period is still running: it sends no period, so that period
 * carries on.
 */
export type AccessChoice = "keep" | "none" | "2d" | "5d" | "1m" | "6m" | "until"

export interface AccessValue {
  choice: AccessChoice
  /** `YYYY-MM-DD`, used when `choice` is `until`. */
  until: string
}

export const NO_LIMIT: AccessValue = { choice: "none", until: "" }

/**
 * The period to send, or null when "Until a date" has no date yet. The end is
 * worked out by the backend; nothing here computes it.
 */
export function toAccessPeriod(
  value: AccessValue
): AccessPeriod | "keep" | null {
  switch (value.choice) {
    case "keep":
      return "keep"
    case "none":
      return { kind: "none" }
    case "2d":
      return { kind: "days", days: 2 }
    case "5d":
      return { kind: "days", days: 5 }
    case "1m":
      return { kind: "months", months: 1 }
    case "6m":
      return { kind: "months", months: 6 }
    case "until":
      return value.until ? { kind: "until", date: value.until } : null
  }
}

/** "22 Nov 2026, 3:07 PM", in the viewer's own time. */
export function formatAccessEnd(iso: string): string {
  return format(new Date(iso), "d MMM yyyy, h:mm a")
}
