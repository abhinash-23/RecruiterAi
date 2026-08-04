/**
 * ============================================================================
 * THE CLIENT'S OWN SETTINGS — `/api/company/*`
 * ============================================================================
 * Everything an Admin manages about their own company: the dashboard counts,
 * the audit trail, the profile, their white-label branding, and the interview
 * defaults HR inherits when scheduling.
 *
 * No company id appears in any URL — scope comes from the bearer token.
 *
 * **Disabled-client mode:** if the super admin has disabled this tenant, reads
 * keep working but every write answers `403 "This company is disabled and
 * read-only."` — `isReadOnlyCompanyError` below identifies that specific case
 * so the UI can show a suspension banner instead of a generic failure.
 */

import { currentAccessToken } from "@/services/auth-service"
import { ApiError, apiFetch, type RequestOptions } from "@/services/http-client"

/* ========================================================================== */
/*  Types                                                                     */
/* ========================================================================== */

export interface CompanyProfile {
  companyId: string
  name: string
  slug: string
  supportEmail: string
  isActive: boolean
  tenancyEnforced: boolean
  createdAt: string
  updatedAt: string
}

export interface CompanyDashboard {
  company: CompanyProfile
  interviews: {
    total: number
    /** Keyed by interview status; absent keys mean zero. */
    byStatus: Record<string, number>
    completionRatePct: number
    abandonmentRatePct: number
  }
  hrs: { total: number; active: number }
}

export interface AuditLogEntry {
  actorEmail: string
  action: string
  target: string
  details: Record<string, unknown>
  ipAddress: string
  createdAt: string
}

export interface Branding {
  appName: string
  logoUrl: string | null
  primaryColor: string
  accentColor: string
  companyName?: string
  supportEmail?: string
}

/** Rounds an interview can be built from. Anything else is a 422. */
export const INTERVIEW_ROUND_OPTIONS = [
  "aptitude",
  "psychometrics",
  "softskills",
  "resume",
  "jd",
] as const

export type InterviewRound = (typeof INTERVIEW_ROUND_OPTIONS)[number]

export interface InterviewDefaults {
  rounds: InterviewRound[]
  timeMinutes: number
  linkExpiryHours: number
}

/* ========================================================================== */
/*  Helpers                                                                   */
/* ========================================================================== */

function authed<T>(path: string, options: Omit<RequestOptions, "token"> = {}) {
  return apiFetch<T>(path, { ...options, token: currentAccessToken() })
}

function toUtcIso(value: string): string {
  return /(?:Z|[+-]\d{2}:?\d{2})$/.test(value) ? value : `${value}Z`
}

/**
 * True for the "your company is suspended" 403, as opposed to an ordinary
 * permission failure. Worth distinguishing: one is a billing/account state the
 * user can't fix by trying again, the other is a bug or a wrong role.
 */
export function isReadOnlyCompanyError(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.status === 403 &&
    /disabled and read-only/i.test(error.message)
  )
}

/* ========================================================================== */
/*  Calls                                                                     */
/* ========================================================================== */

export async function getCompanyDashboard(): Promise<CompanyDashboard> {
  const response = await authed<{
    status: string
    company: CompanyProfile
    interviews: CompanyDashboard["interviews"]
    hrs: CompanyDashboard["hrs"]
  }>("/company/dashboard")

  return {
    company: {
      ...response.company,
      createdAt: toUtcIso(response.company.createdAt),
      updatedAt: toUtcIso(response.company.updatedAt),
    },
    interviews: response.interviews,
    hrs: response.hrs,
  }
}

export async function getCompanyAuditLogs(
  limit = 50
): Promise<AuditLogEntry[]> {
  const response = await authed<{ status: string; logs: AuditLogEntry[] }>(
    `/company/audit-logs?limit=${limit}`
  )
  return response.logs.map((entry) => ({
    ...entry,
    createdAt: toUtcIso(entry.createdAt),
  }))
}

export async function getCompanyProfile(): Promise<CompanyProfile> {
  const response = await authed<{ status: string; company: CompanyProfile }>(
    "/company/profile"
  )
  return {
    ...response.company,
    createdAt: toUtcIso(response.company.createdAt),
    updatedAt: toUtcIso(response.company.updatedAt),
  }
}

export async function updateCompanyProfile(input: {
  name?: string
  supportEmail?: string
}): Promise<CompanyProfile> {
  const body: Record<string, string> = {}
  if (input.name !== undefined) body.name = input.name.trim()
  if (input.supportEmail !== undefined) {
    body.support_email = input.supportEmail.trim()
  }

  const response = await authed<{ status: string; company: CompanyProfile }>(
    "/company/profile",
    { method: "PATCH", body }
  )
  return {
    ...response.company,
    createdAt: toUtcIso(response.company.createdAt),
    updatedAt: toUtcIso(response.company.updatedAt),
  }
}

export async function getBranding(): Promise<Branding> {
  const response = await authed<{ status: string; branding: Branding }>(
    "/company/branding"
  )
  return response.branding
}

/** Colours must be `#rrggbb`; anything else is a 422. */
export async function updateBranding(input: {
  appName?: string
  primaryColor?: string
  accentColor?: string
}): Promise<Branding> {
  const body: Record<string, string> = {}
  if (input.appName !== undefined) body.app_name = input.appName.trim()
  if (input.primaryColor !== undefined) body.primary_color = input.primaryColor
  if (input.accentColor !== undefined) body.accent_color = input.accentColor

  const response = await authed<{ status: string; branding: Branding }>(
    "/company/branding",
    { method: "PATCH", body }
  )
  return response.branding
}

/**
 * Limits for the logo upload, checked before sending.
 *
 * The endpoint answers a bare 422 for a file it won't take, which tells the
 * admin nothing about which part of it was wrong.
 */
export const LOGO_UPLOAD = {
  accept: "image/png,image/jpeg,image/svg+xml,image/webp",
  maxBytes: 5 * 1024 * 1024,
} as const

/**
 * Sends the file as multipart under the field name `logo`, and returns the URL
 * of the stored file.
 *
 * Unlike the branding PATCH this answers `{ status, logoUrl }` — the whole
 * branding record does *not* come back. The URL carries a `?v=` stamp that
 * changes on every upload, which is the only thing that makes a browser drop
 * the logo it already cached.
 */
export async function uploadBrandingLogo(file: File): Promise<string | null> {
  const form = new FormData()
  form.append("logo", file)

  const response = await authed<{ status: string; logoUrl?: string }>(
    "/company/branding/logo",
    { method: "POST", body: form }
  )
  return response.logoUrl ?? null
}

export async function deleteBrandingLogo(): Promise<void> {
  await authed("/company/branding/logo", { method: "DELETE" })
}

export async function getInterviewDefaults(): Promise<InterviewDefaults> {
  const response = await authed<{
    status: string
    defaults: { rounds: InterviewRound[]; time_minutes: number; link_expiry_hours: number }
  }>("/company/interview-defaults")

  return {
    rounds: response.defaults.rounds,
    timeMinutes: response.defaults.time_minutes,
    linkExpiryHours: response.defaults.link_expiry_hours,
  }
}

export async function updateInterviewDefaults(input: {
  rounds?: InterviewRound[]
  timeMinutes?: number
  linkExpiryHours?: number
}): Promise<InterviewDefaults> {
  const body: Record<string, unknown> = {}
  if (input.rounds !== undefined) body.rounds = input.rounds
  if (input.timeMinutes !== undefined) body.time_minutes = input.timeMinutes
  if (input.linkExpiryHours !== undefined) {
    body.link_expiry_hours = input.linkExpiryHours
  }

  const response = await authed<{
    status: string
    defaults: { rounds: InterviewRound[]; time_minutes: number; link_expiry_hours: number }
  }>("/company/interview-defaults", { method: "PATCH", body })

  return {
    rounds: response.defaults.rounds,
    timeMinutes: response.defaults.time_minutes,
    linkExpiryHours: response.defaults.link_expiry_hours,
  }
}

/* ========================================================================== */
/*  Public branding (no token) — login page and candidate pages               */
/* ========================================================================== */

/**
 * White-label branding for a client, with **no token at all**.
 *
 * Two ways to name the client, and the second is what makes a candidate page
 * possible: `company` is the slug the login page has from its URL, while
 * `interview` is the id out of the invitation link — the server resolves the
 * owning client from it, so the code, consent and interview screens can wear the
 * company's logo without a session or a slug (§5).
 *
 * An unknown id or slug returns platform defaults rather than an error, so a
 * stale link still renders a usable page.
 */
export async function getPublicBranding(
  scope: { company?: string; interview?: string } = {}
): Promise<Branding> {
  const query = new URLSearchParams()
  if (scope.interview) query.set("interview", scope.interview)
  else if (scope.company) query.set("company", scope.company)

  const suffix = query.size > 0 ? `?${query}` : ""
  const response = await apiFetch<{ status: string; branding: Branding }>(
    `/branding${suffix}`
  )
  return response.branding
}
