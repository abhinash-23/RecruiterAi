/**
 * ============================================================================
 * PLATFORM ANALYTICS AND AUDIT — `/api/platform/*`
 * ============================================================================
 * The super admin's read-only view of the whole platform.
 *
 * Deliberately aggregate-only: there is **no drill-down to an individual
 * interview or candidate** at this tier, and the API answers 403 if you try.
 * Per-client totals are as granular as it gets.
 */

import { currentAccessToken } from "@/services/auth-service"
import {
  apiDownload,
  apiFetch,
  isMissingEndpoint,
  type DownloadedFile,
} from "@/services/http-client"
import {
  auditPageQuery,
  auditQuery,
  toAuditLogPage,
  type AuditLogFilters,
  type AuditLogPage,
  type AuditLogPageRequest,
} from "@/services/audit-log"

export {
  AUDIT_LOG_MAX_LIMIT,
  AUDIT_SEARCH_MAX_LENGTH,
  auditActionLabel,
  auditRowId,
  type AuditLogEntry,
  type AuditLogFilters,
  type AuditLogPage,
  type AuditLogPageRequest,
} from "@/services/audit-log"

/* ========================================================================== */
/*  Types                                                                     */
/* ========================================================================== */

export interface InterviewTotals {
  total: number
  /** Keyed by interview status; absent keys mean zero. */
  byStatus: Record<string, number>
  completionRatePct: number
  abandonmentRatePct: number
}

/** One tenant's row in the analytics table. */
export interface CompanyAnalytics {
  companyId: string
  name: string
  slug: string
  isActive: boolean
  interviews: InterviewTotals
  /** User counts keyed by role. */
  users: Record<string, number>
}

export interface PlatformAnalytics {
  totalClients: number
  activeClients: number
  /** Counts keyed by role: `admin`, `hr`, `super_admin`. */
  usersByRole: Record<string, number>
  totalUsers: number
  totalInterviews: number
  interviewsByStatus: Record<string, number>
  completionRatePct: number
  abandonmentRatePct: number
  /** Interviews belonging to no tenant — machine-key or legacy rows. */
  unassignedInterviews: number
  companies: CompanyAnalytics[]
}

/** One choice for the Actions filter, with how often it has happened. */
export interface AuditActionCount {
  action: string
  count: number
}

/* ========================================================================== */
/*  Calls                                                                     */
/* ========================================================================== */

interface AnalyticsEnvelope {
  status: string
  totals: {
    companies: number
    activeCompanies: number
    users: Record<string, number>
    interviews: InterviewTotals
    unassignedInterviews: number
  }
  companies: CompanyAnalytics[]
}

export async function getPlatformAnalytics(): Promise<PlatformAnalytics> {
  const response = await apiFetch<AnalyticsEnvelope>("/platform/analytics", {
    token: currentAccessToken(),
  })

  const { totals } = response

  return {
    totalClients: totals.companies,
    activeClients: totals.activeCompanies,
    usersByRole: totals.users,
    totalUsers: Object.values(totals.users).reduce((sum, n) => sum + n, 0),
    totalInterviews: totals.interviews.total,
    interviewsByStatus: totals.interviews.byStatus,
    completionRatePct: totals.interviews.completionRatePct,
    abandonmentRatePct: totals.interviews.abandonmentRatePct,
    unassignedInterviews: totals.unassignedInterviews,
    companies: response.companies,
  }
}

/** One page of the platform-wide audit trail, newest first. */
export async function getPlatformAuditLogs(
  request: AuditLogPageRequest
): Promise<AuditLogPage> {
  const response = await apiFetch<Parameters<typeof toAuditLogPage>[0]>(
    `/platform/audit-logs?${auditPageQuery(request)}`,
    { token: currentAccessToken() }
  )
  return toAuditLogPage(response)
}

/**
 * Every action that has happened at least once, A→Z, with its count — the
 * Actions filter's choices. **Null on a backend without the endpoint**, so the
 * page can fall back to the actions it has already loaded.
 */
export async function getAuditLogActions(): Promise<AuditActionCount[] | null> {
  try {
    const response = await apiFetch<{
      status: string
      actions: AuditActionCount[]
    }>("/platform/audit-logs/actions", { token: currentAccessToken() })
    return response.actions ?? []
  } catch (error) {
    if (isMissingEndpoint(error)) return null
    throw error
  }
}

/**
 * The audit trail as a CSV file, with the same filters and search as the
 * table, in the same order. Times in
 * the file are the viewer's own. Nothing matching still returns a file — just
 * the header row. More than 50,000 rows is a 422 asking to narrow it.
 */
export function exportPlatformAuditLogs(
  filters: AuditLogFilters
): Promise<DownloadedFile> {
  return apiDownload(`/platform/audit-logs/export?${auditQuery(filters)}`, {
    token: currentAccessToken(),
    fallbackName: "Audit_log.csv",
  })
}
