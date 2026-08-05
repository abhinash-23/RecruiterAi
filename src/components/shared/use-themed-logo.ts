import { useTheme } from "@/components/theme-provider"

/**
 * The logo fields any branding payload carries. Structural on purpose: the
 * authenticated read, the public read and the candidate read all satisfy it, and
 * none of them needs to know this hook exists.
 */
export interface ThemedLogoSource {
  /** The legacy single field, which is the dark slot. */
  logoUrl?: string | null
  logoDarkUrl?: string | null
  logoLightUrl?: string | null
}

/**
 * The logo to show for the theme currently on screen.
 *
 * A logo drawn for a dark background disappears into a light one, so a company
 * can upload two. The server pre-resolves both fields — when only one logo
 * exists, both point at it — so **this is the whole of the client's logic**:
 * pick the field matching the theme. No API call on toggle; both URLs are
 * already in memory.
 *
 * `resolvedTheme`, not `theme`: a user on `"system"` with a light OS must get the
 * light logo, and for them `theme === "light"` is false.
 *
 * The trailing `logoUrl` is not the documented fallback — the server does that.
 * It's for a backend predating the two fields, where they arrive null and the
 * alternative is no logo at all.
 */
export function useThemedLogo(
  branding: ThemedLogoSource | null | undefined
): string | null {
  const { resolvedTheme } = useTheme()
  if (!branding) return null

  const slot =
    resolvedTheme === "light" ? branding.logoLightUrl : branding.logoDarkUrl

  return slot ?? branding.logoUrl ?? null
}
