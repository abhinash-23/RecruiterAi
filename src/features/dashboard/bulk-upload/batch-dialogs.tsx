import { format } from "date-fns"
import {
  AlertTriangle,
  Copy,
  FileWarning,
  Loader2,
  RotateCcw,
} from "lucide-react"

import { MetaChip } from "@/components/shared/page-header"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  batchNeverArrived,
  batchSettled,
  useResumeBatchFailures,
  useRetryResumeBatch,
  type ResumeBatchStatus,
  type ResumeRejection,
} from "@/services/hr"

/** Long lists stay readable: the first few hundred, and a count of the rest. */
const LIST_CAP = 300

const count = (value: number) => value.toLocaleString("en-IN")

function FileList({
  items,
}: {
  items: Array<{ name: string; error: string }>
}) {
  return (
    <>
      <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto overscroll-contain">
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
          And {count(items.length - LIST_CAP)} more.
        </p>
      ) : null}
    </>
  )
}

/**
 * What didn't make it into the shortlist, in three groups: files the server
 * couldn't read (retryable), duplicates of someone already on the job, and
 * files that never reached it.
 */
export function BatchFailuresDialog({
  open,
  onOpenChange,
  jobId,
  batchId,
  serverNotAdded,
  notUploaded,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  jobId: string
  batchId: string | null
  /** Failed plus duplicates, from the batch's counts. */
  serverNotAdded: number
  notUploaded: ResumeRejection[]
}) {
  const failures = useResumeBatchFailures(batchId, open && serverNotAdded > 0)
  const retry = useRetryResumeBatch(jobId)
  const rows = failures.data ?? []
  const unread = rows.filter((row) => row.status === "failed")
  const duplicates = rows.filter((row) => row.status === "duplicate")
  const toItems = (list: typeof rows) =>
    list.map((row) => ({ name: row.filename, error: row.error }))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Files not added</DialogTitle>
          <DialogDescription>
            Every Resume needs an email address inside it. A second Resume with
            the same email for this job counts as a duplicate, not a failure.
          </DialogDescription>
        </DialogHeader>

        {serverNotAdded > 0 && (failures.isLoading || failures.isError) ? (
          failures.isLoading ? (
            <p className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Loading the list…
            </p>
          ) : (
            <p className="text-sm text-destructive">
              {failures.error?.message}
            </p>
          )
        ) : null}

        {unread.length > 0 ? (
          <section className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-3">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <FileWarning className="size-4 text-red-600 dark:text-red-400" />
                Couldn&rsquo;t be read
                <MetaChip tone="danger">{count(unread.length)}</MetaChip>
              </h3>
              {batchId ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={retry.isPending}
                  onClick={() => retry.mutate(batchId)}
                >
                  {retry.isPending ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <RotateCcw />
                  )}
                  Retry failed
                </Button>
              ) : null}
            </div>
            <FileList items={toItems(unread)} />
          </section>
        ) : null}

        {duplicates.length > 0 ? (
          <section className="flex flex-col gap-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <Copy className="size-4 text-muted-foreground" />
              Already applied
              <MetaChip>{count(duplicates.length)}</MetaChip>
            </h3>
            <p className="text-xs text-muted-foreground">
              Someone with the same email is already on this job, so these
              weren&rsquo;t added again.
            </p>
            <FileList items={toItems(duplicates)} />
          </section>
        ) : null}

        {notUploaded.length > 0 ? (
          <section className="flex flex-col gap-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <AlertTriangle className="size-4 text-amber-600 dark:text-amber-400" />
              Not uploaded
              <MetaChip tone="warning">{count(notUploaded.length)}</MetaChip>
            </h3>
            <p className="text-xs text-muted-foreground">
              These never reached the server. Fix them and add them again.
            </p>
            <FileList items={notUploaded} />
          </section>
        ) : null}

        {serverNotAdded === 0 && notUploaded.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">
            Nothing failed in this upload.
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

/** Every bulk upload to a job, newest first. */
export function BatchHistoryDialog({
  open,
  onOpenChange,
  batches,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  batches: ResumeBatchStatus[]
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Upload history</DialogTitle>
          <DialogDescription>
            Every bulk Resume upload to this job.
          </DialogDescription>
        </DialogHeader>

        {batches.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">
            No bulk uploads yet.
          </p>
        ) : (
          <ul className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto overscroll-contain">
            {batches.map((batch) => (
              <li
                key={batch.batchId}
                className="flex flex-col gap-2 rounded-xl border px-3.5 py-3"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium">
                    {batch.createdAt
                      ? format(new Date(batch.createdAt), "d MMM yyyy · HH:mm")
                      : "Upload"}
                  </span>
                  {batchNeverArrived(batch) ? (
                    <MetaChip tone="danger">Failed</MetaChip>
                  ) : batchSettled(batch) ? (
                    <MetaChip tone="success">Done</MetaChip>
                  ) : (
                    <MetaChip tone="brand">
                      <Loader2 className="size-3 animate-spin" />
                      {Math.round(batch.percent)}%
                    </MetaChip>
                  )}
                </div>
                <p className="text-xs text-muted-foreground tabular-nums">
                  {count(batch.totalFiles)} files ·{" "}
                  {count(batch.candidatesCreated)} added ·{" "}
                  {count(batch.duplicates)} duplicates · {count(batch.failed)}{" "}
                  failed
                </p>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  )
}
