import * as Sentry from "@sentry/react"

/**
 * The one place an unexpected error is reported from — a render crash caught by
 * an error boundary, or anything the page itself never caught.
 *
 * Always the console, tagged with where it came from. Also Sentry, when the
 * build was given a `VITE_SENTRY_DSN`; without one, Sentry is never started and
 * `captureException` is a no-op — local development stays silent.
 *
 * API failures do **not** come through here. Those are expected, carry a
 * sentence for the user, and are shown where they happen (a toast, a form
 * message).
 */
export function reportError(error: unknown, source: string, detail?: string) {
  console.error(`[${source}]`, error, ...(detail ? [detail] : []))
  Sentry.captureException(error, {
    tags: { source },
    ...(detail ? { extra: { detail } } : {}),
  })
}

/**
 * Catches what nothing else did: an exception thrown outside React's render
 * (an event handler, a timer) and a promise rejected with nobody listening.
 *
 * Reported only, never shown. A toast for every stray rejection would mostly be
 * noise — an aborted request, a `video.play()` the browser refused — and the
 * failures a user needs to hear about are already handled where they happen.
 */
export function installGlobalErrorReporting() {
  startSentry()

  window.addEventListener("error", (event) => {
    reportError(event.error ?? event.message, "window.error")
  })

  window.addEventListener("unhandledrejection", (event) => {
    const reason: unknown = event.reason
    // A cancelled fetch is a decision, not a failure.
    if (reason instanceof DOMException && reason.name === "AbortError") return
    reportError(reason, "unhandledrejection")
  })
}

function startSentry() {
  const dsn = import.meta.env.VITE_SENTRY_DSN
  if (!dsn) return

  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    /* Sentry's own window listeners are switched off: the two above are the
       only path in, so an error is reported once and the AbortError filter
       applies to it. */
    integrations: (defaults) =>
      defaults.filter((integration) => integration.name !== "GlobalHandlers"),
    beforeSend: (event) => {
      if (event.request?.url) event.request.url = withoutQuery(event.request.url)
      return event
    },
    beforeBreadcrumb: (breadcrumb) => {
      const data = breadcrumb.data
      if (data) {
        for (const key of ["url", "from", "to"]) {
          if (typeof data[key] === "string") data[key] = withoutQuery(data[key])
        }
      }
      return breadcrumb
    },
  })
}

/**
 * Interview links carry the candidate's email in the query string (see the
 * `Referrer-Policy` note in `docker/security-headers.conf`). It has no business
 * in a third-party error tracker, so every URL Sentry records loses its query.
 */
export function withoutQuery(url: string): string {
  const cut = url.search(/[?#]/)
  return cut === -1 ? url : url.slice(0, cut)
}
