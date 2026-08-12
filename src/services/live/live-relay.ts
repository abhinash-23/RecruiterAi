/**
 * ============================================================================
 * LIVE VIEW — `WSS /api/live-relay/{interview_id}`
 * ============================================================================
 * The one place that knows how to reach the live relay and what travels over
 * it. The WebSocket counterpart to `http-client.ts` for watching a sitting.
 *
 * **The media comes through our backend now**, which is the whole point. The
 * previous design was peer-to-peer WebRTC with public STUN and no TURN relay,
 * and on a corporate network, a VPN or symmetric NAT the peer connection simply
 * never forms — it neither errors nor connects, so all a recruiter ever saw was
 * "live view unavailable on this network". That was unfixable without a TURN
 * server we don't have.
 *
 * The candidate's browser already streams its recording to the backend over its
 * own socket. The relay fans those same bytes out to authorised viewers, so the
 * reachability question is settled: **if the candidate can sit the interview,
 * live view works.** No ICE, no TURN, no signalling handshake.
 *
 * What it costs is 1–3 seconds of delay — the recorder's timeslice plus the
 * player's buffer. Nothing here should be labelled "real-time"; "live" is the
 * honest word.
 *
 * ⚠️ A WebSocket route is invisible to `GET /openapi.json` (FastAPI documents
 * only HTTP routes) and answers a plain GET as though it did not exist, so the
 * usual ways of confirming an endpoint are no help. The contract below is the
 * backend team's handoff of 2026-08-12.
 */

import { apiSocketUrl } from "@/services/http-client"

/** Absolute `ws(s)://` URL for one interview's relay socket. */
export function liveRelayUrl(interviewId: string): string {
  return apiSocketUrl(`/live-relay/${encodeURIComponent(interviewId)}`)
}

/**
 * Opens the stream. Must be the socket's **first** frame, within 10s, and it is
 * the only frame we ever send — after `auth-ok` the server pushes and the
 * viewer listens.
 *
 * The staff bearer token, not a candidate one: the server admits the HR who
 * created the interview and that company's admin, and closes 4404 on everyone
 * else — the same wall as the rest of the API.
 */
export function relayAuthFrame(token: string): string {
  return JSON.stringify({ type: "auth", token })
}

/**
 * What the player must be able to decode, and therefore what the candidate's
 * `MediaRecorder` has to produce.
 *
 * The two ends agree **by construction**: `MIME_CANDIDATES` in
 * `services/interview/recording-socket.ts` pins `vp8,opus` first for exactly
 * this reason. Chrome's default is vp9 on some machines, which this player
 * cannot append — so neither end is left guessing.
 *
 * Spelt with a space and quotes because that is the form `MediaSource`
 * recognises; `MediaRecorder` accepts either.
 */
export const LIVE_STREAM_MIME = 'video/webm; codecs="vp8,opus"'

/**
 * Text frames. Everything else on the socket is binary WebM to be appended in
 * arrival order — no parsing, no reordering.
 */
export type LiveRelayEvent =
  | "auth-ok"
  /** The candidate's stream is flowing. */
  | "stream-live"
  /** It dropped; their client reconnects by itself. Keep the socket and wait. */
  | "stream-offline"
  /** A *new* stream started (they reloaded). Rebuild the player from scratch. */
  | "stream-reset"
  /** The recording finished. A 1000 close follows. */
  | "stream-ended"
  /** How far through the sitting they are, and everything answered so far. */
  | "progress"

/** One answered question, as the server recorded it. */
export interface LiveExchange {
  /** The question's own index. Always present, and the only safe sort key. */
  index: number
  round: string | null
  question: string
  /** The situation a situational question is about. */
  scenario: string | null
  /**
   * Display-ready: a multiple-choice answer arrives as `"B. <option text>"`,
   * the same rendering the final report uses, and a spoken one as its
   * transcription. Nothing here needs mapping back to an option index.
   */
  answer: string
  /** Epoch ms. Null on frames the server rebuilt after a restart. */
  at: number | null
}

/**
 * The sitting's progress — a **full snapshot**, never a delta.
 *
 * Whatever arrived last is the complete truth, so applying it is an assignment
 * rather than a merge: no sequencing, no gap detection, and a frame that arrives
 * twice changes nothing.
 */
export interface LiveProgress {
  answered: number
  /** Null until the candidate enters their code — unknown, not zero. */
  totalQuestions: number | null
  /**
   * The first unanswered question, which on a linear flow is the one on their
   * screen. Null once every question is answered.
   */
  currentIndex: number | null
  currentRound: string | null
  currentQuestion: string | null
  scenario: string | null
  /** The server's clock on the sitting. Best-effort, and null when unknown. */
  secondsLeft: number | null
  /** Oldest first, sorted by `index`. */
  exchanges: LiveExchange[]
}

/** One text frame off the socket: a status change, or a progress snapshot. */
export type LiveRelayFrame =
  | { type: Exclude<LiveRelayEvent, "progress"> }
  | { type: "progress"; progress: LiveProgress }

/**
 * Reads one text frame. Malformed frames are ignored, not thrown.
 *
 * Both spellings of every field are accepted. The backend states snake_case and
 * is consistent about it; this costs one `??` per field and removes the failure
 * mode entirely — and that failure mode is silent, which is what makes it worth
 * a line each. Camel first is deliberate on nothing: order doesn't matter when
 * only one of the two is ever present.
 */
export function parseRelayFrame(data: unknown): LiveRelayFrame | null {
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

  // Underscores normalised for the same reason as everywhere else: the guide
  // hyphenates, the backend is FastAPI, and a frame we fail to recognise leaves
  // the page in the wrong state with nothing logged.
  const type = raw.type.replace(/_/g, "-") as LiveRelayEvent

  if (type !== "progress") return { type }

  return {
    type,
    progress: {
      answered: num(raw.answered) ?? 0,
      totalQuestions: num(raw.total_questions ?? raw.totalQuestions),
      currentIndex: num(raw.current_index ?? raw.currentIndex),
      currentRound: str(raw.current_round ?? raw.currentRound),
      currentQuestion: str(raw.current_question ?? raw.currentQuestion),
      scenario: str(raw.scenario),
      secondsLeft: num(raw.seconds_left ?? raw.secondsLeft),
      exchanges: toExchanges(raw.exchanges),
    },
  }
}

/** A string, or null for anything else — including the empty string. */
function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null
}

/**
 * A number, or null. Never coerced from a string: a `total_questions` read as
 * `0` from `""` would render a zero-question sitting as fact.
 */
function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

/**
 * Sorted by `index` rather than left in arrival order or sorted by time: `at` is
 * null on frames the server rebuilt after a restart, and `index` is the one
 * field guaranteed present.
 */
function toExchanges(value: unknown): LiveExchange[] {
  if (!Array.isArray(value)) return []

  return value
    .reduce<LiveExchange[]>((list, entry) => {
      if (!entry || typeof entry !== "object") return list
      const raw = entry as Record<string, unknown>
      const index = num(raw.index)
      // No index means nothing can be sorted or keyed by it. Dropped rather
      // than defaulted to 0, which would collide with the first real answer.
      if (index === null) return list

      list.push({
        index,
        round: str(raw.round),
        question: str(raw.question) ?? "",
        scenario: str(raw.scenario),
        answer: str(raw.answer) ?? "",
        at: num(raw.at),
      })
      return list
    }, [])
    .sort((a, b) => a.index - b.index)
}

/**
 * Why the relay hung up, in words a recruiter can act on.
 *
 * These are application close codes, so they arrive on a *clean* close — a
 * socket shut with 4429 looks exactly like one that finished normally unless the
 * code is read.
 */
export const RELAY_CLOSE_MESSAGE: Record<number, string> = {
  4001: "Your session has expired. Sign in again to watch.",
  4400: "The live service rejected the connection request.",
  4403: "This site isn't allowed to open a live connection.",
  4404: "That interview doesn't exist, or it belongs to another recruiter.",
  4429:
    "Four people are already watching this interview — the most the server allows. Try again when one of them leaves.",
  4503: "Live viewing is switched off on this deployment. The recording will still be available afterwards.",
}

/**
 * Close codes there is no point retrying: the answer will not change by asking
 * again. 4429 is in here deliberately — a viewer slot only frees when a person
 * closes their tab, so reconnecting in a loop would just hammer the server on
 * their behalf.
 */
export const RELAY_TERMINAL_CLOSE_CODES = [4001, 4400, 4403, 4404, 4429, 4503]

/**
 * The server dropped us for falling behind rather than buffering forever.
 *
 * Reconnect **immediately**: rejoining hands back a fresh snapshot at the live
 * edge, which is exactly what a viewer who fell behind needs. Backing off would
 * only make the gap it was complaining about wider.
 */
export const RELAY_BEHIND_CLOSE_CODE = 1013

/** Reconnect backoff for an abnormal drop: 1s, 2s, 4s, 8s, then every 15s. */
export function relayReconnectDelayMs(attempt: number): number {
  return Math.min(15_000, 1000 * 2 ** Math.max(0, attempt))
}
