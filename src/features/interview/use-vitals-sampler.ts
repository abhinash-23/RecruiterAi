import * as React from "react"

import {
  initVitals,
  sendVitalsFrame,
  type CandidateSession,
} from "@/services/interview"

import { captureFrame } from "./use-media-stream"

/** Vitals need a steady trickle of frames, not a flood. */
const VITALS_FRAME_MS = 3000

/**
 * How long the camera may see no face before the sitting is held.
 *
 * Not zero, deliberately. `face_detected` goes false for a turn of the head, a
 * reach for a glass of water, or one badly-lit frame, and halting an interview
 * on a single miss would make the room unusable. Several consecutive misses is
 * a candidate who has left, covered the lens, or is no longer the one sitting
 * it — which is the case worth stopping for.
 */
const FACE_GRACE_MS = 6000

/**
 * Samples the webcam for vitals, and decides when the camera has lost the
 * candidate.
 *
 * The two live together because they come from the same response: every frame
 * posted returns both the reading and `face_detected`, and asking the server
 * twice for one answer would be wasteful and could disagree with itself.
 *
 * **Best-effort throughout.** Vitals are a signal for the recruiter, never a
 * reason to interrupt someone's interview, so every failure here is swallowed.
 *
 * @param active     Only true while the candidate is actually sitting.
 * @param videoRef   The live `<video>`; frames are drawn from it.
 * @param readTabSwitches Live tab-switch total, read per frame — see the note
 *   at the call site about why this can't come from render state.
 */
export function useVitalsSampler({
  active,
  session,
  stream,
  videoRef,
  readTabSwitches,
}: {
  active: boolean
  session: CandidateSession | null
  stream: MediaStream | null
  videoRef: React.RefObject<HTMLVideoElement | null>
  readTabSwitches: () => number
}) {
  /**
   * True once the camera has reported no face for longer than the grace period.
   *
   * While it holds, the sitting does not advance: the question is covered, the
   * answer controls are dead, the microphone is closed and the clock stops. An
   * interview answered by someone the camera can't see isn't evidence of
   * anything.
   */
  const [faceLost, setFaceLost] = React.useState(false)
  /*
   * The reading itself is deliberately **not** kept.
   *
   * It used to be held in state so the candidate's tab could relay it to a
   * watching recruiter over the WebRTC data channel, saving the server a second
   * read. That channel is gone — the recruiter polls
   * `/vitals/report/{session_id}` for the full summary instead — and with it goes
   * a `setState` on every frame, which re-rendered the whole sitting every three
   * seconds for a value nobody read.
   */
  /** When the current run of face-less frames began; null while a face is seen. */
  const faceLostSinceRef = React.useRef<number | null>(null)

  React.useEffect(() => {
    if (!active || !session || !stream) return

    void initVitals(session.candidateToken, {
      sessionId: session.sessionId,
    }).catch(() => undefined)

    const timer = window.setInterval(() => {
      const frame = captureFrame(videoRef.current)
      if (!frame) return
      void sendVitalsFrame(session.candidateToken, {
        sessionId: session.sessionId,
        frameBase64: frame,
        timestampMs: Date.now(),
        // Read from the ref, not from render state: this closure is captured
        // when the interval is created and would otherwise ship the count as it
        // stood at the start of the sitting, forever.
        tabSwitchCount: readTabSwitches(),
      })
        // Only `face_detected` is read from the response. The readings
        // themselves are the recruiter's to fetch — see above.
        .then((reading) => {
          if (reading.faceDetected) {
            faceLostSinceRef.current = null
            setFaceLost(false)
            return
          }

          const since = faceLostSinceRef.current ?? Date.now()
          faceLostSinceRef.current = since
          if (Date.now() - since >= FACE_GRACE_MS) setFaceLost(true)
        })
        // A failed frame is *not* a missing face. The endpoint is best-effort
        // and a network blip must never be read as the candidate leaving —
        // holding an interview over a 500 is the worse failure by far.
        .catch(() => undefined)
    }, VITALS_FRAME_MS)

    return () => {
      window.clearInterval(timer)
      // Whatever comes next starts from "we can see them", so a stale run of
      // misses can't hold the room the moment vitals resume.
      faceLostSinceRef.current = null
      setFaceLost(false)
    }
  }, [active, session, stream, videoRef, readTabSwitches])

  return { faceLost }
}
