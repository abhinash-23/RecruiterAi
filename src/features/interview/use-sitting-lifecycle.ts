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
 * @param onClosed Called when the server reports the session inactive. The
 *   sitting is over at that point; the page decides what to show.
 */
export function useSittingLifecycle({
  active,
  session,
  onClosed,
}: {
  active: boolean
  session: CandidateSession | null
  onClosed: (reason: string) => void
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
          if (!result.active) {
            onClosedRef.current(
              "This session was closed by the server. Contact the recruiter to reopen it."
            )
          }
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
 * Held while `paused` — the candidate can't answer during a hold, so charging
 * them for it would punish someone for a webcam that slipped, and the hold is
 * what stops it being a way to buy thinking time since nothing can be submitted
 * either.
 *
 * @param onElapsed Called **once**, when the clock reaches zero. The sitting is
 *   over at that point: until this existed the timer simply sat at `00:00` and
 *   the candidate carried on answering, so the time limit was a display rather
 *   than a limit.
 */
export function useCountdown({
  active,
  paused,
  secondsLeft,
  setSecondsLeft,
  onElapsed,
}: {
  active: boolean
  paused: boolean
  secondsLeft: number
  setSecondsLeft: React.Dispatch<React.SetStateAction<number>>
  onElapsed: () => void
}) {
  React.useEffect(() => {
    if (!active || paused) return

    const timer = window.setInterval(() => {
      setSecondsLeft((current) => (current > 0 ? current - 1 : 0))
    }, 1000)

    return () => window.clearInterval(timer)
  }, [active, paused, setSecondsLeft])

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
