import * as React from "react"

import {
  finalizeRecording,
  linkRecording,
  reportUploadProgress,
  startRecordingUpload,
  type RecordingUploadSession,
} from "@/services/interview"

/** How often `MediaRecorder` hands us a chunk. */
const TIMESLICE_MS = 5000

/**
 * Records the sitting and uploads it while it happens.
 *
 * The video goes **straight from the browser to cloud storage** over Google's
 * resumable protocol — our API only issues the session and is told how far it
 * got. Relaying an hour of video through it would be absurd.
 *
 * The protocol in one paragraph: each `PUT` carries a byte range, the server
 * answers `308` to mean "still going, keep sending", and the final `PUT` — the
 * only one that knows the total size — answers `200`. Ranges must be
 * **contiguous**, which is why chunks accumulate in a buffer here instead of
 * being sent as they arrive: a dropped chunk would corrupt every offset after
 * it.
 *
 * **Nothing here may interrupt the interview.** A candidate whose upload fails
 * has still sat the interview; every failure stops the recording and is
 * swallowed. That is also why `start` never throws — a deployment without
 * storage configured simply doesn't record.
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
  const [recording, setRecording] = React.useState(false)

  const recorderRef = React.useRef<MediaRecorder | null>(null)
  const sessionRef = React.useRef<RecordingUploadSession | null>(null)
  /** Chunks not yet sent. Flushed when they exceed the server's buffer hint. */
  const bufferRef = React.useRef<Blob[]>([])
  /** Bytes already accepted by storage — the start of the next range. */
  const sentRef = React.useRef(0)
  /** Serialises the PUTs: ranges are contiguous, so they can't overlap. */
  const chainRef = React.useRef<Promise<void>>(Promise.resolve())
  const deadRef = React.useRef(false)
  /**
   * `start` is called from an effect and opens the session with an `await`
   * before `recorderRef` is set — without this, a re-render in that window
   * would open a second upload session for the same sitting.
   */
  const startingRef = React.useRef(false)

  /**
   * Sends one contiguous range. `total` is null while more is coming, which is
   * what the `*` in the range header means.
   */
  const put = React.useCallback(async (body: Blob, total: number | null) => {
    const session = sessionRef.current
    if (!session) return
    // Nothing to send and nothing to close.
    if (body.size === 0 && total === null) return

    const start = sentRef.current
    const end = start + body.size - 1

    // An empty final PUT is not a no-op: when the last chunk already flushed,
    // every byte is up but the object is still open. A range of "bytes" then a
    // star, slash, total is the protocol's way of saying "that was all of it".
    const range =
      body.size === 0 ? `bytes */${total}` : `bytes ${start}-${end}/${total ?? "*"}`

    const response = await fetch(session.uploadSessionUri, {
      method: "PUT",
      headers: { "Content-Range": range },
      ...(body.size > 0 ? { body } : {}),
    })

    // 308 = "incomplete, carry on"; 200/201 = the final chunk landed. Anything
    // else means the session is gone and the offsets can never line up again.
    if (response.status !== 308 && !response.ok) {
      throw new Error(`Upload rejected with ${response.status}`)
    }

    if (body.size > 0) sentRef.current = end + 1

    void reportUploadProgress(token!, session.recordingSessionId, {
      uploadedBytes: sentRef.current,
      ...(total !== null ? { totalBytes: total } : {}),
    }).catch(() => undefined)
  }, [token])

  /** Queues work behind whatever PUT is in flight, and kills recording on error. */
  const enqueue = React.useCallback((work: () => Promise<void>) => {
    chainRef.current = chainRef.current
      .then(() => (deadRef.current ? undefined : work()))
      .catch(() => {
        // One failed range invalidates every offset after it, so stop rather
        // than upload a file that can never be assembled.
        deadRef.current = true
        try {
          recorderRef.current?.stop()
        } catch {
          /* already stopped */
        }
      })
    return chainRef.current
  }, [])

  const start = React.useCallback(async () => {
    if (
      !stream ||
      !token ||
      !interviewId ||
      recorderRef.current ||
      startingRef.current ||
      typeof MediaRecorder === "undefined"
    ) {
      return false
    }

    startingRef.current = true

    let session: RecordingUploadSession | null = null
    try {
      session = await startRecordingUpload(token, interviewId, {
        fileName: `interview-${interviewId}.webm`,
        contentType: "video/webm",
      })
    } catch {
      // No storage configured, or the endpoint refused — don't record.
      return false
    }
    if (!session) return false

    let recorder: MediaRecorder
    try {
      recorder = new MediaRecorder(stream, { mimeType: "video/webm" })
    } catch {
      return false
    }

    sessionRef.current = session
    bufferRef.current = []
    sentRef.current = 0
    deadRef.current = false

    recorder.ondataavailable = (event) => {
      if (deadRef.current || event.data.size === 0) return
      bufferRef.current.push(event.data)

      const buffered = bufferRef.current.reduce(
        (total, chunk) => total + chunk.size,
        0
      )
      if (buffered < session.uploadBufferHintBytes) return

      // Hand the buffer to the upload and start a fresh one immediately, so
      // chunks arriving mid-flight aren't sent twice.
      const body = new Blob(bufferRef.current, { type: "video/webm" })
      bufferRef.current = []
      void enqueue(() => put(body, null))
    }

    recorder.start(TIMESLICE_MS)
    recorderRef.current = recorder
    setRecording(true)
    return true
  }, [stream, token, interviewId, enqueue, put])

  /** Flushes the tail, finalises, and points the interview at the video. */
  const stop = React.useCallback(async () => {
    const recorder = recorderRef.current
    const session = sessionRef.current
    recorderRef.current = null
    setRecording(false)

    if (!recorder || !session || !token) return

    await new Promise<void>((resolve) => {
      recorder.onstop = () => resolve()
      try {
        recorder.stop()
      } catch {
        resolve()
      }
    })

    if (deadRef.current) return

    const tail = new Blob(bufferRef.current, { type: "video/webm" })
    bufferRef.current = []

    await enqueue(async () => {
      // The last PUT is the only one that can name the total — it's the first
      // moment the size is known — and it's what closes the object.
      await put(tail, sentRef.current + tail.size)
      await finalizeRecording(token, session.recordingSessionId)
      if (interviewId) {
        await linkRecording(token, interviewId, {
          recordingSessionId: session.recordingSessionId,
        })
      }
    })

    sessionRef.current = null
  }, [token, interviewId, enqueue, put])

  React.useEffect(
    () => () => {
      // The tab is going: stop the recorder so the camera light goes out. The
      // tail is lost, which is what `interview-closed` reports as abandonment.
      try {
        recorderRef.current?.stop()
      } catch {
        /* already stopped */
      }
      recorderRef.current = null
    },
    []
  )

  return { start, stop, recording }
}
