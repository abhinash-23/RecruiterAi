/**
 * Meta Pixel, loaded from the landing page and nowhere else.
 *
 * **Why this is a module and not a `<script>` in `index.html`.** The whole app is
 * one origin and one `index.html`: the marketing site is `/`, but the candidate
 * interview is `/otp?interview_id=…&email=…&name=…&role=…`, and the staff console
 * is `/admin/results/:interviewId`. A pixel in the document head fires a PageView
 * on every one of them, and a PageView reports `document.location` — so the base
 * code as pasted would send candidate email addresses and names to Meta from a
 * product whose own trust page advertises a GDPR DPA. Loading it from the landing
 * page's own mount keeps it on the one route that asked for it.
 *
 * The `<noscript>` half of the base code is left out for the same reason: it can
 * only live in the shared `index.html`, its request carries the current URL as a
 * `Referer`, and this is a client-rendered SPA — a visitor with no JavaScript
 * sees an empty page, so the only thing it could ever measure is crawlers.
 *
 * Every helper goes through `window.fbq?.()`, so a call that lands before
 * `fbevents.js` has arrived — or with the pixel blocked, which is common — is a
 * no-op rather than a crash.
 */

const PIXEL_ID = "1750643632795046"

/**
 * The queue-stub shape Meta's own snippet builds before its script arrives, so
 * calls made in the meantime are replayed rather than dropped.
 */
type Fbq = ((...args: unknown[]) => void) & {
  callMethod?: (...args: unknown[]) => void
  queue?: unknown[][]
  push?: unknown
  loaded?: boolean
  version?: string
}

declare global {
  interface Window {
    fbq?: Fbq
    _fbq?: Fbq
  }
}

/**
 * Injects the pixel if it isn't there yet, then reports a page view.
 *
 * Safe to call on every mount: the script and `init` happen once, while the
 * PageView fires each time — which is what a return visit to the landing page
 * is. Guarding on `window.fbq` rather than a module flag means a second copy of
 * this module, or the snippet arriving from anywhere else, still can't double up.
 */
export function loadPixel() {
  if (!window.fbq) {
    const fbq: Fbq = ((...args: unknown[]) => {
      if (fbq.callMethod) fbq.callMethod(...args)
      else fbq.queue?.push(args)
    }) as Fbq
    fbq.queue = []
    fbq.push = fbq
    fbq.loaded = true
    fbq.version = "2.0"

    window.fbq = fbq
    if (!window._fbq) window._fbq = fbq

    const script = document.createElement("script")
    script.async = true
    script.src = "https://connect.facebook.net/en_US/fbevents.js"
    document.head.appendChild(script)

    window.fbq("init", PIXEL_ID)
  }

  window.fbq?.("track", "PageView")
}

export const trackLead = () => window.fbq?.("track", "Lead")

export const trackContact = () => window.fbq?.("track", "Contact")

export const trackCompleteRegistration = () =>
  window.fbq?.("track", "CompleteRegistration")

export const trackViewContent = (name: string) =>
  window.fbq?.("track", "ViewContent", { content_name: name })

export const trackInitiateCheckout = () =>
  window.fbq?.("track", "InitiateCheckout")
