import * as React from "react"
import {
  ArrowRight,
  Check,
  Ear,
  EyeOff,
  Keyboard,
  Loader2,
  Mic,
  MicOff,
  PhoneOff,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  kindHasOptions,
  type CandidateSession,
  type InterviewQuestion,
} from "@/services/interview"
import { cn } from "@/lib/utils"

import { AiAvatar } from "./ai-avatar"
import { NotesCard } from "./notes-card"
import { CameraPane, RoomTopBar } from "./room-chrome"
import { formatClock, OPTION_LETTERS } from "./room-format"
import { Transcript } from "./transcript"
import type { VoiceInterview } from "./use-voice-interview"
import { MIC_BARGE_LEVEL } from "./voice-audio"

/** How many segments the level meter has. */
const METER_BARS = 5

/**
 * The RMS that lights every bar.
 *
 * Twice the level it takes to interrupt Elena, so ordinary speech sits around
 * three or four bars and there is somewhere left to go. The first bar lights at
 * roughly the threshold an answer has to clear to register at all, which makes
 * this the instrument for the room test as well as reassurance for the
 * candidate: a meter that never gets past one bar in a working room says the
 * thresholds are set too high for it.
 */
const METER_FULL_SCALE = MIC_BARGE_LEVEL * 2

/**
 * A live microphone meter, driven from a ref and an animation frame.
 *
 * The one thing a candidate otherwise has no way to learn: that they are being
 * heard. Captions eventually answer it, but they lag by about a second and dry
 * up exactly when the transcriber is struggling — which is the moment somebody
 * starts wondering whether the microphone is dead and talking louder at a screen
 * that looks inert.
 *
 * **Nothing here touches React state.** The level updates about thirty times a
 * second and this component lives inside a live interview; as state it would
 * re-render the room, the transcript and the camera pane at that rate. The
 * animation frame writes to the bars' styles directly, which is the one place in
 * this app where reaching past React is the correct answer rather than a
 * shortcut.
 */
function MicLevel({
  levelRef,
  active,
}: {
  levelRef: React.RefObject<number>
  active: boolean
}) {
  const hostRef = React.useRef<HTMLSpanElement | null>(null)

  React.useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const bars = Array.from(host.children) as HTMLElement[]

    if (!active) {
      for (const bar of bars) bar.style.opacity = "0.15"
      return
    }

    let frame = 0
    let smoothed = 0

    const draw = () => {
      const level = levelRef.current
      /* Attack fast, release slow. A meter that follows the raw reading in both
         directions flickers on every syllable gap and reads as a fault; one that
         rises instantly and falls over a few frames reads as a voice. */
      smoothed = level > smoothed ? level : smoothed * 0.82 + level * 0.18

      const lit = Math.min(
        METER_BARS,
        Math.ceil((smoothed / METER_FULL_SCALE) * METER_BARS)
      )
      for (let index = 0; index < bars.length; index += 1) {
        bars[index]!.style.opacity = index < lit ? "1" : "0.15"
      }

      frame = requestAnimationFrame(draw)
    }

    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [levelRef, active])

  return (
    <span
      ref={hostRef}
      aria-hidden
      className="flex items-end gap-0.5"
      title={
        active
          ? "Elena is hearing you — the bars move when you speak"
          : "Your microphone is off"
      }
    >
      {Array.from({ length: METER_BARS }, (_, index) => (
        <span
          key={index}
          className="w-0.75 rounded-full bg-emerald-500 opacity-15 transition-opacity duration-75"
          style={{ height: `${5 + index * 2}px` }}
        />
      ))}
    </span>
  )
}

export interface VoiceRoomProps {
  session: CandidateSession
  /**
   * The question Elena is on, matched out of the set `verify-otp` returned by
   * the index the socket sent — null only in the moment before her first one.
   *
   * The socket never carries question *text*; it says which question, and this
   * app has held all of them since the code screen. So the card reads from the
   * local set and the socket decides what the card is showing, which is also why
   * a candidate can follow along in writing while Elena reads.
   */
  question: InterviewQuestion | null
  voice: VoiceInterview
  /** Seconds left in the sitting — the same server clock the typed room shows. */
  secondsLeft: number

  /** The camera, handed to the pane which attaches it itself. */
  stream: MediaStream | null
  videoRef: React.RefObject<HTMLVideoElement | null>
  cameraOn: boolean
  videoRecording: boolean
  logoUrl: string | null

  /**
   * The camera can't see the candidate.
   *
   * Holds the room *and mutes the microphone* — see the hook. Everything Elena
   * hears is transcribed and scored, so an off-camera answer must not reach her.
   */
  faceLost: boolean
  inFullscreen: boolean
  fullscreenSupported: boolean
  onToggleFullscreen: () => void
  onEnd: () => void
}

/**
 * ============================================================================
 * THE SPOKEN INTERVIEW ROOM
 * ============================================================================
 * **The same room the typed interview uses**, and deliberately so: the same top
 * bar, the same camera and notes on the left, the host and the current question
 * in the middle, the transcript on the right. A candidate moved between the two
 * mid-interview — which a dropped socket can do — should not notice the screen
 * change under them, and a recruiter demonstrating one should recognise the
 * other.
 *
 * Only the *answering* differs, because only the answering can:
 *
 *  1. **The answer moves the interview on.** Nothing is pressed and nothing is
 *     sent: the candidate speaks, stops, and Elena takes the answer and asks the
 *     next question. Multiple choice needs even less — she hears "option B" and
 *     records it.
 *  2. **The options are on screen while she reads them aloud.** Tapping isn't a
 *     fallback for the voice failing; it is the faster path for someone who has
 *     already decided, and it fixes a mishearing with one press.
 *  3. **There is no text box and no Send.** A spoken answer has nowhere to type
 *     and nothing to submit — the backend does the submitting. What there *is*
 *     is a way out to the room that does have one: "Type instead" hands the
 *     sitting to the typed interview at the question Elena is on, for a
 *     candidate who cannot speak, whose microphone has died, or who is simply
 *     somewhere they can't talk out loud.
 *  4. **No score, ever.** `answer_recorded` says a question was captured and
 *     scored; the mark itself never crosses the socket, so this room counts
 *     answers and never totals them.
 */
export function VoiceRoom({
  session,
  question,
  voice,
  secondsLeft,
  stream,
  videoRef,
  cameraOn,
  videoRecording,
  logoUrl,
  faceLost,
  inFullscreen,
  fullscreenSupported,
  onToggleFullscreen,
  onEnd,
}: VoiceRoomProps) {
  /**
   * Which option was tapped, so the press has an effect the moment it lands.
   *
   * The socket sends no confirmation of *which* choice it recorded — only that
   * the question is done — so this is a local echo. Without it a tap looks
   * ignored for as long as the round trip takes, and the candidate taps again.
   *
   * The tap remembers **which question** it was for, and the highlight is
   * derived from that rather than cleared by an effect: an effect resetting it
   * would leave one render in which the new question is on screen wearing the
   * last one's selection.
   */
  /**
   * "Type instead" has been pressed once and is asking whether that was meant.
   *
   * Confirmed rather than immediate because the switch is **one-way**: `spoken`
   * only ever turns off, so a misplaced tap costs the candidate the spoken
   * interview for the rest of a sitting they cannot retake. Nothing is lost by
   * it — same questions, same scoring, same clock — but it is not theirs to undo,
   * and a control that irreversible sitting next to Mute deserves the extra
   * press.
   */
  const [confirmTyping, setConfirmTyping] = React.useState(false)

  const [tapped, setTapped] = React.useState<{
    question: number
    choice: number
  } | null>(null)

  /**
   * Which option is shown as chosen: what the **server recorded** if it has said,
   * otherwise what was tapped a moment ago.
   *
   * That order is the point. The server's answer is the one that counts, and it
   * is the only way a candidate can see that "option B" was heard as D — the tap
   * echo is just the instant feedback that keeps a press from feeling ignored
   * while the round trip happens.
   */
  const chosen =
    voice.recorded?.index === voice.index && voice.recorded.choice !== null
      ? voice.recorded.choice
      : tapped?.question === voice.index
        ? tapped.choice
        : null

  /* The socket is the authority on how this question is answered; the local
     question set is the fallback for a frame that omitted either field, since
     it describes the same question. */
  const options = voice.options.length
    ? voice.options
    : (question?.options ?? [])
  const showOptions = voice.kind
    ? kindHasOptions(voice.kind)
    : options.length > 0

  /**
   * The readback's own wording, for a record the server described only as an
   * index.
   *
   * `answer_recorded` normally carries `display` ("D. Agree") and this is unused.
   * It exists for the record that arrives with a `choice` and nothing else —
   * which is what a `skip_question` can look like — where the alternative is a
   * confirmation box with the word "Recorded" and nothing after it.
   */
  const recordedLabel =
    voice.recorded && voice.recorded.choice !== null
      ? `${OPTION_LETTERS[voice.recorded.choice] ?? voice.recorded.choice + 1}. ${
          options[voice.recorded.choice] ?? "recorded"
        }`
      : ""

  const total = voice.of ?? session.totalQuestions
  const position = voice.index ?? 0
  const connecting = voice.status === "connecting"
  // Every control is dead while a tap is with the server, while the room is
  // held, and before Elena has actually started.
  const locked = connecting || voice.waiting || faceLost
  /**
   * ...except the one that finishes the interview, once there is nothing left to
   * answer.
   *
   * The last answer of a sitting is *always* with the server at the moment the
   * interview ends, so `waiting` held "Finish interview" disabled through the
   * end of every spoken interview — on the one screen where a candidate most
   * needs a button that works, watching "22 of 22 answers recorded" above a
   * control they cannot press. A press cannot be premature here: `finished`
   * means the server has confirmed every question recorded.
   */
  const finishLocked = (locked && !voice.finished) || faceLost

  /**
   * This is the **last** question — so answering it ends the interview.
   *
   * Everything on this card that says "next" is wrong here: the button, its
   * arrow, the line under the question, and the way out offered on a long
   * silence. A candidate on question 30 of 30 pressing something labelled
   * "Done →" has no way to know whether one more is coming, and finds out by
   * landing on the finished screen.
   *
   * Guarded on `index` rather than on `position`, which defaults to 0 — without
   * that, a one-question interview would call itself finished before its first
   * question had even arrived.
   */
  const lastQuestion =
    !voice.introducing &&
    voice.index !== null &&
    total > 0 &&
    voice.index + 1 >= total

  /** One line for the state of the conversation. Order matters: most urgent first. */
  const conversation = faceLost
    ? "Your microphone is muted until the camera can see you."
    : connecting
      ? "Connecting you to Elena…"
      : voice.hostSpeaking
        ? voice.introducing
          ? "Elena is speaking — you can answer over her if you're ready."
          : "Elena is asking — you can answer over her if you're ready."
        : voice.micMuted
          ? "Your microphone is muted. Elena can't hear you."
          : voice.micLive
            ? "Listening — just answer out loud."
            : "Opening your microphone…"

  return (
    <div className="flex h-svh flex-col overflow-hidden bg-muted/30">
      <RoomTopBar
        session={session}
        logoUrl={logoUrl}
        round={question?.round ?? 1}
        secondsLeft={secondsLeft}
        inFullscreen={inFullscreen}
        fullscreenSupported={fullscreenSupported}
        onToggleFullscreen={onToggleFullscreen}
      />

      {/* The typed room's three columns, to the pixel — see the note above. */}
      <div className="grid min-h-0 flex-1 gap-3 overflow-y-auto p-3 pb-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)_minmax(0,0.85fr)] lg:overflow-hidden">
        {/* Left: camera + notes */}
        <div className="scrollbar-none flex min-h-0 flex-col gap-3 overflow-y-auto">
          <CameraPane
            stream={stream}
            videoRef={videoRef}
            cameraOn={cameraOn}
            videoRecording={videoRecording}
            hostMuted={voice.hostMuted}
            onToggleHostMuted={voice.toggleHostMuted}
          />

          <NotesCard sessionId={session.sessionId} />

          <Button
            variant="outline"
            onClick={onEnd}
            className="shrink-0 border-red-500/30 text-red-600 hover:bg-red-500/10 hover:text-red-600 dark:text-red-400 dark:hover:text-red-400"
          >
            <PhoneOff />
            End interview
          </Button>
        </div>

        {/* Middle: Elena, and the question she is on */}
        <Card className="relative flex min-h-0 flex-col gap-0 overflow-hidden py-0">
          {/* Covers the question and the controls, never the camera pane —
              being told you're off camera is no use if you can't see yourself
              to fix it. */}
          {faceLost ? (
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-card/95 p-6 text-center backdrop-blur-sm">
              <span className="grid size-12 place-items-center rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400">
                <EyeOff className="size-6" />
              </span>
              <div>
                <p className="text-lg font-semibold">We can&rsquo;t see you</p>
                <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
                  Your microphone is muted while the camera can&rsquo;t see you,
                  so nothing you say now is recorded as an answer. Get your face
                  back in frame and carry on — you can ask Elena to repeat the
                  question.
                </p>
              </div>
              <span className="mt-1 rounded-full bg-muted px-3 py-1 text-xs font-medium">
                {formatClock(secondsLeft)} left
              </span>
            </div>
          ) : null}

          <div className="flex shrink-0 items-center gap-2 border-b px-4 py-3">
            <span
              className={cn(
                "size-2 rounded-full",
                voice.hostSpeaking
                  ? "bg-emerald-500 motion-safe:animate-pulse"
                  : "bg-muted-foreground/40"
              )}
            />
            <span className="text-sm font-semibold">
              Elena (AI Recruiter Host)
            </span>
            {/* Says which interview this is, because a spoken one has no
                keyboard to give it away. */}
            <span className="ml-auto flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
              {voice.micLive ? (
                <Mic className="size-3" />
              ) : (
                <MicOff className="size-3" />
              )}
              Voice interview
            </span>
          </div>

          {/* Pinned above the scroll area, not inside it: the orb is the one
              thing on this card that says whether the host is still speaking,
              and scrolling a long scenario used to take it off screen exactly
              when a candidate wants to know whether to start talking.

              The padding is not spare space: the orb's bloom is drawn outside
              its own box, and this card is `overflow-hidden`, so without room
              here the glow is sliced off flat against the header. */}
          <div className="grid shrink-0 place-items-center py-7">
            <AiAvatar speaking={voice.hostSpeaking} />
          </div>

          <div className="flex shrink-0 items-center justify-between gap-2 px-4 pt-1 pb-3">
            <span className="text-[11px] font-semibold tracking-wider text-emerald-700 uppercase dark:text-emerald-400">
              {voice.introducing ? "Introduction" : "Current question"}
            </span>
            {/* No counter during the introduction. Its index is -1, so the
                arithmetic here would read "0 / 20" — which a candidate takes as
                the interview having gone wrong before it started. It isn't a
                question and it doesn't count as one. */}
            {voice.introducing ? (
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold">
                Not scored
              </span>
            ) : (
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold tabular-nums">
                {Math.min(position + 1, total)} / {total}
              </span>
            )}
          </div>

          <CardContent className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 pt-0">
            {/* Two states behind one spinner, and the difference matters to the
                person reading it: before the first question this is the
                interview starting, and after one it is a dropped connection
                being rebuilt — where "she'll ask the first question" would read
                as everything so far having been lost. */}
            {connecting ? (
              <div className="flex items-center gap-3 rounded-xl border p-4">
                <Loader2 className="size-5 shrink-0 animate-spin text-brand-blue" />
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {voice.index === null
                      ? "Connecting to Elena…"
                      : "Reconnecting to Elena…"}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {voice.index === null
                      ? "She'll greet you and ask the first question herself. There's nothing to press."
                      : "She'll pick up from the question you were on. Everything you've answered is saved — there's nothing to press."}
                  </p>
                </div>
              </div>
            ) : null}

            {/* **The self-introduction**, which is not a question and must not
                look like one. No options, no counter, nothing recorded — so the
                card says what it is and what it is for, and above all that it
                does not count. Somebody who thinks they are being marked on
                "tell me about yourself" answers it quite differently, and worse,
                than somebody who knows it is a warm-up. */}
            {voice.introducing ? (
              <div>
                <p className="text-lg leading-snug font-semibold">
                  Tell Elena a little about yourself
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  A short introduction to start — who you are and what you have
                  been working on. She may ask one or two things about what you
                  say. <strong>None of this is scored</strong>; the questions
                  come after.
                </p>
                {/* The scale, where the server named one. "Tell me about
                    yourself" is the sort of invitation people answer either in
                    six words or for five minutes, and only one of those is what
                    is wanted — so say roughly what is expected rather than
                    letting them guess and get cut off by the cap. */}
                <p className="mt-2 text-xs text-muted-foreground">
                  {voice.introMaxSeconds
                    ? `A minute or two is plenty — up to ${Math.round(voice.introMaxSeconds / 60)} minutes. `
                    : "Take as long as you like. "}
                  Press <strong>Done</strong> when you&rsquo;ve finished, or
                  just stop talking and Elena will move on.
                </p>
              </div>
            ) : null}

            {question && !voice.introducing ? (
              <div>
                {/* The situation, above the question and visibly not part of
                    it — the same treatment as the typed card, and it matters
                    more here: Elena reads both, and a candidate who lost the
                    thread halfway through has this to read back. */}
                {question.scenario ? (
                  <div className="mb-3 rounded-xl border border-l-2 border-l-emerald-500/60 bg-muted/40 px-3.5 py-3">
                    <p className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                      The situation
                    </p>
                    <p className="mt-1 text-sm leading-relaxed whitespace-pre-wrap">
                      {question.scenario}
                    </p>
                  </div>
                ) : null}
                <p className="text-lg leading-snug font-semibold">
                  {question.question}
                </p>
                {/* "Elena moves on" and "asks the next question" are both
                    promises of a question 31 when this is question 30. */}
                <p className="mt-1 text-xs text-muted-foreground">
                  {lastQuestion
                    ? showOptions
                      ? "Last one. Say your answer — “option B” — or tap it, and your interview is complete."
                      : "Last one. Just answer out loud, and your interview is complete once you've finished speaking."
                    : showOptions
                      ? "Say your answer — “option B” — or tap it. Either one answers the question and Elena moves on."
                      : "Just answer out loud. Elena takes your answer and asks the next question once you've finished speaking."}
                  {" You can talk over her if you already know the answer."}
                </p>
              </div>
            ) : !connecting && !voice.introducing ? (
              <p className="text-sm text-muted-foreground">
                Elena is about to begin. Listen for her first question.
              </p>
            ) : null}

            {/* Never during the introduction — the socket sends none, but the
                previous question's would otherwise still be in state. */}
            {showOptions && options.length > 0 && !voice.introducing ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {options.map((option, index) => {
                  const selected = chosen === index
                  return (
                    <button
                      // Keyed by position: some questions offer two identically
                      // worded options, and the answer is the index.
                      key={index}
                      type="button"
                      disabled={locked}
                      onClick={() => {
                        if (voice.index === null) return
                        setTapped({ question: voice.index, choice: index })
                        voice.select(index)
                      }}
                      className={cn(
                        "flex items-center gap-2.5 rounded-xl border px-3 py-3 text-left text-sm transition-colors disabled:opacity-60",
                        selected
                          ? "border-emerald-500 bg-emerald-500/10"
                          : "hover:bg-muted/60"
                      )}
                    >
                      <span
                        className={cn(
                          "grid size-6 shrink-0 place-items-center rounded-md text-xs font-bold",
                          selected
                            ? "bg-emerald-500 text-white"
                            : "bg-muted text-muted-foreground"
                        )}
                      >
                        {OPTION_LETTERS[index] ?? index + 1}
                      </span>
                      {option}
                    </button>
                  )
                })}
              </div>
            ) : null}

            {/* What Elena is hearing, as she hears it. The one piece of
                feedback that tells a candidate the microphone is working —
                without it they are talking at a screen that looks inert. */}
            {voice.liveCaption ? (
              <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-sm">
                <span className="text-xs tracking-wider text-muted-foreground uppercase">
                  Hearing{" "}
                </span>
                {voice.liveCaption}
              </p>
            ) : null}

            {/* **What the server recorded**, in its own words.
                The answer to "did it hear me right?", which a spoken interview
                could not answer at all until the backend started echoing the
                resolved choice back. A misheard "option B" now shows as
                "Recorded: D. Agree" while Elena is still moving on — the only
                moment the candidate could possibly object to it. */}
            {/* Guarded on the index as well as on the box existing, and the
                belt-and-braces is deliberate: the hook clears this on every new
                question, but a readback belonging to some *other* question is
                the one thing that must never appear under this one, and it went
                unnoticed for as long as it did precisely because nothing here
                checked. */}
            {voice.recorded && voice.recorded.index === voice.index ? (
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-sm">
                {/* The server's own wording where it sent one, and our own
                    reading of `choice` where it didn't — `skip_question` can
                    record a decline with no `display` and no transcript at all,
                    and "recorded" with nothing after it is the one thing this
                    box must never say. */}
                {voice.recorded.display || recordedLabel ? (
                  <p>
                    <span className="text-xs tracking-wider text-muted-foreground uppercase">
                      Recorded{" "}
                    </span>
                    {voice.recorded.display || recordedLabel}
                  </p>
                ) : null}

                {/* **What was heard — but only where the transcript is the
                    answer**, which since rev 6 means free text and nothing else.

                    This started life as the diagnosis for a mishearing: "you
                    said option B, we recorded D" was invisible before the
                    backend echoed the resolved choice. Rev 6 changed what is
                    true underneath it. Elena maps a spoken choice to a letter
                    herself, through a tool call, and the transcript is no longer
                    the thing being scored — the backend's own words are that
                    the channel "mislabels short utterances into random
                    languages ('option C' written as 'absentee') even though the
                    MODEL understood perfectly", and that captions are cosmetic.

                    So on a rating item the pair now reads:

                        RECORDED  C. Neutral        ← correct, from her tool call
                        HEARD     "absentee"        ← cosmetic garbage

                    which turns a reassurance into a false alarm, on a question
                    the candidate cannot go back and fix (`stale_frame`). Shown
                    only when `choice` is null, where the words really are the
                    answer and this is the only confirmation they arrived. */}
                {voice.recorded.transcript && voice.recorded.choice === null ? (
                  <p
                    className={cn(
                      "text-muted-foreground",
                      voice.recorded.display && "mt-1 text-xs"
                    )}
                  >
                    <span className="text-xs tracking-wider uppercase">
                      Heard{" "}
                    </span>
                    &ldquo;{voice.recorded.transcript}&rdquo;
                  </p>
                ) : null}

                {/* Deliberately no "tap the right option to correct it" here.
                    A `select` naming a question the server has already recorded
                    comes back as `notice: stale_frame` — the frame is dropped,
                    not applied — so offering a correction would be offering a
                    button that does nothing. Overwrite semantics are item 8 of
                    the backend request; if they land, this is where the offer
                    goes. */}
              </div>
            ) : null}

            {/* Her own connection being rebuilt behind a socket that is fine.
                Said out loud because the alternative is Elena going silent
                mid-interview with nothing on screen to explain it. */}
            {voice.hostReconnecting ? (
              <p className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm">
                <Loader2 className="size-4 shrink-0 animate-spin" />
                Elena is reconnecting — she&rsquo;ll pick up this question in a
                moment. Nothing you&rsquo;ve answered is lost.
              </p>
            ) : null}

            {/* A hand, for the two ways this question can stall.
                Nothing has timed out and nothing has been lost in either case —
                which is the whole reason to say something here rather than to
                advance. */}
            {voice.stuck && !voice.waiting ? (
              <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm">
                {voice.stuck === "unrecorded" ? (
                  /* **They have answered and the question hasn't moved.**
                     Elena records a spoken choice herself and the interview
                     advances on that; this client deliberately does not do it
                     for her, because its only way of resolving "skip this
                     question" on a rating item is to score it *Neutral*.

                     So the wait is real, and it is short — but it must not read
                     as the room having ignored them. Say they were heard, and
                     point at the two things that settle it instantly. */
                  <>
                    Heard you — Elena is recording that. If she doesn&rsquo;t
                    move on in a moment,{" "}
                    {showOptions ? <>tap your answer above or </> : null}press{" "}
                    <strong>
                      {lastQuestion ? "Finish interview" : "Done"}
                    </strong>
                    .
                  </>
                ) : (
                  /* **Nothing said at all.** A candidate who has run dry needs
                     to know that "I don't know" is a real answer and that there
                     is a way on; one who is thinking loses nothing by reading
                     it. */
                  <>
                    Take your time — Elena is waiting, and nothing is lost by
                    thinking. If you&rsquo;d rather move on, say “I don&rsquo;t
                    know”{showOptions ? ", tap an option" : ""} or press{" "}
                    <strong>
                      {lastQuestion ? "Finish interview" : "Done"}
                    </strong>
                    .
                  </>
                )}
              </p>
            ) : null}

            {/* Progress, and deliberately only progress: what is recorded, not
                what it scored. */}
            {voice.answered > 0 ? (
              <p className="text-xs text-muted-foreground">
                {voice.answered} of {total} answers recorded. Your results go to
                the recruiter, not to this screen.
              </p>
            ) : null}
          </CardContent>

          {/* Pinned outside the scroll area, like the typed room's Send
              button: the controls must never scroll away. */}
          <div className="shrink-0 border-t bg-card px-4 py-3">
            {/* The one-way switch, asked about before it is taken. Replaces the
                whole row rather than sitting beside it: the question is worth a
                moment's attention, and the controls underneath it are the ones
                being given up. */}
            {confirmTyping ? (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">
                  Finish the rest of this interview by typing? Everything
                  you&rsquo;ve answered is saved, and you&rsquo;ll pick up on
                  this question — but you can&rsquo;t switch back to speaking.
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    onClick={() => setConfirmTyping(false)}
                  >
                    Keep speaking
                  </Button>
                  <Button variant="default" onClick={voice.switchToTyped}>
                    <Keyboard />
                    Switch to typing
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  {voice.waiting ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : voice.micLive ? (
                    <Ear className="size-3.5" />
                  ) : null}
                  {/* `finished` first: the last answer is with the server at the
                      moment the interview ends, so "Taking your answer…" was
                      what a completed sitting said while it closed — which reads
                      as the thing having hung, and for a while it had. */}
                  {voice.finished
                    ? "That's everything — finishing your interview…"
                    : voice.waiting
                      ? "Taking your answer…"
                      : conversation}
                  {/* Beside the sentence, because it is the evidence for it:
                      "Listening" means nothing on its own to somebody who
                      suspects their microphone is dead. */}
                  <MicLevel levelRef={voice.levelRef} active={voice.micLive} />
                </span>

                <div className="flex items-center gap-2">
                  {/* Quiet on purpose — the ghost variant, and the leftmost of
                      the three. It is the way out for a candidate who cannot use
                      this room at all, not a suggestion to anybody who can. */}
                  {/* <Button
                    variant="ghost"
                    onClick={() => setConfirmTyping(true)}
                    disabled={connecting}
                    title="Finish the interview by typing instead of speaking"
                  >
                    <Keyboard />
                    Type instead
                  </Button> */}

                  <Button
                    variant={voice.micMuted ? "destructive" : "outline"}
                    onClick={voice.toggleMic}
                    disabled={connecting || faceLost}
                  >
                    {voice.micMuted ? <MicOff /> : <Mic />}
                    {voice.micMuted ? "Unmute" : "Mute"}
                  </Button>

                  {/* **On every kind of question**, and `outline` rather than
                      the primary button.

                      The interview moves on by itself — Elena records the answer
                      through a tool call and advances on it — so this is the
                      safety net rather than the way through. But it is the only
                      safety net on a question with options: this client no
                      longer ends those turns on its own end-of-speech detection,
                      because its only reading of a spoken "skip this question"
                      on a rating item is *Neutral* (see `clientMayAdvance`). A
                      press is a person deciding, which is the one case where
                      resolving a choice off the transcript beats waiting.

                      So it is the way off a question for someone who wants to
                      skip, whose "I don't know" was too quiet to register, or
                      whose answer Elena did not act on. Multiple choice gets it
                      too: the options are the fast path, not the only one. */}
                  {/* On the last question this is not "next" — it is the end of
                      the interview, and it says so. The wording and the icon
                      change because an arrow on question 30 of 30 promises a
                      question 31.

                      **And once `finished` is true it is a different action, not
                      just different wording.** `next` on a question the server
                      has already recorded is a stale frame — dropped, not
                      applied — so on a sitting whose last answer was in, this
                      button was doing nothing at all on every press. The hook
                      routes it to the closing sequence instead (see
                      `completeAllRecorded`), and `finishLocked` is what lets it
                      be pressed while that last answer is still with the
                      server. */}
                  <Button
                    variant={voice.finished ? "default" : "outline"}
                    onClick={voice.next}
                    disabled={finishLocked}
                    title={
                      voice.finished
                        ? "Every answer is recorded — closes your interview now"
                        : lastQuestion
                          ? "Submits this answer and finishes your interview"
                          : showOptions
                            ? "Elena moves on once she's recorded your answer — this moves on now"
                            : "Elena moves on by herself when you stop speaking — this skips the wait"
                    }
                  >
                    {lastQuestion || voice.finished
                      ? "Finish interview"
                      : "Done"}
                    {lastQuestion || voice.finished ? (
                      <Check data-icon="inline-end" />
                    ) : (
                      <ArrowRight data-icon="inline-end" />
                    )}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </Card>

        {/* Right: the transcript, from the socket's own captions */}
        <Card className="flex min-h-0 flex-col gap-0 overflow-hidden py-0 max-lg:hidden">
          <div className="shrink-0 border-b px-4 py-3 text-sm font-semibold">
            Transcript
          </div>
          <Transcript entries={voice.captions} />
        </Card>
      </div>
    </div>
  )
}
