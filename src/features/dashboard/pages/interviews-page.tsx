import * as React from "react"
import { useNavigate } from "react-router-dom"
import { format, formatDistanceToNow } from "date-fns"
import { Mail, MessageCircle, Plus } from "lucide-react"

import {
  DataTable,
  type Column,
  type FilterSpec,
} from "@/components/shared/data-table"
import { IconAction } from "@/components/shared/icon-action"
import { PageHeader } from "@/components/shared/page-header"
import { StatusBadge } from "@/components/shared/status-badge"
import { Button } from "@/components/ui/button"
import { NewInterviewDialog } from "@/features/dashboard/new-interview-dialog"
import {
  badgeStatus,
  STATUS_LABEL,
} from "@/features/dashboard/interview-status"
import { SendInviteDialog } from "@/features/dashboard/send-invite-dialog"
import { useCurrentUser } from "@/features/auth/auth-context"
import { ROLE_HOME } from "@/features/auth/types"
import { useInterviews, type InterviewRow } from "@/services/hr"

/**
 * Stands in for `createdBy: null` in the recruiter filter — rows created by a
 * machine key or before the field existed, shown as "System / API" in the
 * column. A filter value can't be null, and grouping them under one key beats
 * dropping them from the list.
 */
const SYSTEM_SCHEDULED = "__system__"

/**
 * Interviews still in flight, from `GET /api/interviews` — everything invited,
 * under way, or that ended without a report. **Completed sittings are filtered
 * out**; they live on Results, with their scores.
 *
 * HR sees their own; an admin sees the whole company — **provided the tenant
 * has data isolation enforced.** Without it the API returns other tenants'
 * interviews too, which the super admin console flags and repairs.
 */
export function InterviewsPage() {
  const user = useCurrentUser()
  const navigate = useNavigate()
  const { data, isLoading } = useInterviews()

  // Filtered here rather than through `?status=`: that parameter takes one
  // status, and this page wants every status *except* one.
  const rows = (data ?? []).filter((row) => row.status !== "completed")

  const [creating, setCreating] = React.useState(false)

  /** The row and channel whose invite dialog is open, or null. */
  const [inviting, setInviting] = React.useState<{
    row: InterviewRow
    channel: "email" | "whatsapp"
  } | null>(null)

  // Sampled once per mount rather than read during each render: a link that
  // lapses while the page sits open shouldn't make the button disappear out
  // from under the pointer, and the server re-checks the expiry regardless.
  const [now] = React.useState(() => Date.now())

  const openResult = (row: InterviewRow) =>
    navigate(`${ROLE_HOME[user.role]}/results/${row.interviewId}`)

  const columns: Array<Column<InterviewRow>> = [
    {
      id: "candidate",
      header: "Candidate",
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.candidateName}</p>
          <p className="truncate text-xs text-muted-foreground">
            {row.candidateEmail}
          </p>
        </div>
      ),
    },
    {
      id: "role",
      header: "Role",
      cell: (row) => <span className="text-muted-foreground">{row.role}</span>,
    },
    {
      id: "invited",
      header: "Invited",
      hideOnMobile: true,
      // Stacked over short lines rather than one long nowrap run.
      cell: (row) => (
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="font-semibold whitespace-nowrap">
            {format(new Date(row.createdAt), "EEE, MMM d")}
          </span>
          <span className="text-xs whitespace-nowrap text-muted-foreground">
            {formatDistanceToNow(new Date(row.createdAt), { addSuffix: true })}
          </span>
          <span className="text-xs whitespace-nowrap text-muted-foreground">
            link {row.expiryAt > Date.now() ? "expires" : "expired"}{" "}
            {formatDistanceToNow(new Date(row.expiryAt), { addSuffix: true })}
          </span>
        </div>
      ),
    },
    // No Score column: a score only exists once a sitting is completed, and
    // completed sittings are on Results. Here it was a column of dashes.
    {
      id: "status",
      header: "Status",
      cell: (row) => (
        <StatusBadge
          status={badgeStatus(row.status)}
          label={STATUS_LABEL[row.status] ?? row.status}
        />
      ),
    },
    {
      // Null for machine-key and legacy rows. An admin wants to know who
      // scheduled what; an HR only ever sees their own, so the column is
      // dropped for them below.
      id: "scheduledBy",
      header: "Scheduled by",
      hideOnMobile: true,
      cell: (row) => (
        <span className="text-xs text-muted-foreground">
          {row.createdBy?.fullName ?? row.createdBy?.email ?? "System / API"}
        </span>
      ),
    },
  ]

  /**
   * The recruiters who actually scheduled something, built from the rows rather
   * than from `GET /api/company/hrs`.
   *
   * Two reasons: it costs no extra request, and it can only offer names that
   * match at least one row — a seat that has scheduled nothing would otherwise
   * sit in the list filtering the table to empty.
   */
  const recruiters = (() => {
    const seen = new Map<string, string>()
    for (const row of rows) {
      const id = row.createdBy?.userId ?? SYSTEM_SCHEDULED
      if (!seen.has(id)) {
        seen.set(
          id,
          row.createdBy?.fullName || row.createdBy?.email || "System / API"
        )
      }
    }
    return [...seen]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label))
  })()

  const filters: Array<FilterSpec<InterviewRow>> =
    // HR only ever sees their own interviews, so a "whose is this" filter would
    // have exactly one entry. The Status filter is gone: on a page that already
    // excludes finished sittings, the remaining states are visible in the column
    // and rarely worth narrowing to.
    user.role === "hr"
      ? []
      : [
          {
            id: "recruiter",
            label: "Recruiters",
            options: recruiters,
            predicate: (row, value) =>
              (row.createdBy?.userId ?? SYSTEM_SCHEDULED) === value,
          },
        ]

  /**
   * Sending is offered while the link is still usable. An expired link lands
   * the candidate on a dead page, and an invitation to one is worse than no
   * button at all.
   */
  const canSend = (row: InterviewRow, now: number) => row.expiryAt > now

  const visibleColumns =
    user.role === "hr"
      ? columns.filter((column) => column.id !== "scheduledBy")
      : columns

  return (
    <>
      <PageHeader
        title="Interviews"
        description="Sittings still in flight — invited, under way, or ended without a report. Finished ones are on Results."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus />
            New interview
          </Button>
        }
      />

      <DataTable
        rows={rows}
        columns={visibleColumns}
        getRowId={(row) => row.interviewId}
        loading={isLoading}
        onRowClick={(row) => {
          if (row.hasResults) openResult(row)
        }}
        searchAccessor={(row) =>
          `${row.candidateName} ${row.candidateEmail} ${row.role}`
        }
        searchPlaceholder="Search candidate, email or role…"
        filters={filters}
        // One button per channel rather than a `⋯` menu. Each opens the same
        // dialog with its own channel pre-selected, so "Both" is still one
        // click away.
        inlineActions={(row) =>
          canSend(row, now) ? (
            <>
              <IconAction
                label="Send invite by email"
                Icon={Mail}
                onSelect={() => setInviting({ row, channel: "email" })}
              />
              <IconAction
                label="Send invite on WhatsApp"
                Icon={MessageCircle}
                onSelect={() => setInviting({ row, channel: "whatsapp" })}
              />
            </>
          ) : null
        }
        emptyMessage="Nothing in flight — schedule candidates from a job's shortlist, or check Results for finished sittings."
      />

      <NewInterviewDialog open={creating} onOpenChange={setCreating} />

      {/* Keyed so each opening starts on the channel whose icon was clicked,
          rather than inheriting the previous selection. */}
      <SendInviteDialog
        key={`${inviting?.row.interviewId ?? ""}-${inviting?.channel ?? ""}`}
        row={inviting?.row ?? null}
        initialChannel={inviting?.channel}
        open={inviting !== null}
        onOpenChange={(next) => {
          if (!next) setInviting(null)
        }}
      />
    </>
  )
}
