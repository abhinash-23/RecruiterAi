import { Badge } from "@/components/ui/badge"

/**
 * Renders whatever the resume analyzer returned without assuming its shape.
 *
 * Shared by a job candidate's detail and an interview's "Resume fit" card:
 * the payload's fields depend on which analyzer ran (`llm` or
 * `keyword_fallback`), so a fixed field list would silently drop half of it.
 */
export function AnalysisFields({
  analysis,
}: {
  analysis: Record<string, unknown>
}) {
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
    <dl className="flex flex-col gap-3 wrap-break-word">
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
