/**
 * The one place an unexpected error is reported from — a render crash caught by
 * an error boundary, or anything the page itself never caught.
 *
 * Today that means the console, tagged with where it came from. It exists as a
 * seam: an error-tracking service (Sentry or similar) plugs in here and every
 * caller is covered at once, rather than each one learning about it.
 *
 * API failures do **not** come through here. Those are expected, carry a
 * sentence for the user, and are shown where they happen (a toast, a form
 * message).
 */
export function reportError(error: unknown, source: string, detail?: string) {
  console.error(`[${source}]`, error, ...(detail ? [detail] : []))
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
