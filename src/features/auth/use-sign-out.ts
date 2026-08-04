import * as React from "react"
import { useNavigate } from "react-router-dom"
import { toast } from "sonner"

import { useAuth } from "./auth-context"

/**
 * One-call sign-out for buttons and menu items. It:
 *
 *   1. revokes the token on the server (`POST /api/auth/logout`),
 *   2. drops the stored session,
 *   3. shows the outcome, and
 *   4. returns the user to the login screen.
 *
 * The sidebar menu and the profile page both use this, so the behaviour can't
 * drift apart between the two places a user can log out from.
 *
 * ```tsx
 * const signOut = useSignOut()
 * <Button onClick={() => void signOut()}>Log out</Button>
 * ```
 */
export function useSignOut() {
  const { signOut } = useAuth()
  const navigate = useNavigate()

  return React.useCallback(async () => {
    // Resolves even when the network call fails — the local session is always
    // cleared, and `message` says which of the two happened.
    const { message } = await signOut()
    toast.success(message)
    navigate("/login", { replace: true })
  }, [signOut, navigate])
}
