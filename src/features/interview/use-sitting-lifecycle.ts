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
 * The sitting's countdown.
 *
 * Held while `paused` — the candidate can't answer during a hold, so charging
 * them for it would punish someone for a webcam that slipped, and the hold is
 * what stops it being a way to buy thinking time since nothing can be submitted
 * either.
 */
export function useCountdown({
  active,
  paused,
  setSecondsLeft,
}: {
  active: boolean
  paused: boolean
  setSecondsLeft: React.Dispatch<React.SetStateAction<number>>
}) {
  React.useEffect(() => {
    if (!active || paused) return

    const timer = window.setInterval(() => {
      setSecondsLeft((current) => (current > 0 ? current - 1 : 0))
    }, 1000)

    return () => window.clearInterval(timer)
  }, [active, paused, setSecondsLeft])
}
