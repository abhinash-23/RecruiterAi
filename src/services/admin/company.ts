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
  /**
   * The legacy single field, which **is** the dark slot — every logo uploaded
   * before the light slot existed landed here, so there was nothing to migrate.
   * Prefer the two below; this is kept for payloads that predate them.
   */
  logoUrl: string | null
  /**
   * The two slots, already resolved by the server: when only one logo was
   * uploaded both point at it, and when none was, both point at the platform
   * logo. So there is **no fallback logic to write** — pick the one matching the
   * theme on screen and use it as-is. `useThemedLogo` is that one line.
   */
  logoDarkUrl: string | null
  logoLightUrl: string | null
  primaryColor: string
  accentColor: string
  companyName?: string
  supportEmail?: string
}

/** Which slot a logo upload or delete is aimed at. */
export type LogoTheme = "dark" | "light"

/** Rounds an interview can be built from. Anything else is a 422. */
export const INTERVIEW_ROUND_OPTIONS = [
  // "aptitude",
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
 * Fills in the two slots from a payload that might only carry `logoUrl`.
 *
 * The server resolves both fields itself, so this is not the documented
 * fallback — it is the *older-deployment* fallback. Without it, a backend that
 * predates the light slot would hand back two nulls and every logo in the app
 * would vanish, which is a worse failure than showing one logo on both themes.
 */
function toBranding(raw: Branding): Branding {
  return {
    ...raw,
    logoDarkUrl: raw.logoDarkUrl ?? raw.logoUrl ?? null,
    logoLightUrl: raw.logoLightUrl ?? raw.logoUrl ?? null,
  }
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
  return toBranding(response.branding)
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
  return toBranding(response.branding)
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
 *
 * Omitting `theme` targets the dark slot, which is the endpoint's own default
 * and the behaviour every existing caller had.
 */
export async function uploadBrandingLogo(input: {
  file: File
  theme?: LogoTheme
}): Promise<{ theme: LogoTheme; logoUrl: string | null }> {
  const form = new FormData()
  form.append("logo", input.file)

  const theme = input.theme ?? "dark"
  const query = theme === "light" ? "?theme=light" : ""

  const response = await authed<{ status: string; logoUrl?: string }>(
    `/company/branding/logo${query}`,
    { method: "POST", body: form }
  )
  return { theme, logoUrl: response.logoUrl ?? null }
}

/**
 * Removes one slot, or **both**.
 *
 * Note the asymmetry with upload: no `theme` here means *both* logos go, not the
 * dark one. That is the endpoint's contract, and it is the reason the UI asks
 * for confirmation naming which slots it is about to clear.
 */
export async function deleteBrandingLogo(theme?: LogoTheme): Promise<void> {
  const query = theme ? `?theme=${theme}` : ""
  await authed(`/company/branding/logo${query}`, { method: "DELETE" })
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
  return toBranding(response.branding)
}
