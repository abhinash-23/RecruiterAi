import * as React from "react"
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  Loader2,
  RotateCcw,
  Upload,
  X,
} from "lucide-react"

import { MetaChip } from "@/components/shared/page-header"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import type { JobCandidateCounts } from "@/services/hr"
import { cn } from "@/lib/utils"

import { UploadReportDialog } from "./upload-report-dialog"
import {
  allProblems,
  cancelUpload,
  clearUploadRun,
  duplicateCount,
  isUploading,
  retryUpload,
  retryableCount,
  type UploadRun,
} from "./upload-store"

const count = (value: number) => value.toLocaleString("en-IN")

/**
 * A Resume upload on the job page, from the first request to the last score:
 *
 *   uploading (this tab) → scoring (the server, read off the job's counts) → done
 *
 * While uploading, the bar is the files whose request has returned. After
 * that it is the job's scored share — the job's counts, not just this
 * upload's, which the panel says. Renders nothing without an upload.
 */
export function BulkUploadPanel({
  run,
  counts,
}: {
  run: UploadRun | null
  counts: JobCandidateCounts | undefined
}) {
  const [showReport, setShowReport] = React.useState(false)
  if (!run) return null

  const sending = isUploading(run)
  const scoring = !sending && (counts?.pending ?? 0) > 0
  const finished = !sending && !scoring
  const failed = run.problems.length - duplicateCount(run) + run.notSent.length
  const retryable = retryableCount(run)
  const picked = run.total + run.skipped.length

  const percent = sending
    ? run.total > 0
      ? (run.uploaded / run.total) * 100
      : 0
    : scoring && counts && counts.total > 0
      ? (counts.analyzed / counts.total) * 100
      : 100

  const [title, detail] = sending
    ? [
        "Uploading Resumes",
        `Uploaded ${count(run.uploaded)} of ${count(run.total)}. Keep this tab open until it finishes.`,
      ]
    : scoring
      ? [
          "Scoring candidates",
          `${count(counts!.analyzed)} of ${count(counts!.total)} candidates in this job scored. The ranking updates as scores come in.`,
        ]
      : [
          run.phase === "cancelled" ? "Upload cancelled" : "Upload complete",
          run.created > 0
            ? `${count(run.created)} candidates added from ${count(picked)} files. Every score is in.`
            : `No new candidates from ${count(picked)} files. See the report.`,
        ]

  const Icon = sending
    ? Upload
    : finished
      ? run.created > 0
        ? CheckCircle2
        : AlertTriangle
      : Loader2

  return (
    <Card className="gap-4 px-5">
      <div className="flex flex-wrap items-start gap-3">
        <span
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-xl",
            finished && run.created > 0
              ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              : finished
                ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                : "bg-accent-brand-muted text-accent-brand"
          )}
        >
          <Icon
            className={cn("size-[1.125rem]", Icon === Loader2 && "animate-spin")}
          />
        </span>

        <div className="min-w-48 flex-1">
          <p className="font-semibold">{title}</p>
          <p className="text-sm text-muted-foreground">{detail}</p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {allProblems(run).length > 0 ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowReport(true)}
            >
              <FileText />
              View report
            </Button>
          ) : null}
          {!sending && retryable > 0 ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => retryUpload(run.jobId)}
            >
              <RotateCcw />
              Retry {count(retryable)}
            </Button>
          ) : null}
          {sending ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => cancelUpload(run.jobId)}
            >
              Cancel
            </Button>
          ) : (
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Hide this upload"
              title="Hide this upload"
              onClick={() => clearUploadRun(run.jobId)}
            >
              <X />
            </Button>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Progress
          value={Math.round(percent)}
          aria-label={title}
          className="flex-1 [&_[data-slot=progress-indicator]]:bg-accent-brand [&_[data-slot=progress-track]]:h-1.5"
        />
        <span className="w-10 text-right text-sm font-medium tabular-nums">
          {Math.round(percent)}%
        </span>
      </div>

      {run.uploaded > 0 || run.skipped.length > 0 || run.notSent.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          <MetaChip tone="brand">{count(run.created)} added</MetaChip>
          {duplicateCount(run) > 0 ? (
            <MetaChip>{count(duplicateCount(run))} already in this job</MetaChip>
          ) : null}
          {failed > 0 ? (
            <MetaChip tone="danger">{count(failed)} failed</MetaChip>
          ) : null}
          {run.skipped.length > 0 ? (
            <MetaChip tone="warning">
              {count(run.skipped.length)} skipped
            </MetaChip>
          ) : null}
          {sending && run.inFlight > 0 ? (
            <MetaChip>
              <Loader2 className="size-3 animate-spin" />
              {run.inFlight} {run.inFlight === 1 ? "request" : "requests"} in
              flight
            </MetaChip>
          ) : null}
        </div>
      ) : null}

      <UploadReportDialog
        open={showReport}
        onOpenChange={setShowReport}
        run={run}
      />
    </Card>
  )
}
