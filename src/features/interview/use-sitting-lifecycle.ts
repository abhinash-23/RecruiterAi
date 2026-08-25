import * as React from "react"

import {
  heartbeat,
  reportInterviewClosed,
  type CandidateSession,
} from "@/services/interview"

/** The API expects a keep-alive about twice a minute. */
const HEARTBEAT_MS = 30_000

/**
 * Keeps the sitting alive, notices when the server closes it, and reports a tab
 * that vanishes.
 *
 * The two halves are opposite ends of the same question — is this candidate
 * still here? — so they share a hook rather than sitting apart in the page.
 *
 * @param onClosed Called when the server reports the session inactive, with the
 *   server's own `reason` where it gives one (`"time_up"`) and null otherwise.
 *   The sitting is over at that point; the page decides what to show — and the
 *   distinction matters, because a sitting the clock ended was submitted and
 *   scored, while the generic close is a fault.
 */
export function useSittingLifecycle({
  active,
  session,
  onClosed,
}: {
  active: boolean
  session: CandidateSession | null
  onClosed: (reason: string | null) => void
}) {
  // Through a ref so a caller passing an inline arrow doesn't restart the
  // interval on every render — which at a one-second clock is every second.
  const onClosedRef = React.useRef(onClosed)
  React.useEffect(() => {
    onClosedRef.current = onClosed
  })

  React.useEffect(() => {
    if (!active || !session) return

    const timer = window.setInterval(() => {
      void heartbeat(session.candidateToken, {
        sessionId: session.sessionId,
        interviewId: session.interviewId,
      })
        .then((result) => {
          // The heartbeat fires about twice a minute, so this is also what ends
          // an open tab within half a minute of the server's deadline, whatever
          // the local clock happens to read.
          if (!result.active) onClosedRef.current(result.reason)
        })
        // A single dropped heartbeat isn't fatal — the next one may land.
        .catch(() => undefined)
    }, HEARTBEAT_MS)

    return () => window.clearInterval(timer)
  }, [active, session])

  /* --------------------------------------------------- abandonment beacon */

  React.useEffect(() => {
    if (!active || !session) return

    const onHide = () =>
      reportInterviewClosed({
        sessionId: session.sessionId,
        interviewId: session.interviewId,
        reason: "pagehide",
      })

    window.addEventListener("pagehide", onHide)
    return () => window.removeEventListener("pagehide", onHide)
  }, [active, session])
}

/**
 * The sitting's countdown, and what happens when it runs out.
 *
 * **Two ways to keep time, and the first is the one that's true.** Given the
 * server's `expiresAt`, every tick is `deadline - now` — so the clock cannot
 * drift, a throttled background tab cannot slow it, a sleeping machine cannot
 * stop it, and a reload shows the right number. Without one (a deployment that
 * predates the field) it falls back to decrementing a local counter, which is
 * the old behaviour and every one of those things goes wrong.
 *
 * `paused` therefore applies **only to the fallback**. The server's deadline
 * does not pause when the candidate is off camera, and a clock that held while
 * the real one ran would show time the candidate does not have — then take their
 * next answer with a `409`. Freezing the display cannot buy back time the server
 * has already spent.
 *
 * @param onElapsed Called **once**, when the clock reaches zero. The sitting is
 *   over at that point: until this existed the timer simply sat at `00:00` and
 *   the candidate carried on answering, so the time limit was a display rather
 *   than a limit.
 */
export function useCountdown({
  active,
  paused,
  expiresAt,
  secondsLeft,
  setSecondsLeft,
  onElapsed,
}: {
  active: boolean
  paused: boolean
  /** Epoch millis from the server, or null to fall back to a local counter. */
  expiresAt: number | null
  secondsLeft: number
  setSecondsLeft: React.Dispatch<React.SetStateAction<number>>
  onElapsed: () => void
}) {
  React.useEffect(() => {
    if (!active) return

    // Derived from the deadline. Set immediately as well as on the interval, so
    // a tab returning from the background corrects on the same frame it wakes
    // rather than a second later.
    if (expiresAt !== null) {
      const read = () =>
        setSecondsLeft(Math.max(0, Math.round((expiresAt - Date.now()) / 1000)))

      read()
      const timer = window.setInterval(read, 1000)
      return () => window.clearInterval(timer)
    }

    if (paused) return

    const timer = window.setInterval(() => {
      setSecondsLeft((current) => (current > 0 ? current - 1 : 0))
    }, 1000)

    return () => window.clearInterval(timer)
  }, [active, paused, expiresAt, setSecondsLeft])

  /* ------------------------------------------------------------ time up -- */

  // Through a ref, like the heartbeat's: the page passes an inline arrow, and
  // the effect below must not be re-run by a new function identity every second.
  const onElapsedRef = React.useRef(onElapsed)
  React.useEffect(() => {
    onElapsedRef.current = onElapsed
  })

  /**
   * True once the clock has actually *counted down* to zero while the sitting
   * was under way.
   *
   * Both guards earn their place. `started` is why a session that arrives with
   * no duration — `time_minutes` absent, so the clock never leaves zero — is not
   * submitted the instant it opens. `fired` is why an elapsed clock ends the
   * sitting once rather than on every render after it.
   */
  const started = React.useRef(false)
  const fired = React.useRef(false)

  React.useEffect(() => {
    if (!active) {
      // A fresh sitting gets a fresh clock: this hook outlives one on the same
      // page only if a candidate begins again, and that is a new countdown.
      started.current = false
      fired.current = false
      return
    }
    if (secondsLeft > 0) {
      started.current = true
      return
    }
    if (!started.current || fired.current) return
    fired.current = true
    onElapsedRef.current()
  }, [active, secondsLeft])
}
