import * as React from "react"
import { Link, useParams } from "react-router-dom"

import {
  AlertTriangle,
  ArrowLeft,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { useCurrentUser } from "@/features/auth/auth-context"
import { ROLE_HOME } from "@/features/auth/types"
import { scoreTone } from "@/features/dashboard/score-tone"
import { useInterviewDefaults } from "@/services/admin"
import {
  useCandidateMutations,
  useCandidatePage,
  useJob,
  useShortlist,
  type AnalysisStatus,
  type Candidate,
} from "@/services/hr"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

import { AddCandidatesDialog } from "../add-candidates-dialog"
import { BulkUploadPanel } from "../bulk-upload/bulk-upload-panel"
import {
  BulkUploadUnavailableError,
  startBulkUpload,
} from "../bulk-upload/upload-store"
import { useActiveBatch } from "../bulk-upload/use-active-batch"
import { CandidateDetailDialog } from "../candidate-detail-dialog"
import { EditCandidateDialog } from "../edit-candidate-dialog"
import { openResumeFile } from "../open-resume"
import { JobSetupPanel } from "../job-setup-panel"
import { BulkReportDialog } from "../report-downloads"
import { ScheduleDialog } from "../schedule-dialog"

/**
 * Past this many candidates the shortlist is read a page at a time from the
 * server instead of whole. Below it, the whole list keeps search and filters.
 */
const PAGED_ABOVE = 500

/** Rows per server page. */
const PAGE_SIZE = 50

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
 * rendered in the order given rather than re-sorted here. While anything is
 * still `pending`, the query polls — analysis runs in the background and can
 * take ~20 s per Resume on the keyword fallback.
 */
export function JobShortlistPage() {
  const { jobId } = useParams<{ jobId: string }>()
  const user = useCurrentUser()
  const jobQuery = useJob(jobId)
  const mutations = useCandidateMutations(jobId)
  const active = useActiveBatch(jobId)

  const counts = jobQuery.data?.candidates
  /* Decided from the job's own count, so a big job never loads whole. Waits for
     that count: reading the full list first and asking afterwards is the very
     request this avoids. */
  const paged = (counts?.total ?? 0) > PAGED_ABOVE
  const shortlistQuery = useShortlist(jobId, {
    enabled: counts !== undefined && !paged,
  })

  const [rawPage, setRawPage] = React.useState(1)
  const [statusFilter, setStatusFilter] = React.useState<
    AnalysisStatus | "all"
  >("all")
  const pageQuery = useCandidatePage(jobId, {
    limit: PAGE_SIZE,
    offset: (rawPage - 1) * PAGE_SIZE,
    status: statusFilter === "all" ? undefined : statusFilter,
    enabled: paged,
    live: active.processing,
  })
  const pageTotal = pageQuery.data?.total ?? 0
  const page = Math.min(rawPage, Math.max(1, Math.ceil(pageTotal / PAGE_SIZE)))

  // Selection is stored raw and filtered at read time rather than pruned in an
  // effect: a candidate can stop being schedulable while the page is open (a
  // colleague invites them), and reconciling that in an effect means a second
  // render pass on every poll. Rows, not ids: on a paged list the people picked
  // on page 1 aren't on page 2, and scheduling still needs them.
  const [rawSelected, setRawSelected] = React.useState<Map<string, Candidate>>(
    new Map()
  )
  const [adding, setAdding] = React.useState(false)
  const [scheduling, setScheduling] = React.useState(false)
  /** The ZIP of this job's finished interviews, narrowed by date or outcome. */
  const [downloading, setDownloading] = React.useState(false)
  const [detailId, setDetailId] = React.useState<string | null>(null)
  /** The unscheduled candidate whose details are being corrected, or null. */
  const [editing, setEditing] = React.useState<Candidate | null>(null)

  const job = jobQuery.data?.job
  /* What "company defaults" actually means right now — the rounds of a job
     that inherits them, and the AI interviewer, which a job overrides key by
     key so it nearly always inherits something. The schedule dialog prefills
     from the same cached read. */
  const interviewDefaults = useInterviewDefaults(Boolean(job) || scheduling)
  const shortlist = shortlistQuery.data
  const candidates = React.useMemo(
    () => (paged ? pageQuery.data?.candidates : shortlist?.candidates) ?? [],
    [paged, pageQuery.data, shortlist]
  )

  /** Only unscheduled candidates can be invited. */
  const schedulable = React.useMemo(
    () => candidates.filter((candidate) => !candidate.interviewId),
    [candidates]
  )

  /**
   * Selection narrowed to what's still schedulable right now, each row as last
   * seen. Whole-list, anything no longer listed is dropped; paged, a pick from
   * another page is kept as it was when picked.
   */
  const selectedRows = React.useMemo(() => {
    const known = new Map(candidates.map((c) => [c.candidateId, c]))
    return [...rawSelected.values()]
      .map((row) => known.get(row.candidateId) ?? (paged ? row : null))
      .filter((row): row is Candidate => row !== null && !row.interviewId)
  }, [rawSelected, candidates, paged])
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

  const analysing =
    active.processing || candidates.some((c) => c.analysisStatus === "pending")

  /**
   * Bulk upload first: any number of files, sent straight to storage. On a
   * server without it, the old upload takes them 20 at a time.
   */
  const uploadFiles = async (files: File[]) => {
    try {
      await startBulkUpload(jobId!, files)
      toast.success(
        `Uploading ${files.length.toLocaleString("en-IN")} ${files.length === 1 ? "Resume" : "Resumes"}. Progress shows on this page.`
      )
      return "started" as const
    } catch (error) {
      if (!(error instanceof BulkUploadUnavailableError)) throw error
      // The old upload, 20 files a request, as many requests as it takes.
      return mutations.upload.mutateAsync(files)
    }
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
      cell: (row) =>
        row.interviewId ? (
          <StatusBadge status="scheduled" label="Scheduled" />
        ) : (
          <span className="text-xs text-muted-foreground">Not scheduled</span>
        ),
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
    // No analysis filter: the Fit score column already reads "Analysing" or
    // "Analysis failed" on the rows it would have matched, and the counts above
    // the table say how many of each there are.
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

      <BulkUploadPanel jobId={job.jobId} active={active} />

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
        loading={
          paged
            ? pageQuery.isLoading
            : shortlistQuery.isLoading || counts === undefined
        }
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
        // Paged, search and filters would only ever see the 50 rows on screen,
        // so the server's status filter stands in for them.
        searchAccessor={paged ? undefined : (row) => `${row.name} ${row.email}`}
        searchPlaceholder="Search candidate or email…"
        filters={paged ? undefined : filters}
        serverPaging={
          paged
            ? {
                total: pageTotal,
                page,
                pageSize: PAGE_SIZE,
                onPageChange: setRawPage,
              }
            : undefined
        }
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
            {paged ? (
              <Select
                value={statusFilter}
                onValueChange={(value) => {
                  setStatusFilter(value as AnalysisStatus | "all")
                  setRawPage(1)
                }}
              >
                <SelectTrigger
                  aria-label="Analysis"
                  className="min-w-36 flex-1 sm:flex-initial"
                >
                  <SelectValue>
                    {(value) =>
                      STATUS_OPTIONS.find((o) => o.value === value)?.label ??
                      "All candidates"
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All candidates</SelectItem>
                  {STATUS_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
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
              {paged
                ? ` · showing ${((page - 1) * PAGE_SIZE + 1).toLocaleString("en-IN")}–${((page - 1) * PAGE_SIZE + candidates.length).toLocaleString("en-IN")} of ${pageTotal.toLocaleString("en-IN")}${selected.size > 0 ? ` · ${selected.size} selected` : ""}`
                : schedulable.length !== candidates.length
                  ? ` · ${schedulable.length} of ${candidates.length} can be scheduled`
                  : ""}
            </p>
          ) : null
        }
        emptyMessage="No candidates yet. Add Resumes to start the analysis."
      />

      <AddCandidatesDialog
        open={adding}
        onOpenChange={setAdding}
        onAddRows={(rows) => mutations.add.mutateAsync(rows)}
        onUpload={uploadFiles}
        pending={mutations.add.isPending || mutations.upload.isPending}
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
