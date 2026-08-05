import * as React from "react"

import {
  LIVE_INSIGHT_CHANNEL,
  LIVE_TERMINAL_CLOSE_CODES,
  liveSocketUrl,
  parseLiveMessage,
  sendLiveMessage,
  STUN_CONFIG,
  type LiveInsight,
} from "./signaling"

/** One watching recruiter: their peer connection and its insight channel. */
interface Viewer {
  connection: RTCPeerConnection
  channel: RTCDataChannel
  /** Answered before the answer arrived — see the viewer hook for why. */
  pendingIce: RTCIceCandidateInit[]
}

/**
 * How long to wait before reopening a signalling socket that dropped.
 *
 * Worth doing at all because a sitting runs for tens of minutes: a socket lost
 * to a blip at minute two would otherwise leave every recruiter who opened the
 * page afterwards unable to connect, for the rest of the interview.
 */
const RECONNECT_MS = 5000

/**
 * Serialises one insight frame, stamping the time **as it is sent**.
 *
 * At module scope on purpose: the timestamp has to be taken outside render, and
 * it belongs to the moment of transmission rather than to whichever render
 * happened to assemble the payload.
 */
function frame(payload: Omit<LiveInsight, "at">): string {
  return JSON.stringify({ ...payload, at: Date.now() } satisfies LiveInsight)
}

/**
 * Publishes the candidate's camera and microphone to any recruiter watching.
 *
 * The candidate is the *publisher*: they hold one peer connection per viewer,
 * keyed by the viewer id the server assigns, and they create the offer for each.
 * The stream handed in is the one the sitting already opened — asking for a
 * second `getUserMedia` would flash the browser's recording indicator and give
 * the vitals sampler a different track to read.
 *
 * **Nothing here may disturb the interview.** Live viewing is a bonus on top of
 * the recording, so every failure is swallowed: no throw, no state the room
 * renders an error from, and no retry that could spin. A candidate whose
 * network refuses peer-to-peer still sits their interview normally, and the
 * recruiter still gets the recording.
 *
 * Consent is a precondition, not a detail: the sitting only enables this after
 * the candidate has been told on the consent screen that a recruiter may watch.
 */
export function useLivePublish({
  stream,
  token,
  interviewId,
  enabled,
  insight,
}: {
  stream: MediaStream | null
  /** The candidate token from `verify-otp`. */
  token: string | null
  interviewId: string | null
  enabled: boolean
  /** Broadcast to every viewer whenever it changes. `at` is stamped on send. */
  insight: Omit<LiveInsight, "at">
}): { viewers: number } {
  const [viewerCount, setViewerCount] = React.useState(0)

  const viewersRef = React.useRef(new Map<string, Viewer>())
  /**
   * Read by the channel-open handler, which fires long after mount. Kept in a
   * ref so that a changing insight — it moves every second, with the clock —
   * can never re-run the effect that owns the socket and the peer connections.
   */
  const insightRef = React.useRef(insight)

  React.useEffect(() => {
    if (!enabled || !stream || !token || !interviewId) return
    if (typeof RTCPeerConnection === "undefined") return

    let released = false
    let socket: WebSocket | null = null
    let retry: number | undefined

    const viewers = viewersRef.current

    const drop = (viewerId: string) => {
      const viewer = viewers.get(viewerId)
      if (!viewer) return
      try {
        viewer.connection.close()
      } catch {
        /* already closed */
      }
      viewers.delete(viewerId)
      if (!released) setViewerCount(viewers.size)
    }

    const dropAll = () => {
      for (const viewerId of [...viewers.keys()]) drop(viewerId)
    }

    /** Builds a connection for one viewer and offers them the stream. */
    const offerTo = async (live: WebSocket, viewerId: string) => {
      if (released || !viewerId) return
      // A re-offer replaces whatever was half-built for this id.
      drop(viewerId)

      const connection = new RTCPeerConnection(STUN_CONFIG)
      const channel = connection.createDataChannel(LIVE_INSIGHT_CHANNEL)

      // Send the current state the moment the channel opens: a recruiter who
      // joins at question seven should see all seven, not wait for the next one.
      channel.onopen = () => {
        if (channel.readyState === "open") {
          try {
            channel.send(frame(insightRef.current))
          } catch {
            /* best-effort, like everything else here */
          }
        }
      }

      viewers.set(viewerId, { connection, channel, pendingIce: [] })
      if (!released) setViewerCount(viewers.size)

      for (const track of stream.getTracks()) {
        connection.addTrack(track, stream)
      }

      connection.onicecandidate = (event) => {
        // Unlike the viewer, the publisher MUST name the peer: one candidate
        // can serve several viewers, and the server routes on this field.
        if (event.candidate) {
          sendLiveMessage(live, {
            type: "ice",
            candidate: event.candidate.toJSON(),
            peer: viewerId,
          })
        }
      }

      connection.onconnectionstatechange = () => {
        if (
          connection.connectionState === "failed" ||
          connection.connectionState === "closed"
        ) {
          drop(viewerId)
        }
      }

      try {
        const offer = await connection.createOffer()
        await connection.setLocalDescription(offer)
        sendLiveMessage(live, { type: "offer", sdp: offer.sdp, peer: viewerId })
      } catch {
        drop(viewerId)
      }
    }

    const connect = () => {
      if (released) return

      let live: WebSocket
      try {
        live = new WebSocket(liveSocketUrl(interviewId))
      } catch {
        return
      }
      socket = live

      live.onopen = () => {
        sendLiveMessage(live, { type: "auth", role: "candidate", token })
      }

      live.onclose = (event) => {
        if (released) return
        dropAll()
        // 4409 says another tab is already publishing this sitting, 4001 that
        // the token has expired — reconnecting would only repeat the refusal.
        if (LIVE_TERMINAL_CLOSE_CODES.includes(event.code)) return
        retry = window.setTimeout(connect, RECONNECT_MS)
      }

      live.onmessage = (event) => {
        const message = parseLiveMessage(event.data)
        if (!message || released) return

        if (message.type === "auth-ok") {
          // Recruiters can already be waiting on a link opened before the
          // candidate started; each needs their own offer.
          for (const viewerId of message.viewers ?? []) {
            void offerTo(live, viewerId)
          }
          return
        }

        if (message.type === "peer-joined" && message.role === "viewer") {
          if (message.peer) void offerTo(live, message.peer)
          return
        }

        if (message.type === "peer-left" && message.role === "viewer") {
          if (message.peer) drop(message.peer)
          return
        }

        const viewer = message.peer ? viewers.get(message.peer) : undefined
        if (!viewer) return

        if (message.type === "answer" && message.sdp) {
          void (async () => {
            try {
              await viewer.connection.setRemoteDescription({
                type: "answer",
                sdp: message.sdp,
              })
              for (const candidate of viewer.pendingIce) {
                await viewer.connection
                  .addIceCandidate(candidate)
                  .catch(() => undefined)
              }
              viewer.pendingIce = []
            } catch {
              if (message.peer) drop(message.peer)
            }
          })()
          return
        }

        if (message.type === "ice" && message.candidate) {
          if (!viewer.connection.remoteDescription) {
            viewer.pendingIce.push(message.candidate)
            return
          }
          void viewer.connection
            .addIceCandidate(message.candidate)
            .catch(() => undefined)
        }
      }
    }

    connect()

    return () => {
      released = true
      window.clearTimeout(retry)
      dropAll()
      socket?.close()
      socket = null
    }
  }, [enabled, stream, token, interviewId])

  /* --------------------------------------------------------- broadcasting - */

  React.useEffect(() => {
    // Also where the ref is refreshed, so a viewer connecting later opens on
    // the current state rather than on whatever this hook first mounted with.
    insightRef.current = insight

    for (const viewer of viewersRef.current.values()) {
      if (viewer.channel.readyState !== "open") continue
      try {
        viewer.channel.send(frame(insight))
      } catch {
        /* a channel closing mid-send is not the interview's problem */
      }
    }
  }, [insight])

  return { viewers: viewerCount }
}
