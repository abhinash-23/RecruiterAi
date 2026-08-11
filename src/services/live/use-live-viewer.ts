import * as React from "react"

import { currentAccessToken } from "@/services/auth-service"
import { trace } from "@/services/socket-trace"

import {
  LIVE_CLOSE_MESSAGE,
  liveSocketUrl,
  parseLiveInsight,
  parseLiveMessage,
  sendLiveMessage,
  STUN_CONFIG,
  type LiveInsight,
} from "./signaling"

export type LiveViewerStatus = "connecting" | "waiting" | "live" | "unavailable"

export interface LiveViewerState {
  status: LiveViewerStatus
  /** Why it isn't live, when it isn't — shown to the recruiter verbatim. */
  message: string | null
  /** The candidate's camera and microphone, once the peer connection forms. */
  stream: MediaStream | null
  /** Question, answers and vitals, relayed over the peer connection. */
  insight: LiveInsight | null
}

/**
 * How long to wait for video before calling it. STUN-only connects for most
 * networks but not all, and a peer connection that can't find a route neither
 * errors nor succeeds — it simply never produces a track, so nothing but a
 * timeout distinguishes "still negotiating" from "never going to work".
 */
const NO_ROUTE_TIMEOUT_MS = 15_000

const NO_ROUTE_MESSAGE =
  "Live view unavailable on this network — the recording will be available after the interview."

/**
 * Watches one interview live: the viewer half of `WS /api/live/{interview_id}`.
 *
 * The viewer is passive by design. It authenticates, then waits: the candidate
 * creates the offer, and this answers it. Nothing here ever asks for a camera —
 * a recruiter is not on screen.
 *
 * Everything is best-effort and every failure is a state, not an exception.
 * A recruiter who can't get a picture still has the recording afterwards, so
 * this reports why and stops rather than retrying into a wall.
 */
export function useLiveViewer({
  interviewId,
  enabled = true,
}: {
  interviewId: string | undefined
  enabled?: boolean
}): LiveViewerState {
  const [state, setState] = React.useState<LiveViewerState>({
    status: "connecting",
    message: null,
    stream: null,
    insight: null,
  })

  // Read during render rather than inside the effect so that "no session" is a
  // *derived* state (see the return below) instead of an effect whose only job
  // is to immediately setState — which is the cascading render React warns
  // about. A refreshed token also reopens the socket, which is what we want.
  const token = currentAccessToken()

  React.useEffect(() => {
    if (!enabled || !interviewId || !token) return

    /** Set by cleanup, so a late callback can't write to an unmounted view. */
    let released = false
    let peer: RTCPeerConnection | null = null
    let timeout: number | undefined
    /**
     * ICE candidates that arrived before the offer had been applied.
     * `addIceCandidate` throws without a remote description, and the server
     * relays each candidate the moment the publisher produces it — so they can
     * and do overtake the offer they belong to.
     */
    let pendingIce: RTCIceCandidateInit[] = []

    const fail = (message: string) => {
      if (released) return
      setState((current) => ({
        ...current,
        status: "unavailable",
        message,
        stream: null,
      }))
    }

    const socket = new WebSocket(liveSocketUrl(interviewId))

    /** Armed once we know someone is publishing — see NO_ROUTE_TIMEOUT_MS. */
    const armTimeout = () => {
      window.clearTimeout(timeout)
      timeout = window.setTimeout(() => {
        if (released) return
        // Distinguishes the two very different reasons this fires: an offer that
        // never arrived (the candidate was never told to send one) from ICE that
        // couldn't find a route (a real network problem, needing a TURN relay).
        trace(
          "live:viewer",
          `no video after ${NO_ROUTE_TIMEOUT_MS}ms`,
          peer
            ? { offerReceived: true, iceConnectionState: peer.iceConnectionState }
            : { offerReceived: false }
        )
        setState((current) =>
          current.status === "live"
            ? current
            : { ...current, status: "unavailable", message: NO_ROUTE_MESSAGE }
        )
      }, NO_ROUTE_TIMEOUT_MS)
    }

    socket.onopen = () => {
      trace("live:viewer", "open", liveSocketUrl(interviewId))
      sendLiveMessage(socket, { type: "auth", role: "viewer", token })
    }

    // No `onerror` handler on purpose: it carries no detail worth showing, and
    // `onclose` always follows it — that is where the wording is decided.
    socket.onclose = (event) => {
      trace(
        "live:viewer",
        `closed ${event.code}${event.reason ? ` — ${event.reason}` : ""}`
      )
      if (released) return
      window.clearTimeout(timeout)

      const known = LIVE_CLOSE_MESSAGE[event.code]
      if (known) {
        fail(known)
        return
      }
      // No application code: either the sitting ended or the tunnel dropped.
      // Those read very differently to a recruiter, so use what we last saw.
      setState((current) => ({
        ...current,
        status: "unavailable",
        stream: null,
        message:
          current.status === "live"
            ? "The live feed ended — the candidate disconnected or finished."
            : "The live service closed the connection. Try reopening this page.",
      }))
    }

    socket.onmessage = (event) => {
      const message = parseLiveMessage(event.data)
      if (!message || released) {
        // A frame we couldn't read is the one worth seeing: it means the server's
        // wording and ours have diverged, which every other symptom hides.
        if (!message) trace("live:viewer", "unreadable frame", event.data)
        return
      }
      trace("live:viewer", `recv ${message.type}`, message)

      if (message.type === "auth-ok") {
        if (message.candidateOnline) {
          setState((current) => ({ ...current, status: "connecting", message: null }))
          armTimeout()
        } else {
          setState((current) => ({
            ...current,
            status: "waiting",
            message: "Waiting for the candidate to start their interview.",
          }))
        }
        return
      }

      if (message.type === "peer-joined" && message.role === "candidate") {
        setState((current) => ({ ...current, status: "connecting", message: null }))
        armTimeout()
        return
      }

      if (message.type === "peer-left" && message.role === "candidate") {
        window.clearTimeout(timeout)
        peer?.close()
        peer = null
        pendingIce = []
        fail("The candidate is no longer connected.")
        return
      }

      if (message.type === "offer" && message.sdp) {
        // A fresh offer supersedes any half-built connection: the candidate
        // re-offers when their own socket reconnects mid-sitting.
        peer?.close()
        pendingIce = []

        const connection = new RTCPeerConnection(STUN_CONFIG)
        peer = connection

        connection.ontrack = (trackEvent) => {
          const [stream] = trackEvent.streams
          if (released || !stream) return
          window.clearTimeout(timeout)
          setState((current) => ({
            ...current,
            status: "live",
            message: null,
            stream,
          }))
        }

        connection.onicecandidate = (iceEvent) => {
          // No `peer` field: there is only one candidate, and the server tags
          // this with our own viewer id before delivering it.
          if (iceEvent.candidate) {
            sendLiveMessage(socket, {
              type: "ice",
              candidate: iceEvent.candidate.toJSON(),
            })
          }
        }

        connection.onconnectionstatechange = () => {
          trace("live:viewer", `peer ${connection.connectionState}`)
          if (released) return
          if (
            connection.connectionState === "failed" ||
            connection.connectionState === "disconnected"
          ) {
            fail(NO_ROUTE_MESSAGE)
          }
        }

        // The candidate's live question, answers and vitals. See
        // LIVE_INSIGHT_CHANNEL for why this rides the peer connection.
        connection.ondatachannel = (channelEvent) => {
          channelEvent.channel.onmessage = (insightEvent) => {
            const insight = parseLiveInsight(insightEvent.data)
            if (insight && !released) {
              setState((current) => ({ ...current, insight }))
            }
          }
        }

        void (async () => {
          try {
            await connection.setRemoteDescription({
              type: "offer",
              sdp: message.sdp,
            })

            for (const candidate of pendingIce) {
              await connection.addIceCandidate(candidate).catch(() => undefined)
            }
            pendingIce = []

            const answer = await connection.createAnswer()
            await connection.setLocalDescription(answer)
            sendLiveMessage(socket, { type: "answer", sdp: answer.sdp })
          } catch {
            fail("Couldn't negotiate the live connection.")
          }
        })()
        return
      }

      if (message.type === "ice" && message.candidate) {
        // Buffered until the offer lands, then flushed above.
        if (!peer || !peer.remoteDescription) {
          pendingIce.push(message.candidate)
          return
        }
        void peer.addIceCandidate(message.candidate).catch(() => undefined)
      }
    }

    return () => {
      released = true
      window.clearTimeout(timeout)
      peer?.close()
      peer = null
      // Closed deliberately: leaving the socket open would keep this viewer in
      // the candidate's peer list, and they'd hold a connection to nobody.
      socket.close()
    }
  }, [interviewId, enabled, token])

  if (enabled && interviewId && !token) {
    return {
      status: "unavailable",
      message: "Your session has expired. Sign in again to watch.",
      stream: null,
      insight: null,
    }
  }

  return state
}
