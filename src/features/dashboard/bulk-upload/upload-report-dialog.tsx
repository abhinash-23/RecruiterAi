import { Download, RotateCcw } from "lucide-react"

import { MetaChip } from "@/components/shared/page-header"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { saveFile } from "@/lib/save-file"

import {
  PROBLEM_LABELS,
  allProblems,
  duplicateCount,
  failedCount,
  isUploading,
  problemLabel,
  problemsCsv,
  retryUpload,
  retryableCount,
  type UploadProblem,
  type UploadRun,
} from "./upload-store"

/** Long lists stay readable: the first few hundred, and a count of the rest. */
const LIST_CAP = 300

const count = (value: number) => value.toLocaleString("en-IN")

/** Known codes in their usual order first, then any others the server sent. */
function grouped(items: UploadProblem[]): Array<[string, UploadProblem[]]> {
  const groups = new Map<string, UploadProblem[]>()
  for (const item of items) {
    groups.set(item.code, [...(groups.get(item.code) ?? []), item])
  }
  const order = Object.keys(PROBLEM_LABELS)
  const rank = (code: string) => {
    const index = order.indexOf(code)
    return index === -1 ? order.length : index
  }
  return [...groups.entries()].sort(([a], [b]) => rank(a) - rank(b))
}

/**
 * Every file in this upload that didn't become a candidate, grouped by why,
 * with the totals that account for every file picked and a CSV of the lot.
 */
export function UploadReportDialog({
  open,
  onOpenChange,
  run,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  run: UploadRun
}) {
  const problems = allProblems(run)
  const picked = run.total + run.skipped.length
  const retryable = retryableCount(run)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Upload report</DialogTitle>
          <DialogDescription>
            {count(picked)} files picked: {count(run.created)} added ·{" "}
            {count(duplicateCount(run))} already in this job ·{" "}
            {count(failedCount(run))} failed · {count(run.skipped.length)}{" "}
            skipped.
          </DialogDescription>
        </DialogHeader>

        {problems.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">
            Every file in this upload was added.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            {grouped(problems).map(([code, items]) => (
              <section key={code} className="flex flex-col gap-2">
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  {problemLabel(code)}
                  <MetaChip tone={code === "duplicate" ? undefined : "danger"}>
                    {count(items.length)}
                  </MetaChip>
                </h3>
                <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto overscroll-contain">
                  {items.slice(0, LIST_CAP).map((item, index) => (
                    <li
                      key={`${item.name}-${index}`}
                      className="flex flex-col gap-0.5 rounded-lg bg-muted/50 px-2.5 py-1.5 text-sm sm:flex-row sm:items-center sm:gap-3"
                    >
                      <span className="min-w-0 flex-1 truncate font-medium">
                        {item.name}
                      </span>
                      <span className="text-xs text-muted-foreground sm:max-w-[55%] sm:text-right">
                        {item.error}
                      </span>
                    </li>
                  ))}
                </ul>
                {items.length > LIST_CAP ? (
                  <p className="text-xs text-muted-foreground">
                    And {count(items.length - LIST_CAP)} more. The CSV has them
                    all.
                  </p>
                ) : null}
              </section>
            ))}
          </div>
        )}

        {problems.length > 0 ? (
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="outline"
              onClick={() =>
                saveFile(
                  new Blob([`\uFEFF${problemsCsv(run)}`], {
                    type: "text/csv;charset=utf-8",
                  }),
                  "Upload_report.csv"
                )
              }
            >
              <Download />
              Download CSV
            </Button>
            {retryable > 0 && !isUploading(run) ? (
              <Button
                onClick={() => {
                  retryUpload(run.jobId)
                  onOpenChange(false)
                }}
              >
                <RotateCcw />
                Retry {count(retryable)}
              </Button>
            ) : null}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
