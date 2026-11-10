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
import { scoreTone } from "@/features/dashboard/score-tone"
import { useInterviewDefaults } from "@/services/admin"
import {
  useCandidateMutations,
  useJob,
  useShortlist,
  type Candidate,
} from "@/services/hr"
import { cn } from "@/lib/utils"

import { AddCandidatesDialog } from "../add-candidates-dialog"
import { CandidateDetailDialog } from "../candidate-detail-dialog"
import { EditCandidateDialog } from "../edit-candidate-dialog"
import { JobSetupPanel } from "../job-setup-panel"
import { ScheduleDialog } from "../schedule-dialog"

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
  const shortlistQuery = useShortlist(jobId)
  const mutations = useCandidateMutations(jobId)

  // Selection is stored raw and filtered at read time rather than pruned in an
  // effect: a candidate can stop being schedulable while the page is open (a
  // colleague invites them), and reconciling that in an effect means a second
  // render pass on every poll.
  const [rawSelected, setRawSelected] = React.useState<Set<string>>(new Set())
  const [adding, setAdding] = React.useState(false)
  const [scheduling, setScheduling] = React.useState(false)
  const [detailId, setDetailId] = React.useState<string | null>(null)
  /** The unscheduled candidate whose details are being corrected, or null. */
  const [editing, setEditing] = React.useState<Candidate | null>(null)

  const job = jobQuery.data?.job
  const counts = jobQuery.data?.candidates
  /* Read only for a job that inherits them — to show what "company defaults"
     actually means right now, since that is what its interviews will run. The
     schedule dialog prefills from the same cached read. */
  const followsDefaults = Boolean(job) && !job?.rounds
  const interviewDefaults = useInterviewDefaults(followsDefaults || scheduling)
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

  /** Selection narrowed to what's still schedulable right now. */
  const selected = React.useMemo(() => {
    const allowed = new Set(schedulable.map((c) => c.candidateId))
    return new Set([...rawSelected].filter((id) => allowed.has(id)))
  }, [rawSelected, schedulable])

  const setSelected = setRawSelected

  const toggleSelected = (candidateId: string) =>
    setRawSelected((current) => {
      const next = new Set(current)
      if (next.has(candidateId)) next.delete(candidateId)
      else next.add(candidateId)
      return next
    })

  const analysing = candidates.some((c) => c.analysisStatus === "pending")

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

      <JobSetupPanel
        selectionThresholdPct={job.selectionThresholdPct}
        jobRounds={job.rounds}
        defaultRounds={interviewDefaults.data?.rounds}
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
        loading={shortlistQuery.isLoading}
        // Rows arrive ranked best-first from the server; nothing here re-sorts.
        //
        // Clicking a row **selects** it — the whole point of this page is
        // picking who to schedule, and a click that opened a dialog instead
        // meant reaching for a 16px checkbox every time. The eye button in
        // Actions is the way into the detail.
        onRowClick={(row) => {
          if (row.interviewId) return // already scheduled — nothing to pick
          toggleSelected(row.candidateId)
        }}
        searchAccessor={(row) => `${row.name} ${row.email}`}
        searchPlaceholder="Search candidate or email…"
        filters={filters}
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
          analysing ? (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              Analysing… this page updates itself
            </span>
          ) : null
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
        emptyMessage="No candidates yet. Add Resumes to start the analysis."
      />

      <AddCandidatesDialog
        open={adding}
        onOpenChange={setAdding}
        onAddRows={(rows) => mutations.add.mutateAsync(rows)}
        onUpload={(files) => mutations.upload.mutateAsync(files)}
        pending={mutations.add.isPending || mutations.upload.isPending}
      />

      <ScheduleDialog
        open={scheduling}
        onOpenChange={setScheduling}
        candidates={schedulable.filter((c) => selected.has(c.candidateId))}
        jobRounds={job.rounds ?? null}
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
