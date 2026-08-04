import { format } from "date-fns"

import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { useCandidate } from "@/services/hr"

/** Renders whatever the analyzer returned without assuming its shape. */
function AnalysisFields({ analysis }: { analysis: Record<string, unknown> }) {
  const entries = Object.entries(analysis).filter(
    ([, value]) => value !== null && value !== undefined && value !== ""
  )

  if (entries.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        The analyzer returned no detail for this candidate.
      </p>
    )
  }

  return (
    <dl className="flex flex-col gap-3">
      {entries.map(([key, value]) => (
        <div key={key}>
          <dt className="text-xs text-muted-foreground">
            {key.replace(/_/g, " ")}
          </dt>
          <dd className="text-sm">
            {Array.isArray(value) ? (
              <div className="mt-1 flex flex-wrap gap-1">
                {value.map((item, index) => (
                  <Badge
                    key={`${String(item)}-${index}`}
                    variant="secondary"
                    className="h-auto font-normal whitespace-normal"
                  >
                    {String(item)}
                  </Badge>
                ))}
              </div>
            ) : typeof value === "object" ? (
              <pre className="mt-1 overflow-x-auto rounded-lg bg-muted/50 p-2 text-xs">
                {JSON.stringify(value, null, 2)}
              </pre>
            ) : (
              String(value)
            )}
          </dd>
        </div>
      ))}
    </dl>
  )
}

/**
 * Everything the analyzer knows about one application: the score, its full
 * output, and the résumé text it read.
 *
 * A centred dialog rather than a full-width sheet — the content is a narrow
 * column of prose and chips, and stretching it across a desktop monitor put
 * the concerns list on lines wide enough to lose your place in.
 *
 * The `analysis` payload's shape depends on which analyzer ran (`llm` vs
 * `keyword_fallback`), so it's rendered generically rather than against a fixed
 * field list that would silently drop half of it.
 */
export function CandidateDetailDialog({
  candidateId,
  onClose,
}: {
  candidateId: string | null
  onClose: () => void
}) {
  const { data, isLoading } = useCandidate(candidateId ?? undefined)
  const candidate = data?.candidate

  return (
    <Dialog
      open={Boolean(candidateId)}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      {/* `flex` replaces the default grid so the body can own the scrolling,
          and `min-h-0` on it is what lets that happen inside a flex column. */}
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="pr-8">
            {candidate?.name || candidate?.email || "Candidate"}
          </DialogTitle>
          <DialogDescription>
            {candidate
              ? `${candidate.email} · added ${format(new Date(candidate.createdAt), "d MMM yyyy")}`
              : "Loading…"}
          </DialogDescription>
        </DialogHeader>

        <div className="-mr-2 min-h-0 flex-1 overflow-y-auto pr-2">
          {isLoading ? (
            <div className="flex flex-col gap-3">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-40 w-full" />
            </div>
          ) : !candidate ? (
            <p className="text-sm text-muted-foreground">
              This candidate isn&rsquo;t available.
            </p>
          ) : (
            <div className="flex flex-col gap-5">
              <div className="flex flex-wrap items-center gap-3">
                <div>
                  <p className="text-xs text-muted-foreground">Fit score</p>
                  <p className="text-2xl font-semibold tabular-nums">
                    {candidate.fitScore ?? "—"}
                  </p>
                </div>
                {candidate.recommendation ? (
                  <Badge variant="secondary" className="h-auto whitespace-normal">
                    {candidate.recommendation}
                  </Badge>
                ) : null}
                {candidate.analyzerVersion ? (
                  <Badge variant="outline" className="h-auto whitespace-normal">
                    {candidate.analyzerVersion === "keyword_fallback"
                      ? "Keyword fallback"
                      : "AI analysis"}
                  </Badge>
                ) : null}
              </div>

              {candidate.analyzerVersion === "keyword_fallback" ? (
                <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs">
                  Scored by keyword matching because the AI analyzer
                  wasn&rsquo;t reachable. Not comparable with AI scores.
                </p>
              ) : null}

              <Separator />

              <section>
                <h3 className="mb-2 text-sm font-semibold">Analysis</h3>
                {data?.analysis ? (
                  <AnalysisFields analysis={data.analysis} />
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No analysis yet.
                  </p>
                )}
              </section>

              <Separator />

              <section>
                <h3 className="mb-2 text-sm font-semibold">Résumé</h3>
                <p className="text-sm whitespace-pre-wrap text-muted-foreground">
                  {candidate.resumeText || "No résumé text stored."}
                </p>
              </section>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
