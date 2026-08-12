import * as React from "react"
import { Link, useParams } from "react-router-dom"
import { format } from "date-fns"
import {
  ArrowLeft,
  Ban,
  FileText,
  Loader2,
  MessageSquare,
  Volume2,
  VolumeX,
} from "lucide-react"

import { PageHeader } from "@/components/shared/page-header"
import { StatusBadge } from "@/components/shared/status-badge"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
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

/** `mm:ss`, for the candidate's remaining time. */
function clock(totalSeconds: number) {
  const minutes = Math.floor(Math.max(0, totalSeconds) / 60)
  const seconds = Math.max(0, totalSeconds) % 60
  return `${minutes}:${String(seconds).padStart(2, "0")}`
}

/** One label/value pair in the strip under the title. */
function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-xs whitespace-nowrap text-muted-foreground">
        {label}
      </span>
      <span className="text-sm font-medium tabular-nums">{value}</span>
    </div>
  )
}

/**
 * The state of the *feed*, which is not the state of the interview: a candidate
 * can be mid-sitting while their stream is between reconnects. Kept separate
 * from the interview's own status badge for exactly that reason.
 */
function FeedPill({ status }: { status: LiveRelayStatus }) {
  const live = status === "live"
  const pending =
    status === "connecting" || status === "waiting" || status === "reconnecting"

  const tone = live
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
            live ? "bg-red-500" : pending ? "bg-amber-500" : "bg-muted-foreground/50"
          )}
        />
      </span>
      {label}
    </span>
  )
}

/**
 * The candidate's camera, with the feed's state drawn over it.
 *
 * The element is fed by `MediaSource` from the relay hook, so it takes the
 * hook's own ref rather than a stream — and it stays **mounted through every
 * state**, because the player attaches to it the moment bytes arrive. Rendering
 * it only when the feed is live would mean there was no element to attach to at
 * the one instant it mattered.
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

  React.useEffect(() => {
    if (videoRef.current) videoRef.current.muted = muted
  }, [muted, videoRef])

  return (
    <div className="flex flex-col gap-2">
      {/* Capped in height, not just by aspect ratio: at full width a 16:9 box
          is tall enough on a laptop to push the vitals entirely below the fold,
          which is the one thing a monitoring screen must not do. */}
      <div className="relative aspect-video max-h-[52vh] w-full overflow-hidden rounded-xl bg-black">
        <video
          ref={videoRef}
          playsInline
          controls
          className="size-full object-contain"
        />

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

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="outline" size="sm" onClick={() => setMuted(!muted)}>
          {muted ? <VolumeX /> : <Volume2 />}
          {muted ? "Turn on sound" : "Mute"}
        </Button>
        {/* Said plainly, because it sets what a recruiter should expect of it:
            this is the candidate's recording relayed through the server, so it
            runs a second or two behind and it works on any network the
            interview itself works on. "Live", never "real-time". */}
        <p className="text-xs text-muted-foreground">
          Live, a second or two behind — relayed from the candidate&rsquo;s
          recording.
        </p>
      </div>
    </div>
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

  return (
    <div className="flex max-h-128 flex-col overflow-y-auto">
      {/* Newest first: a recruiter joining mid-sitting cares about what was just
          said, not about scrolling to find it. Sorted by `index` upstream, since
          `at` is null on snapshots the server rebuilt after a restart. */}
      {[...progress.exchanges].reverse().map((exchange, position) => (
        <div key={exchange.index}>
          {position > 0 ? <Separator /> : null}
          <div className="flex flex-col gap-2 py-3">
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-medium">{exchange.question}</p>
              <Badge variant="secondary" className="shrink-0 tabular-nums">
                {exchange.index + 1}
              </Badge>
            </div>

            {/* The situation, when the question had one. Above the answer and
                visibly apart from it: "B. Ask a co-worker" is unreadable without
                knowing what was being asked about. */}
            {exchange.scenario ? (
              <p className="border-l-2 pl-2.5 text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground">
                {exchange.scenario}
              </p>
            ) : null}

            {exchange.round ? (
              <p className="text-[11px] text-muted-foreground">{exchange.round}</p>
            ) : null}

            {/* Set apart from the question rather than sitting under it in grey:
                the two ran together when an answer was a single short phrase. */}
            <p className="rounded-lg bg-muted/50 px-2.5 py-1.5 text-sm whitespace-pre-wrap">
              {exchange.answer || (
                <span className="text-muted-foreground">No answer given.</span>
              )}
            </p>
          </div>
        </div>
      ))}
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

  const reportHref = `${home}/results/${interviewId}`

  return (
    <>
      <PageHeader
        title={row.candidateName}
        description={`${row.role} · ${row.candidateEmail}`}
        actions={backButton}
      />

      {/* A strip rather than a card of stacked facts: this is state to glance
          at, and a full panel of it cost the vitals their place on screen. */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border bg-card px-4 py-2.5">
        <FeedPill status={live.status} />
        <StatusBadge
          status={badgeStatus(row.status)}
          label={STATUS_LABEL[row.status] ?? row.status}
        />
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

      {/*
        Three columns: the readings, the candidate, the conversation — with
        what's being asked *now* directly under the face, which is where a
        recruiter looks when they want to know how a question is landing.

        Everything a sitting reports is on one screen with nothing to scroll
        between, which is the whole point of watching live rather than reading
        the report afterwards.
      */}
      <div className="grid items-start gap-4 xl:grid-cols-3">
        <Card>
          <CardHeader className="pb-0">
            <CardTitle className="text-base">Vitals</CardTitle>
            <CardDescription>
              From sampled webcam frames. Readings marked estimated are derived
              from the signal, not measured.
            </CardDescription>
          </CardHeader>
          <CardContent className="py-4">
            {!hasVitals ? (
              <p className="text-sm text-muted-foreground">
                No readings yet. Vitals need the candidate&rsquo;s camera on and
                enough frames processed to find a pulse, which takes a little
                while after they begin.
              </p>
            ) : vitalsWarm ? (
              <VitalsPanel report={vitalsPayload} />
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

        {/* Middle: the candidate, and what they're being asked right now.
            `order-first` below `xl`: stacked on a phone the video has to come
            first — it is the reason the page exists — but on a wide screen the
            readings belong on the left, where a column is read from. */}
        <div className="flex flex-col gap-4 max-xl:order-first">
          <Card>
            <CardContent className="py-4">
              <LiveVideo
                videoRef={live.videoRef}
                status={live.status}
                message={live.message}
              />
            </CardContent>
          </Card>

          {/* Under the face, which is where a recruiter looks when they want to
              know how a question is landing. */}
          <Card>
            <CardHeader className="pb-0">
              <CardTitle className="text-base">Now asking</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 py-4">
              {progress?.currentQuestion ? (
                <>
                  {/* The situation first and set apart, then the question — the
                      same order and the same separation the candidate sees on
                      their own screen. */}
                  {progress.scenario ? (
                    <p className="rounded-lg border border-l-2 border-l-emerald-500/60 bg-muted/40 px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap">
                      {progress.scenario}
                    </p>
                  ) : null}
                  <p className="text-sm font-medium whitespace-pre-wrap">
                    {progress.currentQuestion}
                  </p>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs text-muted-foreground">
                      {progress.currentRound ?? ""}
                    </span>
                    {progress.totalQuestions ? (
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {(progress.currentIndex ?? progress.answered) + 1} of{" "}
                        {progress.totalQuestions}
                      </span>
                    ) : null}
                  </div>
                  {progress.totalQuestions ? (
                    <Progress
                      value={(progress.answered / progress.totalQuestions) * 100}
                    />
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
        </div>

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
