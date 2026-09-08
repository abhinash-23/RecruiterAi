import * as React from "react"

import {
  parseVoiceMessage,
  VOICE_CLOSE_REASONS,
  VOICE_END_FRAME,
  VOICE_ERROR,
  VOICE_NOTICE,
  VOICE_INTRO_INDEX,
  VOICE_MIN_REV,
  kindHasOptions,
  voiceAuthFrame,
  voiceCanRetry,
  voiceCloseAction,
  voiceNextFrame,
  voiceReconnectDelayMs,
  voiceSelectFrame,
  voiceSocketUrl,
  type VoiceQuestionKind,
} from "@/services/interview"
import { trace } from "@/services/socket-trace"

import type { TranscriptEntry } from "./transcript"
import {
  createHostPlayer,
  MIC_BARGE_LEVEL,
  MIC_SPEECH_LEVEL,
  openMicCapture,
  type HostPlayer,
  type MicCapture,
  type MicMode,
} from "./voice-audio"

/**
 * How long to wait for the server's `ready` before giving up on voice.
 *
 * A socket that opens and then says nothing is the one failure with no close
 * code behind it — the handshake succeeded, so there is nothing to react to, and
 * without this the candidate reads "Connecting to Elena" until their time runs
 * out. Fifteen seconds is far longer than a working session needs (Gemini is
 * live before the socket is) and short enough to leave a full interview's worth
 * of clock for the typed fallback.
 */
const READY_TIMEOUT_MS = 15_000

/**
 * How long the controls stay held after a tap before they come back by
 * themselves.
 *
 * A `select` is a *request*: the server answers by moving to the next question
 * or by confirming the answer, and either of those releases the hold. But it is
 * also free to do neither — a tap that lands while Elena is still reading the
 * options may simply be ignored — and a hold with no way out leaves the
 * candidate looking at dead buttons on a question they can still hear being
 * asked. Long enough that a slow round trip doesn't unlock the controls under a
 * candidate's finger and let them answer twice; short enough not to be a
 * lock-out.
 */
const ANSWER_HOLD_MS = 8000

/**
 * How long the candidate has to be **quiet** before their answer counts as
 * finished and the interview moves on.
 *
 * **This used to be the whole of the frontend's turn-taking and is now its
 * second line.** Since rev 6 Elena records the answer herself through a tool
 * call — `record_choice` on a rating item, `answer_complete` on an open one —
 * and the interview advances on that. This clock is what catches the case where
 * she doesn't.
 *
 * **Which is why it is six seconds and not the 2.2 it used to be.** The two
 * paths race, and ours winning is the bad outcome:
 *
 * | Path | How a spoken "option B" is resolved |
 * |---|---|
 * | her `record_choice("B")` | the *model* maps their words to the letter — accent, phrasing and transcription quality all irrelevant |
 * | our `next` | the server falls back to resolving it **from the transcript** — the channel that wrote "option C" as "absentee" |
 *
 * So a short window here doesn't just advance early, it advances *down the
 * unreliable path* — actively racing the fix rev 6 exists to be. Her chain is
 * roughly 1.5 s of server VAD plus up to ~2 s to decide and call, so ~3.5 s;
 * six leaves a clear margin and is what the brief means by "keep your detector
 * conservative".
 *
 * The wait costs nothing in the normal case, which is the part worth
 * understanding: when she calls the tool at 3.5 s, the interview moves at 3.5 s
 * and this timer never fires. Six seconds is only ever felt when she has already
 * failed — and the 75 s server net is the real backstop underneath.
 *
 * Measured from the *microphone*, not from captions, so this is real quiet
 * rather than a transcriber having nothing to say. **The final number is for the
 * joint mic test**, against a `rev: 6` build. Do not move it from a desk.
 */
const ANSWER_SILENCE_MS = 6000

/**
 * Whether this client may end the turn on its **own** end-of-speech detection,
 * or whether the question belongs to Elena's tools.
 *
 * **A question with options is hers, and ours is the answer that corrupts it.**
 * Since rev 6 there are two ways one of these gets recorded, and they do not
 * degrade to the same thing:
 *
 * | Path | "Skip this question", spoken on a rating item |
 * |---|---|
 * | her `skip_question` | recorded as **declined** — no credit, which is what was asked for |
 * | our `next` | the server resolves the *spoken words* to a rating level, and those words are no level, so it **defaults to Neutral** |
 *
 * That is the 2026-09-07 run's first finding, and it is not a near miss: a
 * candidate who declined a question was recorded as holding a middle opinion on
 * it, on a question they cannot go back and fix. Our timer firing was the whole
 * cause — Elena saying "sure, we can skip that" was just her talking, while the
 * thing that actually recorded the answer was `next` arriving before her tool
 * did.
 *
 * The same reasoning covers the rest of it. Our `next` on a choice question is
 * always resolved off the transcript, and the transcript is the channel the
 * backend has itself declared cosmetic — the one that writes "option C" as
 * "absentee". There is no window short enough to make that path good and no
 * window long enough to make it necessary: {@link ANSWER_SILENCE_MS}'s six
 * seconds was already a retreat from 2.2 for this reason, and the retreat has
 * no natural stopping point short of not doing it.
 *
 * So on `mcq` and `likert` this client never advances by itself. Three things
 * still do, and between them they cover every case a detector was covering:
 *
 *  1. **her tool call** — `record_choice` for a choice, `skip_question` for a
 *     decline. The model maps the words, so accent, phrasing and transcription
 *     quality are all irrelevant. This is the normal path and it needs nothing
 *     from us;
 *  2. **a tap** — `{type:"select", index, choice}`, which is unambiguous by
 *     construction and is why the options stay on screen;
 *  3. **Done** — a press, i.e. a person deciding, which is the one context in
 *     which the transcript path is the best available answer rather than a
 *     worse one substituted for a good one.
 *
 * Underneath all three is the server's own 75 s advance. The cost of this
 * change is therefore a wait, in the case where she has already failed, on a
 * question that stays answerable throughout it — and the room says so rather
 * than sitting silent (see `stuck`).
 *
 * Open questions keep the fallback. There is no option set to resolve against
 * there, so `next` and `answer_complete` record the same free text and racing
 * costs nothing.
 */
function clientMayAdvance(kind: VoiceQuestionKind | null): boolean {
  return !kindHasOptions(kind)
}

/**
 * The same clock on an **open question**, where it has to be much longer.
 *
 * Rev 5 gave the server one deliberate thing to say on silence: a candidate who
 * starts an open answer and trails off gets a single warm check-in after
 * `VOICE_CHECKIN_SECONDS` — "are you done, or would you like a moment?"
 *
 * A 2.2-second window makes that impossible. We advance the question eight
 * seconds before she can ask, so the feature never fires once and a candidate
 * pausing to gather a thought on the only kind of question where thought takes
 * time is cut off. The brief is explicit about it: the window on text must be
 * **longer than the check-in**, or open questions go manual.
 *
 * Twelve seconds — two clear of the check-in. The flow that buys: they trail
 * off, she asks at ten, and either they answer her (which restarts this clock
 * properly) or they don't, and the silence that follows her finishing carries
 * straight past twelve and advances. Nobody waits twelve seconds in silence for
 * it; they wait for *her*, which is what a conversation feels like.
 *
 * MCQ and Likert keep the short window. "Option B" is complete when it is said,
 * and there is nothing to trail off from.
 *
 * ⚠️ **Only used where the check-in actually exists.** This window is long
 * because something else fills it. Against a backend that has no check-in — rev
 * 4, or anything older — nothing fills it, and the candidate finishes an answer
 * and sits in twelve seconds of unexplained silence with nothing on screen: the
 * "take your time" hint only appears for somebody who never spoke at all, not
 * for somebody who spoke and stopped. That is worse than the 2.2 s it replaced.
 * So it is gated on evidence the check-in is live; see `checkinLive`.
 */
const ANSWER_SILENCE_TEXT_MS = 12_000

/**
 * How often the silence is checked.
 *
 * A quarter second: fine enough that nobody perceives the delay it adds, coarse
 * enough to be free. The alternative — a timer re-armed on every audio frame —
 * meant thirty timer churns a second for the same answer.
 */
const SILENCE_TICK_MS = 250

/**
 * How much speech has to be heard before silence can end the turn.
 *
 * Frames of ~32 ms, so this is roughly a fifth of a second of sound above the
 * speech threshold. A cough, a chair, a door: none of them reach it, and none of
 * them should be able to make an empty answer look like a finished one.
 */
const SPEECH_FRAMES = 6

/**
 * How many consecutive **loud** frames count as interrupting Elena.
 *
 * ~100 ms. Long enough that a knock or a clipped syllable of her own voice
 * doesn't stop her; short enough that cutting in feels immediate.
 */
const BARGE_FRAMES = 3

/**
 * How many frames of **ordinary speech** count as interrupting her instead.
 *
 * The second way in, and it exists because the first one alone caused a loop
 * that looked like the interview being broken:
 *
 *   she repeats the question → her audio keeps playing → the microphone stays
 *   gated → an answer at ordinary volume is replaced with silence → the model
 *   hears nothing and asks again → …
 *
 * which ends only when the candidate happens to speak loudly enough to clear the
 * loud threshold. From their chair, Elena repeats herself until they raise their
 * voice.
 *
 * Half a second at ~32 ms a frame. The reason a *duration* is safe where a level
 * alone isn't: leaked echo comes in bursts shaped like her syllables, while
 * someone answering a question keeps talking. Sixteen unbroken frames above the
 * speech threshold is a person in the room, not a room with a speaker in it.
 */
const BARGE_SUSTAIN_FRAMES = 16

/**
 * How much of Elena's speech to listen through before deciding there is **no
 * echo path at all** — i.e. the candidate is on headphones.
 *
 * The gate exists for one reason: her voice coming out of the candidate's
 * speakers and back into their microphone. On headphones that path does not
 * exist, and the gate then protects against nothing while still standing between
 * the candidate and the interview — their answer has to clear the barge-in doors
 * before a word of it is sent. The first live sitting was exactly this: earphones
 * in, and Elena re-asking over the top of someone who was answering her.
 *
 * So it is measured rather than assumed. We know precisely when she is playing;
 * if the microphone floor never rises through five seconds of it, there is
 * nothing leaking and the gate comes off for the rest of the sitting.
 *
 * 150 frames at ~32 ms. Only frames from *before* the candidate cuts in are
 * counted, and a window whose peak is too high starts again rather than
 * condemning the sitting — one cough during her first question should not decide
 * this.
 */
const ECHO_PROBE_FRAMES = 150

/**
 * The mic level below which her playback is judged **not** to be reaching the
 * microphone.
 *
 * Three quarters of the speech threshold, deliberately not equal to it: the cost
 * of deciding "headphones" wrongly is her voice being fed back to a VAD that
 * interrupts her with it, which is the failure the gate was built to stop. So
 * the evidence has to be clearly below the bar, not merely at it.
 */
const ECHO_FLOOR = MIC_SPEECH_LEVEL * 0.75

/**
 * How long a candidate can sit in silence before the room offers a way out.
 *
 * Not a timeout — nothing advances, nothing is submitted. Someone who has been
 * quiet for fifteen seconds is either thinking hard or stuck, and the second one
 * needs to be told that "I don't know" is an answer and that Done moves on. A
 * hard jump would be the wrong answer to both.
 */
const STUCK_MS = 15_000

/**
 * How long the microphone stays *gated* after Elena stops speaking.
 *
 * While she talks, the microphone is not muted — it is
 * {@link MicMode `"gated"`}: quiet sound is replaced with silence, loud sound
 * goes through. That is the only arrangement that serves both of the things this
 * screen needs at once.
 *
 * **Why it can't just stream everything.** Her voice comes out of the speakers
 * and back into the microphone. Gemini then hears the question it has just
 * asked, takes it for the candidate's turn, makes nothing of it, and asks again —
 * the same question two and three times over, which is what an ungated
 * microphone during playback looks like from the outside. The browser's echo
 * canceller helps and is not sufficient: it is tuned for a far-end talker on a
 * call, and what it leaves behind is still speech-shaped enough to transcribe.
 *
 * **Why it can't just be muted.** Interrupting has to work — saying "option B"
 * over the top of her reading the options is expected behaviour, not an edge
 * case. A hard mute suppresses the echo and the interruption alike.
 *
 * The gate keeps the difference: leaked echo is quiet, a person in the room is
 * loud. The tail then covers the room itself — her audio is finished on the
 * schedule while the last of it is still coming back off the walls.
 */
const HOST_TAIL_MS = 500

/**
 * How long to wait for `interview_complete` once **every** question is recorded.
 *
 * The last answer of a sitting is the one that has nowhere to go. Elena records
 * it, `answer_recorded` confirms it, the card reads "22 of 22 answers recorded" —
 * and then nothing happens, because finishing the interview is a frame the
 * server sends and it did not send one. The candidate is left on a finished
 * interview that will not close.
 *
 * **And the button underneath does not save them**, which is the part that made
 * this a report rather than a nuisance. "Finish interview" sends
 * `{type:"next"}`, and a `next` naming a question the server has already
 * recorded is a stale frame: dropped, not applied. So the one control on screen
 * is *correctly* doing nothing, forever, on every press.
 *
 * So the client finishes it. The evidence is the same evidence this hook already
 * accepts on a `1000` close — every question the server itself named, confirmed
 * recorded by the server — and it is no weaker for arriving while the socket is
 * still open. Eight seconds is the grace: long enough that a server which was
 * going to say `interview_complete` has said it, short enough that nobody sits
 * looking at a dead screen wondering whether their interview counted.
 */
const COMPLETE_GRACE_MS = 8000

/**
 * The cap on that grace when Elena is still talking.
 *
 * The grace waits for her playback to drain, because she usually has a closing
 * line and cutting the candidate off mid-goodbye is a poor last impression of
 * the product. But "still speaking" is a state that has hung before — a queue
 * that never drains held the microphone shut for a whole question once
 * (§12.16) — and it must not be able to strand a finished interview.
 *
 * Thirty seconds from the last recorded answer, and then it closes whatever the
 * player thinks it is doing.
 */
const COMPLETE_MAX_MS = 30_000

/**
 * How long to wait before actually opening the socket.
 *
 * Not a backoff and not a throttle — it exists so that **one interview opens one
 * connection**, which is what the backend has to be able to assume to read its
 * own log. See the socket effect: `StrictMode` mounts, unmounts and remounts in
 * a single task, so any delay at all collapses the pair, and the first setup's
 * socket is never constructed rather than being constructed and abandoned.
 *
 * A tenth of a second, against a WebSocket handshake that takes longer than that
 * on localhost and several times longer anywhere else. Nothing waits on it: the
 * microphone opens on `ready`, which is downstream of the handshake either way.
 */
const CONNECT_SETTLE_MS = 100

/**
 * How many voice sockets this page load has opened.
 *
 * Module scope, and it exists for one diagnostic question that is otherwise
 * unanswerable from the outside: **when Elena greets the candidate twice, who
 * restarted her?** A second greeting on connection `#1` is the backend reopening
 * its own Gemini session behind a socket that never dropped; a second greeting
 * that arrives with `connecting #2` in the log is this client's doing. The two
 * look identical on screen and need opposite fixes.
 *
 * **It starts at 1 in dev as well now.** It used to start at 2, because
 * `StrictMode`'s double mount really did construct two sockets — harmless here
 * and not harmless in the backend's log, where it was indistinguishable from a
 * candidate opening a second tab. {@link CONNECT_SETTLE_MS} collapses that pair,
 * so `connecting #2` means the same thing in dev as it does in production: this
 * client opened a second connection, and the close above it says why.
 */
let connectionSeq = 0

/**
 * The longest pause that still counts as the *same* thing being said.
 *
 * Captions arrive a word or two at a time — "Would", "you say", "that's",
 * "Strongly" — several a second while someone is talking. They have to be sewn
 * back into sentences or the transcript is a column of one-word bubbles, which
 * is unreadable and, worse, hides whether a question was asked once or twice.
 *
 * Two seconds is far longer than the gap between two words of one sentence and
 * far shorter than the gap between two people's turns, so it separates
 * utterances without ever splitting one.
 */
const CAPTION_JOIN_MS = 2000

/**
 * How long a pause has to be, *after a finished sentence*, to start a new line.
 *
 * The full stop is what makes this safe: "Got it, thank you." followed by a
 * breath and then the next question is two bubbles, the way the typed room's
 * transcript has always shown them — while a comma or a half-finished clause
 * keeps the line open however long the speaker hesitates.
 */
const SENTENCE_GAP_MS = 700

/**
 * How many times in a row the socket may drop before the sitting gives up on
 * voice and finishes in the typed room.
 *
 * **In a row** is the important half: the count resets every time an answer is
 * recorded, because a connection that got a question answered was working. So a
 * sitting can survive any number of drops as long as it keeps making progress
 * between them, while a session that dies without ever getting anywhere is not
 * retried until the candidate's clock has gone.
 *
 * The handoff says reconnects are the backend's problem, and for *its* Gemini
 * session they are — it reopens that behind a socket that never closed. This is
 * the other case: the socket itself going away. The candidate's session is
 * untouched by that and still holds their place, so the right answer is another
 * connection, not a different interview. Three, because each attempt costs a
 * greeting and a re-asked question.
 */
const VOICE_RECONNECT_LIMIT = 3

/** Where the sitting is, from the socket's point of view. */
/**
 * The shortest overlap between the end of a caption line and the start of the
 * next frame that is worth believing.
 *
 * Four characters. Below that it is coincidence — a line ending in "e" and a
 * frame starting with "e" is two different words, and splicing them loses a
 * letter of somebody's answer. Above it, a repeat of "Agree" or "Strongly" is
 * the transcriber resending ground it has already covered.
 */
const CAPTION_OVERLAP_MIN = 4

/**
 * How much queued audio, at the moment a **new question** is announced, counts
 * as belonging to the last one and gets dropped.
 *
 * Her audio is generated far faster than it plays, so a question she asked three
 * times over sits here as a minute of sound with nothing to stop it. The server
 * then moves on — and the candidate is looking at question 2 while listening to
 * the third re-ask of question 1, unable to answer either, because a full
 * playback queue holds the microphone gate shut and the answer clock closed.
 *
 * That is the state the second live run was stuck in: the card on 2/20, Elena on
 * question 1, and taps and speech both going nowhere.
 *
 * Audio still queued when the server announces the next question was generated
 * for the last one, by definition. It is not worth the candidate's time and it
 * is actively in their way.
 *
 * 2.5 s rather than zero so a short acknowledgement — "Understood. Thank you." —
 * survives the boundary. Anything longer than that is a backlog, not a courtesy.
 */
const STALE_AUDIO_S = 2.5

/**
 * Joins two caption fragments that **share a seam**, or returns null if they
 * don't.
 *
 * The third case, and the one that was missing. Captions arrive as deltas and
 * the two clean shapes were handled — a fragment wholly contained in the line so
 * far (drop it), and one that starts with the whole line (it *is* the line,
 * further along). What actually arrives a good deal of the time is neither: a
 * fragment whose first words are the line's last words, because the transcriber
 * has revised and resent the tail of what it already sent.
 *
 * Appending that whole is how "…E: Strongly Agree" plus "Strongly Agree" became
 * **"E: Strongly Agree Strongly Agree"** on screen — and, over a question with
 * five options read aloud, a transcript of stuttering nonsense that made a
 * working interview look broken.
 *
 * Longest overlap wins, so a fragment that is entirely a repeat collapses to
 * nothing added rather than to a partial splice.
 */
function joinOverlapping(existing: string, addition: string): string | null {
  const longest = Math.min(existing.length, addition.length)
  for (let size = longest; size >= CAPTION_OVERLAP_MIN; size -= 1) {
    if (existing.endsWith(addition.slice(0, size))) {
      return existing + addition.slice(size)
    }
  }
  return null
}

export type VoiceStatus = "connecting" | "live" | "complete" | "over"

/**
 * Why the room is offering the candidate a hand, if it is.
 *
 * Two situations that look identical from the code and need opposite things
 * said to the person in the chair — nothing said at all, versus something said
 * that has not been acted on. See {@link VoiceInterview.stuck}.
 */
export type VoiceStuck = null | "quiet" | "unrecorded"

/** How a voice interview stopped being one. */
export type VoiceHandover =
  /**
   * Anything that leaves the typed interview as the way to finish.
   *
   * `chosen` separates the candidate *asking* for the keyboard from the voice
   * interview failing into it. Both land in the same room at the same question;
   * only the sentence above it differs, and telling somebody who just pressed
   * "Type instead" that the spoken interview "couldn't continue" reads as though
   * they broke it.
   */
  | { kind: "typed"; resumeAt: number; detail: string; chosen?: boolean }
  /** Another tab of theirs took the sitting over. Do not carry on here. */
  | { kind: "superseded" }
  /**
   * The sitting's clock ran out and the server closed the session itself.
   *
   * A *finished* interview, not a fault: the answers given are scored, and the
   * candidate has to be told that in those words. It is its own kind rather than
   * a flavour of `typed` because handing someone the typed room to carry on in
   * would be a lie — there is no time left to carry on into.
   */
  | { kind: "timeUp" }

export interface VoiceInterview {
  status: VoiceStatus
  /** The question the server says we are on, in `verify-otp`'s numbering. */
  index: number | null
  /** How many questions the socket says there are, when it has said. */
  of: number | null
  kind: VoiceQuestionKind | null
  /** Options as the socket gave them — empty on a free-text question. */
  options: string[]
  /** Questions the server has confirmed captured and scored. */
  answered: number
  /**
   * **What the server recorded** for the question just answered, in its own
   * words — cleared when the next question arrives.
   *
   * The whole point of showing it: a spoken "option B" resolved to D used to be
   * scored as D with nothing on screen to say so, on a question nobody can
   * return to. Now the candidate sees "Recorded: D. Agree" while Elena is still
   * moving on, which is the only moment they could possibly object.
   *
   * `transcript` is **what was heard**, as against `display`'s what it became.
   * On multiple choice the pair is the whole diagnosis — "option B" against
   * "D. Agree" — and on a free-text question it is the only readback there is,
   * since `choice` is null and `display` may be nothing at all.
   */
  recorded: {
    index: number
    choice: number | null
    display: string
    transcript: string | null
  } | null
  /** The Gemini leg is being reopened behind a socket that is still up. */
  hostReconnecting: boolean
  /**
   * The **self-introduction** is running, before question one.
   *
   * Not a question: `index` is `-1`, there are no options, nothing is recorded
   * and nothing is scored. The room has to say so, because a progress counter
   * reading "0 / 20" under a conversation about themselves is the sort of thing
   * a candidate reads as the interview having already gone wrong.
   */
  introducing: boolean
  /**
   * How long the introduction may run, in seconds, when the server said.
   *
   * A ceiling rather than a target — it normally ends on Elena's own
   * `intro_finished`, the candidate's Done, or the turn budget, long before
   * this. Surfaced only so the room can say roughly what scale is expected of
   * "tell me about yourself", which is otherwise the sort of open invitation
   * people either answer in six words or talk through for five minutes.
   */
  introMaxSeconds: number | null
  /** Elena and the candidate, as subtitles. */
  captions: TranscriptEntry[]
  /** What the candidate is being heard to say right now, for the room's strip. */
  liveCaption: string | null
  hostSpeaking: boolean
  /**
   * The microphone is open and Elena can hear the candidate.
   *
   * True while she is speaking too: it is *gated* then rather than closed, so
   * interrupting her works — see {@link HOST_TAIL_MS}. Only the candidate's own
   * mute and the camera hold actually shut it.
   */
  micLive: boolean
  micMuted: boolean
  hostMuted: boolean
  /** A tap or a "next" is with the server; the controls are held until it moves. */
  waiting: boolean
  /**
   * **Every question is recorded** — the interview is over bar the closing.
   *
   * The room needs this for one reason: the controls are held while an answer is
   * with the server, and the very last answer of a sitting is *always* with the
   * server at the moment the interview finishes. So "Finish interview" spent the
   * end of every sitting disabled, on the one screen where a candidate most
   * wants a button that works — and pressing it would not have finished anything
   * anyway, because `next` on a recorded question is a stale frame.
   *
   * True here means: enable it, and treat a press as "close this now" rather
   * than as another `next`. It closes itself a few seconds later regardless —
   * see {@link COMPLETE_GRACE_MS} — so the button is a way to skip the wait, not
   * the only way out.
   */
  finished: boolean
  /**
   * Why the room should offer the candidate a hand on this question — or `null`,
   * which is the ordinary state.
   *
   * **Never a signal to advance.** Nothing has timed out and nothing is lost in
   * either case; the two exist because they need opposite things said.
   *
   * | Value | What has happened | What they need told |
   * |---|---|---|
   * | `"quiet"` | nothing said at all for {@link STUCK_MS} | that "I don't know" is a real answer, and where the way on is |
   * | `"unrecorded"` | they answered, and the question has not moved | that they were heard, and that a tap or Done settles it |
   *
   * `"unrecorded"` is new with the rev-6 flow and only reachable on a question
   * with options, where this client no longer advances by itself — see
   * {@link clientMayAdvance}. Elena's `record_choice` normally lands within a
   * few seconds of the answer and nobody ever sees it; when it doesn't, the
   * alternative to saying so is a card that sits there having apparently ignored
   * a spoken answer until the server's 75 s net fires.
   */
  stuck: VoiceStuck
  /**
   * How loud the microphone is *right now*, 0–1 RMS — as a ref, never as state.
   *
   * The one thing a candidate has no other way to learn: that they are being
   * heard. Captions answer it eventually, but they arrive about a second late
   * and stop arriving altogether when the transcriber is struggling, which is
   * exactly when somebody starts wondering whether the microphone is dead.
   *
   * A ref because this updates about thirty times a second, and the room it
   * lives in is a live interview: as state it would re-render the whole thing at
   * that rate. Whatever draws it should read this from an animation frame and
   * write to the DOM directly — see `MicLevel` in `voice-room.tsx`.
   */
  levelRef: React.RefObject<number>
  toggleMic: () => void
  toggleHostMuted: () => void
  /** The candidate tapped an option. */
  select: (choice: number) => void
  /** The candidate has finished a spoken answer. */
  next: () => void
  /** Ends the voice interview — sent when the sitting is being closed. */
  end: () => void
  /**
   * The candidate would rather type the rest of it.
   *
   * Hands over to the typed room at the question Elena is on, exactly as a
   * dropped socket does. This is the room's answer to having no keyboard at all:
   * a candidate who cannot speak, whose microphone died mid-sitting, or who is
   * simply somewhere they can't talk had only **Done** before, which submits an
   * empty answer and moves on — on a scored question they cannot return to.
   */
  switchToTyped: () => void
}

/**
 * ============================================================================
 * THE VOICE INTERVIEW
 * ============================================================================
 * One WebSocket, one microphone, one voice — the whole of the candidate's side
 * of a spoken interview.
 *
 * **What this hook does not do is the interesting part.** It does not read
 * questions aloud (Elena does, from the server), it does not recognise speech,
 * it does not match a spoken option to an index, and it never submits an answer:
 * `submit-answer` is not called once in voice mode. All of that is Gemini's and
 * the backend's, which is why the typed sitting's `use-voice-answers` — browser
 * `speechSynthesis` plus the Web Speech recogniser — must be **switched off**
 * while this runs, or two Elenas read every question over each other.
 *
 * What it owns is narration and fallback:
 *
 *   · which question the server says we are on, and its options
 *   · Elena's audio, played gaplessly, and the candidate's mic, streamed
 *   · captions, as a transcript
 *   · and the one decision that matters — **when to stop being a voice
 *     interview**, which is the golden rule of the feature: any refusal, any
 *     error, any browser that can't do this hands over to the typed room, which
 *     always works.
 *
 * A handover is not a reset. Every answer the socket confirmed is already
 * captured and scored server-side, so the typed room resumes at the question
 * Elena was on rather than starting again — {@link VoiceHandover.resumeAt}.
 */
export function useVoiceInterview({
  active,
  sessionId,
  token,
  stream,
  faceLost,
  onComplete,
  onHandover,
  onHostTrack,
}: {
  /** The sitting is under way and this is a voice interview. */
  active: boolean
  sessionId: string | null
  token: string | null
  /** The sitting's own camera-and-microphone stream. */
  stream: MediaStream | null
  /** The camera can't see the candidate — nothing said now may be heard. */
  faceLost: boolean
  /** The interview finished over the socket: results are already persisted. */
  onComplete: () => void
  /** Voice is over and something else has to happen. Called at most once. */
  onHandover: (handover: VoiceHandover) => void
  /**
   * Elena now has a voice, as a track — put it in the sitting's recording.
   *
   * A callback rather than a returned value because it is an imperative handoff,
   * not something the room renders: the recorder takes the track once and never
   * looks at it again. Called again after a reconnect, which builds a new player
   * and so a new track, so the receiving end has to tolerate being handed one it
   * already has.
   */
  onHostTrack?: (track: MediaStreamTrack) => void
}): VoiceInterview {
  const [status, setStatus] = React.useState<VoiceStatus>("connecting")
  const [index, setIndex] = React.useState<number | null>(null)
  const [of, setOf] = React.useState<number | null>(null)
  const [kind, setKind] = React.useState<VoiceQuestionKind | null>(null)
  const [options, setOptions] = React.useState<string[]>([])
  const [answered, setAnswered] = React.useState(0)
  const [captions, setCaptions] = React.useState<TranscriptEntry[]>([])
  const [liveCaption, setLiveCaption] = React.useState<string | null>(null)
  const [hostSpeaking, setHostSpeaking] = React.useState(false)
  const [micLive, setMicLive] = React.useState(false)
  const [micMuted, setMicMuted] = React.useState(false)
  const [hostMuted, setHostMuted] = React.useState(false)
  const [waiting, setWaiting] = React.useState(false)
  /**
   * Every question is recorded and the sitting is closing. See the interface.
   */
  const [finished, setFinished] = React.useState(false)
  /**
   * Why the room should offer a hand on this question. See the interface —
   * nothing advances on either reason.
   */
  const [stuck, setStuck] = React.useState<VoiceStuck>(null)
  /** The server's echo of the answer it just recorded. See the interface. */
  const [recorded, setRecorded] = React.useState<{
    index: number
    choice: number | null
    display: string
    transcript: string | null
  } | null>(null)
  /** Elena's own leg is being reopened; the socket is fine. */
  const [hostReconnecting, setHostReconnecting] = React.useState(false)
  /** The self-introduction is running — not a question, and never scored. */
  const [introducing, setIntroducing] = React.useState(false)
  /** The intro's own ceiling, as the `intro` frame stated it. */
  const [introMaxSeconds, setIntroMaxSeconds] = React.useState<number | null>(
    null
  )
  /**
   * Bumped to reopen the socket after a drop.
   *
   * A counter in the socket effect's dependencies rather than a `connect()` the
   * close handler can call: the effect already owns the socket's whole
   * lifetime — the microphone, the player, the teardown — and a second way in
   * would be a second lifetime to keep in step with it.
   */
  const [epoch, setEpoch] = React.useState(0)

  const socketRef = React.useRef<WebSocket | null>(null)
  const micRef = React.useRef<MicCapture | null>(null)
  const playerRef = React.useRef<HostPlayer | null>(null)

  /** The question a `select`/`next` frame refers to, readable between renders. */
  const indexRef = React.useRef<number | null>(null)
  /** Where the typed room would have to pick up. See {@link VoiceHandover}. */
  const resumeRef = React.useRef(0)
  /** We are closing this ourselves: a close is expected and means nothing. */
  const stoppedRef = React.useRef(false)
  /** A handover, or a completion, happens exactly once. */
  const settledRef = React.useRef(false)
  /**
   * Which questions the server has confirmed, by index.
   *
   * A set rather than a counter because `answer_recorded` is not promised to
   * arrive once — a reconnect that re-asks a question can confirm it again — and
   * "12 of 10 answers recorded" is the kind of number that makes a candidate
   * doubt everything else on the screen.
   */
  const recordedRef = React.useRef(new Set<number>())
  /**
   * How many questions there are, per the socket — the denominator a close code
   * gets checked against.
   */
  const ofRef = React.useRef<number | null>(null)
  /**
   * The server said `interview_complete`.
   *
   * The *only* thing that makes a closing socket mean "this interview is
   * finished", together with every answer being recorded. See the close handler.
   */
  const completedRef = React.useRef(false)
  /** Releases the controls if the server never answers a tap. */
  const holdRef = React.useRef<number | null>(null)
  /** Drops since the last answer was recorded. See `VOICE_RECONNECT_LIMIT`. */
  const failuresRef = React.useRef(0)
  /** The pending reconnect. */
  const retryRef = React.useRef<number | null>(null)
  /** Ids for caption lines — a counter, since lines are replaced in place. */
  const captionSeqRef = React.useRef(0)
  /**
   * The line still being spoken: who is saying it, what it says so far, and when
   * the last piece of it arrived.
   *
   * A mirror of the last entry rather than a read of `captions`, because the
   * decision to extend or to start a new bubble has to be made *before* the state
   * updater runs — see the note on `addCaption`.
   */
  const lastCaptionRef = React.useRef<{
    speaker: TranscriptEntry["speaker"]
    text: string
    at: number
  } | null>(null)
  /**
   * The next caption starts a new line whatever it says.
   *
   * Set when the question moves on: the first thing Elena says about question
   * four must not be glued onto the tail of what she said about question three,
   * however similar the two look.
   */
  const breakCaptionRef = React.useRef(false)

  /* ---- what the turn-taking has to know, between renders ----------------- */
  /*
   * All refs, and all read by a timer rather than by a render. The microphone
   * reports its level about thirty times a second; state at that rate would
   * re-render the room thirty times a second to move a number nobody looks at.
   */

  /** Has the candidate said enough on *this* question to have answered it? */
  const spokeRef = React.useRef(false)
  /** Frames above the speech threshold, counting up to {@link SPEECH_FRAMES}. */
  const speechFramesRef = React.useRef(0)
  /** When the microphone last heard them. The clock silence is measured from. */
  const lastVoiceAtRef = React.useRef(0)
  /** When this question was put to them — for {@link STUCK_MS}. */
  const questionAtRef = React.useRef(0)
  /** Consecutive loud frames while Elena is talking. See {@link BARGE_FRAMES}. */
  const bargeFramesRef = React.useRef(0)
  /** Consecutive frames of any speech. See {@link BARGE_SUSTAIN_FRAMES}. */
  const bargeSustainRef = React.useRef(0)
  /** They have cut in, and the gate stays open for the rest of this turn. */
  const bargedRef = React.useRef(false)
  /** The current question's kind. */
  const kindRef = React.useRef<VoiceQuestionKind | null>(null)
  /** Mirrors `introducing`, for the silence clock — which may not read state. */
  const introducingRef = React.useRef(false)

  /* ---- is the server's mid-answer check-in actually there? --------------- */
  /*
   * Both of these feed one decision — whether the long open-question window is
   * safe to use. See `ANSWER_SILENCE_TEXT_MS`.
   *
   * Two sources rather than one, because they fail in opposite directions.
   * `rev` is known from the first frame but only says the build *should* have a
   * check-in; a deployment with `VOICE_CHECKIN_SECONDS=0` still reports 5. Having
   * *seen* one is proof, but it arrives too late to help the first open question.
   * Together: trust the version, and let observation confirm it.
   */
  /** What `ready` said the backend's protocol revision was. */
  const revRef = React.useRef<number | null>(null)
  /**
   * How many sockets **this sitting** has opened.
   *
   * Distinct from `connectionSeq`, which counts the page load, and from
   * `failures`, which is a budget that progress resets. This one only ever goes
   * up, so it is the number that answers "did Elena greet twice because we
   * reconnected?" — a second `ready` on a second socket is a reconnect the
   * client asked for; a second greeting on socket 1 is the backend rebuilding
   * its own Gemini leg. The two look identical on screen and need opposite
   * fixes, which is what made the 2026-09-07 report unanswerable.
   */
  const sittingConnectionsRef = React.useRef(0)
  /** A `notice: checkin` has actually arrived on this sitting. */
  const checkinSeenRef = React.useRef(false)
  /** Elena is talking, so the silence is hers and not an answer ending. */
  const hostSpeakingRef = React.useRef(false)
  /**
   * Elena's turn is still open: she is speaking, or about to, or thinking about
   * a follow-up.
   *
   * **This is what resolves the `next`-versus-follow-up race.** She may ask one
   * short follow-up when an answer is thin — and a thin answer is a short one, so
   * it is exactly the case where our silence clock fires while she is composing.
   * The clock is therefore gated on her turn being *complete*: it opens on her
   * question and on anything she sends, and closes only on `turn_complete`.
   */
  const turnOpenRef = React.useRef(true)
  /**
   * Whether this deployment sends `turn_complete` at all.
   *
   * Until one has arrived the gate above cannot be trusted — an older backend
   * would leave `turnOpen` true for ever and the interview would never advance
   * by itself. Until then the clock falls back to "she isn't audibly speaking",
   * which is what it used before the frame existed.
   */
  const sawTurnCompleteRef = React.useRef(false)
  /** An answer is with the server; nothing may be sent for this question. */
  const waitingRef = React.useRef(false)
  /** Mirrors `stuck`, so the level handler can clear it without depending on it. */
  const stuckRef = React.useRef<VoiceStuck>(null)
  /**
   * The question this client has already advanced **by itself**, so it cannot do
   * it twice.
   *
   * A `next` that goes unanswered lets the hold lapse after
   * {@link ANSWER_HOLD_MS}, and the silence clock — still looking at a finished
   * answer on a question that has not moved — would send another. Which is the
   * fallback path being pressed harder in precisely the case where the evidence
   * says nothing is acting on it. Once per question is a report; after that the
   * server's own 75 s advance is the thing that recovers it, and Done is the
   * thing the candidate has.
   *
   * Not reset by `resetTurn`: it is keyed on the index, so a new question clears
   * it by not matching. `null` starts it, and `VOICE_INTRO_INDEX` is a real
   * value here like everywhere else.
   */
  const autoNextIndexRef = React.useRef<number | null>(null)
  /**
   * When the last outstanding answer was confirmed recorded — or 0, meaning
   * there are questions left.
   *
   * The clock the client's own completion runs on. See
   * {@link COMPLETE_GRACE_MS}: a sitting whose every question is recorded is
   * over, and if the server does not say so this is what does.
   */
  const allRecordedAtRef = React.useRef(0)
  /** `next`, reachable from a timer that outlives the render that armed it. */
  const nextRef = React.useRef<() => void>(() => {})
  /** The closing sequence, reachable from the same timer. */
  const completeRef = React.useRef<() => void>(() => {})
  /**
   * The question whose answer a **tap** has already written into the transcript.
   *
   * `select` writes the line the moment the button is pressed, because a tap
   * makes no sound and the conversation would otherwise show Elena asking and
   * nobody answering. `answer_recorded` then comes back carrying the same
   * sentence in `display`.
   *
   * That was believed to be harmless — "`addCaption` drops the repeat" — and it
   * is not: `addCaption` only suppresses a repeat inside the *same turn*, which
   * means the same speaker within `CAPTION_JOIN_MS`. A server round trip is
   * routinely longer than two seconds, so the answer appeared **twice**, one
   * under the other, both stamped as the candidate's.
   */
  const tapCaptionedRef = React.useRef<number | null>(null)
  /**
   * The latest microphone level, for the room's meter — see `levelRef` on the
   * returned interface. Written ~30×/s and never read during render.
   */
  const levelRef = React.useRef(0)

  /*
   * The three switches the socket effect must be able to read without being
   * restarted by them. Every one changes mid-interview — the candidate mutes
   * themselves, the camera loses their face, they mute Elena — and any one of
   * them in that effect's dependency list would close the socket and end the
   * voice interview over a button press.
   */
  const micMutedRef = React.useRef(false)
  const faceLostRef = React.useRef(false)
  const hostMutedRef = React.useRef(false)
  /** Elena is talking (or has only just stopped) — see `HOST_TAIL_MS`. */
  const deafRef = React.useRef(false)
  /** The tail timer that lifts it. */
  const tailRef = React.useRef<number | null>(null)

  /* ---- the echo probe — see ECHO_PROBE_FRAMES ---------------------------- */
  /** Her playback does not reach this microphone, so the gate is off. */
  const noEchoRef = React.useRef(false)
  /** Frames of her speech listened through in the current probe window. */
  const echoFramesRef = React.useRef(0)
  /** The loudest the room got during them. */
  const echoPeakRef = React.useRef(0)

  // Through refs so a caller passing an inline arrow can't tear the socket down
  // and reopen it on every render — and the clock re-renders this page once a
  // second, so that is not a hypothetical.
  const onCompleteRef = React.useRef(onComplete)
  const onHandoverRef = React.useRef(onHandover)
  const onHostTrackRef = React.useRef(onHostTrack)
  React.useEffect(() => {
    onCompleteRef.current = onComplete
    onHandoverRef.current = onHandover
    onHostTrackRef.current = onHostTrack
  })

  /* -------------------------------------------------- the microphone gate - */

  /**
   * The one place the microphone is opened or closed, from all three reasons it
   * can be shut: the candidate muted themselves, the camera can't see them, or
   * **Elena is speaking**.
   *
   * One function rather than three call sites, because they overlap constantly —
   * she asks a question while the candidate is muted, the camera drops mid
   * question — and any site that set the flag from its own reason alone would
   * open the microphone on someone else's.
   */
  const applyMicGate = React.useCallback(() => {
    const mode: MicMode =
      micMutedRef.current || faceLostRef.current
        ? // Their decision, or the camera's — nothing gets through either way.
          "silent"
        : /* Elena's turn, nobody has cut in yet, and her voice **can** reach
             this microphone: loud enough to be a person, or it doesn't go.

             `noEchoRef` is the measured escape from that — on headphones there
             is nothing to suppress, and gating then only makes the candidate
             shout to be heard. See ECHO_PROBE_FRAMES. */
          deafRef.current && !bargedRef.current && !noEchoRef.current
          ? "gated"
          : "open"

    micRef.current?.setMode(mode)
  }, [])

  /**
   * Muted while the camera can't see the candidate.
   *
   * Not merely a disabled button: this socket is *live*, and words spoken by
   * someone off camera would be transcribed, matched and scored like any other
   * answer. The same rule the typed room applies by stopping its recogniser.
   */
  React.useEffect(() => {
    micMutedRef.current = micMuted
    faceLostRef.current = faceLost
    applyMicGate()

    /* **And Elena waits, rather than asking into an empty room.**
       The microphone is muted for the whole of this, so anything she says while
       the camera cannot see the candidate is a question they are unable to
       answer — and the answer recorded against it is silence. Reported exactly
       that way: "when the camera is off, don't ask any question."

       A hold, not a mute: her audio keeps its place in the queue and plays from
       where it stopped once they are back in frame, so the question is asked
       once, to somebody who can answer it. See `setHeld`.

       ⚠️ **This cannot stop the server advancing.** The protocol gives us four
       frames — `auth`, `select`, `next`, `end` — and none of them means "wait",
       so the backend's 75 s net still fires on a face lost for longer than
       that. A few seconds out of frame is now covered completely; a long
       absence is not covered at all, and needs a `pause` frame from them
       (`BACKEND-REQUEST-voice-camera-hold.md`). */
    playerRef.current?.setHeld(faceLost)
  }, [micMuted, faceLost, applyMicGate])

  /**
   * Deaf while Elena speaks, and for a moment after — the fix for a question
   * asked twice. See {@link HOST_TAIL_MS} for why this is not optional.
   */
  React.useEffect(() => {
    if (tailRef.current !== null) {
      window.clearTimeout(tailRef.current)
      tailRef.current = null
    }

    if (hostSpeaking) {
      deafRef.current = true
      applyMicGate()
      return
    }

    // Lifted on a timer rather than immediately: the room is still ringing with
    // the end of her sentence, and the transcriber is still a beat behind it.
    tailRef.current = window.setTimeout(() => {
      tailRef.current = null
      deafRef.current = false
      applyMicGate()
    }, HOST_TAIL_MS)

    return () => {
      if (tailRef.current !== null) {
        window.clearTimeout(tailRef.current)
        tailRef.current = null
      }
    }
  }, [hostSpeaking, applyMicGate])

  React.useEffect(() => {
    hostMutedRef.current = hostMuted
    playerRef.current?.setMuted(hostMuted)
  }, [hostMuted])

  /* ------------------------------------------------------------- captions - */

  /**
   * Sews the caption stream back into sentences.
   *
   * **Captions arrive a word or two at a time.** The backend forwards Gemini's
   * transcription as it is produced — "Would", "you say", "that's", "Strongly" —
   * so a frame is not a line, and treating it as one gives a column of one-word
   * bubbles nobody can read. Nor is it safe to glue every consecutive frame from
   * one speaker together: that was the version that ran a greeting, a question
   * and a *re-ask of it* into one paragraph, which is what hid a broken session
   * behind what looked like one long repetition.
   *
   * So the line stays open only while the speaker is plainly still saying it, and
   * closes on any of four things:
   *
   *   · the other person starts talking;
   *   · the question moves on (`breakCaptionRef`);
   *   · more than {@link CAPTION_JOIN_MS} of nothing;
   *   · a finished sentence plus a real pause ({@link SENTENCE_GAP_MS}).
   *
   * The result reads like the typed room's transcript, which is the target: one
   * bubble per question, one per answer.
   *
   * Cumulative shapes are handled too, since a deployment may send whole growing
   * lines instead of deltas: a frame that *contains* the open line replaces it,
   * and a frame that is a prefix of it is a straggler and dropped.
   *
   * Every decision is made **outside** the state updater, off `lastCaptionRef`.
   * The updater has to stay pure: StrictMode runs it twice, and a version that
   * flipped `breakCaptionRef` or bumped the id counter from in there lost the
   * break on the second run.
   */
  const addCaption = React.useCallback(
    (speaker: TranscriptEntry["speaker"], text: string) => {
      const trimmed = text.trim()
      if (!trimmed) return

      const now = Date.now()
      const open = lastCaptionRef.current
      const broke = breakCaptionRef.current
      breakCaptionRef.current = false

      const gap = open ? now - open.at : Number.POSITIVE_INFINITY
      const sameTurn =
        open !== null &&
        open.speaker === speaker &&
        !broke &&
        gap <= CAPTION_JOIN_MS &&
        // A full stop and a pause is the end of a thought, not a slow speaker.
        !(gap > SENTENCE_GAP_MS && /[.!?…]$/.test(open.text))

      if (!open || !sameTurn) {
        const line: TranscriptEntry = {
          id: `v${captionSeqRef.current++}`,
          speaker,
          text: trimmed,
          at: now,
        }
        lastCaptionRef.current = { speaker, text: trimmed, at: now }
        setCaptions((current) => [...current, line])
        return
      }

      // A straggler: a shorter partial of what is already on screen.
      if (open.text.startsWith(trimmed)) return

      const merged = trimmed.startsWith(open.text)
        ? // Cumulative — this frame *is* the line, further along.
          trimmed
        : // Overlapping at the seam, which is neither of the clean cases and is
          // what put "E: Strongly Agree Strongly Agree" on screen. See
          // `joinOverlapping`.
          (
            joinOverlapping(open.text, trimmed) ??
            // A plain delta. Joined without a space where either side already
            // has one, so word-level captions don't come out double-spaced.
            (/\s$/.test(open.text) || /^\s/.test(text)
              ? `${open.text}${text}`
              : `${open.text} ${trimmed}`)
          ).trim()

      lastCaptionRef.current = { speaker, text: merged, at: now }
      // The bubble keeps its original `at`, so its timestamp is when the speaker
      // started rather than when they drew breath.
      setCaptions((current) =>
        current.length === 0
          ? current
          : [
              ...current.slice(0, -1),
              { ...current[current.length - 1]!, text: merged },
            ]
      )
    },
    []
  )

  /* --------------------------------------------------- holding the controls - */

  /** Holds them until the server moves on, or until the hold times out. */
  const hold = React.useCallback(() => {
    waitingRef.current = true
    setWaiting(true)
    if (holdRef.current !== null) window.clearTimeout(holdRef.current)
    holdRef.current = window.setTimeout(() => {
      holdRef.current = null
      waitingRef.current = false
      setWaiting(false)
    }, ANSWER_HOLD_MS)
  }, [])

  /** The server answered — the controls are the candidate's again. */
  const release = React.useCallback(() => {
    if (holdRef.current !== null) {
      window.clearTimeout(holdRef.current)
      holdRef.current = null
    }
    waitingRef.current = false
    setWaiting(false)
  }, [])

  /* ------------------------------------------------------------ the turn -- */

  /** A fresh question, or a recorded answer: nobody has said anything yet. */
  const resetTurn = React.useCallback(() => {
    spokeRef.current = false
    speechFramesRef.current = 0
    bargeFramesRef.current = 0
    bargeSustainRef.current = 0
    bargedRef.current = false
    lastVoiceAtRef.current = 0
    questionAtRef.current = Date.now()
    /* Hers again: she is about to read the question, or has just acknowledged an
       answer. The clock stays shut until she says `turn_complete`. */
    turnOpenRef.current = true
    stuckRef.current = null
    setStuck(null)
    /* Whatever a tap wrote belonged to the question just finished. Cleared here
       rather than in the `question` handler because this also runs on
       `answer_recorded` — *after* that handler has read it, which is the order
       that makes the suppression work at all. */
    tapCaptionedRef.current = null
  }, [])

  React.useEffect(() => {
    hostSpeakingRef.current = hostSpeaking
  }, [hostSpeaking])

  React.useEffect(
    () => () => {
      if (holdRef.current !== null) window.clearTimeout(holdRef.current)
      // A reconnect scheduled into a page that has gone.
      if (retryRef.current !== null) window.clearTimeout(retryRef.current)
    },
    []
  )

  /**
   * Every frame of the candidate's microphone, about thirty times a second.
   *
   * Two jobs, and they are the two halves of turn-taking:
   *
   *  1. **When did they last make a sound** — the clock the silence below is
   *     measured against.
   *  2. **Are they cutting in** — a sustained loud frame while Elena is talking
   *     is an interruption, and the right response is for her to stop mid-word.
   *     That is the behaviour a real conversation has, and this is the only place
   *     it can be noticed: she has already been sent, and what is playing is
   *     audio we are holding.
   *
   * Refs throughout. Nothing here may re-render the room.
   */
  const onMicLevel = React.useCallback(
    (level: number) => {
      // Before the threshold test, because the meter's whole job is to show a
      // candidate that a level *below* the threshold is still being picked up.
      levelRef.current = level

      /* **The echo probe.** Also before the threshold test — it is the quiet
         frames that carry the evidence here, and they are exactly the ones the
         return below throws away.

         Only counted while she is audibly speaking and before the candidate has
         cut in, so what it measures really is her leaking back rather than
         anybody talking. See ECHO_PROBE_FRAMES. */
      if (deafRef.current && !bargedRef.current && !noEchoRef.current) {
        echoFramesRef.current += 1
        if (level > echoPeakRef.current) echoPeakRef.current = level

        if (echoFramesRef.current >= ECHO_PROBE_FRAMES) {
          if (echoPeakRef.current < ECHO_FLOOR) {
            noEchoRef.current = true
            trace(
              "voice",
              `no echo path — peak ${echoPeakRef.current.toFixed(4)} through ${
                echoFramesRef.current
              } frames of her speech. The mic gate is off for this sitting.`
            )
            applyMicGate()
          } else {
            /* Something was audible. That may have been her through speakers —
               or a cough, a door, or the candidate starting to answer before the
               barge doors caught it. Start a fresh window rather than concluding
               "there is echo" for the rest of the interview on one window. */
            echoFramesRef.current = 0
            echoPeakRef.current = 0
          }
        }
      }

      if (level < MIC_SPEECH_LEVEL) {
        bargeFramesRef.current = 0
        bargeSustainRef.current = 0
        return
      }

      /* Elena is talking and they have not cut in yet, so this sound has to
         earn its way past her — under both bars, it is her own voice coming back
         off the speakers.

         Two ways past, because echo and an answer differ in *either* volume or
         persistence: loud for a moment, or ordinary for half a second. */
      if (deafRef.current && !bargedRef.current) {
        bargeSustainRef.current += 1
        if (level >= MIC_BARGE_LEVEL) bargeFramesRef.current += 1
        else bargeFramesRef.current = 0

        const cutIn =
          bargeFramesRef.current >= BARGE_FRAMES ||
          bargeSustainRef.current >= BARGE_SUSTAIN_FRAMES
        if (!cutIn) return

        bargedRef.current = true
        trace(
          "voice",
          `barge-in — the candidate spoke over Elena (${
            bargeFramesRef.current >= BARGE_FRAMES ? "loud" : "sustained"
          })`
        )
        /* She stops *now*. The queue holds whole seconds of her reading options,
           and letting it play out over the top of someone who has already
           answered is the single most artificial thing this screen could do. */
        playerRef.current?.flush()
        applyMicGate()
      }

      lastVoiceAtRef.current = Date.now()
      if (!spokeRef.current) {
        speechFramesRef.current += 1
        if (speechFramesRef.current >= SPEECH_FRAMES) spokeRef.current = true
      }
      /* They are talking, so they are not out of ideas.
         Only the silent reason clears here. `"unrecorded"` is *about* an answer
         having been given, so speaking is not evidence against it — and
         clearing it on the tail of the very answer that raised it would have it
         flicker on and off through a sentence. It goes when the question does,
         in `resetTurn`. */
      if (stuckRef.current === "quiet") {
        stuckRef.current = null
        setStuck(null)
      }
    },
    /* Only `applyMicGate`, which is stable — everything else here is a ref, and
       that is load-bearing rather than tidy. This callback is handed to the
       socket effect, so anything that changes its identity reopens the socket:
       reading `stuck` as state here meant that every long silence tore the
       connection down and had Elena greet the candidate all over again. */
    [applyMicGate]
  )

  /**
   * The end of the answer, once every {@link SILENCE_TICK_MS}.
   *
   * A ticking check rather than a timer re-armed per audio frame: same decision,
   * a thirtieth of the churn, and every condition is read at the moment it
   * matters instead of when it was armed.
   */
  React.useEffect(() => {
    if (!active) return

    const timer = window.setInterval(() => {
      const now = Date.now()

      /* **The interview is over and nothing closed it.**
         First, because once every question is recorded there is no answer left
         to detect the end of and nothing below this line applies — including the
         `next` this clock would otherwise fire into a question the server has
         already recorded, which is dropped as a stale frame and is what left the
         card reading "Taking your answer…" on a finished interview.

         Held while Elena is still audibly speaking, so her closing line plays —
         and capped, because a queue that will not drain must not be able to
         strand a sitting that is finished. See `COMPLETE_GRACE_MS`. */
      const allAt = allRecordedAtRef.current
      if (allAt > 0) {
        const waited = now - allAt
        if (
          waited > COMPLETE_MAX_MS ||
          (waited > COMPLETE_GRACE_MS && !hostSpeakingRef.current)
        ) {
          completeRef.current()
        }
        return
      }

      // Nothing said yet. Not an answer to advance — but if it has gone on long
      // enough, the room should offer a way out. See `STUCK_MS`.
      if (!spokeRef.current) {
        if (
          !hostSpeakingRef.current &&
          !waitingRef.current &&
          questionAtRef.current > 0 &&
          now - questionAtRef.current > STUCK_MS
        ) {
          stuckRef.current = "quiet"
          setStuck("quiet")
        }
        return
      }

      /* **All three conditions, per the v4 brief §6** — and the reason it takes
         three is that `turn_complete` does not mean what its name suggests.

         It fires when Gemini has finished *generating* the turn, i.e. when the
         last audio byte has been relayed to us. Generation runs faster than real
         time, so it typically lands while **seconds of Elena are still queued in
         our playback buffer**. Gating on it alone — which is what this did — let
         the silence clock run while she was still audibly talking in the room.

          1. her latest turn has finished generating (`turn_complete`);
          2. our playback has actually drained (`hostSpeaking`), plus the tail
             for the room still ringing with the end of it (`deafRef`);
          3. the microphone is quiet, which is the `ANSWER_SILENCE_MS` test
             further down.

         Condition 2 is now unconditional rather than the fallback for a
         deployment that doesn't send `turn_complete`, so it also still covers
         that case. It can only make advancing *later*, never earlier, and the
         server's own 75-second safety net is underneath it — which is what makes
         erring this way affordable. */
      if (sawTurnCompleteRef.current && turnOpenRef.current) return
      if (hostSpeakingRef.current || deafRef.current) return
      // Already told the server this question is answered.
      if (waitingRef.current) return
      // Nothing heard off camera, or through a muted microphone, is an answer.
      if (faceLostRef.current || micMutedRef.current) return
      /* Open questions get the long window, so the server's check-in happens
         first — see `ANSWER_SILENCE_TEXT_MS`. The introduction counts as open:
         it is a conversation, and cutting somebody off two seconds after they
         pause for breath while introducing themselves is the worst possible
         first impression of the whole product.

         But only where something is going to fill that window. On a backend with
         no check-in the long wait is just silence, and the short window — which
         is what this app did for its whole life before rev 5 — is the better of
         the two. */
      const checkinLive =
        checkinSeenRef.current || (revRef.current ?? 0) >= VOICE_MIN_REV
      const openAnswer = kindRef.current === "text" || introducingRef.current
      const quietFor =
        openAnswer && checkinLive ? ANSWER_SILENCE_TEXT_MS : ANSWER_SILENCE_MS
      if (now - lastVoiceAtRef.current < quietFor) return

      /* **Never on a question with options** — see {@link clientMayAdvance}.
         The way out of one of these is her tool call, the candidate's tap, or
         their press of Done. Not this clock, whose only reading of "skip this
         question" is *Neutral*. The room stops waiting silently and offers the
         way out instead. */
      if (!clientMayAdvance(kindRef.current)) {
        if (stuckRef.current !== "unrecorded") {
          trace(
            "voice",
            "the answer sounds finished, and this question is hers to record — offering the tap and Done"
          )
          stuckRef.current = "unrecorded"
          setStuck("unrecorded")
        }
        return
      }

      /* **Once per question.** `hold()` lapses after `ANSWER_HOLD_MS` with no
         answer from the server, and without this the clock would fire a second
         `next` at the same index — pressing the fallback path harder in exactly
         the case where the evidence says it is not being acted on. One is the
         report; the server's 75 s net is what actually recovers it. */
      const at = indexRef.current
      if (at === null) return
      if (autoNextIndexRef.current === at) return
      autoNextIndexRef.current = at

      trace("voice", "the answer sounds finished — advancing (client fallback)")
      nextRef.current()
    }, SILENCE_TICK_MS)

    return () => window.clearInterval(timer)
  }, [active])

  /* ------------------------------------------------------------- handover -- */

  /** Ends the voice interview one way, once. */
  const settle = React.useCallback((handover: VoiceHandover) => {
    if (settledRef.current) return
    settledRef.current = true
    stoppedRef.current = true
    setStatus("over")
    trace("voice", `handing over — ${handover.kind}`, handover)
    onHandoverRef.current(handover)
  }, [])

  /**
   * **Finishes a sitting whose every question is recorded**, when the server
   * has not.
   *
   * The same closing sequence as the `interview_complete` frame — the page seals
   * the recording, sends the authoritative tab-switch total and shows the done
   * screen either way. What differs is only who decided, and the evidence is the
   * server's own: every index it named, confirmed back to us in an
   * `answer_recorded`.
   *
   * **It sends `{type:"end"}` on the way out, and that is the one place besides
   * {@link end} where that frame belongs.** The standing rule against it — never
   * on teardown, never before a fallback — exists because `end` means "the
   * candidate ends early" and *finalises and scores the interview*, and it was
   * closing live sittings from a code path that ran on every handover (§12.16).
   * Here that is not a hazard but the entire point: there is no early to end,
   * every answer is in, and this frame is what tells a backend that never sent
   * `interview_complete` to let the session go rather than hold a Gemini leg for
   * a candidate who has finished.
   *
   * Guarded on `settled` like everything else, so the frame that arrives a
   * moment later is a no-op rather than a second closing sequence.
   */
  const completeAllRecorded = React.useCallback(() => {
    if (settledRef.current) return
    trace(
      "voice",
      `every question is recorded (${recordedRef.current.size}/${ofRef.current}) and no interview_complete came — finishing`
    )
    const socket = socketRef.current
    if (socket?.readyState === WebSocket.OPEN) socket.send(VOICE_END_FRAME)
    completedRef.current = true
    settledRef.current = true
    stoppedRef.current = true
    allRecordedAtRef.current = 0
    setStatus("complete")
    /* Nothing of hers is worth holding the done screen for at this point: the
       grace already waited for her to stop, and anything still queued after 30 s
       is the queue that would not drain. */
    playerRef.current?.flush()
    micRef.current?.setMode("silent")
    setMicLive(false)
    release()
    onCompleteRef.current()
  }, [release])

  /* Kept current so the ticking check calls this render's closing sequence, not
     the one that existed when the interval was armed — the same arrangement as
     `nextRef`, and for the same reason. */
  React.useEffect(() => {
    completeRef.current = completeAllRecorded
  })

  /* --------------------------------------------------------- the socket --- */

  React.useEffect(() => {
    if (!active || !sessionId || !token || !stream) return
    /* Captured as consts so the narrowing above survives into `connect` below.
       TypeScript does not carry a parameter's narrowing across a closure — a
       parameter is a mutable binding as far as it is concerned — and these three
       are the connection's whole identity. */
    const openSession = sessionId
    const openToken = token
    const openStream = stream

    /*
     * **One socket per interview, and the open is deferred a beat to keep it
     * that way.**
     *
     * React's `StrictMode` mounts every effect, tears it down and mounts it
     * again — so this effect really did construct two `WebSocket`s per sitting
     * in dev, which is what `connecting #2` on a first attempt has always
     * meant. The first was harmless *here*: it is closed while still
     * `CONNECTING`, so `onopen` never fires and it never sends `auth`.
     *
     * It was not harmless *there*. From the backend's side two connections
     * arrive for one session, the newer supersedes the older with a `4409`,
     * and its log for a clean sitting is indistinguishable from a candidate
     * opening a second tab — which is exactly the ambiguity the 2026-09-07
     * double-greeting question could not be answered through.
     *
     * StrictMode's cleanup runs in the same task as its setup, so a timer of
     * any length at all collapses the pair into one connection: the first
     * setup's timer is cleared before it fires and no socket is constructed.
     * {@link CONNECT_SETTLE_MS} is short enough to be imperceptible next to a
     * WebSocket handshake and long enough to also absorb a fast remount from a
     * route change or a re-render storm.
     *
     * The reconnect path is untouched — `epoch` bumps arrive long after the
     * old socket's close, and they are meant to open a new one.
     */
    let cancelled = false
    let teardown: (() => void) | null = null

    const settleTimer = window.setTimeout(() => {
      if (cancelled) return
      teardown = connect() ?? null
    }, CONNECT_SETTLE_MS)

    return () => {
      cancelled = true
      window.clearTimeout(settleTimer)
      teardown?.()
    }

    /* Hoisted, so it can be read after the cleanup that schedules it. The whole
       lifetime of one connection lives in here. */
    function connect(): (() => void) | undefined {
      /*
       * Reset per connection, not per hook.
       *
       * StrictMode mounts every effect twice on the same instance — setup,
       * cleanup, setup — and refs survive that cleanup, so a `stopped` left true
       * by the first teardown would make the second socket ignore every close it
       * ever saw. The same reasoning as `use-recording`'s `finishing` flag.
       */
      stoppedRef.current = false
      settledRef.current = false
      /* `status` is deliberately *not* reset here — it starts as "connecting" and
         only ever moves forward, on a frame from the server or on a close. There
         is no path back: a sitting that reached "over" turned voice off in the
         page, so this effect is never re-armed after one. */

      let socket: WebSocket
      try {
        socket = new WebSocket(voiceSocketUrl(openSession))
      } catch (error) {
        trace("voice", "the socket wouldn't open", error)
        settle({
          kind: "typed",
          resumeAt: resumeRef.current,
          detail: "the voice connection couldn't be opened",
        })
        return
      }
      socket.binaryType = "arraybuffer"
      socketRef.current = socket
      const connection = ++connectionSeq
      /* **Why**, not just that. A reconnect makes the backend greet the
         candidate a second time, which is the whole of the 2026-09-07
         double-greeting report — and "who reopened the socket" is the first
         thing that has to be settled about one. `failures` is the retry budget
         spent so far, so a zero here is a first attempt and anything else names
         the drop it is recovering from. */
      const nth = ++sittingConnectionsRef.current
      trace(
        "voice",
        `connecting #${connection} — ${
          nth === 1
            ? "the first socket of this sitting"
            : `socket ${nth} of this sitting, reopened after a close (expect Elena to greet again)`
        }`,
        { url: voiceSocketUrl(openSession) }
      )

      /**
       * This connection has been given up on, per connection rather than per hook.
       *
       * `stoppedRef` cannot do this job alone. A teardown that is immediately
       * followed by a new setup — StrictMode's double mount, and any remount —
       * resets it to false for the *new* socket while the old one's close is still
       * in flight, and that close is `4409`: the server retires the older
       * connection when a newer one takes the session. Read through the shared ref
       * it looks exactly like the candidate opening a second tab, and the sitting
       * would be ended in front of someone who did nothing. The identity check on
       * `socketRef` below is the same guard from the other side.
       */
      let retired = false
      /** True while this socket is the hook's live one. */
      const live = () => !retired && socketRef.current === socket

      const player = createHostPlayer({ onSpeakingChange: setHostSpeaking })
      playerRef.current = player
      if (player) {
        player.setMuted(hostMutedRef.current)
        /* A reconnect builds a fresh player, and it starts unheld — so a socket
           that comes back while the candidate is still out of frame would have
           Elena greet and re-ask straight into the same empty room the hold
           exists to prevent. Both switches are re-applied from the refs here
           for the same reason. */
        player.setHeld(faceLostRef.current)
        /* Handed up so the page can mix her into the recording. A reconnect makes
           a new player and therefore a new track; whoever holds the mix takes it
           again. */
        if (player.recordingTrack) {
          onHostTrackRef.current?.(player.recordingTrack)
        }
      }

      /** A socket that opens and never answers. See `READY_TIMEOUT_MS`. */
      const readyTimer = window.setTimeout(() => {
        if (!live() || stoppedRef.current) return
        trace("voice", "no `ready` within the timeout")
        settle({
          kind: "typed",
          resumeAt: resumeRef.current,
          detail: "Elena didn't answer in time",
        })
        socket.close()
      }, READY_TIMEOUT_MS)

      socket.onopen = () => {
        // Auth is the first frame or the server hangs up.
        socket.send(voiceAuthFrame(openToken))
      }

      socket.onmessage = (event) => {
        // A close raced with a frame already in flight, or this is a connection
        // the hook has replaced. Everything below writes state, and by now that
        // state belongs to a different socket — or to the typed room.
        if (!live() || stoppedRef.current) return

        if (typeof event.data !== "string") {
          // Elena's voice. The one high-rate path here, and deliberately not
          // state: it goes straight to the audio thread.
          playerRef.current?.play(event.data as ArrayBuffer)
          // Her audio is her turn: anything arriving reopens it, so the silence
          // clock cannot run through the gap between two of her sentences.
          turnOpenRef.current = true
          return
        }

        const message = parseVoiceMessage(event.data)
        if (!message) return

        switch (message.type) {
          case "ready": {
            window.clearTimeout(readyTimer)
            setStatus("live")
            if (message.totalQuestions !== undefined) {
              ofRef.current = message.totalQuestions
              setOf(message.totalQuestions)
            }
            /* **Which build answered**, on its own line and worded so it cannot be
               skimmed past. Two rounds of bug reports were filed against a stale
               deployment before this field existed; the failure mode is not a
               wrong value, it is nobody noticing there was no value.

               Logged loudly and *not* fatal, deliberately. The backend's own
               instruction is "if rev is missing, stop and tell us", which is right
               for a test session and wrong as shipped behaviour: if they ever roll
               back, refusing to run would take voice away from real candidates on
               a build where it still works. */
            revRef.current = message.rev ?? null
            if (message.rev === undefined) {
              trace(
                "voice",
                "⚠️ `ready` carried no `rev` — this is an ANCIENT voice backend, older than rev 4. Expect re-asking, restarts from question one, and `voice_unavailable` with no notice first. Findings against it are not worth filing."
              )
            } else if (message.rev < VOICE_MIN_REV) {
              trace(
                "voice",
                `⚠️ voice backend rev ${message.rev}, expected ${VOICE_MIN_REV}. The protocol works, but this build predates the human layer — no self-introduction and no mid-answer check-in, so neither will arrive however long anyone waits for them.`
              )
            } else {
              trace("voice", `voice backend rev ${message.rev}`)
            }
            /* **Which socket she is greeting on.** Every `ready` is followed by
               a greeting, so this line is the count of greetings the candidate
               is owed — and reading two of them in a sitting is the difference
               between "the client reconnected" (this number climbs) and "the
               backend restarted its own Gemini leg" (it does not). */
            trace(
              "voice",
              `ready on socket ${sittingConnectionsRef.current} of this sitting`,
              message
            )

            // The microphone opens only now: frames sent before the server is
            // ready have nowhere to go, and a browser that can't produce them at
            // all is a fallback rather than a silent half-interview.
            void openMicCapture({
              stream: openStream,
              onFrame: (frame) => {
                if (socket.readyState !== WebSocket.OPEN) return
                socket.send(frame)
              },
              onLevel: onMicLevel,
            }).then((capture) => {
              if (!capture) {
                settle({
                  kind: "typed",
                  resumeAt: resumeRef.current,
                  detail: "this browser couldn't open the microphone for Elena",
                })
                socket.close()
                return
              }
              // Opened across an await: the sitting may have ended, or this
              // connection may have been replaced, in the meantime.
              if (!live() || stoppedRef.current) {
                void capture.close()
                return
              }
              micRef.current = capture
              // Through the gate, not `setMuted(false)`: she is very probably
              // greeting the candidate at this exact moment, and an open
              // microphone would hand her greeting back to her as an answer.
              applyMicGate()
              setMicLive(true)
            })
            return
          }

          /* **The self-introduction** (rev 5, `VOICE_INTRO_ENABLED`).
             Elena invites a short introduction and may ask a follow-up or two
             about what the candidate actually said. Pure conversation: no options,
             no answer to record, never scored.

             The index matters more than it looks. It is `-1`, and `next` has to
             carry it verbatim for the candidate to be able to end the phase — so
             it is set here rather than left null, which is what "no question yet"
             means and what makes `next` refuse to send. */
          case "intro": {
            indexRef.current = VOICE_INTRO_INDEX
            setIndex(VOICE_INTRO_INDEX)
            // The same reasoning as the `question` frame: a presentation, and
            // `-1` is a real index that a reconnect can arrive at twice.
            autoNextIndexRef.current = null
            kindRef.current = null
            setKind(null)
            setOptions([])
            setRecorded(null)
            setLiveCaption(null)
            introducingRef.current = true
            setIntroducing(true)
            setIntroMaxSeconds(message.maxSeconds ?? null)
            breakCaptionRef.current = true
            resetTurn()
            release()
            trace("voice", "introduction", message)
            return
          }

          /* Captured, and question 0 follows on its own frame. Nothing to clear
             here that the `question` frame will not clear anyway — but the room
             stops calling itself an introduction the moment this lands, rather
             than a beat later when the first question arrives. */
          case "intro_complete": {
            introducingRef.current = false
            setIntroducing(false)
            trace("voice", "introduction captured")
            return
          }

          case "question": {
            introducingRef.current = false
            setIntroducing(false)
            /* **A presentation, not necessarily a new index.** A reconnect puts
               the candidate back on the first unanswered question and this frame
               arrives again for it — so the once-per-question budget has to be
               cleared here rather than only expire by the index changing.
               Without it, an open question we advanced before the drop could
               never be advanced automatically again and Done would be the only
               way off it. What the budget is actually for — the hold lapsing
               with no frame at all — is untouched by this. */
            autoNextIndexRef.current = null
            /* **A question nobody has answered means the sitting is not over
               after all**, so the closing clock stands down.
               Tested on the index rather than on the frame arriving, and that is
               the whole safety of it: a re-read of a question already recorded —
               which is what a reconnect or a repeat sends — must not disarm a
               completion that is waiting on nothing else, or the interview goes
               back to being unclosable. */
            if (
              message.index !== undefined &&
              !recordedRef.current.has(message.index)
            ) {
              allRecordedAtRef.current = 0
              setFinished(false)
            }
            if (message.index !== undefined) {
              indexRef.current = message.index
              setIndex(message.index)
              resumeRef.current = Math.max(resumeRef.current, message.index)
            }
            if (message.of !== undefined) {
              ofRef.current = message.of
              setOf(message.of)
            }
            kindRef.current = message.kind ?? null
            setKind(message.kind ?? null)
            setOptions(message.options ?? [])
            // A new question: the last answer's subtitle is history, the controls
            // are the candidate's again, and nobody has said anything yet — so the
            // silence in front of this question is Elena's, not a finished answer.
            setLiveCaption(null)
            /* **And the last answer's readback is history too.**
               This was documented as happening from the day the field was added
               and never actually did: `setRecorded` was called in exactly one
               place and cleared in none, so "RECORDED D. Agree" from question 16
               sat under question 17, and 18, and every question after it. From the
               candidate's chair that reads as the new question having already been
               answered for them — which is the one thing this box exists to rule
               out. */
            setRecorded(null)

            /* **Drop whatever she is still saying about the last question.**
               See `STALE_AUDIO_S`. Beyond wasting the candidate's time, a full
               queue keeps `hostSpeaking` true — which gates the microphone and
               holds the answer clock shut, so the candidate can neither speak nor
               be heard on the question actually in front of them. */
            const stale = playerRef.current?.queuedSeconds() ?? 0
            if (stale > STALE_AUDIO_S) {
              trace(
                "voice",
                `dropping ${stale.toFixed(1)}s of the last question still queued`
              )
              playerRef.current?.flush()
            }

            breakCaptionRef.current = true
            resetTurn()
            release()
            trace("voice", "question", {
              ...message,
              // What is still queued from the *previous* turn when this one is
              // announced. Should be near zero; anything else means she is
              // running ahead of the room. See `queuedSeconds`.
              queuedSeconds: Number(
                (playerRef.current?.queuedSeconds() ?? 0).toFixed(1)
              ),
            })
            return
          }

          case "caption": {
            if (!message.text) return
            if (message.who === "candidate") {
              addCaption("candidate", message.text)
              setLiveCaption(message.text)
              /* A second signal that they are talking, behind the microphone's own.
                 It arrives about a second late, so it can only ever *extend* the
                 answer — never end it early — and it covers the case the level
                 meter can miss: a quiet speaker on a poor microphone whose voice
                 the transcriber hears better than our threshold does. */
              spokeRef.current = true
              lastVoiceAtRef.current = Date.now()
            } else {
              addCaption("host", message.text)
              // Words of hers still arriving: her turn is not over, whatever the
              // audio schedule currently says.
              turnOpenRef.current = true
            }
            return
          }

          /* She has finished speaking — the silence from here belongs to the
             candidate, and the clock may run. The one frame that makes hands-free
             turn-taking safe around her follow-ups. */
          case "turn_complete": {
            sawTurnCompleteRef.current = true
            turnOpenRef.current = false
            /* With the number that matters: how much of her the candidate has
               still not heard at the moment the server considers her finished.
               Anything the backend then does on a silence timer starts this many
               seconds before the candidate has been given a chance to speak — see
               `queuedSeconds`. A large number here is the explanation for a
               question that repeats with no gap to answer into. */
            trace(
              "voice",
              `her turn is complete — ${(
                playerRef.current?.queuedSeconds() ?? 0
              ).toFixed(1)}s of her still unheard here`
            )
            return
          }

          /* Barged in: the model has stopped generating, and this is the server
             telling us to stop the *sound*. What is queued here is seconds of a
             question the candidate has already answered over. */
          case "interrupted": {
            playerRef.current?.flush()
            turnOpenRef.current = false
            bargedRef.current = true
            applyMicGate()
            trace("voice", "interrupted — playback flushed")
            return
          }

          case "answer_recorded": {
            // Counted, never scored: no score crosses this socket, and inventing
            // a number here is the one thing the protocol refuses to do.
            if (message.index === undefined) {
              setAnswered((current) => current + 1)
            } else {
              recordedRef.current.add(message.index)
              setAnswered(recordedRef.current.size)
              resumeRef.current = Math.max(resumeRef.current, message.index + 1)
            }

            /* **Was that the last one?**
               If it was, the sitting is over and the only thing left is for
               somebody to say so. `interview_complete` normally does within a
               second or two; this arms the clock that finishes it if nothing
               does — see `COMPLETE_GRACE_MS`, and the dead "Finish interview"
               button that made it necessary. */
            if (
              ofRef.current !== null &&
              recordedRef.current.size >= ofRef.current &&
              allRecordedAtRef.current === 0
            ) {
              allRecordedAtRef.current = Date.now()
              setFinished(true)
              trace(
                "voice",
                `all ${ofRef.current} answers recorded — waiting ${
                  COMPLETE_GRACE_MS / 1000
                }s for interview_complete`
              )
            }

            /* What was recorded, in the server's words — the answer to "did it
               hear me right?", which the candidate could not ask before.

               Also written into the transcript, where it replaces nothing: a tap
               already put an identical line there and `addCaption` drops the
               repeat, while a *spoken* answer resolved to something else appears
               beside what they said, which is exactly the pair worth seeing. */
            const heard = message.transcript ?? null
            /* A `choice` on its own is enough to show. `skip_question` records a
               decline, and a decline that arrives with no `display` and no
               transcript is exactly the record a candidate most needs to see —
               the 2026-09-07 run turned a spoken "skip this question" into
               *Neutral*, and the readback is where that becomes visible in the
               moment rather than in a report nobody shows them. */
            if (
              message.index !== undefined &&
              (message.display || heard || typeof message.choice === "number")
            ) {
              setRecorded({
                index: message.index,
                choice: message.choice ?? null,
                display: message.display ?? "",
                transcript: heard,
              })

              if (message.choice !== null && message.choice !== undefined) {
                /* Unless the tap already wrote it — see `tapCaptionedRef`. The
                   index is the test rather than the text: the server's `display`
                   and our own wording agree today, and a transcript that shows an
                   answer twice the moment they stop agreeing is not a trade worth
                   making. */
                if (
                  message.display &&
                  tapCaptionedRef.current !== message.index
                ) {
                  addCaption("candidate", message.display)
                }
              } else if (
                heard &&
                lastCaptionRef.current?.speaker !== "candidate"
              ) {
                /* A free-text answer whose captions never arrived.
                   `choice` null means there was no option to resolve to, so
                   `display` carries nothing useful and this transcript is the only
                   record of what they said. Guarded on the last line not already
                   being theirs, because in the ordinary case their captions built
                   that line word by word and adding the server's tidied version
                   underneath would show the same answer twice. */
                addCaption("candidate", heard)
              }
            }

            release()
            setLiveCaption(null)
            resetTurn()
            /* Progress clears the reconnect budget: a connection that got an
               answer recorded was working, so the next drop starts from three
               attempts again rather than from whatever a bad patch earlier in the
               interview left behind. */
            failuresRef.current = 0
            trace("voice", "answer recorded", message)
            return
          }

          /* Nothing terminal — but each of these means the room is about to look
             wrong if it says nothing. */
          case "notice": {
            /* The tool goes in the headline rather than only the payload: on a
               rev-6 sitting `tool_advanced` is most of this log, and "which tool"
               is the difference between "she understood the answer" and "the
               candidate declined". Reading that back off a collapsed object is
               exactly the friction that makes a trace go unread. */
            trace(
              "voice",
              `notice: ${message.code ?? "?"}${message.tool ? ` (${message.tool})` : ""}`,
              message
            )
            switch (message.code) {
              case VOICE_NOTICE.RECONNECTING:
                // Her leg is being rebuilt behind a socket that is fine. Said out
                // loud, because otherwise she simply stops mid-interview.
                setHostReconnecting(true)
                turnOpenRef.current = true
                return
              case VOICE_NOTICE.RECONNECTED:
                setHostReconnecting(false)
                return
              case VOICE_NOTICE.RESUMED:
                /* Our own reconnect landed and the server put us back at the first
                   unanswered question — so the connection *worked*, and the budget
                   that brought us here is spent, not owed. */
                failuresRef.current = 0
                setHostReconnecting(false)
                /* It carries that question's index. The `question` frame that
                   follows sets the room up properly; this only makes sure a
                   handover happening in between lands in the right place rather
                   than at whatever we last saw before the drop. */
                if (message.index !== undefined) {
                  resumeRef.current = Math.max(resumeRef.current, message.index)
                }
                return

              case VOICE_NOTICE.RECONNECT_EXHAUSTED:
                /* The backend has stopped trying to recover her leg.
                   `error: voice_unavailable` and close `4503` follow and do the
                   actual work — this is only the announcement, and it is here
                   because its *absence* is what made the 2026-08-27 failure
                   undiagnosable. Left on screen as "reconnecting" until the error
                   lands a moment later: it is still true, and there is nothing
                   the candidate can do with a more precise word for it. */
                trace("voice", "the backend gave up reconnecting her", message)
                return
              case VOICE_NOTICE.AUTO_ADVANCED:
                // The server's safety net fired: our end-of-speech detection
                // missed one. Worth a log line every time — it is the signal that
                // the thresholds are wrong for this candidate's room.
                trace("voice", "the server advanced a turn we didn't", message)
                release()
                return
              case VOICE_NOTICE.TOOL_ADVANCED:
                /* **She advanced it herself** — the normal path since rev 6, and
                   the reason an `answer_recorded` or `question` frame can arrive
                   with nothing sent from here. Not a fault, and nothing to undo.

                   `release()` is belt-and-braces: the frames that follow release
                   the controls anyway, but a tool call that records without
                   advancing would otherwise leave them held until the hold
                   lapses. */
                release()
                return

              case VOICE_NOTICE.TOOL_IGNORED:
                /* The presentation gate refused one of her answer tools because it
                   named a question she had not begun speaking. Informational —
                   and it is the gate working, not failing: a question the
                   candidate never heard must not acquire an answer. Traced above
                   with the tool name, which is the whole value of it. */
                return

              case VOICE_NOTICE.CHECKIN:
                /* She is about to ask, once, whether they have finished — the only
                   thing rev 5 lets her say on silence.

                   The turn is reopened here rather than waiting for her audio to
                   do it. The notice travels ahead of the sound, and the gap is
                   exactly long enough for our clock to fire `next` into the
                   question she is checking in about. */
                turnOpenRef.current = true
                /* And proof, rather than inference, that the long open-question
                   window has something filling it — see `ANSWER_SILENCE_TEXT_MS`.
                   A deployment with the check-in switched off still reports rev 5,
                   so the version alone cannot settle this. */
                checkinSeenRef.current = true
                return

              case VOICE_NOTICE.STALE_FRAME:
                /* A `select`/`next` of ours named a question already answered. The
                   frame was dropped, so nothing is coming to release the controls —
                   do it here or they stay dead until the hold lapses. */
                release()
                return
              default:
                return
            }
          }

          /* Terminal, and the close that follows says the same thing in a code.
             Handled here rather than there because this frame carries *which*
             terminal — and one of them is not a failure at all. */
          case "error": {
            trace("voice", `error: ${message.code ?? "?"}`, message)
            if (message.code === VOICE_ERROR.TIME_UP) {
              settle({ kind: "timeUp" })
              return
            }
            settle({
              kind: "typed",
              resumeAt: resumeRef.current,
              detail:
                message.code === VOICE_ERROR.UNAVAILABLE
                  ? "the voice host became unavailable"
                  : "the voice service hit an error",
            })
            return
          }

          case "interview_complete": {
            if (settledRef.current) return
            completedRef.current = true
            settledRef.current = true
            stoppedRef.current = true
            // The server said it, so the client's own grace has nothing left to
            // do. See `COMPLETE_GRACE_MS` — this is the path it exists to cover.
            allRecordedAtRef.current = 0
            setStatus("complete")
            trace("voice", "interview complete")
            // Elena has nothing left to say, and what is queued is the goodbye of
            // an interview that is already persisted.
            playerRef.current?.flush()
            onCompleteRef.current()
            return
          }

          default:
            trace("voice", `ignoring ${message.type}`, message)
        }
      }

      socket.onclose = (event) => {
        window.clearTimeout(readyTimer)
        const wasLive = live()
        if (socketRef.current === socket) socketRef.current = null
        trace(
          "voice",
          `#${connection} closed ${event.code} — ${(VOICE_CLOSE_REASONS[event.code] ?? event.reason) || "no reason given"}`
        )
        // A connection this hook has already retired or replaced — see `retired`.
        // Its close says nothing about the interview in front of us.
        if (!wasLive) return
        // Either we closed it, or the interview already finished on a frame.
        if (stoppedRef.current || settledRef.current) return

        const action = voiceCloseAction(event.code)
        if (action === "complete") {
          /*
           * A `1000` close is only a *finished interview* if the interview
           * actually finished.
           *
           * This used to take the code at its word and submit the sitting — which
           * is how a candidate three questions into thirty had their interview
           * scored and closed because the voice session hung up cleanly. `1000` is
           * the code for "no error", and a server tidying up after its own trouble
           * has no error to report either.
           *
           * So it needs corroboration: the `interview_complete` frame, or every
           * question confirmed recorded. Without one of those this is a dropped
           * connection wearing a polite code, and the candidate is handed the typed
           * room to finish in — with everything they have answered already scored.
           */
          const everyAnswer =
            ofRef.current !== null && recordedRef.current.size >= ofRef.current

          if (completedRef.current || everyAnswer) {
            settledRef.current = true
            stoppedRef.current = true
            setStatus("complete")
            onCompleteRef.current()
            return
          }

          trace("voice", "closed 1000 with the interview unfinished", {
            recorded: recordedRef.current.size,
            of: ofRef.current,
          })
          // Falls through to the reconnect below: an unfinished interview whose
          // socket went away is a drop, whatever code it wore.
        }

        if (action === "timeUp") {
          // `error: time_up` normally arrived first and already settled this; the
          // code alone is enough if it didn't.
          settle({ kind: "timeUp" })
          return
        }

        if (action === "superseded") {
          settle({ kind: "superseded" })
          return
        }

        /*
         * A drop. Reopen it — the candidate is mid-interview and their session is
         * still there.
         *
         * This is what stops "Elena asked two questions and then the old typed
         * screen took over". Falling back on the first drop was too eager: it
         * traded the whole rest of a spoken interview for one lost connection,
         * when reconnecting costs the candidate a re-asked question and nothing
         * else. The typed room is still where this ends up if the drops keep
         * coming — see `VOICE_RECONNECT_LIMIT`.
         */
        if (
          voiceCanRetry(event.code) &&
          failuresRef.current < VOICE_RECONNECT_LIMIT
        ) {
          const attempt = failuresRef.current++
          const delay = voiceReconnectDelayMs(attempt)
          trace(
            "voice",
            `reconnecting in ${delay}ms (${attempt + 1}/${VOICE_RECONNECT_LIMIT})`
          )
          // The room reads this as "Connecting to Elena", which is what is
          // happening — rather than leaving a dead question on screen.
          setStatus("connecting")
          retryRef.current = window.setTimeout(() => {
            retryRef.current = null
            setEpoch((current) => current + 1)
          }, delay)
          return
        }

        settle({
          kind: "typed",
          resumeAt: resumeRef.current,
          detail:
            VOICE_CLOSE_REASONS[event.code] ?? "the voice connection dropped",
        })
      }

      socket.onerror = () => {
        // A close always follows, and it carries the code. Deciding here as well
        // would hand over twice — harmless, since `settle` is once-only, but it
        // would also throw away the code, which is the only diagnosis there is.
      }

      return () => {
        retired = true
        stoppedRef.current = true
        window.clearTimeout(readyTimer)

        const capture = micRef.current
        micRef.current = null
        setMicLive(false)
        void capture?.close()

        playerRef.current = null
        void player?.close()

        /* **No `end` frame here.** It used to send one, described as "tells the
           backend to close its Gemini session rather than leave it running for a
           candidate who has gone" — but that is not what the frame means. The
           contract is explicit: `{type:"end"}` is *"candidate ends early"*, and
           the backend finalises and scores the whole interview on it.

           This cleanup runs on **every** teardown, and the commonest one by far is
           a handover to the typed room. So a voice host being lost sent `end`,
           which closed the sitting, and the candidate carried on typing into an
           interview the server had already finished — until the heartbeat came
           back inactive and the room turned into "This session was closed by the
           server" mid-answer.

           Closing the socket is all the Gemini session needs; the backend releases
           it on the close, and per the brief a vanished tab is handled the same
           way. The one place `end` genuinely belongs is {@link end}, which is the
           sitting actually being closed, and it sends its own. */
        socket.close()
        if (socketRef.current === socket) socketRef.current = null
      }
    }
    /* This list is the socket's whole lifetime, and everything in it is stable
       for the length of a sitting. The three switches that are *not* — the
       candidate's mute, Elena's mute, the camera hold — are read through the
       refs above precisely so they can't appear here: any one of them in this
       array would close the socket and end the voice interview over a button
       press. */
  }, [
    active,
    sessionId,
    token,
    stream,
    addCaption,
    applyMicGate,
    onMicLevel,
    release,
    resetTurn,
    settle,
    // Bumped by the close handler to open a fresh socket after a drop.
    epoch,
  ])

  /* -------------------------------------------------------------- actions - */

  const send = React.useCallback((frame: string) => {
    const socket = socketRef.current
    if (!socket || socket.readyState !== WebSocket.OPEN) return false
    socket.send(frame)
    return true
  }, [])

  const select = React.useCallback(
    (choice: number) => {
      const current = indexRef.current
      if (current === null) return
      // Held until the server moves us on, so a second tap can't answer the
      // question that follows.
      if (!send(voiceSelectFrame(current, choice))) return
      hold()

      /* Written into the transcript here, because a tap makes no sound.
         A spoken answer arrives back as captions of the candidate's own words;
         a tapped one would leave the conversation showing Elena asking and
         nobody answering. Worded as the typed room words it — "D. Agree" — so
         the same interview reads the same way whichever way it was taken. */
      const label = options[choice]
      addCaption(
        "candidate",
        label
          ? `${String.fromCharCode(65 + choice)}. ${label}`
          : `Option ${choice + 1}`
      )
      // So `answer_recorded` doesn't write the same sentence underneath it a
      // round trip later. See `tapCaptionedRef`.
      tapCaptionedRef.current = current
    },
    [send, hold, options, addCaption]
  )

  /**
   * `{type:"next"}` — "that's the answer, move on."
   *
   * **The fallback, and no longer the ordinary path.** Since rev 6 the interview
   * advances on one of Elena's tool calls; this frame is what covers the case
   * where it doesn't, and on a question with options it is only ever sent by a
   * person pressing Done ({@link clientMayAdvance}).
   *
   * `source` is carried into the trace rather than the frame — the protocol has
   * no field for it — because "who ended this turn" is the first question asked
   * of every one of these afterwards.
   */
  const advance = React.useCallback(
    (source: "candidate" | "clock") => {
      /* **Nothing left to advance to.** Every question is recorded, so a `next`
         from here names one the server has already answered and comes back as
         `notice: stale_frame` — dropped. A press means "finish it", and this is
         what finishing it is. */
      if (allRecordedAtRef.current > 0) {
        trace("voice", `finish pressed — ${source}`)
        completeRef.current()
        return
      }
      const current = indexRef.current
      if (current === null) return
      if (!send(voiceNextFrame(current))) return
      /* **Who ended the turn**, on the wire and in the log.
         The backend's console prints, per question, whether one of Elena's tools
         advanced it or a client frame did — and when it was a client frame the
         next question is whether a person pressed something or our detector
         fired. That is the difference between a candidate skipping and this
         client overriding her, and reading it back off a screen recording is
         how the 2026-09-07 run cost two days. */
      trace("voice", `next ${current} — ${source}`, {
        kind: kindRef.current,
        introducing: introducingRef.current,
      })
      hold()
      // Their turn is over either way: without this the silence check would fire
      // again on the same answer as soon as the hold lapsed.
      spokeRef.current = false
      speechFramesRef.current = 0
    },
    [send, hold]
  )

  /**
   * "That's my answer, move on." — the candidate's own press.
   *
   * Deliberately a *different* entry point from the silence clock's, and it is
   * allowed on every kind of question where the clock is not (see
   * {@link clientMayAdvance}). A press is a person deciding, which is the one
   * context where resolving a choice off the transcript beats waiting: nobody
   * pressed Done expecting to stay on this question.
   */
  const next = React.useCallback(() => advance("candidate"), [advance])

  // Kept current so the silence clock calls this render's `advance`, not the one
  // that existed when the timer was armed.
  React.useEffect(() => {
    nextRef.current = () => advance("clock")
  })

  /**
   * Ends the voice interview.
   *
   * Called while the sitting is being closed — by the candidate, or by the
   * clock. The mic and Elena stop immediately, because the page goes on to seal
   * the recording and score the sitting and neither should still be running
   * through that.
   */
  const end = React.useCallback(() => {
    if (!stoppedRef.current) send(VOICE_END_FRAME)
    stoppedRef.current = true
    settledRef.current = true
    playerRef.current?.flush()
    micRef.current?.setMode("silent")
    setMicLive(false)
    release()
    setStatus("over")
  }, [send, release])

  /**
   * The candidate asked for the keyboard.
   *
   * The same handover a dropped socket takes, deliberately — `resumeAt` is the
   * first unanswered question, every answer the socket confirmed is already
   * scored server-side, and the captions travel across into the typed room's
   * transcript. Nothing is re-asked and nothing is lost; only the way of
   * answering changes.
   *
   * Distinct from {@link end}, which closes the *sitting*: this closes the
   * *voice* and leaves the interview running. Elena's session is ended on the
   * way out so the backend isn't left holding a Gemini leg for a candidate who
   * has stopped talking to it.
   */
  const switchToTyped = React.useCallback(() => {
    if (settledRef.current) return
    trace("voice", "the candidate asked to type instead")
    /* Deliberately **no `end` frame** — see the socket cleanup. `{type:"end"}`
       means "the candidate ends early" and finalises the interview; this
       candidate is carrying on, just with a keyboard. Closing the socket
       releases the Gemini session on its own. */
    playerRef.current?.flush()
    micRef.current?.setMode("silent")
    setMicLive(false)
    release()
    /* `settle` sets `stopped`, which makes every frame still in flight a no-op,
       and hands up to the page — which turns `spoken` off, deactivates this hook
       and lets its cleanup close the socket properly. */
    settle({
      kind: "typed",
      resumeAt: resumeRef.current,
      detail: "you chose to carry on by typing",
      chosen: true,
    })
  }, [release, settle])

  const toggleMic = React.useCallback(() => setMicMuted((on) => !on), [])
  const toggleHostMuted = React.useCallback(() => setHostMuted((on) => !on), [])

  return {
    status,
    index,
    of,
    kind,
    options,
    answered,
    recorded,
    hostReconnecting,
    introducing,
    introMaxSeconds,
    captions,
    liveCaption,
    hostSpeaking,
    /* The microphone is open and Elena can hear the candidate.
       True even while she is speaking, because it *is* open then — gated, not
       muted, so cutting in works. Only the candidate's own mute and the camera
       hold actually close it. */
    micLive: micLive && !micMuted && !faceLost,
    micMuted,
    hostMuted,
    waiting,
    finished,
    stuck,
    levelRef,
    toggleMic,
    toggleHostMuted,
    select,
    next,
    end,
    switchToTyped,
  }
}
