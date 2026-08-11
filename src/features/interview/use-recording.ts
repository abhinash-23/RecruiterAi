import * as React from "react"

import {
  AUDIO_BITS_PER_SECOND,
  CHUNK_INTERVAL_MS,
  MAX_CHUNK_BYTES,
  RECORDING_TERMINAL_CLOSE_CODES,
  STOP_FRAME,
  VIDEO_BITS_PER_SECOND,
  authFrame,
  chunkFrame,
  contentTypeOf,
  parseRecordingMessage,
  pickRecordingMimeType,
  recordingSocketUrl,
  reconnectDelayMs,
  resumeFrame,
} from "@/services/interview"
import { trace } from "@/services/socket-trace"

/**
 * Records the sitting and streams it to the backend while it happens.
 *
 * `MediaRecorder` → one WebSocket → the backend persists each chunk to cloud
 * storage and **acks what is safe**. On `stop` the recording is sealed and
 * linked to the interview, which is what makes it appear on the recruiter's
 * report.
 *
 * **The rule that makes this lossless:** every chunk stays in memory until an
 * ack covers it. Acks are cumulative and carry a byte total, so a dropped
 * connection is repaired by reconnecting, reading `resumeFrom`, and re-sending
 * from exactly that offset. Nothing is ever assumed delivered because it was
 * sent.
 *
 * **Nothing here may interrupt the interview.** Every failure path ends in "this
 * sitting isn't being recorded" and nothing else: no error surfaces, no question
 * is blocked, and `start` never throws. A deployment with no storage configured
 * (close code 4503) simply doesn't record.
 */
export function useRecording({
  stream,
  token,
  interviewId,
}: {
  stream: MediaStream | null
  token: string | null
  interviewId: string | null
}) {
  /** Drives the REC badge. True whenever the camera is being captured. */
  const [recording, setRecording] = React.useState(false)

  const recorderRef = React.useRef<MediaRecorder | null>(null)
  const socketRef = React.useRef<WebSocket | null>(null)
  const mimeRef = React.useRef("video/webm")

  /**
   * The recording's server-side id. Its presence is what turns a reconnect into
   * a *resume* rather than a second recording of the same sitting.
   */
  const sessionIdRef = React.useRef<string | null>(null)

  /** Chunks produced but not yet acked, contiguous and oldest first. */
  const pendingRef = React.useRef<PendingChunk[]>([])
  /** Total bytes `MediaRecorder` has produced — the offset of the next chunk. */
  const producedRef = React.useRef(0)
  /** Bytes confirmed persisted. Only ever moves forward. */
  const ackedRef = React.useRef(0)
  /**
   * How far the *current connection* has sent.
   *
   * A cursor rather than a flag per chunk, because that is what a resume
   * actually is: the server names a byte offset, and everything after it has to
   * go again. Rewinding this one number re-sends exactly that much.
   */
  const sentToRef = React.useRef(0)
  /** Frame counter. Monotonic across reconnects; the server only needs it rising. */
  const seqRef = React.useRef(1)

  /** Serialises the sends: a chunk header and its bytes must stay adjacent. */
  const pumpRef = React.useRef<Promise<void>>(Promise.resolve())
  /** Lets a reconnect fire without `connect` having to reference itself. */
  const connectRef = React.useRef<(() => void) | null>(null)

  /** We asked to stop — a close is expected and must not reconnect. */
  const finishingRef = React.useRef(false)
  /** Recording is over for this sitting and will not be retried. */
  const deadRef = React.useRef(false)
  const attemptRef = React.useRef(0)
  const retryRef = React.useRef<number | null>(null)
  /** Resolves when the server confirms the recording is sealed. */
  const finalizedRef = React.useRef<(() => void) | null>(null)
  /**
   * `start` runs from an effect and creates the recorder after an `await`;
   * without this, a re-render in that window would open a second recording of
   * the same sitting.
   */
  const startingRef = React.useRef(false)

  /* ------------------------------------------------------------- shutdown - */

  /** Ends recording for good, releasing everything but the camera stream. */
  const abandon = React.useCallback(() => {
    if (deadRef.current) return
    trace("recording", "abandoned — this sitting will have no recording", {
      producedBytes: producedRef.current,
      ackedBytes: ackedRef.current,
      sessionId: sessionIdRef.current,
    })
    deadRef.current = true
    setRecording(false)

    if (retryRef.current !== null) {
      window.clearTimeout(retryRef.current)
      retryRef.current = null
    }
    try {
      recorderRef.current?.stop()
    } catch {
      /* already stopped */
    }
    recorderRef.current = null

    // If the socket is still up, seal what did land: giving up on the *rest* of
    // a recording is no reason to throw away the part that is already in
    // storage. The server needs a `stop` to make it playable.
    const socket = socketRef.current
    if (socket?.readyState === WebSocket.OPEN) {
      try {
        socket.send(STOP_FRAME)
      } catch {
        /* closing anyway */
      }
    }
    socket?.close()
    socketRef.current = null

    // Dropping the buffer matters: with nowhere to send it, an unbounded queue
    // of video is the one way this hook could take the interview down with it.
    pendingRef.current = []
  }, [])

  /* ----------------------------------------------------------- the sender - */

  /**
   * Sends every chunk the current connection hasn't sent yet, in order.
   *
   * Queued behind whatever send is in flight, because each chunk is *two*
   * frames — a JSON header then its bytes — and anything interleaved between
   * them is a protocol violation the server closes on (4400).
   */
  const pump = React.useCallback(() => {
    pumpRef.current = pumpRef.current
      .then(async () => {
        const socket = socketRef.current
        // No session id yet means `ready` hasn't arrived: chunks keep piling up
        // and go out together, so the opening seconds survive a slow connection.
        if (!socket || !sessionIdRef.current) return

        for (const chunk of pendingRef.current) {
          const end = chunk.offset + chunk.size
          if (end <= sentToRef.current) continue
          if (socket.readyState !== WebSocket.OPEN) return

          // The socket's own outbound buffer is the back-pressure signal: past
          // this, stop feeding it and let the next ack restart the pump. Without
          // it a slow uplink is absorbed silently until the tab is starved.
          if (socket.bufferedAmount > SOCKET_BUFFER_LIMIT) return

          const bytes = await chunk.blob.arrayBuffer()
          // Re-checked after the await: reading a blob is asynchronous and the
          // socket can close underneath it, which would throw on send.
          if (socket.readyState !== WebSocket.OPEN) return

          // Header then bytes, adjacent and in that order — the server reads the
          // next binary frame as the body of the last header it saw.
          socket.send(chunkFrame(seqRef.current++, chunk.size))
          socket.send(bytes)
          sentToRef.current = end
        }
      })
      .catch(() => {
        // A failed read or a socket that closed mid-send. The chunk is still
        // unsent and unacked, so the resume path will carry it.
      })
    return pumpRef.current
  }, [])

  /* -------------------------------------------------------- the connection - */

  /**
   * Drops everything the server has confirmed is in storage.
   *
   * The buffer is rebuilt rather than edited in place: the surviving head chunk
   * can *straddle* the boundary — part of it persisted, part not — and sending
   * it whole again would duplicate those bytes inside the file, so its acked
   * head is sliced away.
   */
  const dropAcked = React.useCallback((safeBytes: number) => {
    ackedRef.current = Math.max(ackedRef.current, safeBytes)
    const acked = ackedRef.current

    pendingRef.current = pendingRef.current
      .filter((chunk) => chunk.offset + chunk.size > acked)
      .map((chunk) =>
        chunk.offset < acked
          ? {
              offset: acked,
              blob: chunk.blob.slice(acked - chunk.offset),
              size: chunk.size - (acked - chunk.offset),
            }
          : chunk
      )
  }, [])

  /**
   * Re-attaches the send cursor to the offset the server reports.
   *
   * `resumeFrom` outranks anything this client believes it sent: it is what is
   * actually in storage, and bytes we handed to a socket that then died were
   * never there.
   */
  const resumeAt = React.useCallback(
    (safeBytes: number) => {
      dropAcked(safeBytes)
      sentToRef.current = safeBytes
    },
    [dropAcked]
  )

  const connect = React.useCallback(() => {
    if (deadRef.current || finishingRef.current) return
    if (!token || !interviewId) return

    let socket: WebSocket
    try {
      socket = new WebSocket(recordingSocketUrl(interviewId))
    } catch {
      abandon()
      return
    }
    socketRef.current = socket

    socket.onopen = () => {
      // Auth is the first frame or the server hangs up — and on a reconnect it
      // carries the session id, which is the difference between resuming this
      // recording and starting a second one.
      const existing = sessionIdRef.current
      trace("recording", existing ? `open — resuming ${existing}` : "open — new session")
      socket.send(
        existing
          ? resumeFrame(token, existing)
          : authFrame(token, contentTypeOf(mimeRef.current))
      )
    }

    socket.onmessage = (event) => {
      const message = parseRecordingMessage(event.data)
      if (!message) return

      trace("recording", `recv ${message.type}`, message)

      if (message.type === "ready") {
        sessionIdRef.current = message.recordingSessionId ?? sessionIdRef.current
        attemptRef.current = 0

        if (!sessionIdRef.current) {
          // Without an id there is nothing to resume to and, more importantly,
          // `pump` refuses to send — so say so instead of recording an interview
          // into a buffer nobody empties.
          trace("recording", "ready carried no session id — giving up", message)
          abandon()
          return
        }
        // Falls back to what we already know is acked, not to 0: on a fresh
        // session those are the same, but on a *resume* whose reply omitted the
        // offset, rewinding to zero would re-send the whole recording and
        // duplicate every byte already in storage.
        resumeAt(message.resumeFrom ?? ackedRef.current)
        void pump()
        return
      }

      if (message.type === "ack") {
        // Acks are cumulative and it is `uploadedBytes` that matters — the seq
        // is the server's receipt, the byte total is the guarantee.
        if (typeof message.uploadedBytes === "number") {
          dropAcked(message.uploadedBytes)
        }
        // Acked chunks just left the buffer, and back-pressure may have paused
        // the pump — either way there is now room to send.
        void pump()
        return
      }

      if (message.type === "finalized") {
        finalizedRef.current?.()
        finalizedRef.current = null
      }
    }

    socket.onclose = (event) => {
      trace(
        "recording",
        `closed ${event.code}${event.reason ? ` — ${event.reason}` : ""}`,
        {
          producedBytes: producedRef.current,
          ackedBytes: ackedRef.current,
          finishing: finishingRef.current,
        }
      )
      if (socketRef.current === socket) socketRef.current = null
      if (finishingRef.current || deadRef.current) return

      if (RECORDING_TERMINAL_CLOSE_CODES.includes(event.code)) {
        // Storage isn't configured, another tab took over, or the token was
        // refused. Retrying cannot change any of those.
        abandon()
        return
      }

      // Everything else is a blip: keep capturing and resume from the offset the
      // server reports when we get back in.
      const delay = reconnectDelayMs(attemptRef.current++)
      retryRef.current = window.setTimeout(() => {
        retryRef.current = null
        // Through the ref, because a callback cannot name itself — and because
        // the reconnect should use the newest one, not the one captured when the
        // socket that just died was opened.
        connectRef.current?.()
      }, delay)
    }

    socket.onerror = () => {
      // A close event always follows; the reconnect is decided there so it isn't
      // scheduled twice.
    }
  }, [token, interviewId, abandon, pump, resumeAt, dropAcked])

  // Kept current so a reconnect scheduled minutes ago uses the newest `connect`
  // — the same reason `use-dictation` respawns through a ref.
  React.useEffect(() => {
    connectRef.current = connect
  })

  /* --------------------------------------------------------------- start -- */

  const start = React.useCallback(() => {
    if (
      !stream ||
      !token ||
      !interviewId ||
      recorderRef.current ||
      startingRef.current ||
      deadRef.current
    ) {
      return false
    }

    const mimeType = pickRecordingMimeType()
    if (!mimeType) {
      trace("recording", "this browser records none of the supported types")
      return false
    }

    startingRef.current = true
    mimeRef.current = mimeType

    /* Cleared here, and this is load-bearing rather than tidy.
     *
     * The teardown effect sets `finishing` so that closing the socket on the way
     * out can't schedule a reconnect into an unmounted page. But React's
     * StrictMode mounts every effect twice on the *same* instance — setup,
     * cleanup, setup — and a ref survives that cleanup. The page mounts long
     * before the camera is granted, so the flag was already true by the time
     * recording began: the recorder ran, chunks piled up, `connect` returned at
     * its first line, and no socket was ever opened. The sitting then ended with
     * nothing in storage, which is indistinguishable from never having tried.
     *
     * Asking to start a recording is the one moment that definitively means
     * "not finishing", so this is the right place to re-arm it. */
    finishingRef.current = false

    let recorder: MediaRecorder
    try {
      recorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: VIDEO_BITS_PER_SECOND,
        audioBitsPerSecond: AUDIO_BITS_PER_SECOND,
      })
    } catch {
      startingRef.current = false
      return false
    }

    pendingRef.current = []
    producedRef.current = 0
    ackedRef.current = 0
    sentToRef.current = 0
    sessionIdRef.current = null
    attemptRef.current = 0

    recorder.ondataavailable = (event) => {
      if (deadRef.current || event.data.size === 0) return

      // Split so no single frame can exceed the server's per-chunk limit — one
      // oversized frame is a protocol violation, not a trimmed upload.
      let offset = producedRef.current
      const produced = split(event.data, MAX_CHUNK_BYTES).map((piece) => {
        const chunk = { offset, size: piece.size, blob: piece }
        offset += piece.size
        return chunk
      })
      pendingRef.current = [...pendingRef.current, ...produced]
      producedRef.current = offset

      // A long disconnection is survivable; an endless one is not. Past the cap
      // the recording is given up rather than allowed to exhaust the tab the
      // candidate is sitting the interview in. Whatever reached storage is still
      // sealed by the server, so this truncates the video — it never corrupts
      // it, which dropping from the middle of the buffer would.
      const buffered = producedRef.current - ackedRef.current
      if (buffered > MAX_BUFFERED_BYTES) {
        abandon()
        return
      }

      void pump()
    }

    // Recording starts before the socket is up on purpose: the first chunks
    // queue and go out the moment `ready` lands, so nothing is lost to a slow
    // handshake.
    recorder.start(CHUNK_INTERVAL_MS)
    recorderRef.current = recorder
    startingRef.current = false
    setRecording(true)
    trace("recording", `started as ${mimeType}`, {
      url: recordingSocketUrl(interviewId),
    })

    connect()
    return true
  }, [stream, token, interviewId, connect, pump, abandon])

  /* ---------------------------------------------------------------- stop -- */

  /**
   * Flushes the tail and seals the recording.
   *
   * Called from `finishSitting` *before* `finish-interview`, so the video is
   * linked by the time the recruiter's report exists. Bounded by
   * {@link FINALIZE_TIMEOUT_MS}: the candidate's finish screen never waits on
   * the network longer than that, and a `stop` the server didn't confirm is
   * still covered by its own ~10-minute auto-seal.
   */
  const stop = React.useCallback(async () => {
    const recorder = recorderRef.current
    recorderRef.current = null
    setRecording(false)

    // Set before anything else: from here a close is expected, and reconnecting
    // to rescue a few last seconds would hold up the finish screen.
    finishingRef.current = true

    if (recorder) {
      await new Promise<void>((resolve) => {
        // The final `ondataavailable` fires before `onstop`, so the tail is in
        // the buffer by the time this resolves.
        recorder.onstop = () => resolve()
        try {
          recorder.stop()
        } catch {
          resolve()
        }
      })
    }

    const socket = socketRef.current
    if (!deadRef.current && socket?.readyState === WebSocket.OPEN) {
      await pump()

      trace("recording", "sending stop", {
        producedBytes: producedRef.current,
        ackedBytes: ackedRef.current,
      })
      const sealed = new Promise<void>((resolve) => {
        finalizedRef.current = resolve
      })
      try {
        // Ordered after the chunks above, so the server has every byte before it
        // reads this. A `stop` with nothing sent cancels the session cleanly.
        socket.send(STOP_FRAME)
        await Promise.race([sealed, wait(FINALIZE_TIMEOUT_MS)])
      } catch {
        /* the socket went away; the server's auto-seal covers it */
      }
    }

    finalizedRef.current = null
    socketRef.current?.close()
    socketRef.current = null
    pendingRef.current = []
    // This sitting's recording is finished, sealed or not. Without this a later
    // `start` — a re-render while the done screen mounts — would open a second
    // recording of an interview that is already over.
    deadRef.current = true
  }, [pump])

  /* ------------------------------------------------------------- teardown - */

  React.useEffect(
    () => () => {
      // The tab is going. Stopping the recorder is what puts the camera light
      // out, and a parting `stop` gets the recording sealed now rather than
      // leaving the server to reap it ten minutes later.
      finishingRef.current = true
      if (retryRef.current !== null) window.clearTimeout(retryRef.current)
      try {
        recorderRef.current?.stop()
      } catch {
        /* already stopped */
      }
      recorderRef.current = null

      const socket = socketRef.current
      if (socket?.readyState === WebSocket.OPEN) {
        try {
          socket.send(STOP_FRAME)
        } catch {
          /* closing anyway */
        }
      }
      socket?.close()
      socketRef.current = null
    },
    []
  )

  return { start, stop, recording }
}

/** One chunk of video, and where it sits in the file. */
interface PendingChunk {
  /** Absolute byte offset in the recording. What `resumeFrom` is compared to. */
  offset: number
  size: number
  blob: Blob
}

/**
 * How much unsent video to hold before giving up — roughly four minutes at the
 * configured bitrate.
 */
const MAX_BUFFERED_BYTES = 32 * 1024 * 1024

/** How much to leave queued in the socket before pausing the pump. */
const SOCKET_BUFFER_LIMIT = 4 * 1024 * 1024

/** How long `stop` waits for the server to confirm the recording is sealed. */
const FINALIZE_TIMEOUT_MS = 8000

/** Cuts a blob into pieces no larger than `limit`. Cheap — blobs slice by reference. */
function split(blob: Blob, limit: number): Blob[] {
  if (blob.size <= limit) return [blob]

  const pieces: Blob[] = []
  for (let start = 0; start < blob.size; start += limit) {
    pieces.push(blob.slice(start, Math.min(start + limit, blob.size)))
  }
  return pieces
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}
