import { Navigate, Outlet, useLocation } from "react-router-dom"

import { Skeleton } from "@/components/ui/skeleton"

import { useAuth } from "./auth-context"
import { ChangePasswordGate } from "./change-password-gate"
import { ROLE_HOME, type Role } from "./types"

/**
 * Route guard. Sends unauthenticated visitors to the login screen (remembering
 * where they were headed) and anyone without an allowed role to their own home
 * dashboard rather than leaking another role's pages.
 *
 * This gates the UI only — the server must repeat every check.
 */
export function RequireAuth({ roles }: { roles?: readonly Role[] }) {
  const { user, initializing } = useAuth()
  const location = useLocation()

  if (initializing) {
    return (
      <div className="flex min-h-svh flex-col gap-4 p-8">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  if (roles && !roles.includes(user.role)) {
    return <Navigate to={ROLE_HOME[user.role]} replace />
  }

  // The server 403s every data endpoint while a password change is outstanding,
  // so rendering the dashboard would just show a wall of failed panels. Gate
  // ahead of the role check's outcome, not instead of it.
  if (user.mustChangePassword) {
    return <ChangePasswordGate />
  }

  return <Outlet />
}
