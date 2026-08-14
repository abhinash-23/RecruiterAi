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
import { VitalsPanel } from "@/features/dashboard/vitals-panel"
import { useCurrentUser } from "@/features/auth/auth-context"
import { ROLE_HOME } from "@/features/auth/types"
import { useInterviewReport } from "@/services/hr"
import { toIntegrityReport } from "@/services/interview"
import { cn } from "@/lib/utils"

function scoreTone(score: number) {
  if (score >= 70) return "text-emerald-600 dark:text-emerald-400"
  if (score >= 40) return "text-amber-600 dark:text-amber-400"
  return "text-destructive"
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
          <Button variant="outline" nativeButton={false} render={<Link to={backHref} />}>
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

  return (
    <>
      <PageHeader
        title={data.candidateName}
        description={`${data.role} · ${data.candidateEmail}`}
        actions={
          <Button variant="outline" nativeButton={false} render={<Link to={backHref} />}>
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
            value={<StatusBadge status={results ? "completed" : "scheduled"} label={data.status} />}
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
              <div className="min-w-56 flex-1">
                <Progress value={results.overallScore} />
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
                          <span className="text-sm tabular-nums text-muted-foreground">
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

            <TabsContent value="questions" className="pt-4">
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
