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

/** A light-slot file is served with the same `?theme=light` its upload took. */
function isLightSlotFile(url: string) {
  return /[?&]theme=light(?:&|$)/.test(url)
}

/**
 * The logo each theme **actually has** — `null` for a slot nobody uploaded to.
 *
 * The server pre-resolves both fields: when only one logo exists, both point at
 * it. That makes the two slots look linked — upload a dark logo and the light
 * theme shows it too; remove it and both go — when they are meant to be
 * independent, since a logo drawn for one background disappears into the other.
 * So the fallback is undone here: two fields carrying the same file means one
 * of them is borrowed, and the file's own URL says which slot it belongs to.
 *
 * The trailing `logoUrl` is for a backend predating the two fields, where they
 * arrive null and the alternative is no logo at all.
 */
export function ownLogos(branding: ThemedLogoSource | null | undefined): {
  dark: string | null
  light: string | null
} {
  if (!branding) return { dark: null, light: null }

  const dark = branding.logoDarkUrl ?? branding.logoUrl ?? null
  const light = branding.logoLightUrl ?? branding.logoUrl ?? null

  if (!dark || dark !== light) return { dark, light }
  return isLightSlotFile(dark)
    ? { dark: null, light }
    : { dark, light: null }
}

/**
 * The logo to show for the theme currently on screen, or `null` when that
 * theme has none of its own — callers then show the platform wordmark rather
 * than the other theme's logo. No API call on toggle; both URLs are already in
 * memory.
 *
 * `resolvedTheme`, not `theme`: a user on `"system"` with a light OS must get the
 * light logo, and for them `theme === "light"` is false.
 */
export function useThemedLogo(
  branding: ThemedLogoSource | null | undefined
): string | null {
  const { resolvedTheme } = useTheme()
  const logos = ownLogos(branding)
  return resolvedTheme === "light" ? logos.light : logos.dark
}
