import type { FilterSpec } from "@/components/shared/data-table"
import type { InterviewRow } from "@/services/hr"

/**
 * Stands in for `createdBy: null` in the recruiter filter — rows created by a
 * machine key or before the field existed. A filter value can't be null, and
 * grouping them under one key beats dropping them from the list.
 */
export const SYSTEM_SCHEDULED = "__system__"

/** What a row is grouped and filtered by. */
export function schedulerKey(row: InterviewRow): string {
  return row.createdBy?.userId ?? SYSTEM_SCHEDULED
}

/** What a recruiter is called on screen, in the column and in the dropdown. */
export function schedulerLabel(row: InterviewRow): string {
  return row.createdBy?.fullName || row.createdBy?.email || "System / API"
}

/**
 * "Whose candidate is this" — the same dropdown on the Interviews list and on
 * Results, because both read the same `GET /api/interviews` rows.
 *
 * Shared rather than written twice: the two must agree on the sentinel above and
 * on the wording, or the same recruiter appears under two names and one page's
 * filter quietly matches rows the other's doesn't.
 *
 * Built from **the rows on screen**, not from `GET /api/company/hrs`. Two
 * reasons: it costs no extra request, and it can only offer names that match at
 * least one row — a seat that has scheduled nothing would otherwise sit in the
 * list filtering the table to empty.
 */
export function recruiterFilter(rows: InterviewRow[]): FilterSpec<InterviewRow> {
  const seen = new Map<string, string>()
  for (const row of rows) {
    const key = schedulerKey(row)
    if (!seen.has(key)) seen.set(key, schedulerLabel(row))
  }

  return {
    id: "recruiter",
    label: "Recruiters",
    options: [...seen]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    predicate: (row, value) => schedulerKey(row) === value,
  }
}
