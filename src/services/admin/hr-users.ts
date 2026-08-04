/**
 * ============================================================================
 * HR USERS — `/api/company/hrs`
 * ============================================================================
 * The recruiter seats inside the signed-in Admin's own company. Everything here
 * is scoped to that company by the server, from the bearer token — there is no
 * company id to pass, and an Admin can never see another tenant's HR users.
 *
 * | Call                                       | What it does                    |
 * |--------------------------------------------|---------------------------------|
 * | `GET    /company/hrs`                      | list                            |
 * | `POST   /company/hrs`                      | create — returns a one-time password |
 * | `GET    /company/hrs/:id`                  | read one                        |
 * | `PATCH  /company/hrs/:id`                  | change name / phone only        |
 * | `POST   /company/hrs/:id/disable`          | revoke sign-in                  |
 * | `POST   /company/hrs/:id/enable`           | restore it                      |
 * | `POST   /company/hrs/:id/reset-password`   | server picks a new password     |
 *
 * Differences from the platform-admin endpoints worth remembering:
 *
 *  - **Reset takes no body.** The server generates the password and returns it,
 *    where `platform/admins/:id/reset-password` makes the caller supply one.
 *  - **`disable` returns only `{status, message}`**, with no HR object, so its
 *    result can't be used to update a cache — refetch instead.
 *  - **`PATCH` silently ignores anything but `full_name` and `phone`.** Sending
 *    `email` returns 200 with the address unchanged, so the form must not offer
 *    it as editable.
 *  - **There is no delete**, same as tenants: disable instead.
 */

import { currentAccessToken } from "@/services/auth-service"
import { apiFetch, type RequestOptions } from "@/services/http-client"

/* ========================================================================== */
/*  Types                                                                     */
/* ========================================================================== */

/** One recruiter seat, as the API returns it (already camelCase). */
export interface HrUser {
  userId: string
  email: string
  fullName: string
  phone: string
  isActive: boolean
  /** True until they've replaced the password they were issued. */
  mustChangePassword: boolean
  lastLogin: string | null
  createdAt: string
}

/** Body of `POST /company/hrs`. */
export interface CreateHrInput {
  /** Their login address. Required, and must not already be a user. */
  email: string
  fullName?: string
  /** E.164, e.g. `+919876543210`. */
  phone?: string
}

/** Body of `PATCH /company/hrs/:id` — the only two editable fields. */
export interface UpdateHrInput {
  fullName?: string
  phone?: string
}

/** A create or a reset: both hand back a password shown only once. */
export interface HrCredentialsResult {
  /** Present on create; a reset returns no HR object of its own. */
  hr: HrUser | null
  temporaryPassword: string
  credentialsEmailSent: boolean
  message: string
}

/* ========================================================================== */
/*  Wire format                                                               */
/* ========================================================================== */

interface HrEnvelope {
  status: string
  hr: HrUser
}
interface ListEnvelope {
  status: string
  count: number
  hrs: HrUser[]
}
interface CredentialsEnvelope {
  status: string
  hr?: HrUser
  temporaryPassword: string
  credentialsEmailSent: boolean
  message: string
}
interface MessageEnvelope {
  status: string
  message: string
}

function authed<T>(path: string, options: Omit<RequestOptions, "token"> = {}) {
  return apiFetch<T>(path, { ...options, token: currentAccessToken() })
}

/**
 * `createdAt` and `lastLogin` arrive without a timezone
 * (`"2026-07-31T15:04:10.960938"`), which `new Date()` would read as local time
 * and display shifted by the viewer's UTC offset. Server time is UTC.
 */
function toUtcIso(value: string): string {
  return /(?:Z|[+-]\d{2}:?\d{2})$/.test(value) ? value : `${value}Z`
}

function normalise(hr: HrUser): HrUser {
  return {
    ...hr,
    createdAt: toUtcIso(hr.createdAt),
    lastLogin: hr.lastLogin === null ? null : toUtcIso(hr.lastLogin),
  }
}

/* ========================================================================== */
/*  Calls                                                                     */
/* ========================================================================== */

export async function listHrUsers(): Promise<HrUser[]> {
  const response = await authed<ListEnvelope>("/company/hrs")
  return response.hrs.map(normalise)
}

export async function getHrUser(userId: string): Promise<HrUser> {
  const response = await authed<HrEnvelope>(`/company/hrs/${userId}`)
  return normalise(response.hr)
}

/**
 * Adds a recruiter and emails them their credentials. The returned
 * `temporaryPassword` is the only copy — show it before discarding the result.
 */
export async function createHrUser(
  input: CreateHrInput
): Promise<HrCredentialsResult> {
  const response = await authed<CredentialsEnvelope>("/company/hrs", {
    method: "POST",
    body: {
      email: input.email.trim().toLowerCase(),
      full_name: input.fullName?.trim() ?? "",
      phone: input.phone?.trim() ?? "",
    },
  })

  return {
    hr: response.hr ? normalise(response.hr) : null,
    temporaryPassword: response.temporaryPassword,
    credentialsEmailSent: response.credentialsEmailSent,
    message: response.message,
  }
}

/** Changes the recruiter's display name or phone. Their email is fixed. */
export async function updateHrUser(
  userId: string,
  input: UpdateHrInput
): Promise<HrUser> {
  const body: Record<string, string> = {}
  if (input.fullName !== undefined) body.full_name = input.fullName.trim()
  if (input.phone !== undefined) body.phone = input.phone.trim()

  const response = await authed<HrEnvelope>(`/company/hrs/${userId}`, {
    method: "PATCH",
    body,
  })
  return normalise(response.hr)
}

/**
 * Revokes or restores the recruiter's sign-in.
 *
 * Returns nothing useful: `disable` answers with a bare message rather than the
 * updated record, so callers refetch the list instead of patching a cache.
 */
export async function setHrUserActive(
  userId: string,
  isActive: boolean
): Promise<void> {
  await authed<HrEnvelope | MessageEnvelope>(
    `/company/hrs/${userId}/${isActive ? "enable" : "disable"}`,
    { method: "POST" }
  )
}

/**
 * Issues a fresh temporary password.
 *
 * Unlike the platform-admin equivalent, this endpoint takes no body — the
 * server chooses the password and returns it once.
 */
export async function resetHrUserPassword(
  userId: string
): Promise<HrCredentialsResult> {
  const response = await authed<CredentialsEnvelope>(
    `/company/hrs/${userId}/reset-password`,
    { method: "POST" }
  )

  return {
    hr: response.hr ? normalise(response.hr) : null,
    temporaryPassword: response.temporaryPassword,
    credentialsEmailSent: response.credentialsEmailSent,
    message: response.message,
  }
}
