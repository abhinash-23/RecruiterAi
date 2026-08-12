import * as React from "react"

import { currentAccessToken } from "@/services/auth-service"
import { trace } from "@/services/socket-trace"

import {
  LIVE_STREAM_MIME,
  liveRelayUrl,
  parseRelayFrame,
  relayAuthFrame,
  relayReconnectDelayMs,
  RELAY_BEHIND_CLOSE_CODE,
  RELAY_CLOSE_MESSAGE,
  RELAY_TERMINAL_CLOSE_CODES,
  type LiveProgress,
} from "./live-relay"

export type LiveRelayStatus =
  | "connecting"
  /** Authorised, but the candidate isn't streaming yet. */
  | "waiting"
  | "live"
  /** They were streaming and dropped; their client is coming back by itself. */
  | "reconnecting"
  | "ended"
  /** Refused, or this browser can't play the stream. Nothing to wait for. */
  | "unavailable"

export interface LiveRelayState {
  status: LiveRelayStatus
  /** Why it isn't playing, when it isn't — shown to the recruiter verbatim. */
  message: string | null
  /**
   * How far through the sitting the candidate is, and everything they have
   * answered. Null until the first snapshot arrives.
   *
   * **Independent of `status`.** It travels as JSON on the same socket as the
   * video, so it survives a browser that can't decode the stream and a viewer
   * whose bytes are falling behind — which is the whole reason it lives here
   * rather than on a peer connection, where it used to die with the picture.
   */
  progress: LiveProgress | null
  /**
   * Attach this to the `<video>`.
   *
   * The element is driven through `src` and a `MediaSource`, **not** `srcObject`:
   * these are WebM bytes off a socket, not a `MediaStream`. So the hook needs the
   * element itself rather than handing back a stream to assign.
   */
  videoRef: React.RefObject<HTMLVideoElement | null>
}

/**
 * How far behind the live edge the player is allowed to drift before it is
 * nudged forward, and where it lands.
 *
 * Without this a backgrounded tab falls minutes behind: the socket keeps
 * delivering bytes, the buffer keeps growing, and the element keeps playing from
 * wherever it was. Four seconds of slack is enough to absorb a stutter without
 * chasing every hiccup.
 */
const EDGE_SLACK_SECONDS = 4
const EDGE_CHECK_MS = 3000

/**
 * How much played video to keep, and how often to drop the rest.
 *
 * A `SourceBuffer` holds everything appended to it, so an hour-long interview
 * is an hour of video in the tab's memory — and the browser eventually refuses
 * an append instead, which stops playback dead.
 */
const KEEP_SECONDS = 30
const TRIM_EVERY_MS = 60_000

/**
 * Watches one interview live, over `WSS /api/live-relay/{interview_id}`.
 *
 * The socket delivers the candidate's own recording bytes; this appends them to
 * a `MediaSource` and keeps the element at the live edge. Every failure is a
 * state rather than an exception — the recording remains the reliable artefact,
 * so a recruiter who can't watch live has lost nothing but immediacy.
 *
 * **The whole lifecycle lives inside one effect on purpose.** Its guards are
 * closure variables, not refs: React's StrictMode mounts an effect twice on the
 * same instance, and a ref set during cleanup survives into the second run —
 * which is precisely how the recording socket was once left permanently unable
 * to connect.
 */
export function useLiveRelay({
  interviewId,
  enabled = true,
}: {
  interviewId: string | undefined
  enabled?: boolean
}): LiveRelayState {
  const videoRef = React.useRef<HTMLVideoElement | null>(null)
  const [state, setState] = React.useState<{
    status: LiveRelayStatus
    message: string | null
  }>({ status: "connecting", message: null })
  /**
   * Separate state from the status pair, and never cleared on a drop.
   *
   * Every rejoin is handed a full snapshot right after `auth-ok`, so holding the
   * last one meanwhile keeps the panel from blanking during a blip — and the
   * snapshot that replaces it is the whole truth, so nothing can go stale.
   */
  const [progress, setProgress] = React.useState<LiveProgress | null>(null)

  // Read during render rather than inside the effect, so "no session" is a
  // derived state instead of an effect whose only job is to setState. A
  // refreshed token also reopens the socket, which is what we want.
  const token = currentAccessToken()

  React.useEffect(() => {
    if (!enabled || !interviewId || !token) return

    /** Set by cleanup, so a late callback can't touch an unmounted view. */
    let released = false
    let socket: WebSocket | null = null
    let retry: number | undefined
    let attempt = 0
    /**
     * Consecutive "you fell behind" drops.
     *
     * The contract says rejoin immediately on 1013, and for a viewer who fell
     * behind once that is right — the rejoin lands at the live edge, which is the
     * fix. But taken literally it is also a hot loop: a connection too slow to
     * keep up will be dropped again the moment it catches up, and "immediately"
     * would mean a new socket every few hundred milliseconds from a recruiter's
     * tab. After a few tries, fall back to the ordinary backoff.
     */
    let behindDrops = 0

    let mediaSource: MediaSource | null = null
    let sourceBuffer: SourceBuffer | null = null
    let objectUrl: string | null = null
    /**
     * Bytes waiting for the SourceBuffer to go idle.
     *
     * Held as the `ArrayBuffer` the socket delivered, not wrapped in a view: the
     * order they were received in is the order they must be appended in, and
     * there is nothing to inspect on the way.
     */
    let queue: ArrayBuffer[] = []
    /** Distinguishes "hasn't started" from "was streaming and dropped". */
    let everLive = false

    const show = (status: LiveRelayStatus, message: string | null = null) => {
      if (!released) setState({ status, message })
    }

    // Firefox has MediaSource but not WebM/VP8 in every build, and Safari has no
    // WebM at all — so this is a real branch, not a formality. Said plainly
    // rather than left as an empty player: the recording still exists.
    if (
      typeof MediaSource === "undefined" ||
      !MediaSource.isTypeSupported(LIVE_STREAM_MIME)
    ) {
      trace("live:relay", "MediaSource can't play the stream in this browser")
      show(
        "unavailable",
        "This browser can't play the live stream. Chrome or Edge can, and the recording is available either way."
      )
      return
    }

    /* ------------------------------------------------------------- player - */

    /**
     * Appends one chunk, or removes played video — whichever is next.
     *
     * Serialised through a queue because `appendBuffer` throws while the buffer
     * is `updating`, and `remove` sets the same flag. Both fire `updateend`,
     * which is what drains the rest.
     */
    const pump = () => {
      if (released || !sourceBuffer || sourceBuffer.updating) return
      const next = queue.shift()
      if (!next) return

      try {
        sourceBuffer.appendBuffer(next)
      } catch (error) {
        // QuotaExceededError means the buffer is full: drop what has already
        // been watched and try this chunk again on the next `updateend`.
        if (error instanceof DOMException && error.name === "QuotaExceededError") {
          queue.unshift(next)
          trimPlayed(5)
          return
        }
        // Anything else means this MediaSource is finished. A rebuild needs a
        // fresh init segment, which only arrives on a reconnect or a reset, so
        // there is nothing to do here but stop feeding it.
        trace("live:relay", "append failed", error)
      }
    }

    /** Drops everything up to `keep` seconds behind the playhead. */
    const trimPlayed = (keep = KEEP_SECONDS) => {
      const video = videoRef.current
      if (!sourceBuffer || sourceBuffer.updating || !video) return
      const cutoff = video.currentTime - keep
      if (cutoff <= 0) return
      try {
        sourceBuffer.remove(0, cutoff)
      } catch {
        /* buffer busy or already gone; the next tick will do it */
      }
    }

    const teardownPlayer = () => {
      queue = []
      if (sourceBuffer) {
        sourceBuffer.removeEventListener("updateend", pump)
        // `abort` is only legal while the source is open, and only matters to
        // cancel an append already in flight.
        try {
          if (mediaSource?.readyState === "open") sourceBuffer.abort()
        } catch {
          /* nothing in flight */
        }
      }
      sourceBuffer = null
      mediaSource = null
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl)
        objectUrl = null
      }
      const video = videoRef.current
      if (video) video.removeAttribute("src")
    }

    /**
     * Builds a fresh player. Returns false when the `<video>` isn't on screen
     * yet, so the caller can keep the bytes and try again on the next frame.
     */
    const buildPlayer = () => {
      const video = videoRef.current
      if (!video) return false

      teardownPlayer()

      mediaSource = new MediaSource()
      objectUrl = URL.createObjectURL(mediaSource)
      video.src = objectUrl

      mediaSource.addEventListener("sourceopen", () => {
        if (released || !mediaSource) return
        try {
          sourceBuffer = mediaSource.addSourceBuffer(LIVE_STREAM_MIME)
        } catch (error) {
          trace("live:relay", "addSourceBuffer refused", error)
          show(
            "unavailable",
            "This browser wouldn't open a player for the live stream. The recording is available afterwards."
          )
          return
        }
        sourceBuffer.addEventListener("updateend", pump)
        pump()
      })

      // Muted, because a browser refuses to autoplay audio without a gesture on
      // the element — and a feed that silently declined to start reads as a
      // broken connection rather than a blocked one. The page has its own
      // control for sound.
      video.muted = true
      void video.play().catch(() => undefined)
      return true
    }

    const edgeTimer = window.setInterval(() => {
      const video = videoRef.current
      if (!video || !video.buffered.length) return
      const edge = video.buffered.end(video.buffered.length - 1)
      if (edge - video.currentTime > EDGE_SLACK_SECONDS) {
        video.currentTime = edge - 1
      }
    }, EDGE_CHECK_MS)

    const trimTimer = window.setInterval(() => trimPlayed(), TRIM_EVERY_MS)

    /* ------------------------------------------------------------- socket - */

    const connect = () => {
      if (released) return

      let live: WebSocket
      try {
        live = new WebSocket(liveRelayUrl(interviewId))
      } catch {
        show("unavailable", "Couldn't open a live connection.")
        return
      }
      socket = live
      // Binary frames must arrive as buffers, not Blobs — a Blob would have to
      // be read asynchronously, which reorders appends.
      live.binaryType = "arraybuffer"

      live.onopen = () => {
        trace("live:relay", "open", liveRelayUrl(interviewId))
        live.send(relayAuthFrame(token))
      }

      live.onmessage = (event) => {
        if (released) return

        // Binary: the stream itself. The first frame after joining or after a
        // reset is the init segment, so the player must already exist.
        if (typeof event.data !== "string") {
          if (!sourceBuffer && !mediaSource && !buildPlayer()) return
          queue.push(event.data as ArrayBuffer)
          pump()
          return
        }

        const frame = parseRelayFrame(event.data)
        if (!frame) {
          trace("live:relay", "unreadable frame", event.data)
          return
        }
        trace("live:relay", `recv ${frame.type}`)

        // A full snapshot, so this is an assignment rather than a merge — and it
        // deliberately doesn't touch `status`: progress is not the feed.
        if (frame.type === "progress") {
          if (!released) setProgress(frame.progress)
          return
        }

        switch (frame.type) {
          case "auth-ok":
            attempt = 0
            show("connecting")
            return

          case "stream-live":
            everLive = true
            // Bytes are flowing again, so whatever went wrong before is behind
            // us — both counters start over.
            attempt = 0
            behindDrops = 0
            if (!mediaSource) buildPlayer()
            void videoRef.current?.play().catch(() => undefined)
            show("live")
            return

          case "stream-offline":
            // Their client reconnects on its own and the bytes resume where they
            // stopped, so the player stays exactly as it is — rebuilding here
            // would throw away a working buffer and wait for an init segment
            // that isn't coming.
            show(
              everLive ? "reconnecting" : "waiting",
              everLive
                ? "The candidate's connection dropped. Their browser is reconnecting — the recording is still capturing everything."
                : "Waiting for the candidate to start their interview."
            )
            return

          case "stream-reset":
            // A *new* stream: they reloaded the page. The old bytes belong to a
            // file that has ended, and a fresh init segment is on its way.
            buildPlayer()
            show("connecting")
            return

          case "stream-ended":
            show("ended", "The interview has finished. The recording will be on the report shortly.")
            return
        }
      }

      live.onerror = () => {
        // A close always follows, and that is where the wording is decided.
      }

      live.onclose = (event) => {
        trace(
          "live:relay",
          `closed ${event.code}${event.reason ? ` — ${event.reason}` : ""}`
        )
        if (released) return
        if (socket === live) socket = null

        // Any rejoin is handed a fresh init segment, so it always needs a fresh
        // MediaSource — including the immediate 1013 case below.
        teardownPlayer()

        if (event.code === 1000) {
          show(
            "ended",
            "The interview has finished. The recording will be on the report shortly."
          )
          return
        }

        if (RELAY_TERMINAL_CLOSE_CODES.includes(event.code)) {
          show(
            "unavailable",
            RELAY_CLOSE_MESSAGE[event.code] ??
              "The live service closed the connection."
          )
          return
        }

        if (event.code === RELAY_BEHIND_CLOSE_CODE && behindDrops < 3) {
          // Dropped for falling behind. Straight back in — the rejoin starts at
          // the live edge, which is the fix.
          behindDrops++
          show("connecting", "Catching up…")
          attempt = 0
          connect()
          return
        }

        show(
          everLive ? "reconnecting" : "connecting",
          "Reconnecting to the live feed…"
        )
        retry = window.setTimeout(connect, relayReconnectDelayMs(attempt++))
      }
    }

    connect()

    return () => {
      released = true
      window.clearTimeout(retry)
      window.clearInterval(edgeTimer)
      window.clearInterval(trimTimer)
      teardownPlayer()
      // Closed deliberately: leaving it open would hold one of the four viewer
      // slots the server allows per interview.
      socket?.close()
    }
  }, [interviewId, enabled, token])

  if (enabled && interviewId && !token) {
    return {
      status: "unavailable",
      message: "Your session has expired. Sign in again to watch.",
      progress: null,
      videoRef,
    }
  }

  return { ...state, progress, videoRef }
}
