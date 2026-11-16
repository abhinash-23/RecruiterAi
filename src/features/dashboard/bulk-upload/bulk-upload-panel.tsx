import * as React from "react"
import {
  AlertTriangle,
  CheckCircle2,
  History,
  Loader2,
  Upload,
  X,
  XCircle,
} from "lucide-react"

import { MetaChip } from "@/components/shared/page-header"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { batchNeverArrived, batchSettled } from "@/services/hr"
import { cn } from "@/lib/utils"

import { BatchFailuresDialog, BatchHistoryDialog } from "./batch-dialogs"
import { cancelUpload } from "./upload-store"
import type { ActiveBatch } from "./use-active-batch"

const count = (value: number) => value.toLocaleString("en-IN")

/**
 * A bulk upload on the job page, from the first file sent to the last score:
 *
 *   sending (this tab) → reading (server) → scoring (server) → done
 *
 * The bar shows the files sent while sending, then the server's own percent.
 * Renders nothing when there's no batch to show.
 */
export function BulkUploadPanel({
  jobId,
  active,
}: {
  jobId: string
  active: ActiveBatch
}) {
  const [showFailures, setShowFailures] = React.useState(false)
  const [showHistory, setShowHistory] = React.useState(false)
  const { run, sending, status, history } = active

  if (!run && !status) {
    // No batch on screen, but past ones are still a click away.
    return history.length > 0 ? (
      <>
        <div className="-mt-1 flex justify-end">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setShowHistory(true)}
          >
            <History />
            Upload history
          </Button>
        </div>
        <BatchHistoryDialog
          open={showHistory}
          onOpenChange={setShowHistory}
          batches={history}
        />
      </>
    ) : null
  }

  const notUploaded = run?.notUploaded ?? []
  /** Files the server took but didn't turn into candidates: listed on demand. */
  const serverNotAdded = (status?.failed ?? 0) + (status?.duplicates ?? 0)
  const stopped = run?.phase === "failed" || run?.phase === "cancelled"
  /* Not one file reached storage — this tab saw every upload fail, or the
     server reports the whole batch still waiting for its files. Said as a
     failure: a green "complete" over nothing added was the old reading. */
  const uploadFailed =
    !sending &&
    (active.nothingSent ||
      // Never on files this tab saw arrive, whatever an older reading says.
      (!(run && run.uploaded > 0) &&
        status !== null &&
        batchNeverArrived(status)))
  const done =
    !sending && !uploadFailed && status !== null && batchSettled(status)
  /** Described to the server but never arrived. Only the server knows, when
      this tab didn't do the sending. */
  const neverArrived = !run && status ? status.awaitingUpload : 0
  const fileCount = run?.total ?? status?.totalFiles ?? 0

  const percent = sending
    ? run && run.total > 0
      ? (run.uploaded / run.total) * 100
      : 0
    : (status?.percent ?? 0)

  const [title, detail] = uploadFailed
    ? [
        "Upload failed",
        `None of the ${count(fileCount)} files reached storage, so nothing was added. Upload them again. If it keeps happening, the storage bucket's upload settings (CORS) need fixing on the server.`,
      ]
    : sending
      ? [
          "Uploading Resumes",
          `${count(run!.uploaded)} of ${count(run!.total)} sent. Keep this tab open until it finishes.`,
        ]
      : !status
        ? [
            stopped ? "Upload stopped" : "Upload sent",
            run?.error ?? "Waiting for the server…",
          ]
        : done
          ? [
              run?.phase === "cancelled"
                ? "Upload cancelled"
                : "Upload complete",
              status.candidatesCreated > 0
                ? `${count(status.candidatesCreated)} candidates added from ${count(status.totalFiles)} files. Every score is in.`
                : `No new candidates from ${count(status.totalFiles)} files. See what wasn't added.`,
            ]
          : !status.extractionDone
            ? [
                "Reading Resumes",
                `${count(status.totalFiles - status.queued - status.processing)} of ${count(status.totalFiles)} files read. New candidates appear in the list below as they're found.`,
              ]
            : [
                "Scoring candidates",
                `${count(status.analyzed)} of ${count(status.candidatesCreated)} scored. The ranking updates as scores come in.`,
              ]

  const Icon = uploadFailed
    ? XCircle
    : done
      ? CheckCircle2
      : stopped
        ? AlertTriangle
        : Loader2
  // Nothing read yet while the first files are still going up: no row of zeros.
  const showCounts =
    status !== null &&
    (!sending ||
      status.candidatesCreated + status.duplicates + status.failed > 0)

  return (
    <Card className="gap-4 px-5">
      <div className="flex flex-wrap items-start gap-3">
        <span
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-xl",
            uploadFailed
              ? "bg-red-500/10 text-red-600 dark:text-red-400"
              : done
                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                : stopped
                  ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                  : "bg-accent-brand-muted text-accent-brand"
          )}
        >
          {sending ? (
            <Upload className="size-[1.125rem]" />
          ) : (
            <Icon
              className={cn(
                "size-[1.125rem]",
                Icon === Loader2 && "animate-spin"
              )}
            />
          )}
        </span>

        <div className="min-w-48 flex-1">
          <p className="font-semibold">{title}</p>
          <p className="text-sm text-muted-foreground">{detail}</p>
          {stopped && run?.error && (status || uploadFailed) ? (
            <p className="mt-1 text-sm text-destructive">{run.error}</p>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {serverNotAdded > 0 || notUploaded.length > 0 ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowFailures(true)}
            >
              <AlertTriangle />
              {uploadFailed ? "See files" : "View failures"}
            </Button>
          ) : null}
          {history.length > 0 ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShowHistory(true)}
            >
              <History />
              History
            </Button>
          ) : null}
          {sending ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => cancelUpload(jobId)}
            >
              Cancel
            </Button>
          ) : (
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Hide this upload"
              title="Hide this upload"
              onClick={active.dismiss}
            >
              <X />
            </Button>
          )}
        </div>
      </div>

      {uploadFailed ? null : (
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
      )}

      {(showCounts && !uploadFailed) ||
      notUploaded.length > 0 ||
      neverArrived > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {showCounts && status && !uploadFailed ? (
            <>
              <MetaChip tone="brand">
                {count(status.candidatesCreated)} added
              </MetaChip>
              <MetaChip tone="success">
                {count(status.analyzed)} scored
              </MetaChip>
              {status.analysisPending > 0 ? (
                <MetaChip>
                  {count(status.analysisPending)} waiting to score
                </MetaChip>
              ) : null}
              {status.duplicates > 0 ? (
                <MetaChip>{count(status.duplicates)} duplicates</MetaChip>
              ) : null}
              {status.failed > 0 ? (
                <MetaChip tone="danger">{count(status.failed)} failed</MetaChip>
              ) : null}
            </>
          ) : null}
          {notUploaded.length > 0 ? (
            <MetaChip tone="warning">
              {count(notUploaded.length)} not uploaded
            </MetaChip>
          ) : null}
          {neverArrived > 0 && !uploadFailed ? (
            <MetaChip tone="warning">
              {count(neverArrived)} never uploaded
            </MetaChip>
          ) : null}
        </div>
      ) : null}

      <BatchFailuresDialog
        open={showFailures}
        onOpenChange={setShowFailures}
        jobId={jobId}
        batchId={active.batchId}
        serverNotAdded={serverNotAdded}
        notUploaded={notUploaded}
      />
      <BatchHistoryDialog
        open={showHistory}
        onOpenChange={setShowHistory}
        batches={history}
      />
    </Card>
  )
}
