/**
 * ============================================================================
 * AUTH SERVICE
 * ============================================================================
 * Everything the app knows about signing in against the real backend:
 *
 *   POST /api/auth/login   -> a token + the user, which decides the dashboard
 *   POST /api/auth/refresh -> a fresh token (only if the backend offers it)
 *   POST /api/auth/logout  -> best effort; the local session is dropped either way
 *
 * Nothing outside this file needs to know the server's field names. Callers
 * receive the app's own `Session` / `User` shapes, so the wire format can
 * change here without touching a single component.
 *
 * Used by `features/auth/auth-context.tsx`, which is what the login page and
 * the route guards actually talk to.
 */

import {
  ROLES,
  type Credentials,
  type Role,
  type Session,
  type User,
} from "@/features/auth/types"

import { ApiError, apiFetch } from "./http-client"

/* ========================================================================== */
/*  Wire format — exactly what the server sends. Its names, not ours.         */
/* ========================================================================== */

/**
 * Body of a successful `POST /auth/login`:
 *
 * ```json
 * {
 *   "status": "ok",
 *   "token": "eyJ0eXAiOi...",
 *   "expires_at": 1785547434,
 *   "user": { "userId": "...", "role": "super_admin", ... }
 * }
 * ```
 */
interface LoginResponse {
  status: string
  token: string
  /** Epoch **seconds**. JavaScript dates want milliseconds — see `toSession`. */
  expires_at: number
  user: ApiUser
}

interface ApiUser {
  userId: string
  email: string
  fullName: string
  role: string
  phone: string | null
  companyName: string | null
  mustChangePassword: boolean
}

/** Body of a successful `POST /auth/logout`: `{ status, message }`. */
interface LogoutResponse {
  status: string
  message?: string
}

/* ========================================================================== */
/*  Mapping — server shape in, app shape out                                  */
/* ========================================================================== */

/**
 * The role string drives which dashboard the user lands on, so an unknown value
 * has to fail loudly. Silently defaulting to a role would either lock a valid
 * user out or show them someone else's pages.
 */
function toRole(value: string): Role {
  const role = ROLES.find((known) => known === value)
  if (!role) {
    throw new ApiError(
      500,
      `Your account has a role this app doesn't know about ("${value}").`
    )
  }
  return role
}

function toUser(api: ApiUser): User {
  return {
    id: api.userId,
    name: api.fullName,
    email: api.email,
    role: toRole(api.role),
    companyName: api.companyName ?? "",
    phone: api.phone ?? undefined,
    mustChangePassword: api.mustChangePassword,
    // The login response carries no status field. Getting a 200 back *is* the
    // server saying the account is usable — a disabled one is rejected.
    status: "active",
  }
}

function toSession(response: LoginResponse): Session {
  return {
    user: toUser(response.user),
    accessToken: response.token,
    // This backend issues one token and no refresh token, so the session just
    // ends at `expiresAt`. If a refresh endpoint is added later, return its
    // token here and AuthProvider starts renewing on its own — no other change.
    refreshToken: null,
    expiresAt: response.expires_at * 1000,
  }
}

/* ========================================================================== */
/*  Calls                                                                     */
/* ========================================================================== */

/**
 * Signs in and stores the session.
 *
 * Throws `ApiError` with a message meant for the user — the login form shows it
 * verbatim, so callers don't need to translate anything.
 */
export async function login(credentials: Credentials): Promise<Session> {
  const response = await apiFetch<LoginResponse>("/auth/login", {
    method: "POST",
    body: {
      email: credentials.email.trim().toLowerCase(),
      password: credentials.password,
    },
  })

  const session = toSession(response)
  persistSession(session)
  return session
}

/**
 * Exchanges a refresh token for a new session.
 *
 * The current backend has no such endpoint; the call fails and the caller signs
 * the user out, which is the right outcome for an expired single token. The
 * code is here so that adding the endpoint requires no frontend work.
 */
export async function refresh(refreshToken: string): Promise<Session> {
  const response = await apiFetch<LoginResponse>("/auth/refresh", {
    method: "POST",
    body: { refreshToken },
  })

  const session = toSession(response)
  persistSession(session)
  return session
}

/** What `logout` tells the caller once the dust has settled. */
export interface LogoutResult {
  /** True when the server confirmed it revoked the token. */
  revoked: boolean
  /** Ready to show the user — the server's own sentence when there is one. */
  message: string
}

/**
 * Ends the session.
 *
 * `POST /auth/logout` takes **no body** — the bearer token *is* the request.
 * Called without one it answers `401 {"detail":"Missing bearer token"}`, so
 * there is no point sending it when we have nothing to revoke.
 *
 * The local session is dropped no matter what the server says. A logout that
 * fails must never strand someone inside a session they asked to leave.
 */
export async function logout(accessToken?: string | null): Promise<LogoutResult> {
  if (!accessToken) {
    clearSession()
    return { revoked: false, message: "Signed out." }
  }

  try {
    const response = await apiFetch<LogoutResponse>("/auth/logout", {
      method: "POST",
      token: accessToken,
    })
    return { revoked: true, message: response.message?.trim() || "Signed out." }
  } catch (error) {
    // Server unreachable, token already expired, endpoint missing. The user is
    // signed out locally either way — but say so precisely, because the token
    // may still be live somewhere else.
    if (import.meta.env.DEV) {
      console.warn("[auth] logout call failed; clearing the session anyway.", error)
    }
    return { revoked: false, message: "Signed out on this device." }
  } finally {
    clearSession()
  }
}

/**
 * Minimum length the server enforces on a new password (422 below it). Mirrored
 * in the change-password form so the reader is told before submitting.
 */
export const MIN_PASSWORD_LENGTH = 8

/**
 * Replaces the signed-in user's own password.
 *
 * This is not optional housekeeping: while `user.mustChangePassword` is true the
 * server answers **403 on every endpoint except `/auth/me`** —
 * *"Password change required. Call POST /api/auth/change-password, then retry."*
 * So a freshly created admin or HR can sign in and then do nothing at all until
 * this succeeds.
 *
 * The existing access token stays valid afterwards, so there is no need to sign
 * back in — the caller just clears the flag and carries on.
 */
export async function changePassword(input: {
  currentPassword: string
  newPassword: string
}): Promise<void> {
  await apiFetch("/auth/change-password", {
    method: "POST",
    token: currentAccessToken(),
    body: {
      current_password: input.currentPassword,
      new_password: input.newPassword,
    },
  })
}

/**
 * Clears `mustChangePassword` on the stored session and returns it, so the UI
 * stops gating without a round-trip to re-read the user.
 */
export function markPasswordChanged(): Session | null {
  const session = readStoredSession()
  if (!session) return null

  const next: Session = {
    ...session,
    user: { ...session.user, mustChangePassword: false },
  }
  persistSession(next)
  return next
}

/* ========================================================================== */
/*  Storage — survives a page reload                                          */
/* ========================================================================== */

/**
 * Bump the suffix whenever `Session` changes shape, so a value written by an
 * older build is ignored rather than half-read. v2 is the move to real backend
 * tokens: the v1 sessions were mock ones this API would reject anyway.
 *
 * SECURITY NOTE: localStorage is readable by any script on the page, so a
 * successful XSS steals this token. The safer arrangement is an HttpOnly,
 * Secure, SameSite cookie issued by the server, which script can't read.
 */
const SESSION_KEY = "recruiterai.session.v2"

export function persistSession(session: Session) {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session))
  } catch {
    // Private mode or a full quota. The session still works for this tab; the
    // user just has to sign in again next visit.
  }
}

export function readStoredSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) return null

    const session = JSON.parse(raw) as Session
    // Guard against a partial or hand-edited value rather than letting it fail
    // later as an undefined property somewhere in a component.
    if (!session?.accessToken || !session.user?.role) return null

    return session
  } catch {
    return null
  }
}

export function clearSession() {
  try {
    localStorage.removeItem(SESSION_KEY)
  } catch {
    // Nothing to clear.
  }
}

/**
 * The current access token, for other services that need to authenticate.
 *
 * Read from storage rather than React state on purpose: services are plain
 * functions called from query/mutation callbacks, and storage is always the
 * freshest copy — including right after a refresh, and in another tab.
 */
export function currentAccessToken(): string | null {
  return readStoredSession()?.accessToken ?? null
}

/* ========================================================================== */
/*  Development convenience                                                   */
/* ========================================================================== */

/**
 * Known accounts on the shared development backend, offered as one-click fill
 * on the login screen. The login page renders these **only** in a dev build
 * (`import.meta.env.DEV`), so they are absent from a production bundle.
 */
export const DEV_ACCOUNTS = [
  {
    label: "Super Admin",
    email: "superadmin@cognitivescreen.ai",
    password: "Nugget@123",
  },
] as const
