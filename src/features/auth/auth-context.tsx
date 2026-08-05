/* eslint-disable react-refresh/only-export-components */
import * as React from "react"

import * as authService from "@/services/auth-service"

import type { Credentials, Role, Session, User } from "./types"

interface AuthContextValue {
  user: User | null
  /** True until the stored session has been checked on first load. */
  initializing: boolean
  signIn: (credentials: Credentials) => Promise<User>
  /** Never rejects — see `authService.logout`. Resolves with what to tell the user. */
  signOut: () => Promise<authService.LogoutResult>
  /**
   * Replaces the user's own password and clears `mustChangePassword`, which
   * unblocks the rest of the API. Rejects with the server's message.
   */
  changePassword: (input: {
    currentPassword: string
    newPassword: string
  }) => Promise<void>
  /**
   * Records a change the user made to their own name or picture.
   *
   * Not just for the profile screen: the sidebar and the avatar read from the
   * session, so a picture uploaded on one screen has to be visible on every
   * other without a reload. `avatarUrl: null` means removed.
   */
  applyProfile: (patch: { name?: string; avatarUrl?: string | null }) => void
  /** Whether the signed-in user holds one of the given roles. */
  can: (roles: readonly Role[]) => boolean
}

const AuthContext = React.createContext<AuthContextValue | null>(null)

/** Refresh this far before the access token actually expires. */
const REFRESH_LEEWAY_MS = 60_000

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = React.useState<Session | null>(null)
  const [initializing, setInitializing] = React.useState(true)

  // Restore a stored session on boot so a reload doesn't bounce the user back
  // to the login screen. An already-lapsed token is only worth keeping if a
  // refresh token can rescue it.
  React.useEffect(() => {
    let cancelled = false

    const restore = async () => {
      const stored = authService.readStoredSession()

      const settle = (next: Session | null) => {
        if (cancelled) return
        setSession(next)
        setInitializing(false)
      }

      if (!stored) return settle(null)

      if (stored.expiresAt - REFRESH_LEEWAY_MS > Date.now()) {
        return settle(stored)
      }

      // Expired. Without a refresh token there is nothing to exchange.
      if (!stored.refreshToken) {
        authService.clearSession()
        return settle(null)
      }

      try {
        settle(await authService.refresh(stored.refreshToken))
      } catch {
        authService.clearSession()
        settle(null)
      }
    }

    void restore()
    return () => {
      cancelled = true
    }
  }, [])

  // Keep the access token fresh while the tab is open — or, when the backend
  // issues no refresh token, sign out cleanly the moment it lapses instead of
  // letting every request start failing with a 401.
  React.useEffect(() => {
    if (!session) return

    const wait = Math.max(
      5_000,
      session.expiresAt - Date.now() - REFRESH_LEEWAY_MS
    )

    const timer = window.setTimeout(async () => {
      const { refreshToken } = session
      if (!refreshToken) {
        authService.clearSession()
        setSession(null)
        return
      }

      try {
        setSession(await authService.refresh(refreshToken))
      } catch {
        authService.clearSession()
        setSession(null)
      }
    }, wait)

    return () => window.clearTimeout(timer)
  }, [session])

  // Sign-out in one tab should sign out the others.
  React.useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key && !event.key.includes("session")) return
      setSession(authService.readStoredSession())
    }
    window.addEventListener("storage", onStorage)
    return () => window.removeEventListener("storage", onStorage)
  }, [])

  /**
   * Hydrates the user from `GET /api/auth/me`, once per session.
   *
   * The login response is a *snapshot*, and not a complete one — it carries no
   * `profilePictureUrl`. Running only on that meant a picture set in an earlier
   * session was missing until it was uploaded again, and every sign-out lost it.
   * The docs call this endpoint the "cheap who-am-I for app boot"; this is that.
   *
   * Keyed on the token, so it runs on sign-in and on a restored session, and
   * *doesn't* re-run when the user object changes underneath it — which is what
   * a profile edit does, and what would otherwise make this loop.
   */
  const token = session?.accessToken ?? null
  React.useEffect(() => {
    if (!token) return
    let cancelled = false

    void authService
      .refreshUser()
      .then((next) => {
        if (!cancelled && next) setSession(next)
      })
      .catch(() => {
        // Best-effort. A blip here leaves the session from login in place; it is
        // a stale name at worst. A real 401 is caught by the next actual request
        // and handled there, and bouncing to the login screen from here would
        // turn a flaky network into a forced sign-out.
      })

    return () => {
      cancelled = true
    }
  }, [token])

  const signIn = React.useCallback(async (credentials: Credentials) => {
    const next = await authService.login(credentials)
    setSession(next)
    // The caller redirects on this — `next.user.role` picks the dashboard.
    return next.user
  }, [])

  const signOut = React.useCallback(async () => {
    const result = await authService.logout(session?.accessToken)
    setSession(null)
    return result
  }, [session])

  const changePassword = React.useCallback(
    async (input: { currentPassword: string; newPassword: string }) => {
      await authService.changePassword(input)
      // The token survives the change, so drop the flag in place rather than
      // forcing the user back through the login screen.
      setSession(authService.markPasswordChanged())
    },
    []
  )

  const applyProfile = React.useCallback(
    (patch: { name?: string; avatarUrl?: string | null }) => {
      const next = authService.applyOwnProfile(patch)
      // Only on success. A null here means there was no stored session to patch,
      // and assigning it would sign the user out over a profile edit.
      if (next) setSession(next)
    },
    []
  )

  const can = React.useCallback(
    (roles: readonly Role[]) =>
      Boolean(session?.user && roles.includes(session.user.role)),
    [session]
  )

  const value = React.useMemo<AuthContextValue>(
    () => ({
      user: session?.user ?? null,
      initializing,
      signIn,
      signOut,
      changePassword,
      applyProfile,
      can,
    }),
    [session, initializing, signIn, signOut, changePassword, applyProfile, can]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const context = React.useContext(AuthContext)
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider")
  }
  return context
}

/**
 * The signed-in user, for code that only runs inside a protected route.
 * Throws if called while unauthenticated, which would be a routing bug.
 */
export function useCurrentUser(): User {
  const { user } = useAuth()
  if (!user) {
    throw new Error("useCurrentUser called outside a protected route")
  }
  return user
}
