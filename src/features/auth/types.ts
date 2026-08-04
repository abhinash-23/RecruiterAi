export const ROLES = ["super_admin", "admin", "hr"] as const

export type Role = (typeof ROLES)[number]

export interface User {
  id: string
  name: string
  email: string
  role: Role
  companyName: string
  phone?: string
  /** Server wants this password replaced before the account is used for real. */
  mustChangePassword?: boolean
  avatarUrl?: string
  status: "active" | "disabled"
}

/** Shape of the credential pair the login form collects. */
export interface Credentials {
  email: string
  password: string
}

/**
 * What the server hands back on login/refresh. `accessToken` is short-lived and
 * sent with each request; `refreshToken` is exchanged for a new pair.
 */
export interface Session {
  user: User
  accessToken: string
  /**
   * Exchanged for a new pair before the access token lapses. `null` when the
   * backend issues a single token and no refresh — the session then simply
   * ends at `expiresAt` and the user signs in again.
   */
  refreshToken: string | null
  /** Epoch millis at which `accessToken` stops being accepted. */
  expiresAt: number
}

export const ROLE_LABEL: Record<Role, string> = {
  super_admin: "Super Admin",
  admin: "Admin",
  hr: "HR",
}

/** Landing route for each role once authenticated. */
export const ROLE_HOME: Record<Role, string> = {
  super_admin: "/super-admin",
  admin: "/admin",
  hr: "/hr",
}
