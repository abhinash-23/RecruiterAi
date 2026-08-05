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
  useLiveViewer,
  type LiveInsight,
  type LiveViewerStatus,
} from "@/services/live"
import { cn } from "@/lib/utils"

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
 * can be mid-sitting with no peer connection to us at all. Kept separate from
 * the interview's own status badge for exactly that reason.
 */
function FeedPill({ status }: { status: LiveViewerStatus }) {
  const live = status === "live"
  const pending = status === "connecting" || status === "waiting"

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
 * The candidate's camera, with the connection's state drawn over it.
 *
 * Starts **muted**, with an explicit control to turn sound on: browsers refuse
 * to autoplay audio without a gesture on the element itself, and a feed that
 * silently fails to start reads as a broken connection rather than a blocked
 * one. `controls` stays on for volume and fullscreen.
 */
function LiveVideo({
  stream,
  status,
  message,
}: {
  stream: MediaStream | null
  status: string
  message: string | null
}) {
  const videoRef = React.useRef<HTMLVideoElement | null>(null)
  const [muted, setMuted] = React.useState(true)

  React.useEffect(() => {
    const element = videoRef.current
    if (!element) return
    // Assigning null too is deliberate: it releases the old tracks when the
    // candidate disconnects, instead of leaving their last frame frozen there.
    element.srcObject = stream
  }, [stream])

  React.useEffect(() => {
    if (videoRef.current) videoRef.current.muted = muted
  }, [muted])

  return (
    <div className="flex flex-col gap-2">
      {/* Capped in height, not just by aspect ratio: at full width a 16:9 box
          is tall enough on a laptop to push the vitals entirely below the fold,
          which is the one thing a monitoring screen must not do. */}
      <div className="relative aspect-video max-h-[52vh] w-full overflow-hidden rounded-xl bg-black">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          controls
          className="size-full object-contain"
        />

        {status !== "live" ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/80 p-6 text-center">
            {status === "unavailable" ? (
              <Ban className="size-6 text-amber-400" />
            ) : (
              <Loader2 className="size-6 animate-spin text-white/70" />
            )}
            <p className="max-w-md text-sm text-white/90">
              {message ??
                (status === "waiting"
                  ? "Waiting for the candidate to start."
                  : "Connecting to the candidate…")}
            </p>
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="outline" size="sm" onClick={() => setMuted(!muted)}>
          {muted ? <VolumeX /> : <Volume2 />}
          {muted ? "Turn on sound" : "Mute"}
        </Button>
        <p className="text-xs text-muted-foreground">
          Peer-to-peer from the candidate&rsquo;s browser — not through the server.
        </p>
      </div>
    </div>
  )
}

/** Questions and answers as the candidate gives them. */
function LiveExchanges({
  insight,
  connected,
  answered,
}: {
  insight: LiveInsight | null
  connected: boolean
  answered: number | null
}) {
  if (!insight) {
    return (
      <div className="flex flex-col gap-2 py-2">
        <p className="text-sm text-muted-foreground">
          {connected
            ? "Nothing answered yet — questions appear here as the candidate works through them."
            : "Answers arrive over the same direct connection as the video, so they need it to be established."}
        </p>
        {answered !== null && answered > 0 ? (
          <p className="text-sm">
            The server reports{" "}
            <span className="font-medium tabular-nums">{answered}</span> answered
            so far. The full transcript, with scores, is on the report once they
            finish.
          </p>
        ) : null}
      </div>
    )
  }

  if (insight.exchanges.length === 0) {
    return (
      <p className="py-2 text-sm text-muted-foreground">
        No answers yet — the candidate is on their first question.
      </p>
    )
  }

  return (
    <div className="flex max-h-128 flex-col overflow-y-auto">
      {/* Newest first: a recruiter joining mid-sitting cares about what was
          just said, not about scrolling to find it. */}
      {[...insight.exchanges].reverse().map((exchange, index) => (
        <div key={exchange.questionIndex}>
          {index > 0 ? <Separator /> : null}
          <div className="flex flex-col gap-2 py-3">
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-medium">{exchange.question}</p>
              <Badge variant="secondary" className="shrink-0 tabular-nums">
                {exchange.questionIndex + 1}
              </Badge>
            </div>
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
      {/* No scores: they are assigned server-side and only reach a staff read
          once the sitting is finished, so showing a blank column would imply
          the answers had been marked zero. */}
    </div>
  )
}

/**
 * Watching one interview as it happens: video and audio, the candidate's
 * answers, and their vitals.
 *
 * Three independent sources, and each degrades on its own:
 *
 *  - **Media** is peer-to-peer WebRTC. Best-effort by design — a restrictive
 *    network leaves it unable to connect, and the recording is the fallback.
 *  - **Questions and answers** ride the same peer connection, because no
 *    server endpoint exposes them mid-sitting (`get-results` returns
 *    `results: null` until the candidate finishes).
 *  - **Vitals** prefer the readings the candidate relays, and otherwise poll
 *    `GET /api/vitals/report/{session_id}` — the one of the three that survives
 *    a failed peer connection.
 */
export function LiveInterviewPage() {
  const { interviewId } = useParams<{ interviewId: string }>()
  const user = useCurrentUser()

  const { data: row, isLoading } = useLiveInterviewRow(interviewId)
  const live = useLiveViewer({ interviewId, enabled: Boolean(row) })
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

  const insight = live.insight
  /**
   * The polled report wins where it answers: it is the full summary — frame
   * count, blood pressure, the `estimated_only` flags the panel must label —
   * whereas a relayed frame carries only that frame's reading, and would render
   * a heart rate above "0 frames processed". The relay is the fallback, for a
   * deployment that refuses a staff token on the report endpoint.
   *
   * `raw` either way: the panel parses the server's own snake_case payload.
   */
  const vitalsPayload = polledVitals.data?.raw ?? insight?.vitals ?? null
  const hasVitals = toVitalsReport(vitalsPayload) !== null

  const asked = insight ? insight.position : null
  const total = insight?.totalQuestions ?? null

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
        {asked !== null && total ? (
          <Fact label="Question" value={`${asked} / ${total}`} />
        ) : null}
        {insight ? (
          <Fact label="Time left" value={clock(insight.secondsLeft)} />
        ) : null}
        {row.answered !== null ? (
          <Fact label="Answered" value={row.answered} />
        ) : null}
      </div>

      {/*
        Video top-left, the live conversation in a rail down the right, vitals
        beneath the video. The rail spans both rows so it runs the full height
        of the screen instead of leaving a column of dead space.

        This DOM order is also the right order stacked on a phone — video, then
        what is being asked, then the readings.
      */}
      <div className="grid items-start gap-4 xl:grid-cols-12">
        <Card className="xl:col-span-7">
          <CardContent className="py-4">
            <LiveVideo
              stream={live.stream}
              status={live.status}
              message={live.message}
            />
          </CardContent>
        </Card>

        <div className="flex flex-col gap-4 xl:col-span-5 xl:row-span-2">
          <Card>
            <CardHeader className="pb-0">
              <CardTitle className="text-base">Now asking</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 py-4">
              {insight?.currentQuestion ? (
                <>
                  <p className="text-sm font-medium">{insight.currentQuestion}</p>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs text-muted-foreground">
                      {insight.currentRound ?? ""}
                    </span>
                    {total ? (
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {asked} of {total}
                      </span>
                    ) : null}
                  </div>
                  {total ? (
                    <Progress value={((asked ?? 0) / total) * 100} />
                  ) : null}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {live.status === "live"
                    ? "Waiting for the candidate's client to report its question."
                    : "The current question appears once the direct connection is up."}
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-0">
              <CardTitle className="flex items-center gap-2 text-base">
                <MessageSquare className="size-4 text-muted-foreground" />
                Questions &amp; answers
                {insight && insight.exchanges.length > 0 ? (
                  <Badge variant="secondary" className="tabular-nums">
                    {insight.exchanges.length}
                  </Badge>
                ) : null}
              </CardTitle>
            </CardHeader>
            <CardContent className="py-0 pb-4">
              <LiveExchanges
                insight={insight}
                connected={live.status === "live"}
                answered={row.answered}
              />
            </CardContent>
          </Card>
        </div>

        <Card className="xl:col-span-7">
          <CardHeader className="pb-0">
            <CardTitle className="text-base">Vitals</CardTitle>
            <CardDescription>
              From sampled webcam frames. Readings marked estimated are derived
              from the signal, not measured.
            </CardDescription>
          </CardHeader>
          <CardContent className="py-4">
            {hasVitals ? (
              <VitalsPanel report={vitalsPayload} />
            ) : (
              <p className="text-sm text-muted-foreground">
                No readings yet. Vitals need the candidate&rsquo;s camera on and
                enough frames processed to find a pulse, which takes a little
                while after they begin.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  )
}
