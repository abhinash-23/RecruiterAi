import * as React from "react"
import { Download, FileArchive, Loader2 } from "lucide-react"

import { IconAction } from "@/components/shared/icon-action"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  REPORT_LIMITS,
  useDownloadReport,
  useDownloadReports,
  useJobs,
  type ReportFilters,
  type ReportVerdict,
} from "@/services/hr"

/** "about 4 s" / "about a minute", for a ZIP of `count` reports. */
function estimate(count: number): string {
  const seconds = Math.ceil(count * REPORT_LIMITS.secondsPerReport) + 1
  if (seconds < 50) return `about ${seconds} s`
  const minutes = Math.round(seconds / 60)
  return minutes <= 1 ? "about a minute" : `about ${minutes} minutes`
}

/* ========================================================================== */
/*  One candidate                                                             */
/* ========================================================================== */

/**
 * One interview's PDF report — as a header button, or as a row's icon. The
 * spinner is per interview: pressing one row's download doesn't spin them all.
 */
export function ReportDownloadButton({
  interviewId,
  variant = "button",
}: {
  interviewId: string
  variant?: "button" | "icon"
}) {
  const download = useDownloadReport()
  const busy = download.isPending && download.variables === interviewId

  if (variant === "icon") {
    return (
      <IconAction
        label={busy ? "Preparing PDF…" : "Download PDF report"}
        Icon={busy ? Loader2 : Download}
        disabled={busy}
        onSelect={() => download.mutate(interviewId)}
      />
    )
  }

  return (
    <Button
      variant="outline"
      disabled={busy}
      onClick={() => download.mutate(interviewId)}
    >
      {busy ? <Loader2 className="animate-spin" /> : <Download />}
      {busy ? "Preparing PDF…" : "Download PDF"}
    </Button>
  )
}

/* ========================================================================== */
/*  The rows ticked                                                           */
/* ========================================================================== */

/** "Download 5 selected" — straight to the ZIP, no dialog. */
export function DownloadSelectedButton({
  interviewIds,
}: {
  interviewIds: string[]
}) {
  const download = useDownloadReports()
  const count = interviewIds.length
  const tooMany = count > REPORT_LIMITS.maxPerZip

  return (
    <Button
      disabled={download.isPending || tooMany}
      title={
        tooMany
          ? `Select at most ${REPORT_LIMITS.maxPerZip} at a time.`
          : undefined
      }
      onClick={() => download.mutate({ interviewIds })}
    >
      {download.isPending ? (
        <Loader2 className="animate-spin" />
      ) : (
        <FileArchive />
      )}
      {download.isPending
        ? `Preparing ${count} report${count === 1 ? "" : "s"}… ${estimate(count)}`
        : `Download ${count} selected`}
    </Button>
  )
}

/* ========================================================================== */
/*  Everything, or a filtered slice                                           */
/* ========================================================================== */

const ANY = "all"

/**
 * The ZIP's filters: a date range, a verdict and a job, all optional and
 * combined. Rendered only while the dialog is open, so the job list isn't
 * read on a page where nobody has asked for it.
 */
function BulkReportForm({
  fixedJob,
  onDone,
  onCancel,
}: {
  /** On a job's own page: the job is the scope, and isn't offered as a choice. */
  fixedJob?: { jobId: string; title: string }
  onDone: () => void
  onCancel: () => void
}) {
  const download = useDownloadReports()
  const jobs = useJobs()
  const [from, setFrom] = React.useState("")
  const [to, setTo] = React.useState("")
  const [result, setResult] = React.useState<string>(ANY)
  const [jobId, setJobId] = React.useState<string>(fixedJob?.jobId ?? ANY)

  const rangeInvalid = Boolean(from && to && from > to)

  const filters: ReportFilters = {
    ...(jobId !== ANY ? { jobId } : {}),
    ...(from ? { completedFrom: from } : {}),
    ...(to ? { completedTo: to } : {}),
    ...(result !== ANY ? { result: result as ReportVerdict } : {}),
  }

  const jobLabel = (value: string) =>
    value === ANY
      ? "All jobs"
      : (jobs.data?.find((job) => job.jobId === value)?.title ?? "A job")

  return (
    <>
      <div className="flex flex-col gap-4">
        {fixedJob ? null : (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="reports-job">Job</Label>
            <Select
              value={jobId}
              onValueChange={(value) => setJobId(String(value))}
            >
              <SelectTrigger id="reports-job" className="w-full">
                <SelectValue>{(value) => jobLabel(String(value))}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>All jobs</SelectItem>
                {(jobs.data ?? []).map((job) => (
                  <SelectItem key={job.jobId} value={job.jobId}>
                    {job.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Interviews created with New interview belong to no job and are
              included only under All jobs.
            </p>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="reports-from">Completed from</Label>
            <Input
              id="reports-from"
              type="date"
              className="dark:scheme-dark"
              value={from}
              max={to || undefined}
              onChange={(event) => setFrom(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="reports-to">Completed to</Label>
            <Input
              id="reports-to"
              type="date"
              className="dark:scheme-dark"
              value={to}
              min={from || undefined}
              onChange={(event) => setTo(event.target.value)}
              aria-invalid={rangeInvalid}
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="reports-result">Outcome</Label>
          <Select
            value={result}
            onValueChange={(value) => setResult(String(value))}
          >
            <SelectTrigger id="reports-result" className="w-full">
              <SelectValue>
                {(value) =>
                  value === "SELECTED"
                    ? "Selected"
                    : value === "NOT SELECTED"
                      ? "Not selected"
                      : "All outcomes"
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>All outcomes</SelectItem>
              <SelectItem value="SELECTED">Selected</SelectItem>
              <SelectItem value="NOT SELECTED">Not selected</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {rangeInvalid ? (
          <p className="text-xs text-destructive">
            The start date is after the end date.
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            Leave a field empty to include everything. The ZIP has a ranked
            summary PDF first, then one report per candidate, best score first.
            Up to {REPORT_LIMITS.maxPerZip} at a time.
          </p>
        )}

        {download.isPending ? (
          <div className="flex items-center gap-3 rounded-xl border p-3">
            <Loader2 className="size-5 shrink-0 animate-spin text-brand-blue" />
            <div className="min-w-0">
              <p className="text-sm font-medium">Building your ZIP…</p>
              <p className="text-xs text-muted-foreground">
                Each report takes a moment, so a large download can take up to a
                minute. Keep this window open.
              </p>
            </div>
          </div>
        ) : null}
      </div>

      <DialogFooter>
        <Button
          variant="outline"
          onClick={onCancel}
          disabled={download.isPending}
        >
          Cancel
        </Button>
        <Button
          disabled={download.isPending || rangeInvalid}
          onClick={() =>
            download.mutate(filters, {
              onSuccess: onDone,
            })
          }
        >
          {download.isPending ? (
            <Loader2 className="animate-spin" />
          ) : (
            <FileArchive />
          )}
          {download.isPending ? "Preparing…" : "Download ZIP"}
        </Button>
      </DialogFooter>
    </>
  )
}

/**
 * "Download results" — a ZIP of every finished interview the reader can see,
 * or a slice of them by date, outcome and job.
 */
export function BulkReportDialog({
  open,
  onOpenChange,
  fixedJob,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  fixedJob?: { jobId: string; title: string }
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {fixedJob
              ? `Download results: ${fixedJob.title}`
              : "Download results"}
          </DialogTitle>
          <DialogDescription>
            A ZIP of PDF reports for finished interviews. Unfinished interviews
            are skipped.
          </DialogDescription>
        </DialogHeader>
        {open ? (
          <BulkReportForm
            fixedJob={fixedJob}
            onDone={() => onOpenChange(false)}
            onCancel={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
