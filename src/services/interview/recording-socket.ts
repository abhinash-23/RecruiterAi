/**
 * ============================================================================
 * RECORDING TRANSPORT — `WS /api/recordings/stream/{interview_id}`
 * ============================================================================
 * The one place that knows how to reach the recording socket and what travels
 * over it. The WebSocket counterpart to `http-client.ts` for the candidate's
 * video: no hook builds a `ws://` URL or hand-writes a frame of its own.
 *
 * **The bytes go through our backend here**, unlike live viewing next door in
 * `services/live` — the backend persists each chunk to cloud storage as it
 * arrives and *acknowledges what is safe*. That ack is the whole reason this is
 * a socket rather than an upload: it is what lets a dropped connection resume
 * from an exact byte offset instead of losing the file.
 *
 * Supersedes the direct-to-storage flow (`start-upload` → `PUT` to a resumable
 * URI → `upload-progress` → `finalize` → `link-recording`). That contract is
 * retired on the backend; nothing in the app should reintroduce it.
 *
 * ⚠️ A WebSocket route is invisible to `GET /openapi.json` — FastAPI documents
 * only HTTP routes, and a plain GET on this path answers 404. The contract below
 * is from the backend team's recording guide (2026-08-11).
 */

import { apiSocketUrl } from "@/services/http-client"

/** Absolute `ws(s)://` URL for one interview's recording socket. */
export function recordingSocketUrl(interviewId: string): string {
  return apiSocketUrl(`/recordings/stream/${encodeURIComponent(interviewId)}`)
}

/* ========================================================================== */
/*  Capture settings                                                          */
/* ========================================================================== */

/**
 * How often `MediaRecorder` hands us a chunk.
 *
 * Four seconds is the guide's figure, and it sets the worst case: a tab that
 * dies without warning loses at most the chunk being assembled.
 */
export const CHUNK_INTERVAL_MS = 4000

/**
 * Bitrates, set explicitly because browser defaults are not comparable — the
 * same sitting can come out 40 MB in one browser and 400 MB in another. These
 * are the guide's numbers: ~230 MB for a 30-minute interview.
 */
export const VIDEO_BITS_PER_SECOND = 1_000_000
export const AUDIO_BITS_PER_SECOND = 32_000

/**
 * The largest single binary frame the server accepts is 1 MB. Chunks are split
 * to well under it: a 4-second chunk at the bitrates above averages ~500 kB, but
 * a scene change can spike one well past its average, and the server treats an
 * oversized frame as a protocol violation (`4400`) rather than trimming it.
 */
export const MAX_CHUNK_BYTES = 512 * 1024

/**
 * Candidate-recording MIME types, best first.
 *
 * The chosen type is declared to the server in the `auth` frame and stored with
 * the recording, so playback gets it back — which matters because the file has
 * no container-level fixups applied.
 *
 * **VP8 first is a contract, not a preference.** These same bytes are relayed to
 * watching recruiters, whose player is pinned to `LIVE_STREAM_MIME`
 * (`services/live/live-relay.ts`) because a viewer has no way to ask what the
 * candidate's machine chose. Reorder this list and live view goes black for
 * anyone recorded by the new first entry — the recording itself still plays,
 * since a file carries its own codecs, which is exactly why the breakage would
 * look like a live-view bug rather than a recording one.
 *
 * It is also the better choice on its own merits: VP9 encodes a webcam stream no
 * better at this bitrate and its encoder is slower on the low-end laptops
 * candidates actually use — CPU spent here is CPU taken from the vitals sampler
 * and the speech recogniser. `video/mp4` is last and is Safari's only option;
 * whether the backend accepts that container is **unverified**, and a sitting
 * recorded that way cannot be watched live.
 */
const MIME_CANDIDATES = [
  "video/webm;codecs=vp8,opus",
  "video/webm;codecs=vp9,opus",
  "video/webm",
  "video/mp4",
]

/**
 * The best recording type this browser supports, or null when it records none.
 *
 * `isTypeSupported` is missing on some older implementations; a browser that
 * can't answer the question is given the base webm type and allowed to fail at
 * `new MediaRecorder(…)`, which the caller already treats as "no recording".
 */
export function pickRecordingMimeType(): string | null {
  if (typeof MediaRecorder === "undefined") return null
  if (typeof MediaRecorder.isTypeSupported !== "function") return "video/webm"

  return MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type)) ?? null
}

/**
 * The container without its codec parameters — `video/webm;codecs=vp8,opus`
 * becomes `video/webm`. What the server is told, since the codec list is a
 * browser detail and the storage object only needs the container.
 */
export function contentTypeOf(mimeType: string): string {
  return mimeType.split(";")[0]!.trim()
}

/* ========================================================================== */
/*  The protocol                                                              */
/* ========================================================================== */

/** Opens a new recording. Must be the socket's **first** frame, within 10s. */
export function authFrame(token: string, contentType: string): string {
  return JSON.stringify({ type: "auth", token, contentType })
}

/** Re-attaches to an existing recording after a drop. */
export function resumeFrame(token: string, recordingSessionId: string): string {
  return JSON.stringify({ type: "auth", token, resume: recordingSessionId })
}

/** Header for one binary chunk. The bytes follow as the very next frame. */
export function chunkFrame(seq: number, size: number): string {
  return JSON.stringify({ type: "chunk", seq, size })
}

/**
 * Seals the recording. Mandatory: this is what makes the video appear for HR.
 * Sent with zero bytes uploaded, it cancels cleanly instead.
 */
export const STOP_FRAME = JSON.stringify({ type: "stop" })

/** Anything the server may send. Fields are per-type, hence all optional. */
export interface RecordingServerMessage {
  type: string
  recordingSessionId?: string
  /** On `ready`: the byte offset already safe in storage. 0 for a new session. */
  resumeFrom?: number
  seq?: number
  /** On `ack`: total bytes persisted. Cumulative, and the number to trust. */
  uploadedBytes?: number
  /** On `finalized`: the sealed size. */
  sizeBytes?: number
}

/**
 * Reads one frame off the socket. Malformed frames are ignored, not thrown.
 *
 * **Both spellings of every field are accepted.** The guide documents camelCase,
 * the backend is FastAPI and everything else it serves is snake_case, and this
 * app has been caught by that gap before (§2 of the handover is a list of them).
 * Reading only one spelling here is not a cosmetic risk: miss
 * `recordingSessionId` on the `ready` frame and the client never learns it has a
 * session, so it never sends a byte — and the sitting ends with the server
 * cancelling an empty recording, which looks exactly like a recording that was
 * never attempted.
 */
export function parseRecordingMessage(
  data: unknown
): RecordingServerMessage | null {
  if (typeof data !== "string") return null

  let parsed: unknown
  try {
    parsed = JSON.parse(data)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== "object") return null

  const raw = parsed as Record<string, unknown>
  if (typeof raw.type !== "string") return null

  return {
    type: raw.type,
    ...pick<string>(raw, "recordingSessionId", "recording_session_id", "string"),
    ...pick<number>(raw, "resumeFrom", "resume_from", "number"),
    ...pick<number>(raw, "seq", "seq", "number"),
    ...pick<number>(raw, "uploadedBytes", "uploaded_bytes", "number"),
    ...pick<number>(raw, "sizeBytes", "size_bytes", "number"),
  }
}

/**
 * Reads one field under either spelling, and only when it has the right type —
 * a `resumeFrom` that arrived as the string `"0"` must not become a byte offset
 * by accident.
 */
function pick<T>(
  raw: Record<string, unknown>,
  camel: string,
  snake: string,
  type: "string" | "number"
): Record<string, T> {
  const value = raw[camel] ?? raw[snake]
  return typeof value === type ? ({ [camel]: value } as Record<string, T>) : {}
}

/* ========================================================================== */
/*  Why the socket closed                                                     */
/* ========================================================================== */

/**
 * Close codes there is no point retrying — the answer will not change.
 *
 * | Code | Meaning |
 * |---|---|
 * | `4001` | bad or mismatched candidate token |
 * | `4400` | protocol violation — a header that didn't match its bytes; our bug |
 * | `4409` | a newer connection took over (the candidate opened another tab) |
 * | `4503` | this environment has no recording storage configured |
 *
 * Everything else — `1013` back-pressure, `1006`/`1011` abnormal drops, the
 * platform's own socket timeout — is reconnect-and-resume territory.
 */
export const RECORDING_TERMINAL_CLOSE_CODES = [4001, 4400, 4409, 4503]

/** Reconnect backoff: 1s, 2s, 4s, 8s, then every 15s. */
export function reconnectDelayMs(attempt: number): number {
  return Math.min(15_000, 1000 * 2 ** Math.max(0, attempt))
}
