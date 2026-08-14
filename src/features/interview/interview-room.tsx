import * as React from "react"
import {
  Briefcase,
  Clock,
  Copy,
  Check,
  EyeOff,
  Loader2,
  // Corner brackets — the conventional fullscreen mark. `Maximize2`'s diagonal
  // arrows are already the video pane's expand toggle a column away, and the
  // two controls do different things.
  Maximize,
  Maximize2,
  Mic,
  MicOff,
  Minimize2,
  PhoneOff,
  Send,
  Volume2,
  VolumeX,
} from "lucide-react"

import { ApiImage } from "@/components/shared/api-image"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import type { CandidateSession, InterviewQuestion } from "@/services/interview"
import { cn } from "@/lib/utils"

import { AiAvatar } from "./ai-avatar"
import { NotesCard } from "./notes-card"
import { RoundStepper } from "./round-stepper"
import { Transcript, type TranscriptEntry } from "./transcript"

/** A/B/C/D/E — how the host reads the options out. */
const OPTION_LETTERS = "ABCDEFGHIJ".split("")

function formatClock(seconds: number) {
  const safe = Math.max(0, seconds)
  const minutes = Math.floor(safe / 60)
  return `${String(minutes).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`
}

/**
 * Shown when the company hasn't uploaded a logo of its own. The wordmark alone —
 * the lettered square was removed by request.
 */
function ProductMark() {
  return (
    <span className="font-extrabold tracking-tight whitespace-nowrap">
      Recruiter<span className="text-brand-pink">AI</span>
    </span>
  )
}

/** Copy control for the interview id in the top bar. */
function CopyId({ value }: { value: string }) {
  const [copied, setCopied] = React.useState(false)

  return (
    <button
      type="button"
      aria-label="Copy interview ID"
      onClick={() => {
        void navigator.clipboard
          .writeText(value)
          .then(() => {
            setCopied(true)
            window.setTimeout(() => setCopied(false), 1500)
          })
          .catch(() => undefined)
      }}
      className="flex items-center gap-1.5 rounded-md px-2 py-1 font-mono text-[11px] text-white/60 transition-colors hover:bg-white/10 hover:text-white/90"
    >
      {value}
      {copied ? (
        <Check className="size-3 text-emerald-400" />
      ) : (
        <Copy className="size-3" />
      )}
    </button>
  )
}

export interface InterviewRoomProps {
  session: CandidateSession
  question: InterviewQuestion
  /** 0-based position in the question list, for the "n / total" counter. */
  position: number
  transcript: TranscriptEntry[]
  /** Seconds left in the sitting. */
  secondsLeft: number

  videoRef: React.RefObject<HTMLVideoElement | null>
  cameraOn: boolean
  recording: boolean
  onToggleRecording: () => void
  voiceSupported: boolean
  /** Whether the sitting is actually being recorded and uploaded. */
  videoRecording: boolean
  /**
   * Words being heard right now, appended to whatever is already in the box, so
   * the candidate can see the microphone working before they commit.
   */
  liveTranscript: string | null
  /** The company's logo, from the public branding for this interview. */
  logoUrl: string | null

  hostSpeaking: boolean
  hostMuted: boolean
  onToggleHostMuted: () => void

  /** Selected option index, or the typed text. */
  answer: string
  onAnswerChange: (next: string) => void
  onSubmit: () => void
  /**
   * An answer is being submitted: every control is dead and the Send button
   * carries the spinner.
   *
   * Deliberately nothing louder. It happens on every question, and covering the
   * card each time made a one-second round trip feel like an event. Submitting
   * the whole *interview* is the one that gets a screen of its own — see
   * `SubmittingCard`, which takes over before this component renders.
   */
  busy: boolean
  error: string | null
  /**
   * Confirmation of something that worked — what the microphone heard, and which
   * option it matched. It belongs beside the answer controls: a candidate who
   * spoke their choice has to be able to check it before pressing send.
   */
  notice: string | null
  /**
   * The camera can't see the candidate — no face in frame, or no camera at all.
   *
   * The sitting is *held*, not ended: the question is covered, every answer
   * control is dead and the clock has stopped, but the camera pane stays clear
   * so they can see themselves and fix it.
   */
  faceLost: boolean
  /**
   * Whether the room is currently fullscreen — for the toggle's icon and label
   * only.
   *
   * Leaving fullscreen deliberately **does not hold the sitting**. It is
   * recorded for the recruiter and nothing else: a candidate who drops out of
   * fullscreen mid-answer is usually reaching for something, and freezing their
   * interview over it punished the accident far more than it deterred the
   * misuse. `faceLost` remains the one condition that holds the room, because
   * an interview nobody can see genuinely cannot continue.
   */
  inFullscreen: boolean
  /**
   * False where the browser has no Fullscreen API — notably iOS Safari, which
   * has none outside `<video>`. The control is hidden rather than shown broken.
   */
  fullscreenSupported: boolean
  /** Entering needs a fresh user gesture, so this must be a real button press. */
  onToggleFullscreen: () => void
  onEnd: () => void
}

/**
 * The interview room: webcam and notes on the left, the AI host and the current
 * question in the middle, the running transcript on the right.
 *
 * There is deliberately **no footer**. The two things a candidate might want
 * from one — the interview id (to quote in a support email) and the way out —
 * live in the top bar instead, where they stay visible without competing with
 * the answer controls for the bottom of the screen.
 *
 * Each column scrolls independently with the scrollbar hidden, so the page
 * itself never scrolls and the question never moves out of view.
 */
export function InterviewRoom({
  session,
  question,
  position,
  transcript,
  secondsLeft,
  videoRef,
  cameraOn,
  recording,
  onToggleRecording,
  voiceSupported,
  videoRecording,
  liveTranscript,
  logoUrl,
  hostSpeaking,
  hostMuted,
  onToggleHostMuted,
  answer,
  onAnswerChange,
  onSubmit,
  busy,
  error,
  notice,
  faceLost,
  inFullscreen,
  fullscreenSupported,
  onToggleFullscreen,
  onEnd,
}: InterviewRoomProps) {
  const [expanded, setExpanded] = React.useState(false)
  const total = session.questions.length
  const hasOptions = question.options.length > 0
  const last = position + 1 === total

  /**
   * What the answer box shows while dictating: the words already in it, then
   * the ones arriving now. It used to show *only* the live transcript, so a
   * candidate who typed a paragraph and then reached for the microphone watched
   * it vanish — and wouldn't know it comes back until they stopped.
   */
  const draft =
    liveTranscript === null
      ? answer
      : [answer.trim(), liveTranscript].filter(Boolean).join(" ")

  return (
    <div className="flex h-svh flex-col overflow-hidden bg-muted/30">
      {/* ------------------------------------------------------------ top -- */}
      <header className="flex shrink-0 flex-wrap items-center gap-3 bg-surface-dark px-4 py-2.5 text-white">
        {/* The company's own logo when they have one, exactly as their staff
            see it — the candidate is being interviewed by them, not by us. */}
        {logoUrl ? (
          <ApiImage
            src={logoUrl}
            alt="Company logo"
            className="h-7 w-auto max-w-40 shrink-0 object-contain"
            fallback={<ProductMark />}
            pending={<span className="h-7 w-7" />}
          />
        ) : (
          <ProductMark />
        )}

        {session.rounds.length > 1 ? (
          <RoundStepper
            rounds={session.rounds.map((round) => ({
              id: String(round.round),
              name: round.name,
            }))}
            activeIndex={Math.max(0, question.round - 1)}
            className="mx-auto [&_span]:text-white/60"
          />
        ) : (
          <span className="mx-auto" />
        )}

        <div className="flex flex-wrap items-center gap-2">
          {/* A way *in* only — never a way out.

              Hidden once fullscreen, deliberately: offering an Exit control on
              the interview chrome invites the candidate to leave, which is the
              opposite of what the room wants, and the browser already provides
              every exit anyone needs (Escape, F11, window controls). Also
              hidden entirely where fullscreen isn't available — notably iOS
              Safari — rather than shown as a control that does nothing. */}
          {fullscreenSupported && !inFullscreen ? (
            <button
              type="button"
              onClick={onToggleFullscreen}
              aria-label="Enter fullscreen"
              title="Enter fullscreen"
              className="flex items-center gap-1.5 rounded-lg bg-white/10 px-2.5 py-1.5 text-white/70 transition-colors hover:bg-white/20 hover:text-white"
            >
              <Maximize className="size-3.5" />
              {/* The label is the affordance on a bar of unlabelled pills; it
                  drops below `sm`, where the row is already tight. */}
              <span className="hidden text-xs font-semibold sm:inline">
                Fullscreen
              </span>
            </button>
          ) : null}

          <span className="flex items-center gap-1.5 rounded-lg bg-white/10 px-2.5 py-1.5 text-sm font-semibold tabular-nums">
            <Clock className="size-3.5 text-white/60" />
            {formatClock(secondsLeft)}
          </span>

          <span className="flex items-center gap-1.5 rounded-lg bg-white/10 px-2.5 py-1.5">
            <Briefcase className="size-3.5 text-white/60" />
            <span className="flex flex-col leading-none">
              <span className="text-[9px] tracking-wider text-white/50 uppercase">
                Position
              </span>
              <span className="text-xs font-semibold">{session.role}</span>
            </span>
          </span>

          <span className="flex items-center gap-2 rounded-lg bg-white/10 px-2.5 py-1.5 text-xs font-semibold">
            <span className="grid size-5 place-items-center rounded-full bg-white/15 text-[10px]">
              {session.candidateName.slice(0, 1).toUpperCase()}
            </span>
            {session.candidateName}
          </span>

          {/* Moved up from the footer. */}
          <CopyId value={session.interviewId} />
        </div>
      </header>

      {/* ---------------------------------------------------------- body --- */}
      {/* Below `lg` the panes stack into content-sized rows that can total more
          than the viewport, so this column scrolls instead of clipping them.
          At `lg` the three columns each scroll on their own and it never does.

          `pb-6` is for the watermark fixed to the bottom of the viewport: this
          shell is exactly one screen tall, so without the gap the mark lands on
          "Send answer" — the one control that must never look obstructed. */}
      <div className="grid min-h-0 flex-1 gap-3 overflow-y-auto p-3 pb-6 lg:overflow-hidden lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)_minmax(0,0.85fr)]">
        {/* Left: camera + notes */}
        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto scrollbar-none">
          <div
            className={cn(
              "relative shrink-0 overflow-hidden rounded-xl bg-surface-dark",
              expanded ? "aspect-video lg:aspect-4/3" : "aspect-video"
            )}
          >
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              className="size-full object-cover"
            />

            {!cameraOn ? (
              <div className="absolute inset-0 grid place-items-center bg-surface-dark/90 text-sm text-white/70">
                Camera off
              </div>
            ) : null}

            {/* Only shown when a recording is genuinely being uploaded. A REC
                badge over a sitting nobody is recording is a lie the candidate
                can't check. */}
            {videoRecording ? (
              <span className="absolute top-3 left-3 flex items-center gap-1.5 rounded-md bg-black/60 px-2 py-1 text-[11px] font-semibold text-white">
                <span className="size-2 rounded-full bg-red-500 motion-safe:animate-pulse" />
                REC
              </span>
            ) : null}

            {/* Controls float over the video so they don't steal vertical
                space from the notes card beneath. */}
            {/* No camera toggle: the sitting is recorded and the candidate
                agreed to be visible for it, so an off switch here only invites
                a recording nobody can use. */}
            <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-black/55 p-1.5 backdrop-blur">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={hostMuted ? "Unmute the host" : "Mute the host"}
                onClick={onToggleHostMuted}
                className="rounded-full text-white hover:bg-white/20"
              >
                {hostMuted ? <VolumeX /> : <Volume2 />}
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={expanded ? "Shrink video" : "Expand video"}
                onClick={() => setExpanded((current) => !current)}
                className="rounded-full text-white hover:bg-white/20"
              >
                {expanded ? <Minimize2 /> : <Maximize2 />}
              </Button>
            </div>
          </div>

          <NotesCard sessionId={session.sessionId} />

          {/* Under the notes rather than in the top bar: ending is the last
              thing anyone should do here, and the bar is where the clock and
              the position live — things you read, not things you press. */}
          <Button
            variant="outline"
            onClick={onEnd}
            className="shrink-0 border-red-500/30 text-red-600 hover:bg-red-500/10 hover:text-red-600 dark:text-red-400 dark:hover:text-red-400"
          >
            <PhoneOff />
            End interview
          </Button>
        </div>

        {/* Middle: host + current question */}
        <Card className="relative flex min-h-0 flex-col gap-0 overflow-hidden py-0">
          {/* Covers the question and the answer controls, and nothing else.
              The camera pane to the left stays clear on purpose — being told
              you're off camera is no use if you can't see yourself to fix it. */}
          {faceLost ? (
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-card/95 p-6 text-center backdrop-blur-sm">
              <span className="grid size-12 place-items-center rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400">
                <EyeOff className="size-6" />
              </span>
              <div>
                <p className="text-lg font-semibold">
                  We can&rsquo;t see you
                </p>
                <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
                  Your interview is paused. It carries on by itself as soon as
                  your face is back in frame — nothing has been lost.
                </p>
              </div>
              <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
                <li>Check your camera is on and nothing is covering it</li>
                <li>Sit so your whole face is inside the frame</li>
                <li>Turn on a light if the room is dark</li>
              </ul>
              <span className="mt-1 rounded-full bg-muted px-3 py-1 text-xs font-medium">
                Timer paused at {formatClock(secondsLeft)}
              </span>
            </div>
          ) : null}

          <div className="flex shrink-0 items-center gap-2 border-b px-4 py-3">
            <span
              className={cn(
                "size-2 rounded-full",
                hostSpeaking ? "bg-emerald-500 motion-safe:animate-pulse" : "bg-muted-foreground/40"
              )}
            />
            <span className="text-sm font-semibold">Elena (AI Recruiter Host)</span>
          </div>

          {/* Pinned above the scroll area, not inside it. The orb is the one
              thing on this card that says whether the host is still speaking —
              scrolling down to read a long scenario used to take it off screen,
              exactly when a candidate wants to know whether to start talking.

              The padding is not spare space: the orb's bloom is drawn outside
              its own box, and this card is `overflow-hidden`, so without room
              here the glow is sliced off flat against the header. */}
          <div className="grid shrink-0 place-items-center py-7">
            <AiAvatar speaking={hostSpeaking} />
          </div>

          {/* Pinned, like the orb above it. This is the one line that says
              *which* question is on screen, and it scrolled away with the rest —
              so a candidate who had scrolled down to the options could no longer
              see where they were in the set. */}
          <div className="flex shrink-0 items-center justify-between gap-2 px-4 pt-1 pb-3">
            <span className="text-[11px] font-semibold tracking-wider text-emerald-700 uppercase dark:text-emerald-400">
              Current question
            </span>
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold tabular-nums">
              {position + 1} / {total}
            </span>
          </div>

          {/* `min-h-0` is load-bearing: a flex child defaults to
              `min-height: auto`, grows to its content, and overflows the
              card's `overflow-hidden` — which clips the answer controls off
              the bottom of the screen instead of scrolling them into reach.
              Scrollbars are hidden app-wide (see `index.css`); the pinned
              footer below is what signals there's more above it.

              `pt-0` because the pinned header above now owns the top spacing. */}
          <CardContent className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 pt-0">
            <div>
              {/* The situation, above the question and visibly not part of it.
                  It is prose the candidate has to read and hold in mind, so it
                  gets normal-weight text at a readable size — while the question
                  keeps the one piece of bold type on the card, because that is
                  the thing being answered. Running the two together as one
                  paragraph loses which is which. */}
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
              {/* Spelt out while the mic is open, because the candidate has no
                  other way to know the microphone answers *and advances* on
                  their words alone — and no reason to guess the wording. */}
              <p className="mt-1 text-xs text-muted-foreground">
                {recording
                  ? hasOptions
                    ? "Say “option B” and it's answered — the mic stays on for the next question."
                    : "Speak your answer, then say “send answer” to move on."
                  : hasOptions
                    ? "Choose an option — then press Enter, or use Send answer. You can also answer out loud with the microphone."
                    : "Type your answer below, or use the microphone."}
              </p>
            </div>

            {hasOptions ? (
              <div
                className="grid gap-2 sm:grid-cols-2"
                /**
                 * Enter on the option that is *already* selected sends it.
                 *
                 * Handled here rather than per button so the rule stays in one
                 * place, and gated on the focused option being the selected one:
                 * Enter on a button always fires its click, so on an unselected
                 * option it must be left alone to do the selecting. That gives
                 * the two sequences a candidate would expect — click then Enter
                 * sends, and arrow-or-tab then Enter selects, Enter again sends —
                 * without Enter ever submitting an option nobody chose.
                 */
                onKeyDown={(event) => {
                  if (event.key !== "Enter" || busy || faceLost) return
                  const focused = (event.target as HTMLElement).dataset
                    .optionIndex
                  if (focused === undefined || focused !== answer) return
                  // Stops the button's own click, which would merely re-select.
                  event.preventDefault()
                  onSubmit()
                }}
              >
                {question.options.map((option, index) => {
                  const selected = answer === String(index)
                  return (
                    <button
                      // Keyed by position: some questions offer two identically
                      // worded options, and the answer sent is the index.
                      key={index}
                      type="button"
                      data-option-index={index}
                      disabled={busy}
                      onClick={() => onAnswerChange(String(index))}
                      className={cn(
                        "flex items-center gap-2.5 rounded-xl border px-3 py-3 text-left text-sm transition-colors",
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

            {/* The words as they're heard. On an open question the box below
                shows them; on multiple choice there is no box, and without this
                the candidate is talking at a screen that looks inert. */}
            {hasOptions && liveTranscript !== null ? (
              <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-sm">
                <span className="text-xs tracking-wider text-muted-foreground uppercase">
                  Hearing{" "}
                </span>
                {liveTranscript || "…"}
              </p>
            ) : null}

            {!hasOptions ? (
              <Textarea
                rows={5}
                // While the mic is live this shows what's being heard, so the
                // candidate watches the words land instead of wondering whether
                // anything is happening. Read-only for as long as words are
                // arriving — typing into a box the recogniser is also writing to
                // loses whichever of the two lands second. Editable on stop.
                value={draft}
                readOnly={liveTranscript !== null}
                disabled={busy}
                onChange={(event) => onAnswerChange(event.target.value)}
                /**
                 * Pasting and dropping are both refused: an answer arriving whole
                 * from somewhere else is not the candidate's answer, and this is
                 * the field a scored open question is judged on.
                 *
                 * Both events, because either one carries text in — a drop is a
                 * paste with a mouse. Refusing them cannot stop a determined
                 * candidate retyping from another window, and isn't meant to; it
                 * removes the effortless path, which is the one that gets taken.
                 *
                 * Dictation is unaffected: it writes through `onAnswerChange`
                 * like typing does, not through the clipboard.
                 */
                onPaste={(event) => event.preventDefault()}
                onDrop={(event) => event.preventDefault()}
                placeholder={
                  recording ? "Listening…" : "Type your answer here…"
                }
              />
            ) : null}

            {/* Said out loud, because a paste that silently does nothing reads as
                a broken text box — and a candidate who thinks the page is broken
                reloads it, which costs them the sitting. */}
            {!hasOptions ? (
              <p className="text-xs text-muted-foreground">
                Pasting is turned off for this question — please type or speak
                your answer.
              </p>
            ) : null}

            {error ? (
              <p
                role="alert"
                className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              >
                {error}
              </p>
            ) : null}

            {/* Only once the microphone is off: while it's live the box above
                and the "Hearing" strip already say what's being picked up. */}
            {notice && !recording ? (
              <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400">
                {notice}
              </p>
            ) : null}
          </CardContent>

          {/* Pinned outside the scroll area: "Send answer" is the one control
              the candidate always needs, so it must never scroll away. */}
          <div className="shrink-0 border-t bg-card px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">
                {/* The mic is deaf while the host reads — say so, or a candidate
                    who answers over the question thinks it stopped working. */}
                {recording && hostSpeaking
                  ? "Reading the question — answer when it finishes."
                  : hostSpeaking
                    ? "Wait for the question to finish, then answer."
                    : recording
                      ? "Listening — the mic stays on until you stop it."
                      : ""}
              </span>

              <div className="flex items-center gap-2">
                {voiceSupported ? (
                  <Button
                    variant={recording ? "destructive" : "outline"}
                    onClick={onToggleRecording}
                    disabled={busy}
                  >
                    {recording ? <MicOff /> : <Mic />}
                    {recording ? "Stop" : "Use mic"}
                  </Button>
                ) : null}

                <Button
                  onClick={onSubmit}
                  disabled={busy || faceLost || answer === ""}
                >
                  {busy ? (
                    <>
                      <Loader2 className="animate-spin" />
                      Sending…
                    </>
                  ) : (
                    <>
                      <Send />
                      {last ? "Finish interview" : "Send answer"}
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
        </Card>

        {/* Right: transcript */}
        <Card className="flex min-h-0 flex-col gap-0 overflow-hidden py-0 max-lg:hidden">
          <div className="shrink-0 border-b px-4 py-3 text-sm font-semibold">
            Transcript
          </div>
          <Transcript entries={transcript} />
        </Card>
      </div>
    </div>
  )
}
