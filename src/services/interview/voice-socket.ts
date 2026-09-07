/**
 * ============================================================================
 * THE VOICE TRANSPORT — `WS /api/voice/{session_id}`
 * ============================================================================
 * The one place that knows how to reach the voice socket and what travels over
 * it, exactly as `recording-socket.ts` is for the candidate's video. No hook
 * builds a `ws://` URL or hand-writes a frame of its own.
 *
 * On this socket the candidate **talks to Elena** instead of reading and typing:
 * she speaks every question aloud, reads the options out, and holds a
 * conversation. The backend owns the whole exchange — it runs the Gemini Live
 * session, transcribes, maps a spoken choice to an option index, and submits and
 * scores through the same engine a typed interview uses. What arrives here is
 * therefore *narration*: which question we are on, Elena's voice, subtitles, and
 * "that one is recorded".
 *
 * Three consequences worth stating, because they are what make this file small:
 *
 *  1. **No answer is ever submitted from the client.** A tap sends `select`,
 *     which is a *request to answer*, not the answer itself. `submit-answer` is
 *     not called at all in voice mode.
 *  2. **No score crosses this socket**, deliberately — a live score shown mid
 *     interview would state a mark no human has looked at yet.
 *  3. **There are two reconnects and only one of them is ours.** A Gemini
 *     session caps out at around fifteen minutes and a longer interview crosses
 *     that; the backend reopens its own leg behind *this same* socket, using
 *     Gemini's session-resumption handles, so the reopened session is the same
 *     conversation — no new greeting, no re-ask (`notice: reconnecting` →
 *     `reconnected`). Nothing is required of us. **This socket going away is
 *     ours**, and worth retrying: since the 2026-08-27 backend a fresh socket
 *     resumes at the first unanswered question rather than starting over. See
 *     {@link voiceCanRetry}.
 *
 * Everything is additive: voice is a strict enhancement over the typed sitting,
 * and every refusal on this socket ends in the typed interview instead. See
 * {@link voiceCloseAction}.
 *
 * ⚠️ A WebSocket route is invisible to `GET /openapi.json` — FastAPI documents
 * only HTTP routes, and a plain GET on this path answers 404. The contract here
 * is the backend team's voice brief — 2026-08-26, as amended by **v4** of
 * 2026-08-27, which is the one to read.
 */

import { apiSocketUrl } from "@/services/http-client"

/** Absolute `ws(s)://` URL for one sitting's voice socket. */
export function voiceSocketUrl(sessionId: string): string {
  return apiSocketUrl(`/voice/${encodeURIComponent(sessionId)}`)
}

/* ========================================================================== */
/*  Audio formats                                                             */
/* ========================================================================== */

/**
 * Raw PCM both ways — **16-bit little-endian, mono**, in binary frames. Only
 * the rate differs by direction, and neither is negotiable: the server hands
 * these bytes straight to Gemini, which is not told what rate they are in.
 *
 * Browsers capture at 44.1 or 48 kHz, so the microphone has to be *resampled*
 * to 16 kHz on the way out (see `pcm-capture-worklet.js`) — not merely
 * relabelled, which reaches Gemini as a chipmunk at three times the speed and
 * transcribes as nothing at all.
 */
export const MIC_SAMPLE_RATE = 16_000

/** What Elena's voice arrives as. Played through its own 24 kHz context. */
export const HOST_SAMPLE_RATE = 24_000

/* ========================================================================== */
/*  The protocol — client to server                                           */
/* ========================================================================== */

/** Opens the session. Must be the socket's **first** frame. */
export function voiceAuthFrame(token: string): string {
  return JSON.stringify({ type: "auth", token })
}

/**
 * The candidate **tapped** an option.
 *
 * `index` is the question and `choice` the option — both indices, and both from
 * the question the server last announced. A tap outranks anything Elena thought
 * she heard: it is the one unambiguous signal on this socket.
 */
export function voiceSelectFrame(index: number, choice: number): string {
  return JSON.stringify({ type: "select", index, choice })
}

/**
 * The candidate has finished this question — advance.
 *
 * For free-text questions, where nothing else marks the end of an answer: Elena
 * may ask a short follow-up, and only the candidate knows when they are done.
 */
export function voiceNextFrame(index: number): string {
  return JSON.stringify({ type: "next", index })
}

/**
 * **The candidate is ending the interview early** — the whole interview, not
 * the voice leg.
 *
 * The backend finalises and scores the sitting on this frame, exactly as it does
 * for a vanished tab. So it belongs *only* where the sitting is genuinely being
 * closed, and specifically **not** on a handover to the typed room, where the
 * candidate is carrying on and only the way of answering has changed.
 *
 * Sending it on teardown is what closed live sittings out from under people who
 * had simply lost the voice host: they kept typing into an interview the server
 * had already finished, until the heartbeat reported it inactive.
 *
 * Merely closing the socket releases the Gemini session. That is the right way
 * to stop talking to Elena without stopping the interview.
 */
export const VOICE_END_FRAME = JSON.stringify({ type: "end" })

/* ========================================================================== */
/*  The protocol — server to client                                           */
/* ========================================================================== */

/** How the candidate is expected to answer the question on screen. */
export type VoiceQuestionKind = "mcq" | "likert" | "text"

/** Options are only offered on the two kinds that have them. */
export function kindHasOptions(kind: VoiceQuestionKind | null): boolean {
  return kind === "mcq" || kind === "likert"
}

/**
 * Anything the server may send. Fields are per-type, hence all optional:
 *
 * | Type | Carries | Means |
 * |---|---|---|
 * | `ready` | `totalQuestions` | the session is open |
 * | `question` | `index`, `of`, `round`, `kind`, `options?` | we are on this question now |
 * | `caption` | `who`, `text` | a live subtitle |
 * | `answer_recorded` | `index`, `choice`, `display`, `transcript` | captured — and **what** was captured |
 * | `turn_complete` | — | Elena has finished speaking; the silence clock may run |
 * | `interrupted` | — | she was cut off — drop the audio still queued here |
 * | `notice` | `code`, sometimes `index` | something happened worth knowing, nothing terminal |
 * | `error` | `code`, `message` | terminal; the matching close follows |
 * | `interview_complete` | — | done and persisted; a `1000` close follows |
 *
 * Binary frames are Elena's voice and never reach here.
 */
export interface VoiceServerMessage {
  type: string
  /**
   * On `ready`: **which build of the voice backend answered.**
   *
   * Added by the backend team on 2026-08-27 after two rounds of bug reports
   * turned out to have been filed against a stale deployment — the fixes were
   * written, merged and not running, and nothing on the wire said so. Both sides
   * spent days on symptoms that had already been fixed.
   *
   * `4` is the build that ships one-ask-per-question, session-resumption
   * reconnects and `reconnect_exhausted`. **Absent means old** — and absent is
   * indistinguishable from present unless something reads it, which is the whole
   * reason it is on this interface.
   */
  rev?: number
  /**
   * On `intro`: how long the self-introduction may run before the server ends
   * it by itself.
   *
   * A ceiling, not a target — the candidate normally finishes it long before,
   * and the room says so rather than counting down at them.
   */
  maxSeconds?: number
  totalQuestions?: number
  /** Question index, in the same numbering `verify-otp` used. */
  index?: number
  /** How many questions in total, as the `question` frame states it. */
  of?: number
  round?: number
  kind?: VoiceQuestionKind
  options?: string[]
  /** `"assistant"` is Elena; `"candidate"` is the person being interviewed. */
  who?: "assistant" | "candidate"
  text?: string
  /**
   * On `answer_recorded`: the option the server resolved the answer to — and
   * **null on a free-text question**, which is not the same as absent.
   *
   * This is the field that makes a mishearing visible. A spoken "option B" heard
   * as D was, until the backend started echoing this, scored as D with nothing on
   * screen to show it, on a question nobody can go back to.
   */
  choice?: number | null
  /** On `answer_recorded`: the answer as a human sentence — `"B. Talk privately"`. */
  display?: string
  /** On `answer_recorded`: what was heard. Null when the answer was tapped. */
  transcript?: string | null
  /** On `notice` and `error`: the machine-readable name of what happened. */
  code?: string
  /**
   * On `notice: tool_advanced` / `tool_ignored`: **which of Elena's tools** —
   * `record_choice`, `answer_complete`, `skip_question`, `intro_finished`.
   */
  tool?: string
  /** On `error`: prose. Diagnostic — not for the candidate to read. */
  message?: string
}

/** The `notice` codes the backend sends. Anything else is logged and ignored. */
export const VOICE_NOTICE = {
  /** The Gemini leg is being reopened behind this socket. She'll resume. */
  RECONNECTING: "reconnecting",
  /** …and is back. */
  RECONNECTED: "reconnected",
  /**
   * The Gemini leg could not be recovered and the backend has stopped trying.
   *
   * `error: voice_unavailable` and close `4503` follow, so this changes nothing
   * about what happens next — its whole value is that giving up now *announces*
   * itself. The 2026-08-27 sitting that died four minutes in with no
   * `reconnecting` at all was the reconnect budget having been silently spent by
   * earlier drops; this is the frame that would have said so.
   */
  RECONNECT_EXHAUSTED: "reconnect_exhausted",
  /** Our own reconnect landed; carries the first unanswered `index`. */
  RESUMED: "resumed",
  /** The server's safety net advanced a turn we never advanced. */
  AUTO_ADVANCED: "auto_advanced",
  /** A `select`/`next` we sent named a question that is already answered. */
  STALE_FRAME: "stale_frame",
  /**
   * The candidate trailed off mid-answer and Elena is asking, **once**, whether
   * they are finished — "are you done, or would you like a moment?"
   *
   * Server-timed (`VOICE_CHECKIN_SECONDS`, default 10) precisely because the
   * model's own clock runs ahead of the room. It is the *only* thing she says on
   * silence in rev 5; everything else that used to fire on a timer is gone.
   *
   * The thing to get right around it is ours: an answer clock shorter than the
   * check-in advances the question before she can ever ask. See
   * `ANSWER_SILENCE_TEXT_MS`.
   */
  CHECKIN: "checkin",
  /**
   * **Elena advanced the interview herself**, through one of her tools —
   * `record_choice`, `answer_complete`, `skip_question` or `intro_finished`.
   *
   * The normal path since rev 6, and the reason `answer_recorded` and `question`
   * now arrive without this client having sent anything. Carries `tool`, which
   * is the single most useful field on this socket for reading a sitting back:
   * `record_choice` says she understood the answer, `skip_question` says the
   * candidate declined, and telling those two apart afterwards is otherwise
   * guesswork.
   */
  TOOL_ADVANCED: "tool_advanced",
  /**
   * One of her answer tools was **refused** because it named a question she had
   * not begun speaking yet — the presentation gate.
   *
   * Purely informational: it is the server stopping a question from acquiring an
   * answer the candidate never heard. Worth a trace line because it is the only
   * visible symptom of that gate doing its job.
   */
  TOOL_IGNORED: "tool_ignored",
} as const

/**
 * The question index the **self-introduction** phase uses.
 *
 * Negative on purpose — it is not a question, it is not scored, and it must
 * never be mistaken for position zero. `next` carries it verbatim to end the
 * phase, so the guard on sending has to admit it while still rejecting "no
 * question yet".
 */
export const VOICE_INTRO_INDEX = -1

/**
 * The oldest backend revision whose behaviour matches this client.
 *
 * `6` is the **tool-driven flow**: Elena records answers herself through
 * function calls, so a spoken choice is mapped by the model rather than parsed
 * out of a transcript. The revisions below it all speak this protocol and all
 * get the interview subtly wrong:
 *
 * | rev | What is missing |
 * |---|---|
 * | `5` | her tools. A spoken choice is resolved from the transcript — the channel that turned "option C" into "absentee" |
 * | `4` | the human layer too: no self-introduction, no mid-answer check-in |
 * | absent | everything, including one-ask-per-question |
 *
 * Checked and logged rather than enforced. Three rounds of bug reports were
 * filed against stale deployments before `rev` existed, and the failure mode was
 * never a wrong number — it was nobody noticing there was no number.
 */
export const VOICE_MIN_REV = 6

/** The `error` codes, each followed by its own close code. */
export const VOICE_ERROR = {
  /** The sitting's deadline passed. Answers so far are scored. Close `4408`. */
  TIME_UP: "time_up",
  /** No voice host, or this stopped being a voice interview. Close `4503`. */
  UNAVAILABLE: "voice_unavailable",
  /** The server broke. Close `1011`. */
  INTERNAL: "internal",
} as const

function asWho(value: unknown): "assistant" | "candidate" | undefined {
  return value === "assistant" || value === "candidate" ? value : undefined
}

function asKind(value: unknown): VoiceQuestionKind | undefined {
  return value === "mcq" || value === "likert" || value === "text"
    ? value
    : undefined
}

/**
 * Reads one frame off the socket. Malformed frames are ignored, not thrown — a
 * frame this build doesn't understand must never take the interview down.
 *
 * **Both spellings of every field are accepted**, for the reason set out at
 * length in `parseRecordingMessage`: the handoff documents camelCase, the
 * backend is FastAPI and everything else it serves is snake_case, and this app
 * has been caught by that gap repeatedly. Here the stake is the feature itself —
 * miss `totalQuestions` and the progress counter is blank; miss `index` on a
 * `question` frame and the candidate is shown option buttons belonging to some
 * other question.
 */
export function parseVoiceMessage(data: unknown): VoiceServerMessage | null {
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

  const message: VoiceServerMessage = { type: raw.type }

  // Both spellings, like everything else here — and read at all, which is the
  // point: this parser builds its result field by field and silently drops what
  // it doesn't name, so an unread field is an invisible one.
  const rev = raw.rev ?? raw.revision
  if (typeof rev === "number") message.rev = rev

  const maxSeconds = raw.maxSeconds ?? raw.max_seconds
  if (typeof maxSeconds === "number") message.maxSeconds = maxSeconds

  const totalQuestions = raw.totalQuestions ?? raw.total_questions
  if (typeof totalQuestions === "number")
    message.totalQuestions = totalQuestions

  if (typeof raw.index === "number") message.index = raw.index
  // `of` under its documented name, then under the name the rest of this API
  // uses for the same number.
  const of = raw.of ?? raw.total ?? raw.total_questions
  if (typeof of === "number") message.of = of

  if (typeof raw.round === "number") message.round = raw.round

  const kind = asKind(raw.kind ?? raw.input_mode ?? raw.inputMode)
  if (kind) message.kind = kind

  if (Array.isArray(raw.options)) {
    message.options = raw.options.filter(
      (option): option is string => typeof option === "string"
    )
  }

  const who = asWho(raw.who ?? raw.speaker ?? raw.role)
  if (who) message.who = who
  if (typeof raw.text === "string") message.text = raw.text

  /* `choice` is read with `null` preserved, because null is a *value* here — it
     is how a free-text answer says "there was no option to resolve to". Folding
     it in with absent would make a text answer indistinguishable from a
     deployment that doesn't send the field. */
  if (typeof raw.choice === "number" || raw.choice === null) {
    message.choice = raw.choice
  }
  if (typeof raw.display === "string") message.display = raw.display
  if (typeof raw.transcript === "string" || raw.transcript === null) {
    message.transcript = raw.transcript
  }
  if (typeof raw.code === "string") message.code = raw.code
  const tool = raw.tool ?? raw.tool_name ?? raw.toolName
  if (typeof tool === "string") message.tool = tool
  if (typeof raw.message === "string") message.message = raw.message

  return message
}

/* ========================================================================== */
/*  Why the socket closed                                                     */
/* ========================================================================== */

/**
 * What a close code means for the candidate in front of us.
 *
 * `"complete"` — the interview finished and is persisted; show the done screen.
 *
 * `"superseded"` — a newer connection took this session over, which means
 * *another tab of theirs* is now the interview. Stop; do not fall back, or two
 * tabs end up answering one sitting.
 *
 * `"timeUp"` — the sitting's deadline passed and the server ended the voice
 * session itself. The answers given are scored; this is a *finished* interview
 * that ran out of time, not a fault, and the candidate must be told so — the
 * one thing they cannot work out for themselves is whether their answers
 * counted.
 *
 * `"typed"` — everything else, including every kind of failure. This is the
 * golden rule of the whole feature: **any refusal or error runs the typed
 * interview**, which always works. The distinctions the handoff draws between
 * `4001`, `4403`, `4404` and `4503` are real, but they are one instruction
 * here — not one of them is something the candidate can act on, and the only
 * thing worse than an unexplained fallback is a dead end in front of someone
 * whose interview would have run fine by keyboard.
 *
 * The codes that carry a message for *us* rather than for them — `4403` origin
 * not allowed, `4001` a token this socket won't take — are named in
 * {@link VOICE_CLOSE_REASONS} for the trace log, which is where anybody
 * debugging this will be looking.
 */
export function voiceCloseAction(
  code: number
): "complete" | "superseded" | "timeUp" | "typed" {
  if (code === 1000) return "complete"
  if (code === 4408) return "timeUp"
  if (code === 4409) return "superseded"
  return "typed"
}

/**
 * Close codes there is no point reopening the socket on — the answer will not
 * change however many times it is asked.
 *
 * | Code | Why retrying is pointless |
 * |---|---|
 * | `4001` | the token is not valid for this session, and it won't become valid |
 * | `4403` | this origin is not on the backend's allow-list |
 * | `4404` | the session doesn't exist on the instance that answered |
 * | `4408` | the sitting's time is up — there is no interview left to reopen |
 * | `4409` | a newer connection owns the session — reconnecting is a fight |
 * | `4503` | this deployment has no voice host, or this isn't a voice interview |
 * | `1011` | the server named its own failure (`error: internal`) |
 *
 * Everything else is a *drop*: an abnormal close, a load balancer, a tunnel
 * restarting. Those are worth another connection — the session on the other side
 * is still there, still holds the candidate's place, and since the 2026-08-27
 * backend a fresh socket **resumes at the first unanswered question** instead of
 * starting the interview again.
 */
export const VOICE_TERMINAL_CLOSE_CODES = [
  4001, 4403, 4404, 4408, 4409, 4503, 1011,
]

/** Is this close worth reopening the socket for? */
export function voiceCanRetry(code: number): boolean {
  return !VOICE_TERMINAL_CLOSE_CODES.includes(code)
}

/** Reconnect backoff: 1s, 2s, then 4s. */
export function voiceReconnectDelayMs(attempt: number): number {
  return Math.min(4000, 1000 * 2 ** Math.max(0, attempt))
}

/** The close codes the handoff names, for the trace line. */
export const VOICE_CLOSE_REASONS: Record<number, string> = {
  1000: "finished",
  1011: "the server hit an error",
  4001: "token invalid for this session",
  /* Deliberately **not** in the terminal list above, and that is the right
     behaviour rather than an oversight: the prescribed response is "reconnect
     and send `auth` first", which is exactly what a retry here does — `onopen`
     sends the auth frame before anything else. Named only so the trace does not
     read "no reason given" in the one case where the reason is the whole
     diagnosis. */
  4400: "the first frame wasn't `auth`, or it arrived too late",
  4403: "origin not allowed — check the backend's allow-list",
  4404: "session not found on this instance",
  4408: "the time limit for this interview passed",
  4409: "superseded by a newer connection",
  4503: "voice not configured, or not a voice interview",
}
