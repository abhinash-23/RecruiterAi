/** React Query bindings for the signed-in user's own profile. */

import { useMutation } from "@tanstack/react-query"
import { toast } from "sonner"

import { useAuth } from "@/features/auth/auth-context"
import type { Role } from "@/features/auth/types"

import {
  canEditOwnProfile,
  readAsDataUrl,
  updateOwnProfile,
  type OwnProfile,
} from "./profile"

/**
 * Edits the signed-in user's own name and picture.
 *
 * Deliberately **not** a query plus a mutation. The user is already in the auth
 * session, and the PATCH returns the new name and picture URL, so there is
 * nothing left to fetch — the result is written straight into the session, which
 * is what the sidebar and every avatar in the app render from.
 *
 * Takes any `Role` so the profile screen can call it unconditionally — hooks
 * can't be conditional, and a super admin renders no editing controls at all.
 * The guard in `mutationFn` is therefore unreachable by construction, and there
 * so that a future caller who *does* render controls for them gets a sentence
 * rather than a 403.
 */
export function useOwnProfileMutation(role: Role) {
  const { applyProfile } = useAuth()

  return useMutation({
    /**
     * `picture: null` removes it; leaving it out changes nothing. The file is
     * read here rather than by the caller so a component never has to hold a
     * multi-megabyte data-URL in state.
     */
    mutationFn: async (input: {
      file?: File
      removePicture?: boolean
      fullName?: string
    }): Promise<OwnProfile> => {
      if (!canEditOwnProfile(role)) {
        throw new Error(
          "This account belongs to no company, so it has no profile of its own to edit."
        )
      }

      const picture = input.file
        ? await readAsDataUrl(input.file)
        : input.removePicture
          ? null
          : undefined

      return updateOwnProfile(role, {
        ...(picture !== undefined ? { picture } : {}),
        ...(input.fullName !== undefined ? { fullName: input.fullName } : {}),
      })
    },

    onSuccess: (result, input) => {
      applyProfile({
        // Only what was actually sent. Echoing `fullName` back on a
        // picture-only save would be harmless today, but it makes the session
        // depend on the server bothering to return a field it isn't obliged to.
        ...(input.fullName !== undefined ? { name: result.fullName } : {}),
        ...(input.file || input.removePicture
          ? { avatarUrl: result.pictureUrl }
          : {}),
      })

      toast.success(
        input.removePicture
          ? "Profile picture removed."
          : input.file && input.fullName !== undefined
            ? "Profile updated."
            : input.file
              ? "Profile picture updated."
              : "Name updated."
      )
    },

    onError: (error: Error) => toast.error(error.message),
  })
}
