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
import { apiFetch } from "@/services/http-client"

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
  /** False means this tenant can read other tenants' interviews. */
  tenancyEnforced: boolean
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
  /**
   * Interviews belonging to no tenant — machine-key or legacy rows. Visible to
   * every tenant that doesn't have isolation enforced.
   */
  unassignedInterviews: number
  companies: CompanyAnalytics[]
}

export interface AuditLogEntry {
  actorEmail: string
  action: string
  target: string
  details: Record<string, unknown>
  ipAddress: string
  createdAt: string
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

function toUtcIso(value: string): string {
  return /(?:Z|[+-]\d{2}:?\d{2})$/.test(value) ? value : `${value}Z`
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

export async function getPlatformAuditLogs(
  limit = 50
): Promise<AuditLogEntry[]> {
  const response = await apiFetch<{ status: string; logs: AuditLogEntry[] }>(
    `/platform/audit-logs?limit=${limit}`,
    { token: currentAccessToken() }
  )
  return response.logs.map((entry) => ({
    ...entry,
    createdAt: toUtcIso(entry.createdAt),
  }))
}
