/**
 * ============================================================================
 * THE SIGNED-IN USER'S OWN NAME AND PICTURE
 * ============================================================================
 * One behaviour behind two URLs. The fields are spelled identically; only the
 * door differs by role:
 *
 *  - Admin → `PATCH /api/company/profile`
 *  - HR    → `PATCH /api/hr/profile` (an admin gets 403 here)
 *
 * **The trap this module exists to close:** on the admin door, `name` is the
 * *company's* name — it always has been, and `updateCompanyProfile` still sends
 * it that way. The person's own name is `full_name`, on both doors. Routing both
 * through one function is what stops a profile screen renaming the company.
 *
 * A super admin has neither door: they belong to no company, and `/api/hr/*`
 * is not theirs. `canEditOwnProfile` says so rather than letting the call 403.
 */

import { currentAccessToken } from "@/services/auth-service"
import { ApiError, apiFetch } from "@/services/http-client"
import type { Role } from "@/features/auth/types"

/**
 * What the file picker accepts and what the server will take.
 *
 * SVG is **absent on purpose** — the branding logo accepts it, this doesn't.
 * The server checks real file bytes, so a renamed `.png` is a 415 whatever the
 * picker allowed; checking here first turns that into a sentence.
 */
export const PROFILE_PICTURE = {
  accept: "image/png,image/jpeg,image/webp,image/gif",
  maxBytes: 10 * 1024 * 1024,
} as const

/** Roles with a profile door. Super admins have neither. */
export function canEditOwnProfile(role: Role): role is "admin" | "hr" {
  return role === "admin" || role === "hr"
}

export interface OwnProfile {
  /** `null` once removed, or when none was ever set. */
  pictureUrl: string | null
  fullName: string
}

/** Reads a picked file as the data-URL the API accepts verbatim. */
export function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () =>
      reject(new Error(`${file.name} couldn't be read from this device.`))
    reader.readAsDataURL(file)
  })
}

/**
 * Turns the API's own refusals into something worth showing.
 *
 * Each of these has a next step the user can take, and the raw body doesn't say
 * what it is — a bare "422" on a name field reads as a bug rather than "that was
 * blank".
 */
function explain(error: unknown): never {
  if (error instanceof ApiError) {
    if (error.status === 413) {
      throw new ApiError(
        413,
        `That image is over ${PROFILE_PICTURE.maxBytes / 1024 / 1024} MB. Try a smaller one, or a photo straight from your phone.`
      )
    }
    if (error.status === 415) {
      throw new ApiError(
        415,
        "That file isn't a PNG, JPEG, WebP or GIF. Note that SVG isn't accepted for a profile picture."
      )
    }
    if (error.status === 400) {
      throw new ApiError(
        400,
        "That image couldn't be read — it may be damaged. Try a different file."
      )
    }
    if (error.status === 422) {
      throw new ApiError(422, "Your display name can't be blank.")
    }
  }
  throw error
}

/**
 * Sets any subset of the user's own name and picture.
 *
 * Absent fields are left untouched by the server, which is why every field here
 * is optional and nothing is defaulted: sending `full_name: ""` is a 422, not a
 * no-op. Pass `picture: null` to **remove** the picture — that goes out as the
 * empty string the API defines for it.
 */
export async function updateOwnProfile(
  role: "admin" | "hr",
  input: {
    /** A data-URL from {@link readAsDataUrl}, or `null` to remove. */
    picture?: string | null
    fullName?: string
  }
): Promise<OwnProfile> {
  const body: Record<string, string> = {}
  if (input.picture !== undefined) body.profile_picture = input.picture ?? ""
  if (input.fullName !== undefined) body.full_name = input.fullName.trim()

  const path = role === "admin" ? "/company/profile" : "/hr/profile"

  try {
    const response = await apiFetch<{
      status: string
      profilePictureUrl?: string | null
      fullName?: string
    }>(path, { method: "PATCH", token: currentAccessToken(), body })

    return {
      pictureUrl: response.profilePictureUrl ?? null,
      fullName: response.fullName ?? input.fullName?.trim() ?? "",
    }
  } catch (error) {
    explain(error)
  }
}
