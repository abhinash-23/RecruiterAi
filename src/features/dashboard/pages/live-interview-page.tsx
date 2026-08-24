import * as React from "react"
import { Link, useParams } from "react-router-dom"
import { format } from "date-fns"
import {
  Activity,
  ArrowLeft,
  Ban,
  ChevronRight,
  FileText,
  Loader2,
  Maximize2,
  MessageSquare,
  Minimize2,
  Volume2,
  VolumeX,
} from "lucide-react"

import { PageHeader } from "@/components/shared/page-header"
import { StatusBadge } from "@/components/shared/status-badge"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import { useCurrentUser } from "@/features/auth/auth-context"
import { ROLE_HOME } from "@/features/auth/types"
import {
  badgeStatus,
  STATUS_LABEL,
} from "@/features/dashboard/interview-status"
import { VitalsPanel } from "@/features/dashboard/vitals-panel"
import { useLiveInterviewRow, useLiveVitals } from "@/services/hr"
import { toVitalsReport } from "@/services/interview"
import {
  useLiveRelay,
  type LiveExchange,
  type LiveProgress,
  type LiveRelayStatus,
} from "@/services/live"
import { cn } from "@/lib/utils"

/**
 * Frames a sitting must have banked before its vitals are worth putting on
 * screen. The candidate's page sends one every three seconds, so this is the
 * first **30 seconds** of the sitting.
 *
 * rPPG reads a pulse from how the image changes *across* frames. With two or
 * three of them the server still returns a number, but it is arithmetic on
 * noise — and a recruiter watching live has no way to tell that from a settled
 * reading. Counting frames rather than running a clock in this page is also
 * what makes it right for a recruiter who joins at minute ten: what matters is
 * how much the reading is built on, not how long they have been watching.
 */
const VITALS_WARMUP_FRAMES = 10

/**
 * Round keys, spelt for people.
 *
 * The relay sends whatever the backend calls the round, and that has been seen
 * both as the wire key (`softskills`) and as a display string (`Psychometrics`).
 * Known keys are given the same names the rest of the product uses; anything
 * unrecognised is passed through with its first letter raised, because the
 * server's own wording is a better guess than any rewriting of it here.
 */
const ROUND_LABEL: Record<string, string> = {
  psychometrics: "Psychometrics",
  softskills: "Soft skills",
  resume: "Résumé",
  jd: "Job description",
  aptitude: "Aptitude",
  technical: "Technical",
}

/** Collapses spelling differences so one round is never two groups. */
function roundKey(round: string | null): string {
  return round ? round.trim().toLowerCase().replace(/[^a-z0-9]/g, "") : ""
}

function roundLabel(round: string | null): string {
  if (!round) return "Unlabelled"
  const key = roundKey(round)
  return ROUND_LABEL[key] ?? round.charAt(0).toUpperCase() + round.slice(1)
}

/** `mm:ss`, for the candidate's remaining time. */
function clock(totalSeconds: number) {
  const minutes = Math.floor(Math.max(0, totalSeconds) / 60)
  const seconds = Math.max(0, totalSeconds) % 60
  return `${minutes}:${String(seconds).padStart(2, "0")}`
}

/**
 * One label/value pair in the strip under the title. Stacked, not inline: five
 * inline pairs on one line read as a sentence, and a recruiter glancing for
 * "time left" wants the values on a single baseline they can find twice.
 */
function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-[11px] leading-none tracking-wide whitespace-nowrap text-muted-foreground uppercase">
        {label}
      </span>
      <span className="truncate text-sm leading-tight font-medium tabular-nums">
        {value}
      </span>
    </div>
  )
}

/**
 * The state of the *feed*, which is not the state of the interview: a candidate
 * can be mid-sitting while their stream is between reconnects. Kept separate
 * from the interview's own status badge for exactly that reason.
 *
 * `onDark` is the same pill drawn over the video. The themed tones below are
 * picked against `bg-card` — `text-red-700` on black is barely legible — so the
 * overlay copy carries its own scrim and white text rather than reusing them.
 */
function FeedPill({
  status,
  onDark = false,
}: {
  status: LiveRelayStatus
  onDark?: boolean
}) {
  const live = status === "live"
  const pending =
    status === "connecting" || status === "waiting" || status === "reconnecting"

  const tone = onDark
    ? "border-white/15 bg-black/55 text-white backdrop-blur-sm"
    : live
      ? "border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-400"
      : pending
        ? "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-400"
        : "border-transparent bg-muted text-muted-foreground"

  const label = live
    ? "Live"
    : status === "waiting"
      ? "Waiting"
      : status === "connecting"
        ? "Connecting"
        : status === "reconnecting"
          ? "Reconnecting"
          : status === "ended"
            ? "Ended"
            : "No feed"

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium",
        tone
      )}
    >
      <span className="relative flex size-2" aria-hidden>
        {live ? (
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-red-500 opacity-75" />
        ) : null}
        <span
          className={cn(
            "relative inline-flex size-2 rounded-full",
            live
              ? "bg-red-500"
              : pending
                ? "bg-amber-500"
                : onDark
                  ? "bg-white/50"
                  : "bg-muted-foreground/50"
          )}
        />
      </span>
      {label}
    </span>
  )
}

/** The player's own chrome — one tone for every button drawn over the picture. */
const OVERLAY_BUTTON =
  "border-white/15 bg-black/45 text-white backdrop-blur-sm hover:bg-black/70 hover:text-white"

/**
 * The candidate's camera, with the feed's state drawn over it.
 *
 * The element is fed by `MediaSource` from the relay hook, so it takes the
 * hook's own ref rather than a stream — and it stays **mounted through every
 * state**, because the player attaches to it the moment bytes arrive. Rendering
 * it only when the feed is live would mean there was no element to attach to at
 * the one instant it mattered.
 *
 * **No native `controls`.** They drew a seek bar under a stream that cannot be
 * seeked — the buffer is trimmed to the last 30 seconds of played video and the
 * element is nudged back to the live edge whenever it drifts — so every control
 * on that bar either did nothing or fought the player, and it sat across the
 * bottom of the picture as a black band. What a recruiter needs is sound and a
 * bigger picture; those are the two buttons here.
 *
 * Starts **muted**, with an explicit control for sound: browsers refuse to
 * autoplay audio without a gesture on the element itself, and a feed that
 * silently fails to start reads as a broken connection rather than a blocked one.
 */
function LiveVideo({
  videoRef,
  status,
  message,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>
  status: LiveRelayStatus
  message: string | null
}) {
  const [muted, setMuted] = React.useState(true)
  const shellRef = React.useRef<HTMLDivElement | null>(null)
  const [fullscreen, setFullscreen] = React.useState(false)

  /**
   * Re-applied on every status change, not only when the toggle moves: the relay
   * rebuilds its player on a stream reset and sets `muted = true` itself, which
   * would otherwise leave this button reading "Mute" over a silent feed.
   */
  React.useEffect(() => {
    if (videoRef.current) videoRef.current.muted = muted
  }, [muted, status, videoRef])

  // Escape exits fullscreen without going through the button, so the icon is
  // driven by the event rather than by whichever control was last pressed.
  React.useEffect(() => {
    const sync = () =>
      setFullscreen(document.fullscreenElement === shellRef.current)
    document.addEventListener("fullscreenchange", sync)
    return () => document.removeEventListener("fullscreenchange", sync)
  }, [])

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined)
    } else {
      // The shell, not the `<video>`: fullscreening the element alone would take
      // the picture and leave the feed's state and the sound button behind.
      void shellRef.current?.requestFullscreen().catch(() => undefined)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Capped in height, not just by aspect ratio: at full width a 16:9 box
          is tall enough on a laptop to push the vitals entirely below the fold,
          which is the one thing a monitoring screen must not do. The cap is
          lifted in fullscreen, where the box *is* the screen. */}
      <div
        ref={shellRef}
        className="relative aspect-video max-h-[56vh] w-full overflow-hidden rounded-xl bg-black [&:fullscreen]:aspect-auto [&:fullscreen]:max-h-none [&:fullscreen]:rounded-none"
      >
        <video ref={videoRef} playsInline className="size-full object-contain" />

        {/* Scrims rather than solid bars: the chrome has to stay legible over a
            bright frame without cropping the picture it sits on. */}
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 bg-linear-to-b from-black/55 to-transparent p-3 pb-8">
          <FeedPill status={status} onDark />
        </div>

        <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-linear-to-t from-black/60 to-transparent p-3 pt-8">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setMuted(!muted)}
            className={OVERLAY_BUTTON}
          >
            {muted ? <VolumeX /> : <Volume2 />}
            {muted ? "Turn on sound" : "Mute"}
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            onClick={toggleFullscreen}
            aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"}
            className={OVERLAY_BUTTON}
          >
            {fullscreen ? <Minimize2 /> : <Maximize2 />}
          </Button>
        </div>

        {/* Last, so it covers the chrome as well as the picture: none of those
            controls does anything while there is nothing to control. */}
        {status !== "live" ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/80 p-6 text-center">
            {status === "unavailable" || status === "ended" ? (
              <Ban className="size-6 text-amber-400" />
            ) : (
              <Loader2 className="size-6 animate-spin text-white/70" />
            )}
            <p className="max-w-md text-sm text-white/90">
              {message ??
                (status === "waiting"
                  ? "Waiting for the candidate to start."
                  : "Connecting to the live feed…")}
            </p>
          </div>
        ) : null}
      </div>

      {/* Said plainly, because it sets what a recruiter should expect of it:
          this is the candidate's recording relayed through the server, so it
          runs a second or two behind and it works on any network the interview
          itself works on. "Live", never "real-time". */}
      <p className="px-0.5 text-xs text-muted-foreground">
        Live, a second or two behind — relayed from the candidate&rsquo;s
        recording. Sound stays off until you turn it on.
      </p>
    </div>
  )
}

/**
 * What the candidate is being asked at this moment: the first thing in the
 * conversation half of the page, above everything they have already answered.
 */
function NowAsking({ progress }: { progress: LiveProgress | null }) {
  const asked =
    progress && progress.currentQuestion
      ? (progress.currentIndex ?? progress.answered) + 1
      : null

  return (
    /* Ringed in the accent rather than carrying a heavier border: this is the
       one card on the page whose contents change under the reader, and it has
       to be findable again at a glance after they look back at the face. */
    <Card className="ring-brand-blue/25">
      <CardHeader className="pb-0">
        <CardTitle className="text-base">Now asking</CardTitle>
        {/* The count belongs beside the heading, not below the question, where
            it read as part of the answer. `CardAction` rather than a flex row,
            because that slot is what turns the header's own grid into
            `1fr auto` — a `flex-row` on it fights the `grid` already there. */}
        {progress?.totalQuestions && asked !== null ? (
          <CardAction className="text-xs text-muted-foreground tabular-nums">
            Question {asked} of {progress.totalQuestions}
          </CardAction>
        ) : null}
      </CardHeader>

      {/* One column, the width of the card. The scenario and the question are
          the content here and they get all of it; how far through they are is a
          single line ruled off at the foot, which is the one place a progress bar
          can run the full width without reading as the main event. */}
      <CardContent className="flex flex-col gap-3 py-4">
        {progress?.currentQuestion ? (
          <>
            {progress.currentRound ? (
              <Badge variant="secondary" className="self-start font-normal">
                {roundLabel(progress.currentRound)}
              </Badge>
            ) : null}

            {/* The situation first and set apart, then the question — the same
                order and the same separation the candidate sees on their own
                screen. */}
            {progress.scenario ? (
              <p className="rounded-lg border border-l-2 border-l-emerald-500/60 bg-muted/40 px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap">
                {progress.scenario}
              </p>
            ) : null}

            <p className="text-base leading-snug font-medium whitespace-pre-wrap">
              {progress.currentQuestion}
            </p>

            {progress.totalQuestions ? (
              <div className="mt-1 flex items-center gap-3 border-t pt-3">
                <span className="shrink-0 text-[11px] tracking-wide text-muted-foreground uppercase">
                  Progress
                </span>
                <Progress
                  value={(progress.answered / progress.totalQuestions) * 100}
                  className="flex-1"
                />
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {progress.answered} of {progress.totalQuestions} answered
                </span>
              </div>
            ) : null}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            {progress
              ? /* A snapshot with no current question means every one is
                   answered — `current_index` is null once they are done. */
                "Every question has been answered. The report follows when they submit."
              : "The current question appears with the server's first progress report."}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

/** One round's answers, and how far into the sitting that round runs. */
interface RoundGroup {
  key: string
  label: string
  /** Newest first, like the groups themselves. */
  exchanges: LiveExchange[]
  /** The highest question index in the group — which is how current it is. */
  latest: number
}

/**
 * The answers so far, split into the rounds they belong to.
 *
 * An interview is built from rounds (psychometrics, soft skills, résumé, JD), and
 * the flat list printed the round's name on all thirty cards — the same word
 * repeated down the column, saying nothing about any single answer. Grouped, the
 * name is stated once and carries the block under it.
 *
 * **Most recent first, at both levels.** The round the candidate is in sits at
 * the top and their last answer is the first card in it, which is what someone
 * who just opened the page is looking for. `exchanges` arrive sorted ascending
 * by `index`, so each group is built in order and then reversed.
 */
function groupByRound(exchanges: LiveExchange[]): RoundGroup[] {
  const groups = new Map<string, RoundGroup>()

  for (const exchange of exchanges) {
    const key = roundKey(exchange.round)
    const group = groups.get(key)
    if (group) {
      group.exchanges.push(exchange)
      group.latest = Math.max(group.latest, exchange.index)
    } else {
      groups.set(key, {
        key,
        label: roundLabel(exchange.round),
        exchanges: [exchange],
        latest: exchange.index,
      })
    }
  }

  return [...groups.values()]
    .map((group) => ({ ...group, exchanges: [...group.exchanges].reverse() }))
    .sort((a, b) => b.latest - a.latest)
}

/**
 * One answered question, full width: the question on its own line, the answer on
 * its own line under it.
 *
 * Not a card in a grid of cards, and not two columns either. Narrow cards turned
 * a scenario into a paragraph six words wide; side by side, a one-line question
 * and a two-word answer left the middle of every row empty. Stacked, each part
 * has the whole page to use and the reading order is the order it happened in.
 */
function ExchangeRow({ exchange }: { exchange: LiveExchange }) {
  return (
    <li className="flex flex-col gap-2 border-b py-3 last:border-b-0">
      <div className="flex items-baseline gap-2.5">
        {/* The question's own number, which is the only thing the row still
            needs to say about where it sits — its round is the heading. */}
        <span className="w-5 shrink-0 text-xs font-medium tabular-nums text-muted-foreground">
          {exchange.index + 1}
        </span>
        <p className="min-w-0 text-sm leading-snug font-medium">
          {exchange.question}
        </p>
      </div>

      {/* Indented to the question's own measure and quieter than it: "B. Ask a
          co-worker" is unreadable without knowing what was being asked about,
          but the prompt is still the line to read first. */}
      {exchange.scenario ? (
        <p className="ml-7.5 border-l-2 pl-2.5 text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground">
          {exchange.scenario}
        </p>
      ) : null}

      {/* Set apart from the question rather than sitting under it in grey: the
          two ran together when an answer was a single short phrase. */}
      <p className="ml-7.5 rounded-md bg-muted/50 px-3 py-2 text-sm whitespace-pre-wrap">
        {exchange.answer || (
          <span className="text-muted-foreground">No answer given.</span>
        )}
      </p>
    </li>
  )
}

/**
 * Questions and answers as the candidate gives them.
 *
 * Fed by the relay's own `progress` snapshots, **not** by the candidate's
 * browser. That distinction is the whole point: this used to ride the WebRTC data
 * channel beside the video, so on the networks where a peer connection couldn't
 * form — which was most of them — a recruiter got neither picture nor answers.
 * Now it is JSON on the same socket as the video, which means it also survives a
 * browser that can't decode the stream at all.
 *
 * `answered` from the interviews row is the fallback for the moment before the
 * first snapshot lands, so the panel says something true rather than nothing.
 */
function LiveExchanges({
  progress,
  answered,
  reportHref,
}: {
  progress: LiveProgress | null
  answered: number | null
  reportHref: string
}) {
  /**
   * Which rounds the reader has opened or closed **by hand**, against a default
   * of "the round they are in is open, the ones behind it are folded away".
   *
   * Held as an override rather than as the open set, because the default moves:
   * when a new round starts it becomes the open one and the finished round folds
   * itself. A plain `open={index === 0}` could not do any of this — a progress
   * snapshot lands every second or two, and each one would have slammed shut
   * whatever the reader had just opened.
   */
  const [openOverride, setOpenOverride] = React.useState<
    Record<string, boolean>
  >({})
  /** Ties each fold's button to the panel it opens. */
  const panelId = React.useId()

  /**
   * Records a fold's new state — or forgets it, when the reader has put it back
   * to what it would have done on its own. Dropping it rather than pinning it is
   * what lets a round still fold itself once the sitting moves on.
   */
  const setOpen = (key: string, next: boolean, byDefault: boolean) => {
    setOpenOverride((current) => {
      if (next === byDefault) {
        if (!(key in current)) return current
        const rest = { ...current }
        delete rest[key]
        return rest
      }
      if (current[key] === next) return current
      return { ...current, [key]: next }
    })
  }

  if (!progress) {
    return (
      <div className="flex flex-col items-start gap-3 py-2">
        <p className="text-sm text-muted-foreground">
          Waiting for the server&rsquo;s first progress report — answers appear
          here as the candidate submits them.
        </p>
        {answered !== null && answered > 0 ? (
          <p className="text-sm">
            The interviews list reports{" "}
            <span className="font-medium tabular-nums">{answered}</span> answered
            so far.
          </p>
        ) : null}
        <Button
          variant="outline"
          size="sm"
          nativeButton={false}
          render={<Link to={reportHref} />}
        >
          <FileText />
          Open the report
        </Button>
      </div>
    )
  }

  if (progress.exchanges.length === 0) {
    return (
      <p className="py-2 text-sm text-muted-foreground">
        No answers yet — the candidate is on their first question.
      </p>
    )
  }

  const groups = groupByRound(progress.exchanges)

  return (
    /* One fold per round, and no scroll of its own: the folds are what keep a
       thirty-question sitting from running past the fold, so a second scrollbar
       inside the card would only be a second thing to fight.

       **A button and a panel, not `<details>`.** The element was the obvious
       choice and it is the reason the fold snapped: a browser shows and hides
       `<details>` content itself, from a state nothing can transition, so there
       is no in-between for a duration to apply to. `::details-content` will
       eventually make that animatable and only Chromium implements it today.

       So the panel is a one-row grid whose track runs `0fr → 1fr`, which *is*
       interpolable, with the content clipped inside it — the row grows, and the
       answers slide out from under the heading rather than appearing. The
       button carries the `aria-expanded`/`aria-controls` pair the summary used
       to carry for free. */
    <div className="flex flex-col">
      {groups.map((group, index) => {
        // The round they are on, unless the reader has said otherwise.
        const openByDefault = index === 0
        const open = openOverride[group.key] ?? openByDefault
        const id = `${panelId}-${group.key}`
        return (
          <div key={group.key} className="border-b last:border-b-0">
            <button
              type="button"
              aria-expanded={open}
              aria-controls={id}
              onClick={() => setOpen(group.key, !open, openByDefault)}
              className="flex w-full cursor-pointer items-center gap-2 py-3 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <ChevronRight
                className={cn(
                  "size-4 shrink-0 text-muted-foreground motion-safe:transition-transform motion-safe:duration-300",
                  open && "rotate-90"
                )}
              />
              <h3
                id={`${id}-label`}
                className="text-xs font-semibold tracking-wide uppercase"
              >
                {group.label}
              </h3>
              <Badge variant="secondary" className="tabular-nums">
                {group.exchanges.length}
              </Badge>
              {/* Says what pressing it will do, rather than naming the state. */}
              <span className="ml-auto text-xs text-muted-foreground">
                {open ? "Hide" : "Show answers"}
              </span>
            </button>

            <div
              id={id}
              role="region"
              aria-labelledby={`${id}-label`}
              /* Clipped is not hidden: without this the answers in a shut fold
                 are still read out, and `aria-expanded="false"` on the button
                 above would be describing something a screen reader can walk
                 straight into. */
              inert={!open}
              className={cn(
                "grid motion-safe:transition-[grid-template-rows] motion-safe:duration-300 motion-safe:ease-out",
                open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
              )}
            >
              {/* The clip. It has to be its own element: the grid row is what
                  animates, and whatever it holds must be free to be its full
                  height throughout — otherwise the rows reflow as it opens
                  instead of being revealed. */}
              <div className="overflow-hidden">
                <ul className="flex flex-col border-t pb-1">
                  {group.exchanges.map((exchange) => (
                    <ExchangeRow key={exchange.index} exchange={exchange} />
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )
      })}
      {/* No scores, and the server sends none: they are assigned at
          finish-interview, and a 0 against an unmarked answer would read here as
          a candidate who got it wrong. */}
    </div>
  )
}

/**
 * Watching one interview as it happens: video and audio, the questions and
 * answers, and the candidate's vitals.
 *
 * Everything comes from the server now, over two independent reads that degrade
 * separately:
 *
 *  - **`WSS /api/live-relay/{id}`** carries both the video — the candidate's own
 *    recording bytes, fanned out by the backend — and `progress` snapshots with
 *    the current question and every answer so far. Same socket, but the snapshots
 *    are JSON, so they still arrive on a browser that cannot decode the stream.
 *  - **Vitals** poll `GET /api/vitals/report/{session_id}`.
 *
 * All three used to hang off a peer-to-peer connection that, with public STUN and
 * no TURN relay, never formed on a corporate network — so what a recruiter
 * actually got was "live view unavailable on this network" and an empty page.
 * Nothing here depends on WebRTC any more, and there is no such state to render.
 */
export function LiveInterviewPage() {
  const { interviewId } = useParams<{ interviewId: string }>()
  const user = useCurrentUser()

  const { data: row, isLoading } = useLiveInterviewRow(interviewId)
  const live = useLiveRelay({ interviewId, enabled: Boolean(row) })
  const polledVitals = useLiveVitals(row?.sessionId)

  const home = ROLE_HOME[user.role]
  const backButton = (
    <Button variant="outline" nativeButton={false} render={<Link to={`${home}/live`} />}>
      <ArrowLeft />
      Back to live
    </Button>
  )

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-96 w-full" />
      </div>
    )
  }

  // The row leaves the live list the moment the sitting stops being live —
  // which is precisely when there is a report to read instead.
  if (!row) {
    return (
      <>
        <PageHeader
          title="Not live"
          description="This interview isn't being sat at the moment."
          actions={backButton}
        />
        <Card>
          <CardContent className="flex flex-col items-start gap-3 py-8">
            <p className="font-medium">Nothing to watch here.</p>
            <p className="text-sm text-muted-foreground">
              The candidate has finished, hasn&rsquo;t started, or the interview
              belongs to a colleague — the API doesn&rsquo;t distinguish the last
              case from a missing one.
            </p>
            <Button
              variant="outline"
              nativeButton={false}
              render={<Link to={`${home}/results/${interviewId}`} />}
            >
              <FileText />
              Open the report
            </Button>
          </CardContent>
        </Card>
      </>
    )
  }

  /**
   * `GET /api/vitals/report/{session_id}`, polled — the full summary, including
   * the frame count and the `estimated_only` flags the panel has to label.
   *
   * This used to prefer readings relayed over the peer connection and fall back
   * to the poll. There is no peer connection any more, and the poll was always
   * the better of the two anyway: a relayed frame carried only that frame's
   * reading, which rendered a heart rate above "0 frames processed".
   *
   * `raw` because the panel parses the server's own snake_case payload.
   */
  const progress = live.progress
  const vitalsPayload = polledVitals.data?.raw ?? null
  const vitalsReport = toVitalsReport(vitalsPayload)
  const hasVitals = vitalsReport !== null
  const framesSoFar = vitalsReport?.framesProcessed ?? 0
  const vitalsWarm = framesSoFar >= VITALS_WARMUP_FRAMES
  /* Which markers exist depends on the deployment, so the card that holds them
     is only on the page when the payload has some. */
  const markerCount = Object.keys(vitalsReport?.bloodMarkers ?? {}).length

  const reportHref = `${home}/results/${interviewId}`

  return (
    <>
      <PageHeader
        title={row.candidateName}
        description={`${row.role} · ${row.candidateEmail}`}
        actions={backButton}
      />

      {/* A strip rather than a card of stacked facts: this is state to glance
          at, and a full panel of it cost the vitals their place on screen.
          Ringed like a card rather than bordered, so it reads as the same
          surface as the panels under it. */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-xl bg-card px-4 py-3 ring-1 ring-foreground/10">
        <div className="flex flex-wrap items-center gap-2">
          <FeedPill status={live.status} />
          <StatusBadge
            status={badgeStatus(row.status)}
            label={STATUS_LABEL[row.status] ?? row.status}
          />
        </div>

        {/* The numbers pushed to the far end, so the two badges and the four
            readings are two things to look at rather than six. */}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 sm:ml-auto">
          <Fact label="Started" value={format(new Date(row.createdAt), "HH:mm")} />
          {/* The relay's own count where it has one — it is a second or two old,
              against up to ten for the polled row. */}
          <Fact label="Answered" value={progress?.answered ?? row.answered ?? "—"} />
          {progress?.totalQuestions ? (
            <Fact
              label="Question"
              value={`${(progress.currentIndex ?? progress.answered) + 1} / ${progress.totalQuestions}`}
            />
          ) : null}
          {progress?.secondsLeft !== null && progress?.secondsLeft !== undefined ? (
            <Fact label="Time left" value={clock(progress.secondsLeft)} />
          ) : null}
        </div>
      </div>

      {/*
        The page is two halves now: **the candidate** above — the face and the
        readings, side by side — and **the conversation** below, the question
        they are on and everything they have answered.

        Three equal columns is what made this unreadable. The vitals panel is a
        grid sized by a container query, and in a 440px third it dropped to one
        tile per row: six tiles and a dozen blood markers became a column two
        thousand pixels tall, beside a video squeezed into a third of the width.
        3/5 and 2/5 is the split where the readings lay out two-up and the two
        cards come out very nearly the same height.
      */}
      <div className="grid items-start gap-4 xl:grid-cols-5">
        <Card className="xl:col-span-3">
          <CardContent className="py-4">
            <LiveVideo
              videoRef={live.videoRef}
              status={live.status}
              message={live.message}
            />
          </CardContent>
        </Card>

        {/*
          A wrapper that holds the column open, and a card positioned into it.

          The readings are however tall the deployment's payload makes them, and
          the video is however tall 16:9 comes out at three fifths of the page —
          so whichever is shorter used to leave its column empty, which at six
          readings against a 400px video was a hole the height of the video
          itself. The wrapper contributes no height of its own, so the row is the
          video's; `self-stretch` grows the wrapper to it, and the card fills the
          wrapper exactly and scrolls whatever doesn't fit.
        */}
        <div className="xl:relative xl:col-span-2 xl:self-stretch">
          <Card className="xl:absolute xl:inset-0">
            <CardHeader className="pb-0">
              <CardTitle className="text-base">Vitals</CardTitle>
              <CardDescription>
                Derived from sampled webcam frames — not clinical measurements.
              </CardDescription>
            </CardHeader>
            {/* A column, so the panel can be told to fill it: the tiles stretch
                to the height the video sets, which is what leaves this card
                with nothing to scroll. `overflow-y-auto` stays as the valve for
                a deployment that reports more readings than fit. */}
            <CardContent className="flex min-h-0 flex-1 flex-col overflow-y-auto py-4">
              {!hasVitals ? (
                <p className="text-sm text-muted-foreground">
                  No readings yet. Vitals need the candidate&rsquo;s camera on and
                  enough frames processed to find a pulse, which takes a little
                  while after they begin.
                </p>
              ) : vitalsWarm ? (
                /* Readings only — the blood markers have a card of their own
                   below, where a dozen of them get the width to lay out
                   three-up instead of one per line down a narrow column. */
                <VitalsPanel report={vitalsPayload} section="readings" />
              ) : (
                /* Held back on purpose — see `VITALS_WARMUP_FRAMES`. Shown as a
                   stated wait rather than an empty panel, because a Vitals card
                   with nothing in it reads as broken. */
                <div className="flex flex-col gap-3">
                  <div className="flex items-start gap-3 rounded-xl border p-4">
                    <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-muted-foreground" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium">
                        Readings settle after the first 30 seconds
                      </p>
                      <p className="mt-0.5 text-sm text-muted-foreground">
                        A pulse is derived from how the image changes across many
                        frames. The first few produce a number, but not one worth
                        reading — so it isn&rsquo;t shown.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <Progress
                      value={(framesSoFar / VITALS_WARMUP_FRAMES) * 100}
                      className="flex-1"
                    />
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                      {framesSoFar} / {VITALS_WARMUP_FRAMES} frames
                    </span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* The markers, given the page's width: they are a lab report, and a
          dozen label/value pairs read as a table three columns wide and as a
          queue one column wide. Only when the deployment sends any. */}
      {hasVitals && vitalsWarm && markerCount > 0 ? (
        <Card>
          <CardHeader className="pb-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="size-4 text-muted-foreground" />
              Blood markers
            </CardTitle>
            <CardDescription>
              Estimated from the same webcam signal, not from a blood sample.
            </CardDescription>
          </CardHeader>
          <CardContent className="@container py-4">
            <VitalsPanel report={vitalsPayload} section="markers" />
          </CardContent>
        </Card>
      ) : null}

      {/* The conversation: what is being asked, then what has been answered,
          grouped into its rounds. One block, so the gap above it reads as the
          break between the two halves of the page. */}
      <div className="flex flex-col gap-4">
        <NowAsking progress={progress} />

        <Card>
          <CardHeader className="pb-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <MessageSquare className="size-4 text-muted-foreground" />
              Questions &amp; answers
              {progress && progress.exchanges.length > 0 ? (
                <Badge variant="secondary" className="tabular-nums">
                  {progress.exchanges.length}
                </Badge>
              ) : null}
            </CardTitle>
            {progress && progress.exchanges.length > 1 ? (
              <CardDescription className="text-xs">
                One fold per round, newest answers first. The round they are on
                is open; the rest open on a click.
              </CardDescription>
            ) : null}
          </CardHeader>
          <CardContent className="py-0 pb-4">
            <LiveExchanges
              progress={progress}
              answered={row.answered}
              reportHref={reportHref}
            />
          </CardContent>
        </Card>
      </div>
    </>
  )
}
