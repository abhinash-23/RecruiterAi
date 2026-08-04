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
import { JOB_FIELDS } from "@/config/entities"
import { useCurrentUser } from "@/features/auth/auth-context"
import { ROLE_HOME } from "@/features/auth/types"
import {
  useJobMutations,
  useJobs,
  type Job,
  type JobStatus,
} from "@/services/hr"

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
          <Button onClick={() => setCreating(true)}>
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
              onSelect={() => setEditing(row)}
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
        onSubmit={async (values) => {
          const job = await mutations.create.mutateAsync({
            title: String(values.title),
            jobDescription: String(values.jobDescription),
            role: String(values.role),
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
        initialValues={
          editing
            ? {
                title: editing.title,
                role: editing.role,
                jobDescription: editing.jobDescription,
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
            },
          })
          setEditing(null)
        }}
      />
    </>
  )
}
