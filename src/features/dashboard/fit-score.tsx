import { FileSearch, Loader2 } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { AnalysisFields } from "@/features/dashboard/analysis-fields"
import { scoreTone } from "@/features/dashboard/score-tone"
import { fitRecommendationLabel, type InterviewFit } from "@/services/hr"
import { cn } from "@/lib/utils"

/** A keyword-matching score: the AI analyzer wasn't reachable. */
function isRough(fit: InterviewFit): boolean {
  return fit.analyzerVersion === "keyword_fallback"
}

/**
 * The resume fit in a list row: "82% · Strong fit", "Analysing…" while the
 * background analysis runs, or a dash when there is no score — no resume or
 * job description, created before the feature, or the analysis failed.
 */
export function FitCell({ fit }: { fit: InterviewFit | null }) {
  if (fit?.status === "pending") {
    return (
      <span className="flex items-center gap-1.5 text-xs whitespace-nowrap text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        Analysing…
      </span>
    )
  }
  if (fit?.status !== "analyzed" || fit.score === null) {
    return <span className="text-muted-foreground">—</span>
  }
  return (
    <div className="flex flex-col gap-0.5">
      <span className="whitespace-nowrap">
        <span
          className={cn("font-semibold tabular-nums", scoreTone(fit.score))}
        >
          {fit.score}%
        </span>
        {fit.recommendation ? (
          <span className="text-muted-foreground">
            {" "}
            · {fitRecommendationLabel(fit.recommendation)}
          </span>
        ) : null}
      </span>
      {isRough(fit) ? (
        <span
          className="text-[0.6875rem] whitespace-nowrap text-amber-700 dark:text-amber-400"
          title="Scored by keyword matching because the AI analyzer wasn't reachable."
        >
          Rough estimate
        </span>
      ) : null}
    </div>
  )
}

/**
 * An interview's resume fit on its report: the score, the label and the
 * analysis behind them. Not rendered at all when the interview has no fit
 * score — a report without one isn't missing anything.
 */
export function ResumeFitCard({
  fit,
  analysis,
}: {
  fit: InterviewFit | null
  analysis: Record<string, unknown> | null
}) {
  if (!fit) return null

  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle className="flex items-center gap-2 font-bold">
          <FileSearch className="size-4 text-muted-foreground" />
          Resume fit
        </CardTitle>
        <CardDescription>
          How well the resume matched the job description, analysed before the
          interview. Separate from the interview score.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {fit.status === "pending" ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Analysing the resume. This takes about 15 seconds.
          </p>
        ) : fit.status === "failed" ? (
          <p className="text-sm text-muted-foreground">
            The resume couldn&rsquo;t be analysed, so there is no fit score.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <span
                className={cn(
                  "text-4xl leading-none font-bold tracking-tight tabular-nums",
                  scoreTone(fit.score)
                )}
              >
                {fit.score ?? "—"}
                {fit.score !== null ? (
                  <span className="text-lg text-muted-foreground">%</span>
                ) : null}
              </span>
              {fit.recommendation ? (
                <Badge variant="secondary">
                  {fitRecommendationLabel(fit.recommendation)}
                </Badge>
              ) : null}
              {fit.analyzerVersion ? (
                <Badge variant="outline">
                  {isRough(fit) ? "Keyword fallback" : "AI analysis"}
                </Badge>
              ) : null}
            </div>
            {isRough(fit) ? (
              <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs">
                A rough estimate: scored by keyword matching because the AI
                analyzer wasn&rsquo;t reachable. Not comparable with AI scores.
              </p>
            ) : null}
            {analysis ? <AnalysisFields analysis={analysis} /> : null}
          </>
        )}
      </CardContent>
    </Card>
  )
}
