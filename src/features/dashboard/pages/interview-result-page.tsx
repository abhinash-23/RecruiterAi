import { Link, useParams } from "react-router-dom"
import { format } from "date-fns"
import { ArrowLeft } from "lucide-react"

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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { IntegrityPanel } from "@/features/dashboard/integrity-panel"
import { RecordingPanel } from "@/features/dashboard/recording-panel"
import {
  formatPct,
  selectionThreshold,
  selectionThresholdLabel,
} from "@/features/dashboard/selection-threshold"
import { VitalsPanel } from "@/features/dashboard/vitals-panel"
import { useCurrentUser } from "@/features/auth/auth-context"
import { ROLE_HOME } from "@/features/auth/types"
import { scoreTone } from "@/features/dashboard/score-tone"
import { useInterviewReport } from "@/services/hr"
import { toIntegrityReport } from "@/services/interview"
import { cn } from "@/lib/utils"

/**
 * Puts the missing spaces back into a stitched transcript.
 *
 * The spoken introduction reaches the report as the caption channel wrote it,
 * and that channel emits a few words at a time with no separator between
 * fragments. Joined end to end it produces sentences welded together:
 *
 *     …recruiter a based application.Yes.Don't have any interest on that.
 *
 * Which reads as a candidate who cannot write, on the one part of a report that
 * is their own voice describing themselves. It is a rendering artifact of how
 * the text was assembled, not something anybody said.
 *
 * **Whitespace only, and deliberately timid about it.** A space goes in after a
 * full stop, question mark or exclamation only where a lowercase word of at
 * least two letters runs straight into a capitalised one — the one pattern that
 * cannot be anything but a lost sentence break. That leaves initialisms alone
 * (`U.S.A`, whose letters are capitals), decimals alone (`1.5`, a digit after
 * the point), and every word in the transcript exactly as it arrived. Nothing
 * here rewrites what was said; a report is not the place to improve somebody's
 * answer for them.
 */
function readableTranscript(text: string): string {
  return text.replace(/([a-z0-9]{2})([.?!])([A-Z])/g, "$1$2 $3")
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="shrink-0">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-medium">{value}</p>
    </div>
  )
}

/**
 * The full report for one interview, from `GET /api/get-results/{id}`.
 *
 * The header fields exist from the moment the interview is scheduled; the
 * `results` body is null until the candidate finishes, so the page renders a
 * "not finished yet" state rather than an error for an interview in flight.
 */
export function InterviewResultPage() {
  const { interviewId } = useParams<{ interviewId: string }>()
  const user = useCurrentUser()
  const { data, isLoading, isError } = useInterviewReport(interviewId)

  const backHref = `${ROLE_HOME[user.role]}/results`

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    )
  }

  if (isError || !data) {
    return (
      <Card>
        <CardContent className="flex flex-col items-start gap-3 py-8">
          <p className="font-medium">This report isn&rsquo;t available.</p>
          <p className="text-sm text-muted-foreground">
            The interview may not exist, or it belongs to a colleague — the API
            doesn&rsquo;t distinguish the two.
          </p>
          <Button
            variant="outline"
            nativeButton={false}
            render={<Link to={backHref} />}
          >
            <ArrowLeft />
            Back to results
          </Button>
        </CardContent>
      </Card>
    )
  }

  const { results } = data
  // Asked here because the panel's own "nothing to show" is a `null` render:
  // a backend that predates these counters would otherwise leave an empty card
  // on the page, which reads as a section that failed to load.
  const hasIntegrity = toIntegrityReport(results?.vitalsReport) !== null
  /**
   * The bar in force for this interview.
   *
   * From the **top level** of the report, not from inside `results`: the server
   * resolves it there, which means it is a number before the sitting has
   * finished — and on an interview completed before thresholds were stored, the
   * top level reports the 75 that actually judged it while the stored `results`
   * object has no threshold at all. `results.selectionThresholdPct` is the
   * fallback for a backend that predates the top-level field.
   */
  const thresholdPct =
    data.selectionThresholdPct ?? results?.selectionThresholdPct
  const threshold = selectionThreshold(thresholdPct)

  return (
    <>
      <PageHeader
        title={data.candidateName}
        description={`${data.role} · ${data.candidateEmail}`}
        actions={
          <Button
            variant="outline"
            nativeButton={false}
            render={<Link to={backHref} />}
          >
            <ArrowLeft />
            Back to results
          </Button>
        }
      />

      {/* Flex-wrap rather than a fixed grid: a 7-column grid clipped the longer
          date values at narrow widths. */}
      <Card>
        <CardContent className="flex flex-wrap items-start gap-x-8 gap-y-4 py-4">
          <Fact
            label="Status"
            value={
              <StatusBadge
                status={results ? "completed" : "scheduled"}
                label={data.status}
              />
            }
          />
          <Fact
            label="Invited"
            value={format(new Date(data.createdAt), "d MMM yyyy · HH:mm")}
          />
          <Fact
            label="Link expires"
            value={
              data.linkExpiresAt
                ? format(new Date(data.linkExpiresAt), "d MMM yyyy · HH:mm")
                : `${data.linkExpiryHours}h window`
            }
          />
          <Fact
            label="Consent"
            // An object, not a boolean — truthiness would read a refusal as
            // consent, so check the flag inside it.
            value={
              data.consent === null
                ? "Not recorded"
                : data.consent.given
                  ? "Given"
                  : "Refused"
            }
          />
          <Fact
            label="Scheduled by"
            value={data.createdBy?.fullName ?? "System / API"}
          />
          {results ? (
            <>
              <Fact
                label="Answered"
                value={`${results.answered} / ${results.totalQuestions}`}
              />
              <Fact
                label="Outcome"
                value={
                  <StatusBadge
                    status={results.selected ? "completed" : "disabled"}
                    label={results.selected ? "Selected" : "Not selected"}
                  />
                }
              />
            </>
          ) : null}

          {/* Outside the `results` branch: the bar exists from the moment the
              interview is created, and a pending one is exactly when someone
              wants to know what it will have to clear. Beside the outcome once
              there is one, because it is what produced it — a 78 that reads Not
              selected is baffling until the bar is shown to have been 80. */}
          <Fact
            label={results ? "Selection bar" : "Bar to clear"}
            value={selectionThresholdLabel(thresholdPct)}
          />
        </CardContent>
      </Card>

      {!results ? (
        <Card>
          <CardContent className="py-10 text-center">
            <p className="font-medium">No report yet.</p>
            <p className="mt-1 text-sm text-muted-foreground">
              The candidate hasn&rsquo;t finished this interview. Scores appear
              here as soon as they submit.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Overall score</CardTitle>
              <CardDescription>
                {results.completedAt
                  ? `Completed ${format(new Date(results.completedAt), "d MMM yyyy · HH:mm")}`
                  : "Completed"}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center gap-6">
              <span
                className={cn(
                  "text-5xl leading-none font-semibold tabular-nums",
                  scoreTone(results.overallScore)
                )}
              >
                {results.overallScore}
                <span className="text-xl text-muted-foreground">/100</span>
              </span>
              <div className="flex min-w-56 flex-1 flex-col gap-1.5">
                {/* The bar drawn *on* the track, so the verdict is visible as a
                    distance rather than as two numbers to compare. */}
                <div className="relative">
                  <Progress value={results.overallScore} />
                  <span
                    aria-hidden="true"
                    className="absolute top-1/2 h-3 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground/60"
                    style={{ left: `${threshold.value}%` }}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  {results.selected ? "Cleared" : "Short of"} the{" "}
                  <span className="font-medium text-foreground tabular-nums">
                    {formatPct(threshold.value)}%
                  </span>{" "}
                  selection bar
                  {threshold.isDefault
                    ? /* Only reachable against a backend that sends no
                         threshold at all: everything since reports the resolved
                         bar, so there is nothing to infer. Worded as an
                         assumption, because that is what it is. */
                      " — the platform default, which is what judged interviews from before the bar could be set."
                    : " this interview was created with."}
                </p>
              </div>
            </CardContent>
          </Card>

          {/* On the page itself rather than behind the Vitals tab. How much of
              the sitting the camera actually saw qualifies the score directly
              above it, and a reader deciding on a candidate shouldn't have to
              know to go looking for it — a tab nobody opens is the same as a
              figure nobody sees.

              `@container` so the three tiles size to this card rather than to
              the window. Renders nothing on a backend that predates the
              counters, hence the guard: an empty card is worse than none. */}
          {hasIntegrity ? (
            <Card>
              <CardContent className="@container py-4">
                <IntegrityPanel report={results.vitalsReport} />
              </CardContent>
            </Card>
          ) : null}

          <Tabs defaultValue="rounds">
            <TabsList>
              <TabsTrigger value="rounds">Rounds</TabsTrigger>
              <TabsTrigger value="questions">
                Questions ({results.questionDetails.length})
              </TabsTrigger>
              <TabsTrigger value="vitals">Vitals</TabsTrigger>
              <TabsTrigger value="recording">Recording</TabsTrigger>
            </TabsList>

            <TabsContent value="rounds" className="pt-4">
              <Card>
                <CardContent className="flex flex-col gap-4 py-4">
                  {results.roundBreakdown.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No per-round breakdown was returned.
                    </p>
                  ) : (
                    results.roundBreakdown.map((round) => (
                      <div key={round.round} className="flex flex-col gap-1.5">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="font-medium">{round.round}</span>
                          <span className="text-sm text-muted-foreground tabular-nums">
                            {round.score} / {round.outOf} ·{" "}
                            {Math.round(round.percentage)}%
                          </span>
                        </div>
                        <Progress value={round.percentage} />
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="questions" className="flex flex-col gap-4 pt-4">
              {/* **The spoken self-introduction, above the scored questions and
                  deliberately not among them.**

                  The voice interview opens by inviting a short introduction, and
                  the candidate is told plainly on screen that it is not scored —
                  they answer "tell me about yourself" quite differently, and
                  better, for knowing that. It reaches the report as its own
                  `introduction` field for the same reason, and this card keeps
                  the distinction the candidate was promised: dropped into the
                  list below it would read as a question that scored nothing out
                  of one, and a recruiter would mark them down for a warm-up.

                  Its own card rather than a row inside theirs, so the boundary
                  is visible at a glance rather than inferred from a missing
                  badge. Absent entirely on typed interviews, and on spoken ones
                  from before the phase existed — no empty state, because a
                  report with no introduction is not missing anything. */}
              {results.introduction ? (
                <Card>
                  <CardContent className="flex flex-col gap-2 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <p className="font-medium">Tell me about yourself</p>
                      {/* Where the score badge sits on every card below. The
                          reader's eye already goes here for a number, so this is
                          the one place saying "there isn't one" actually lands. */}
                      <Badge variant="outline" className="shrink-0">
                        Introduction · not scored
                      </Badge>
                    </div>
                    <p className="text-sm leading-relaxed whitespace-pre-wrap text-muted-foreground">
                      {readableTranscript(results.introduction)}
                    </p>
                    <p className="text-xs text-muted-foreground/80">
                      Spoken at the start of the interview, before the
                      questions. It carries no marks and is not counted in the
                      score above.
                    </p>
                  </CardContent>
                </Card>
              ) : null}

              <Card>
                <CardContent className="flex flex-col gap-0 py-0">
                  {results.questionDetails.length === 0 ? (
                    <p className="py-6 text-sm text-muted-foreground">
                      No answers were recorded.
                    </p>
                  ) : (
                    results.questionDetails.map((entry, index) => (
                      <div key={index}>
                        {index > 0 ? <Separator /> : null}
                        <div className="flex flex-col gap-2 py-4">
                          <div className="flex items-start justify-between gap-3">
                            {/* Pre-wrapped: a question can carry its own line
                                breaks, and a blank line in it should stay one. */}
                            <p className="font-medium whitespace-pre-wrap">
                              {entry.question}
                            </p>
                            {entry.score !== null ? (
                              <Badge
                                variant="secondary"
                                className="shrink-0 tabular-nums"
                              >
                                {entry.score}
                              </Badge>
                            ) : null}
                          </div>

                          {/* The situation the question was about, between the
                              prompt and the answer — the order it was read in.
                              Its own block rather than merged into the question,
                              so a scored prompt stays the bold line. */}
                          {entry.scenario ? (
                            <p className="border-l-2 pl-3 text-sm leading-relaxed whitespace-pre-wrap text-muted-foreground">
                              {entry.scenario}
                            </p>
                          ) : null}

                          <p className="text-sm whitespace-pre-wrap text-muted-foreground">
                            {entry.answer || "No answer given."}
                          </p>
                          {entry.feedback ? (
                            <p className="rounded-lg bg-muted/50 px-3 py-2 text-xs">
                              {entry.feedback}
                            </p>
                          ) : null}
                        </div>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="vitals" className="pt-4">
              <Card>
                {/* `@container` so the vitals grid sizes to the card rather than
                    to the window. The integrity block used to sit above these
                    readings; it is on the page now, and duplicating it here
                    would only make the page's own copy look like a summary of
                    something more detailed further down. */}
                <CardContent className="@container py-4">
                  <VitalsPanel report={results.vitalsReport} />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="recording" className="pt-4">
              <Card>
                <CardContent className="py-4">
                  {/* Keyed on the interview, not on a recording id: the report
                      has never carried one, and the playback route resolves the
                      sitting's latest recording from this alone. */}
                  <RecordingPanel interviewId={interviewId} />
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </>
      )}
    </>
  )
}
