/**
 * ============================================================================
 * AUDIT LOG — shared by `/platform/audit-logs` and `/company/audit-logs`
 * ============================================================================
 * Both endpoints take the same query and send the same reply, so the shape,
 * the query string and the parsing live here once.
 *
 * **Paging is by cursor.** A reply carries `nextCursor` (null on the last
 * page); the next page is the *same* request plus `cursor=<nextCursor>`. The
 * backend sorts on `(createdAt DESC, id DESC)` and pages by key, so entries
 * written while someone is paging never shift a page: every entry comes back
 * exactly once. There is no backward cursor — the caller keeps the cursors it
 * used to go back (see the Activity Logs page).
 *
 * A backend from before paging sends no `total` or `nextCursor`. The reply is
 * then marked `paged: false` and the page falls back to one capped read.
 */

import { tzOffsetMinutes } from "@/lib/save-file"

export interface AuditLogEntry {
  /** Unique per entry. Absent on a backend from before paging. */
  id?: string | number
  actorEmail: string
  action: string
  target: string
  details: Record<string, unknown>
  ipAddress: string
  createdAt: string
}

/**
 * What the audit trail is narrowed to. All optional; nothing set means
 * everything. Days are the viewer's own (see `tz_offset_minutes`).
 */
export interface AuditLogFilters {
  /** `YYYY-MM-DD`, from the start of that day. */
  dateFrom?: string
  /** `YYYY-MM-DD`, up to the end of that day. */
  dateTo?: string
  /** Raw `snake_case` names, e.g. `credits_granted`. Empty means all. */
  actions?: string[]
  /**
   * Free-text search, matched by the backend over the action (and its label),
   * actor email, target, IP and the values in `details`. Blank = no search.
   */
  q?: string
}

/** The server's ceiling for one page. */
export const AUDIT_LOG_MAX_LIMIT = 500

/** The longest search the server accepts (422 beyond it). */
export const AUDIT_SEARCH_MAX_LENGTH = 200

export interface AuditLogPageRequest {
  filters: AuditLogFilters
  /** Entries per page, 1–500. */
  limit: number
  /** From the previous page's `nextCursor`; null for the first page. */
  cursor: string | null
}

export interface AuditLogPage {
  logs: AuditLogEntry[]
  /** Pass back as `cursor` for the next page. Null on the last page. */
  nextCursor: string | null
  /** Entries matching the filters, across every page. */
  total: number
  /**
   * False on a backend from before paging: no `total`, no cursor, `q` ignored.
   * The caller then reads one capped page and searches it itself.
   */
  paged: boolean
}

interface AuditLogEnvelope {
  status: string
  logs: AuditLogEntry[]
  nextCursor?: string | null
  total?: number
}

function toUtcIso(value: string): string {
  return /(?:Z|[+-]\d{2}:?\d{2})$/.test(value) ? value : `${value}Z`
}

/**
 * The filters as a query string. `action` goes as **one comma-separated
 * value** — the backend ignores a repeated or `action[]=` parameter.
 */
export function auditQuery(filters: AuditLogFilters = {}): URLSearchParams {
  const query = new URLSearchParams()
  if (filters.dateFrom) query.set("date_from", filters.dateFrom)
  if (filters.dateTo) query.set("date_to", filters.dateTo)
  if (filters.actions?.length) query.set("action", filters.actions.join(","))
  const q = filters.q?.trim()
  if (q) query.set("q", q)
  query.set("tz_offset_minutes", String(tzOffsetMinutes()))
  return query
}

/** The query for one page: filters, limit, and the cursor when there is one. */
export function auditPageQuery(request: AuditLogPageRequest): URLSearchParams {
  const query = auditQuery(request.filters)
  query.set("limit", String(Math.min(request.limit, AUDIT_LOG_MAX_LIMIT)))
  if (request.cursor) query.set("cursor", request.cursor)
  return query
}

/** `createdAt` arrives UTC with no `Z` (and maybe fractions of a second). */
export function toAuditLogPage(response: AuditLogEnvelope): AuditLogPage {
  const logs = response.logs.map((entry) => ({
    ...entry,
    createdAt: toUtcIso(entry.createdAt),
  }))
  const paged = typeof response.total === "number"
  return {
    logs,
    nextCursor: paged ? (response.nextCursor ?? null) : null,
    total: paged ? (response.total as number) : logs.length,
    paged,
  }
}

/**
 * A stable row key: the entry's `id`, or — on a backend without ids — the
 * closest thing to one.
 */
export function auditRowId(entry: AuditLogEntry): string {
  return entry.id !== undefined && entry.id !== null
    ? String(entry.id)
    : `${entry.createdAt}-${entry.actorEmail}-${entry.action}`
}

/** Labels for actions whose raw name reads badly once humanised. */
const ACTION_LABELS: Record<string, string> = {
  admin_access_set: "Access period set",
  admin_access_ended: "Access ended",
}

/** `candidates_scheduled` → `Candidates scheduled`, or a label from above. */
export function auditActionLabel(action: string): string {
  const known = ACTION_LABELS[action]
  if (known) return known
  const spaced = action.replace(/[._-]+/g, " ").trim()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}
