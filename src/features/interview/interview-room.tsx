import * as React from "react"
import {
  Briefcase,
  Clock,
  Copy,
  Check,
  Loader2,
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

/** Shown when the company hasn't uploaded a logo of its own. */
function ProductMark() {
  return (
    <span className="flex items-center gap-2 font-extrabold tracking-tight">
      <span className="grid size-7 place-items-center rounded-lg bg-white/10 text-xs">
        R
      </span>
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
   * Words being heard right now. Shown in place of the typed answer while the
   * microphone is live, so the candidate can see it working before they commit.
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
  busy: boolean
  error: string | null
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
  onEnd,
}: InterviewRoomProps) {
  const [expanded, setExpanded] = React.useState(false)
  const total = session.questions.length
  const hasOptions = question.options.length > 0
  const last = position + 1 === total

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
          At `lg` the three columns each scroll on their own and it never does. */}
      <div className="grid min-h-0 flex-1 gap-3 overflow-y-auto p-3 lg:overflow-hidden lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)_minmax(0,0.85fr)]">
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
        <Card className="flex min-h-0 flex-col gap-0 overflow-hidden py-0">
          <div className="flex shrink-0 items-center gap-2 border-b px-4 py-3">
            <span
              className={cn(
                "size-2 rounded-full",
                hostSpeaking ? "bg-emerald-500 motion-safe:animate-pulse" : "bg-muted-foreground/40"
              )}
            />
            <span className="text-sm font-semibold">Elena (AI Recruiter Host)</span>
          </div>

          {/* `min-h-0` is load-bearing: a flex child defaults to
              `min-height: auto`, grows to its content, and overflows the
              card's `overflow-hidden` — which clips the answer controls off
              the bottom of the screen instead of scrolling them into reach.
              Scrollbars are hidden app-wide (see `index.css`); the pinned
              footer below is what signals there's more above it. */}
          <CardContent className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
            <div className="grid shrink-0 place-items-center py-2">
              <AiAvatar speaking={hostSpeaking} />
            </div>

            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold tracking-wider text-emerald-700 uppercase dark:text-emerald-400">
                Current question
              </span>
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold tabular-nums">
                {position + 1} / {total}
              </span>
            </div>

            <div>
              <p className="text-lg leading-snug font-semibold">
                {question.question}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {hasOptions
                  ? "Choose an option, or use the microphone to answer out loud."
                  : "Type your answer below, or use the microphone."}
              </p>
            </div>

            {hasOptions ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {question.options.map((option, index) => {
                  const selected = answer === String(index)
                  return (
                    <button
                      // Keyed by position: some questions offer two identically
                      // worded options, and the answer sent is the index.
                      key={index}
                      type="button"
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
                // anything is happening. It becomes editable again on stop.
                value={liveTranscript ?? answer}
                readOnly={liveTranscript !== null}
                disabled={busy}
                onChange={(event) => onAnswerChange(event.target.value)}
                placeholder={
                  recording ? "Listening…" : "Type your answer here…"
                }
              />
            ) : null}

            {error ? (
              <p
                role="alert"
                className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              >
                {error}
              </p>
            ) : null}
          </CardContent>

          {/* Pinned outside the scroll area: "Send answer" is the one control
              the candidate always needs, so it must never scroll away. */}
          <div className="shrink-0 border-t bg-card px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">
                {hostSpeaking
                  ? "Wait for the question to finish, then answer."
                  : recording
                    ? "Listening… press stop when you're done."
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

                <Button onClick={onSubmit} disabled={busy || answer === ""}>
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
