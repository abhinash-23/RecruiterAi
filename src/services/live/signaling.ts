/**
 * ============================================================================
 * LIVE VIEWING — signalling transport for `WS /api/live/{interview_id}`
 * ============================================================================
 * The one place that knows how to reach the live socket and what travels over
 * it. This is the WebSocket counterpart to `http-client.ts`: no component or
 * hook builds a `ws://` URL or hand-writes a message body of its own.
 *
 * **The media never touches our backend.** Audio and video go browser →
 * browser over WebRTC; the server relays only the handshake (an `offer`, an
 * `answer`, and `ice` candidates). That is also why it is best-effort: with a
 * free STUN server and no TURN relay, a restrictive network can leave two
 * browsers unable to reach each other. Every caller has to degrade gracefully
 * — the guaranteed artefact is the recording, not the live view.
 *
 * ⚠️ **A WebSocket route is invisible to `GET /openapi.json`** (FastAPI only
 * documents HTTP routes) and answers a plain HTTP GET with 404, so neither of
 * the usual ways of confirming an endpoint exists works here. Verified instead
 * by opening a real socket: the handshake is accepted on `wss://` and a bad
 * viewer token closes with `4001 invalid token`, matching the contract below.
 */

import { apiSocketUrl } from "@/services/http-client"

/**
 * Free public STUN, no credentials — exactly as the backend's integration
 * guide specifies. STUN only tells each browser its own public address; there
 * is deliberately no TURN relay, which is what makes this best-effort.
 */
export const STUN_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
}

/** Absolute `ws(s)://` URL for one interview's signalling socket. */
export function liveSocketUrl(interviewId: string): string {
  return apiSocketUrl(`/live/${encodeURIComponent(interviewId)}`)
}

export type LiveRole = "candidate" | "viewer"

/**
 * Why the server hung up, in words a recruiter or candidate can act on.
 *
 * These are application close codes, so they arrive on a *clean* close rather
 * than as an error — a socket that shuts with 4409 looks identical to one that
 * finished normally unless the code is read.
 */
export const LIVE_CLOSE_MESSAGE: Record<number, string> = {
  4001: "This session isn't authorised to watch. Sign in again and retry.",
  4400: "The live service rejected the connection request.",
  4403: "This site isn't allowed to open a live connection.",
  4404: "That interview doesn't exist, or it belongs to another company.",
  4409: "Someone is already streaming this interview.",
}

/** Close codes there is no point retrying — the answer won't change. */
export const LIVE_TERMINAL_CLOSE_CODES = [4001, 4400, 4403, 4404, 4409]

/** Anything the server may send us. Fields are per-type, hence all optional. */
export interface LiveServerMessage {
  type: string
  role?: LiveRole
  /** The viewer's id. Absent on messages that concern the candidate. */
  peer?: string
  sdp?: string
  candidate?: RTCIceCandidateInit
  /** On a candidate's `auth-ok`: viewers already waiting. */
  viewers?: string[]
  /** On a viewer's `auth-ok`: whether anyone is publishing yet. */
  candidateOnline?: boolean
}

/**
 * Reads one frame off the socket. Malformed frames are ignored, not thrown.
 *
 * **Tolerant of spelling on both the type and the fields**, for the same reason
 * as the recording socket: the integration guide is camelCase and hyphenated, the
 * backend is FastAPI, and reading only one form fails *silently*. The two that
 * matter most:
 *
 * - `peer` on a `peer-joined` — without it the candidate never learns who joined
 *   and sends no offer, so the recruiter waits out the 15-second timeout and is
 *   told the network is at fault when nothing was ever offered.
 * - `viewers` on `auth-ok` — the recruiters already waiting when the candidate
 *   starts. Miss it and only those who arrive *later* ever get a picture.
 */
export function parseLiveMessage(data: unknown): LiveServerMessage | null {
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

  const peer = raw.peer ?? raw.peer_id ?? raw.peerId ?? raw.viewer_id ?? raw.viewerId
  const viewers = raw.viewers ?? raw.viewer_ids ?? raw.viewerIds
  const online = raw.candidateOnline ?? raw.candidate_online

  return {
    // `auth_ok` and `auth-ok` are the same message; only the style differs.
    type: raw.type.replace(/_/g, "-"),
    ...(typeof raw.role === "string" ? { role: raw.role as LiveRole } : {}),
    ...(typeof peer === "string" ? { peer } : {}),
    ...(typeof raw.sdp === "string" ? { sdp: raw.sdp } : {}),
    ...(raw.candidate && typeof raw.candidate === "object"
      ? { candidate: raw.candidate as RTCIceCandidateInit }
      : {}),
    ...(Array.isArray(viewers)
      ? { viewers: viewers.filter((id): id is string => typeof id === "string") }
      : {}),
    ...(typeof online === "boolean" ? { candidateOnline: online } : {}),
  }
}

/**
 * Sends one frame, tolerating a socket that closed under us.
 *
 * Signalling races with disconnection by nature — an ICE candidate can be
 * produced microseconds after the candidate's tab vanished — and `send()` on a
 * closing socket throws.
 */
export function sendLiveMessage(
  socket: WebSocket,
  message: Record<string, unknown>
): void {
  if (socket.readyState !== WebSocket.OPEN) return
  try {
    socket.send(JSON.stringify(message))
  } catch {
    /* the socket went away mid-handshake; the peer will simply not connect */
  }
}

/* ========================================================================== */
/*  The insight channel — our own contract, not the backend's                  */
/* ========================================================================== */

/**
 * Label of the WebRTC data channel the candidate opens alongside the media.
 *
 * **Why this exists.** There is no server-side way to watch a sitting's
 * questions and answers as they happen: `GET /api/get-results/{id}` returns
 * `results: null` until the candidate finishes, and `/api/interviews` carries
 * only an `answered` count. The candidate's browser is the only place that
 * knows the current question and what was just said — so it publishes that
 * over the same peer connection as the video, at no cost to the backend.
 *
 * It follows that this data shares the media's fate: if the peer connection
 * can't form, the recruiter gets no live Q&A either, and the panel has to say
 * so rather than render an empty list as though nothing had been asked.
 */
export const LIVE_INSIGHT_CHANNEL = "insight"

/** One answered question, as the candidate's own client recorded it. */
export interface LiveExchange {
  questionIndex: number
  round: string
  question: string
  /** What the candidate answered, already resolved to readable text. */
  answer: string
  /** Epoch millis. */
  at: number
}

/** The candidate's live state, as broadcast to every watching recruiter. */
export interface LiveInsight {
  candidateName: string
  role: string
  /** 1-based position in the question list. */
  position: number
  totalQuestions: number
  currentQuestion: string | null
  currentRound: string | null
  secondsLeft: number
  exchanges: LiveExchange[]
  /**
   * The most recent `POST /api/vitals/frame` response, verbatim. Passed to
   * `toVitalsReport` by the viewer — relayed rather than re-fetched because
   * the candidate is already being handed these readings every few seconds.
   */
  vitals: Record<string, unknown> | null
  /** Epoch millis, so a stalled feed can be spotted. */
  at: number
}

/** Reads an insight frame off the data channel. */
export function parseLiveInsight(data: unknown): LiveInsight | null {
  if (typeof data !== "string") return null
  try {
    const parsed: unknown = JSON.parse(data)
    if (!parsed || typeof parsed !== "object") return null
    const insight = parsed as LiveInsight
    return Array.isArray(insight.exchanges) ? insight : null
  } catch {
    return null
  }
}
