import * as React from "react"
import { Link, useParams } from "react-router-dom"
import { useQueryClient } from "@tanstack/react-query"

import {
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  Briefcase,
  CalendarPlus,
  CheckCircle2,
  Clock,
  Eye,
  FileArchive,
  FileText,
  Loader2,
  Pencil,
  RefreshCw,
  Upload,
  Users,
  XCircle,
} from "lucide-react"

import {
  DataTable,
  type Column,
  type FilterSpec,
} from "@/components/shared/data-table"
import { IconAction } from "@/components/shared/icon-action"
import { MetaChip, PageHeader } from "@/components/shared/page-header"
import { StatCard } from "@/components/shared/stat-card"
import { StatusBadge } from "@/components/shared/status-badge"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useCurrentUser } from "@/features/auth/auth-context"
import { ROLE_HOME } from "@/features/auth/types"
import { rowBadge } from "@/features/dashboard/interview-status"
import { scoreTone } from "@/features/dashboard/score-tone"
import { useInterviewDefaults } from "@/services/admin"
import {
  hrKeys,
  isSelectedResult,
  useCandidateMutations,
  useInterviews,
  useJob,
  useSyncedShortlist,
  type AnalysisStatus,
  type Candidate,
  type InterviewStatus,
} from "@/services/hr"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

import { AddCandidatesDialog } from "../add-candidates-dialog"
import { BulkUploadPanel } from "../bulk-upload/bulk-upload-panel"
import {
  isUploading,
  startUpload,
  useUploadRun,
} from "../bulk-upload/upload-store"
import { CandidateDetailDialog } from "../candidate-detail-dialog"
import { EditCandidateDialog } from "../edit-candidate-dialog"
import { InterviewReportDialog } from "../interview-report-dialog"
import { openResumeFile } from "../open-resume"
import { JobSetupPanel } from "../job-setup-panel"
import { BulkReportDialog } from "../report-downloads"
import { ScheduleDialog } from "../schedule-dialog"

/**
 * Rows per page. The whole list is loaded for every job, whatever its size
 * (the server builds 1,000 candidates in about 0.05 s), and paged, searched
 * and filtered here.
 */
const PAGE_SIZE = 50

/** While an upload's requests return, its counts are re-read at most this often. */
const COUNTS_REFRESH_MS = 5000

/** A scheduled candidate's interview, as far as this page can tell. */
interface InterviewOutcome {
  /** Null when the interview isn't on the interviews list (an old one). */
  status: InterviewStatus | null
  isDraft: boolean
  score: number | null
  /** Null until decided. */
  selected: boolean | null
  hasResults: boolean
}

const STATUS_OPTIONS: Array<{ value: AnalysisStatus; label: string }> = [
  { value: "analyzed", label: "Scored" },
  { value: "pending", label: "Analysing" },
  { value: "failed", label: "Analysis failed" },
]

/** `part` as a share of `whole`, 0 when there is no whole to share. */
function share(part: number, whole: number) {
  return whole === 0 ? 0 : (part / whole) * 100
}

/**
 * One job's funnel: add candidates, watch them get analysed, review the ranked
 * shortlist, schedule the ones worth interviewing.
 *
 * The list arrives **already ranked** best-first from the server, so it is
 * rendered in the order given rather than re-sorted here. While scores are
 * still coming in, the job's small counts poll every 10 s and the list is
 * re-read from them, at most every 30 s — see `useSyncedShortlist`.
 */
export function JobShortlistPage() {
  const { jobId } = useParams<{ jobId: string }>()
  const user = useCurrentUser()
  const run = useUploadRun(jobId)
  const sending = isUploading(run)
  const jobQuery = useJob(jobId, { live: sending })
  const mutations = useCandidateMutations(jobId)

  const counts = jobQuery.data?.candidates
  const shortlistQuery = useSyncedShortlist(jobId, counts)

  /*
   * An upload from this tab moves the counts as its requests come back. The
   * 10 s poll alone can miss a short upload entirely, so: the counts (a small
   * reply, `exact` so the list isn't dragged along) at most every 5 s while
   * requests return, and the counts and the list once when it finishes — the
   * one read outside the 30 s rule, so the new candidates show at once.
   */
  const client = useQueryClient()
  const uploaded = run?.uploaded ?? 0
  const countsReadAt = React.useRef(0)
  React.useEffect(() => {
    if (!jobId || uploaded === 0) return
    const now = Date.now()
    if (now - countsReadAt.current < COUNTS_REFRESH_MS) return
    countsReadAt.current = now
    void client.invalidateQueries({ queryKey: hrKeys.job(jobId), exact: true })
  }, [client, jobId, uploaded])
  const wasSending = React.useRef(sending)
  React.useEffect(() => {
    if (wasSending.current && !sending && jobId) {
      void client.invalidateQueries({ queryKey: hrKeys.job(jobId), exact: true })
      void client.invalidateQueries({
        queryKey: hrKeys.shortlist(jobId),
        exact: true,
      })
    }
    wasSending.current = sending
  }, [client, jobId, sending])
  /** A failure to read the list: said, not shown as "no candidates". */
  const listFailed = shortlistQuery.isError

  // Selection is stored raw and filtered at read time rather than pruned in an
  // effect: a candidate can stop being schedulable while the page is open (a
  // colleague invites them), and reconciling that in an effect means a second
  // render pass on every poll.
  const [rawSelected, setRawSelected] = React.useState<Map<string, Candidate>>(
    new Map()
  )
  const [adding, setAdding] = React.useState(false)
  const [scheduling, setScheduling] = React.useState(false)
  /** The ZIP of this job's finished interviews, narrowed by date or outcome. */
  const [downloading, setDownloading] = React.useState(false)
  const [detailId, setDetailId] = React.useState<string | null>(null)
  /** The interview whose report is open in a dialog, or null. */
  const [reportId, setReportId] = React.useState<string | null>(null)
  /** The unscheduled candidate whose details are being corrected, or null. */
  const [editing, setEditing] = React.useState<Candidate | null>(null)

  /*
   * Each scheduled candidate's progress and outcome.
   *
   * The candidate rows only say *that* an interview exists, so this reads the
   * company's interviews list (the one the Interviews and Results pages share,
   * usually already cached) and matches by `interviewId`. Fields the backend
   * sends on the candidate itself win — that list can be capped, and an old
   * interview missing from it then shows a plain "Scheduled", as before.
   */
  const interviewsQuery = useInterviews()
  const interviewsById = React.useMemo(
    () =>
      new Map(
        (interviewsQuery.data ?? []).map((row) => [row.interviewId, row])
      ),
    [interviewsQuery.data]
  )
  const outcomeOf = (row: Candidate): InterviewOutcome | null => {
    if (!row.interviewId) return null
    const listed = interviewsById.get(row.interviewId)
    const result = row.result ?? listed?.result ?? null
    return {
      status:
        (row.interviewStatus as InterviewStatus | null | undefined) ??
        listed?.status ??
        null,
      isDraft: listed?.isDraft ?? false,
      score: row.overallScore ?? listed?.overallScore ?? null,
      selected: result ? isSelectedResult(result) : null,
      hasResults: row.hasResults ?? listed?.hasResults ?? false,
    }
  }

  const job = jobQuery.data?.job
  /* What "company defaults" actually means right now — the rounds of a job
     that inherits them, and the AI interviewer, which a job overrides key by
     key so it nearly always inherits something. The schedule dialog prefills
     from the same cached read. */
  const interviewDefaults = useInterviewDefaults(Boolean(job) || scheduling)
  const shortlist = shortlistQuery.data
  const candidates = React.useMemo(
    () => shortlist?.candidates ?? [],
    [shortlist]
  )

  /** Only unscheduled candidates can be invited. */
  const schedulable = React.useMemo(
    () => candidates.filter((candidate) => !candidate.interviewId),
    [candidates]
  )

  /**
   * Selection narrowed to what's still schedulable right now, each row as last
   * read. Anyone no longer on the list is dropped.
   */
  const selectedRows = React.useMemo(() => {
    const known = new Map(candidates.map((c) => [c.candidateId, c]))
    return [...rawSelected.values()]
      .map((row) => known.get(row.candidateId) ?? null)
      .filter((row): row is Candidate => row !== null && !row.interviewId)
  }, [rawSelected, candidates])
  const selected = new Set(selectedRows.map((row) => row.candidateId))

  const setSelected = (ids: Iterable<string>) => {
    const known = new Map(candidates.map((c) => [c.candidateId, c]))
    const next = new Map<string, Candidate>()
    for (const id of ids) {
      const row = known.get(id) ?? rawSelected.get(id)
      if (row) next.set(id, row)
    }
    setRawSelected(next)
  }

  const toggleSelected = (row: Candidate) =>
    setRawSelected((current) => {
      const next = new Map(current)
      if (next.has(row.candidateId)) next.delete(row.candidateId)
      else next.set(row.candidateId, row)
      return next
    })

  const analysing = sending || (counts?.pending ?? 0) > 0

  /**
   * Starts the upload and closes the dialog: the requests carry on in this
   * tab, three at a time, and the panel on this page shows their progress.
   */
  const uploadFiles = async (
    files: File[],
    skipped: Array<{ name: string; error: string }>
  ) => {
    startUpload(jobId!, files, skipped)
    toast.success(
      `Uploading ${files.length.toLocaleString("en-IN")} ${files.length === 1 ? "Resume" : "Resumes"}. Progress shows on this page.`
    )
    return "started" as const
  }

  const columns: Array<Column<Candidate>> = [
    {
      id: "candidate",
      header: "Candidate",
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.name || row.email}</p>
          <p className="truncate text-xs text-muted-foreground">{row.email}</p>
        </div>
      ),
    },
    {
      id: "score",
      header: "Fit score",
      className: "tabular-nums",
      cell: (row) =>
        row.analysisStatus === "analyzed" ? (
          <div className="flex flex-col gap-0.5">
            <span
              className={cn(
                "text-lg leading-none font-semibold",
                // `weak`, so a poor *fit* stays grey rather than going red: it
                // is a match score on a candidate nobody has judged yet, and
                // red would be this table returning a verdict of its own.
                scoreTone(row.fitScore, "weak")
              )}
            >
              {row.fitScore ?? "—"}
            </span>
            <span className="text-[0.6875rem] text-muted-foreground">
              {row.recommendation ?? "scored"}
              {row.analyzerVersion === "keyword_fallback" ? " · keyword" : ""}
            </span>
          </div>
        ) : row.analysisStatus === "pending" ? (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            Analysing
          </span>
        ) : (
          <Badge
            variant="outline"
            className="border-destructive/40 text-destructive"
          >
            Analysis failed
          </Badge>
        ),
    },
    {
      id: "scheduled",
      header: "Interview",
      cell: (row) => {
        const outcome = outcomeOf(row)
        if (!outcome) {
          return (
            <span className="text-xs text-muted-foreground">Not scheduled</span>
          )
        }
        // Decided: the outcome is what a recruiter scans this column for.
        if (outcome.selected !== null) {
          return (
            <div className="flex flex-col items-start gap-1">
              <StatusBadge
                status={outcome.selected ? "completed" : "disabled"}
                label={outcome.selected ? "Selected" : "Not selected"}
              />
              {outcome.score !== null ? (
                <span
                  className={cn(
                    "text-xs font-medium tabular-nums",
                    scoreTone(outcome.score)
                  )}
                >
                  Score {outcome.score}%
                </span>
              ) : null}
            </div>
          )
        }
        // Not on the interviews list: all that is known is that it exists.
        if (!outcome.status) {
          return <StatusBadge status="scheduled" label="Scheduled" />
        }
        const badge = rowBadge({
          status: outcome.status,
          isDraft: outcome.isDraft,
        })
        return <StatusBadge status={badge.status} label={badge.label} />
      },
    },
  ]

  const filters: Array<FilterSpec<Candidate>> = [
    {
      id: "scheduled",
      label: "Interview",
      options: [
        { value: "no", label: "Not scheduled" },
        { value: "yes", label: "Scheduled" },
      ],
      predicate: (row, value) => Boolean(row.interviewId) === (value === "yes"),
    },
    {
      id: "outcome",
      label: "Outcome",
      options: [
        { value: "selected", label: "Selected" },
        { value: "not_selected", label: "Not selected" },
        { value: "pending", label: "Awaiting result" },
      ],
      predicate: (row, value) => {
        const outcome = outcomeOf(row)
        if (!outcome) return false
        if (value === "pending") return outcome.selected === null
        return outcome.selected === (value === "selected")
      },
    },
    {
      id: "analysis",
      label: "Analysis",
      options: STATUS_OPTIONS,
      predicate: (row, value) => row.analysisStatus === value,
    },
  ]

  if (jobQuery.isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-10 w-72 max-w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  if (jobQuery.isError || !job) {
    return (
      <Card>
        <CardContent className="flex flex-col items-start gap-3 py-8">
          <p className="font-medium">This job isn&rsquo;t available.</p>
          <p className="text-sm text-muted-foreground">
            It may have been deleted, or it belongs to a colleague. The API
            doesn&rsquo;t distinguish the two.
          </p>
          <Button
            variant="outline"
            nativeButton={false}
            render={<Link to={`${ROLE_HOME[user.role]}/jobs`} />}
          >
            <ArrowLeft />
            Back to jobs
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <>
      <PageHeader
        title={job.title}
        icon={Briefcase}
        description={
          job.role && job.role !== job.title
            ? `Interviews as ${job.role}`
            : undefined
        }
        meta={
          job.status === "open" ? (
            <MetaChip tone="success">Open</MetaChip>
          ) : (
            <MetaChip>Closed</MetaChip>
          )
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              nativeButton={false}
              render={<Link to={`${ROLE_HOME[user.role]}/jobs`} />}
            >
              <ArrowLeft />
              All jobs
            </Button>
            <Button
              variant="outline"
              onClick={() => setAdding(true)}
              disabled={job.status === "closed"}
            >
              <Upload />
              Add candidates
            </Button>
            <Button variant="outline" onClick={() => setDownloading(true)}>
              <FileArchive />
              Download results
            </Button>
            <Button
              onClick={() => setScheduling(true)}
              disabled={selected.size === 0}
            >
              <CalendarPlus />
              Schedule{selected.size > 0 ? ` (${selected.size})` : ""}
            </Button>
          </div>
        }
      />

      <BulkReportDialog
        open={downloading}
        onOpenChange={setDownloading}
        fixedJob={{ jobId: job.jobId, title: job.title }}
      />

      {job.status === "closed" ? (
        <div className="flex items-center gap-2 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-5 py-3 text-sm">
          <AlertTriangle className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
          This job is closed. The API rejects new candidates. Reopen it from the
          jobs list to resume intake.
        </div>
      ) : null}

      {counts ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Candidates"
            value={counts.total}
            icon={Users}
            tone="brand"
            note="Added to this job"
          />
          <StatCard
            label="Analysed"
            value={counts.analyzed}
            icon={CheckCircle2}
            tone="success"
            rate={share(counts.analyzed, counts.total)}
            rateText="analysed"
          />
          <StatCard
            label="Pending"
            value={counts.pending}
            icon={Clock}
            tone="warning"
            rate={share(counts.pending, counts.total)}
            rateText="still analysing"
          />
          <StatCard
            label="Failed"
            value={counts.failed}
            icon={XCircle}
            tone="danger"
            rate={share(counts.failed, counts.total)}
            rateText="couldn't be analysed"
          />
        </div>
      ) : null}

      <BulkUploadPanel run={run} counts={counts} />

      <JobSetupPanel
        selectionThresholdPct={job.selectionThresholdPct}
        jobRounds={job.rounds}
        defaultRounds={interviewDefaults.data?.rounds}
        jobVoice={job.voiceSettings ?? null}
        companyVoice={interviewDefaults.data?.voiceSettings ?? null}
      />

      {shortlist?.mixedAnalyzerVersions ? (
        <div className="flex items-start gap-2 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-5 py-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <p>
            This list mixes AI and keyword-fallback scores.{" "}
            <strong>They are different scales</strong>. Compare within a group,
            not across the whole list.
          </p>
        </div>
      ) : null}

      <DataTable
        rows={candidates}
        columns={columns}
        getRowId={(row) => row.candidateId}
        loading={shortlistQuery.isLoading || counts === undefined}
        // Rows arrive ranked best-first from the server; nothing here re-sorts.
        //
        // Clicking a row **selects** it — the whole point of this page is
        // picking who to schedule, and a click that opened a dialog instead
        // meant reaching for a 16px checkbox every time. The eye button in
        // Actions is the way into the detail.
        onRowClick={(row) => {
          if (row.interviewId) return // already scheduled — nothing to pick
          toggleSelected(row)
        }}
        // All in the browser, on the loaded list: instant even at 1,000.
        searchAccessor={(row) => `${row.name} ${row.email}`}
        searchPlaceholder="Search candidate or email…"
        filters={filters}
        pageSize={PAGE_SIZE}
        selectable
        // Already-invited candidates can't be invited again, so their checkbox
        // is disabled and select-all skips them — while still counting against
        // "all selected", which is what stops one pick from filling the header
        // box on a list where the rest are already scheduled.
        isRowSelectable={(row) => !row.interviewId}
        selectedIds={[...selected]}
        onSelectionChange={(ids) => setSelected(new Set(ids))}
        inlineActions={(row) => (
          <>
            <IconAction
              label="View candidate"
              Icon={Eye}
              onSelect={() => setDetailId(row.candidateId)}
            />
            {/* Once there is a report to open. An interview the list doesn't
                know about gets the button too: the report itself says when a
                sitting isn't finished. Opens over this page, so the
                shortlist's filters and page survive a look. */}
            {row.interviewId &&
            (outcomeOf(row)?.hasResults || !outcomeOf(row)?.status) ? (
              <IconAction
                label="View results"
                Icon={BarChart3}
                onSelect={() => setReportId(row.interviewId!)}
              />
            ) : null}
            {/* Only for a Resume that came in as a file; a pasted one has
                nothing to open. */}
            {row.sourceFilename ? (
              <IconAction
                label="View resume"
                Icon={FileText}
                onSelect={() => void openResumeFile(row.candidateId)}
              />
            ) : null}
            {/* Only before scheduling: once invited, the email already sits in
                the old inbox and the server refuses the edit (409). Shown
                disabled rather than hidden, so the tooltip can say why — a
                missing button reads as a missing permission. */}
            <IconAction
              label={
                row.interviewId
                  ? "Can't edit: the invitation has already been emailed to these details"
                  : "Edit candidate"
              }
              Icon={Pencil}
              disabled={Boolean(row.interviewId)}
              onSelect={() => setEditing(row)}
            />
            {row.analysisStatus === "failed" ? (
              <IconAction
                label="Re-run analysis"
                Icon={RefreshCw}
                disabled={mutations.reanalyse.isPending}
                onSelect={() => mutations.reanalyse.mutate(row.candidateId)}
              />
            ) : null}
          </>
        )}
        toolbarExtra={
          <>
            {analysing ? (
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" />
                Analysing… this page updates itself
              </span>
            ) : null}
          </>
        }
        // Two facts the toolbar's "Total: n" can't convey: the order means
        // something, and the count you can act on is smaller than the count
        // shown once anyone has been invited.
        header={
          candidates.length > 0 ? (
            <p className="text-sm text-muted-foreground">
              Ranked best first
              {schedulable.length !== candidates.length
                ? ` · ${schedulable.length} of ${candidates.length} can be scheduled`
                : ""}
            </p>
          ) : null
        }
        emptyMessage={
          listFailed
            ? "Couldn't load the candidates. Refresh the page to try again."
            : "No candidates yet. Add Resumes to start the analysis."
        }
      />

      <AddCandidatesDialog
        open={adding}
        onOpenChange={setAdding}
        onAddRows={(rows) => mutations.add.mutateAsync(rows)}
        onUpload={uploadFiles}
        pending={mutations.add.isPending}
      />

      <ScheduleDialog
        open={scheduling}
        onOpenChange={setScheduling}
        candidates={selectedRows}
        jobRounds={job.rounds ?? null}
        jobVoiceSettings={job.voiceSettings ?? null}
        onSchedule={(input) => mutations.schedule.mutateAsync(input)}
        pending={mutations.schedule.isPending}
        onDone={() => setSelected(new Set())}
      />

      <CandidateDetailDialog
        candidateId={detailId}
        onClose={() => setDetailId(null)}
      />

      <InterviewReportDialog
        interviewId={reportId}
        onClose={() => setReportId(null)}
      />

      <EditCandidateDialog
        contact={
          editing
            ? {
                name: editing.name,
                email: editing.email,
                phone: editing.phone ?? "",
              }
            : null
        }
        description="Only possible before they're scheduled. The Resume isn't edited here. Re-run the analysis for that."
        pending={mutations.edit.isPending}
        onSave={(changes) =>
          mutations.edit.mutateAsync({
            candidateId: editing!.candidateId,
            changes,
          })
        }
        onOpenChange={(next) => {
          if (!next) setEditing(null)
        }}
      />
    </>
  )
}
