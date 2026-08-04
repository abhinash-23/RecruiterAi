/**
 * Rewrites a hash-form URL into a real path before the router starts.
 *
 * The backend emails interview invitations as
 * `https://host/#/otp?interview_id=…&email=…`, a hash route left over from when
 * this app used a `HashRouter`. It now uses `BrowserRouter`, which only looks at
 * `location.pathname` — that reads as `/`, so those links matched the marketing
 * landing page and the candidate never reached their interview.
 *
 * Doing this before React mounts (rather than redirecting from a component)
 * means the router's very first match is already correct: no wrong page flashes
 * past, and no route needs to know about the legacy format.
 *
 * Only `#/…` is touched. The landing page's own anchors are bare fragments
 * (`#home`, `#api`), so the leading slash is what separates a stale route from
 * an in-page jump.
 */
export function normaliseHashRoute(): void {
  const { hash, pathname } = window.location

  if (!hash.startsWith("#/")) return

  // Never override a real route the user is already on — a hash on a genuine
  // path is an anchor, not a redirect.
  if (pathname !== "/" && pathname !== "") return

  // `#/otp?interview_id=…` → `/otp?interview_id=…`
  window.history.replaceState(null, "", hash.slice(1))
}
