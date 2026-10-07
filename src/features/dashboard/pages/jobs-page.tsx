import * as React from "react"
import { useNavigate } from "react-router-dom"
import { format } from "date-fns"
import { ListChecks, Lock, LockOpen, Pencil, Plus } from "lucide-react"

import {
  DataTable,
  type Column,
  type FilterSpec,
} from "@/components/shared/data-table"
import { IconAction } from "@/components/shared/icon-action"
import { EntityDialog } from "@/components/shared/entity-dialog"
import { PageHeader } from "@/components/shared/page-header"
import { StatusBadge } from "@/components/shared/status-badge"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { JOB_FIELDS } from "@/config/entities"
import type { FieldValue } from "@/components/shared/field-schema"
import { useCurrentUser } from "@/features/auth/auth-context"
import { ROLE_HOME } from "@/features/auth/types"
import { RoundPicker } from "@/features/dashboard/round-picker"
import { formatRounds, useRoundSelection } from "@/features/dashboard/rounds"
import {
  formatPct,
  selectionThreshold,
} from "@/features/dashboard/selection-threshold"
import { useInterviewDefaults, type InterviewRound } from "@/services/admin"
import {
  useJobMutations,
  useJobs,
  type Job,
  type JobStatus,
} from "@/services/hr"

/**
 * The threshold field as the API wants it: a number, or `null` for "no bar of
 * its own".
 *
 * An optional number field hands back `""` when the box is empty, and `null` is
 * how the API is told that — sending `0`, which is what a bare `Number("")`
 * produces, is both a 422 and a bar no interview could clear.
 *
 * The two writers then read that `null` differently, and correctly: **create**
 * omits it, because a new job has no custom bar to clear; **update** sends it,
 * which is what puts an edited job back on the platform default. So clearing the
 * box on the edit form *is* the reset button.
 */
function toThreshold(value: FieldValue | undefined): number | null {
  if (value === "" || value === undefined) return null
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

/**
 * The rounds section of the job form.
 *
 * Says which of the two states the job is in, because they behave differently
 * later: **following the company defaults** picks up whatever the admin sets
 * there next, while **its own rounds** stay put. Not saying so would leave a
 * recruiter to discover it from a candidate.
 */
function JobRoundsField({
  rounds,
  onChange,
  following,
  defaults,
  loading,
  onUseDefaults,
  editing,
}: {
  rounds: InterviewRound[]
  onChange: (next: InterviewRound[]) => void
  /** True while the job inherits the company defaults. */
  following: boolean
  defaults: InterviewRound[] | undefined
  loading: boolean
  onUseDefaults: () => void
  editing?: boolean
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label>Interview rounds</Label>
      <RoundPicker value={rounds} onChange={onChange} disabled={loading} />
      <p className="text-xs text-muted-foreground">
        {following ? (
          <>
            Your company&rsquo;s defaults
            {defaults ? <> ({formatRounds(defaults)})</> : null} — this job
            follows any later change to them.
          </>
        ) : (
          <>
            This job&rsquo;s own rounds — later changes to the company defaults
            won&rsquo;t affect it.{" "}
            <button
              type="button"
              onClick={onUseDefaults}
              className="font-medium text-foreground underline underline-offset-2"
            >
              Use company defaults
            </button>
          </>
        )}
        {editing ? (
          <> Changes reach only interviews scheduled from now on.</>
        ) : null}
      </p>
    </div>
  )
}

/**
 * Jobs are the root of the recruiting funnel: candidates, analysis, shortlists
 * and interviews all hang off one. There is no flat candidate list on this API,
 * so this page is the way into everything below it.
 *
 * HR sees their own jobs; an admin sees the whole company's.
 */
export function JobsPage() {
  const user = useCurrentUser()
  const navigate = useNavigate()
  const { data, isLoading } = useJobs()
  const mutations = useJobMutations()

  const [creating, setCreating] = React.useState(false)
  const [editing, setEditing] = React.useState<Job | null>(null)

  /* Rounds prefill from the company defaults — readable by HR as well as
     admin — and are fetched only once a form is open. */
  const interviewDefaults = useInterviewDefaults(creating || Boolean(editing))
  const defaultRounds = interviewDefaults.data?.rounds
  const roundsLoading = interviewDefaults.isLoading

  const createRounds = useRoundSelection(defaultRounds)

  /* Edit starts from the job's own list, or from the defaults when it has
     none. `editFollows` is the third state the PATCH needs: flipped on by
     "Use company defaults", it is what sends `rounds: null`. */
  const [editFollows, setEditFollows] = React.useState(true)
  const editRounds = useRoundSelection(
    editFollows ? defaultRounds : (editing?.rounds ?? undefined)
  )

  // Reset as each form opens, so it never shows the last job's choice.
  const startCreating = () => {
    createRounds.reset()
    setCreating(true)
  }
  const startEditing = (job: Job) => {
    setEditFollows(!job.rounds)
    editRounds.reset()
    setEditing(job)
  }

  const openShortlist = (job: Job) =>
    navigate(`${ROLE_HOME[user.role]}/jobs/${job.jobId}`)

  const columns: Array<Column<Job>> = [
    {
      id: "title",
      header: "Job",
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.title}</p>
          {/* `role` is what the candidate is told they're interviewing for, and
              defaults to the title — only worth a second line when it differs. */}
          {row.role && row.role !== row.title ? (
            <p className="truncate text-xs text-muted-foreground">
              Interviews as {row.role}
            </p>
          ) : null}
        </div>
      ),
    },
    {
      id: "description",
      header: "Description",
      hideOnMobile: true,
      cell: (row) => (
        <p className="line-clamp-2 max-w-md text-xs text-muted-foreground">
          {row.jobDescription}
        </p>
      ),
    },
    {
      id: "created",
      header: "Created",
      hideOnMobile: true,
      cell: (row) => (
        <span className="text-muted-foreground">
          {format(new Date(row.createdAt), "d MMM yyyy")}
        </span>
      ),
    },
    {
      id: "threshold",
      header: "Selection bar",
      hideOnMobile: true,
      cell: (row) => {
        const { value, isDefault } = selectionThreshold(
          row.selectionThresholdPct
        )
        return (
          <span className="whitespace-nowrap tabular-nums">
            {formatPct(value)}%
            {/* Quieter than the number, because it is a fact about where the
                number came from rather than part of it. */}
            {isDefault ? (
              <span className="ml-1 text-xs text-muted-foreground">
                default
              </span>
            ) : null}
          </span>
        )
      },
    },
    {
      id: "status",
      header: "Status",
      cell: (row) => (
        <StatusBadge
          status={row.status === "open" ? "active" : "disabled"}
          label={row.status === "open" ? "Open" : "Closed"}
        />
      ),
    },
  ]

  const filters: Array<FilterSpec<Job>> = [
    {
      id: "status",
      label: "Status",
      options: [
        { value: "open", label: "Open" },
        { value: "closed", label: "Closed" },
      ],
      predicate: (row, value) => row.status === value,
    },
  ]

  const setStatus = (job: Job, status: JobStatus) =>
    mutations.update.mutate({ jobId: job.jobId, input: { status } })

  return (
    <>
      <PageHeader
        title="Jobs"
        description="Every role you're hiring for. Open one to add candidates, review the ranked shortlist and schedule interviews."
        actions={
          <Button onClick={startCreating}>
            <Plus />
            Create job
          </Button>
        }
      />

      <DataTable
        rows={data ?? []}
        columns={columns}
        getRowId={(row) => row.jobId}
        loading={isLoading}
        onRowClick={openShortlist}
        searchAccessor={(row) => `${row.title} ${row.role}`}
        searchPlaceholder="Search job title or role…"
        filters={filters}
        // One button per action instead of a `⋯` menu: three actions is few
        // enough to show, and each is one click rather than two. Every one
        // stops propagation — the row itself opens the shortlist.
        inlineActions={(row) => (
          <>
            <IconAction
              label="Open shortlist"
              Icon={ListChecks}
              onSelect={() => openShortlist(row)}
            />
            <IconAction
              label="Edit job"
              Icon={Pencil}
              onSelect={() => startEditing(row)}
            />
            {row.status === "open" ? (
              <IconAction
                label="Close job"
                Icon={Lock}
                tone="destructive"
                disabled={mutations.update.isPending}
                onSelect={() => setStatus(row, "closed")}
              />
            ) : (
              <IconAction
                label="Reopen job"
                Icon={LockOpen}
                tone="positive"
                disabled={mutations.update.isPending}
                onSelect={() => setStatus(row, "open")}
              />
            )}
          </>
        )}
        emptyMessage="No jobs yet — create one to start adding candidates."
      />

      <EntityDialog
        open={creating}
        onOpenChange={setCreating}
        title="Create job"
        description="The description is what candidates are scored against, so include the real requirements rather than a summary."
        fields={JOB_FIELDS}
        submitLabel="Create job"
        pending={mutations.create.isPending}
        // Wider than this dialog's default: the description is the longest text
        // anyone types in the console, and at 576px it wrapped to about nine
        // words a line — no way to read back a set of requirements you are
        // checking before candidates get scored against it.
        contentClassName="sm:max-w-3xl"
        extra={
          <JobRoundsField
            rounds={createRounds.rounds}
            onChange={createRounds.setRounds}
            following={!createRounds.changed}
            defaults={defaultRounds}
            loading={roundsLoading}
            onUseDefaults={createRounds.reset}
          />
        }
        onSubmit={async (values) => {
          const job = await mutations.create.mutateAsync({
            title: String(values.title),
            jobDescription: String(values.jobDescription),
            role: String(values.role),
            // An empty box is "not provided", which is what leaves the platform
            // default in charge — see `selectionThresholdPct` on `createJob`.
            selectionThresholdPct: toThreshold(values.selectionThresholdPct),
            // Only when changed: left alone, the job follows the defaults.
            ...(createRounds.changed ? { rounds: createRounds.rounds } : {}),
            /* No `voiceMode` here any more — `createJob` sends it itself, so
               no caller can create a job that quietly schedules typed
               interviews for ever. */
          })
          setCreating(false)
          // Straight into the funnel — an empty job is never the destination.
          navigate(`${ROLE_HOME[user.role]}/jobs/${job.jobId}`)
        }}
      />

      <EntityDialog
        open={Boolean(editing)}
        onOpenChange={(open) => !open && setEditing(null)}
        title="Edit job"
        description="Editing the description changes what future candidates are scored against. Existing scores stay as they are until you re-analyse."
        fields={JOB_FIELDS}
        submitLabel="Save changes"
        pending={mutations.update.isPending}
        // Same width as Create: it is the same form, and the description it
        // opens with is longer than the one Create starts empty.
        contentClassName="sm:max-w-3xl"
        extra={
          <JobRoundsField
            rounds={editRounds.rounds}
            onChange={editRounds.setRounds}
            following={editFollows && !editRounds.changed}
            defaults={defaultRounds}
            loading={roundsLoading}
            onUseDefaults={() => {
              setEditFollows(true)
              editRounds.reset()
            }}
            editing
          />
        }
        initialValues={
          editing
            ? {
                title: editing.title,
                role: editing.role,
                jobDescription: editing.jobDescription,
                // Blank when the job has none, so the box shows its "75
                // (default)" placeholder rather than asserting a number the job
                // doesn't actually carry.
                selectionThresholdPct: editing.selectionThresholdPct ?? "",
              }
            : null
        }
        onSubmit={async (values) => {
          if (!editing) return
          await mutations.update.mutateAsync({
            jobId: editing.jobId,
            input: {
              title: String(values.title),
              role: String(values.role),
              jobDescription: String(values.jobDescription),
              /* Emptying the box sends `null`, which **clears** the job's own
                 bar and puts it back on the platform default — rather than
                 pinning a literal 75, which would stop the job following that
                 default if it ever moves. */
              selectionThresholdPct: toThreshold(values.selectionThresholdPct),
              /* Three intents: a changed selection sends the list; "Use
                 company defaults" on a job that had its own sends `null`;
                 anything else leaves the field out, so the rounds are
                 untouched. */
              rounds: editRounds.changed
                ? editRounds.rounds
                : editFollows && editing.rounds
                  ? null
                  : undefined,
              /* **Brings the job over to voice**, and this reverses a call made
                 on 2026-08-27.

                 That decision was "no backfill — jobs created before voice stay
                 typed, and voice is opted into on new jobs at creation", and the
                 objection to sending it here was a fair one: a silent modality
                 change as a side effect of editing a job title is the kind of
                 thing nobody looks for and nobody connects to the edit
                 afterwards.

                 What overtook it is that voice stopped being *a* mode and became
                 **the** mode (2026-09-09, on the platform owner's ask that every
                 interview link open the spoken room). There is no longer a
                 modality to change silently: an old job scheduling a typed
                 interview is not a preference being respected, it is a candidate
                 getting a different and worse product because of when their job
                 was created.

                 So a save converges the job, and the schedule call sends it per
                 interview as well — see `scheduleCandidates`. Two layers,
                 because the schedule endpoint's support for the field is
                 unconfirmed and this one's is not. */
              voiceMode: true,
            },
          })
          setEditing(null)
        }}
      />
    </>
  )
}
