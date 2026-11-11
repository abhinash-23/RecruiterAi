import * as React from "react"
import { useNavigate } from "react-router-dom"
import { format, formatDistanceToNow } from "date-fns"
import {
  CalendarClock,
  CalendarSync,
  Mail,
  MessageCircle,
  Pencil,
  Plus,
  RotateCcw,
  Send,
} from "lucide-react"

import {
  DataTable,
  type Column,
  type FilterSpec,
} from "@/components/shared/data-table"
import { IconAction } from "@/components/shared/icon-action"
import { MetaChip, PageHeader } from "@/components/shared/page-header"
import { StatusBadge } from "@/components/shared/status-badge"
import { Button } from "@/components/ui/button"
import { useHeldCreditsChoice } from "@/features/billing/held-credits"
import { EditCandidateDialog } from "@/features/dashboard/edit-candidate-dialog"
import { NewInterviewDialog } from "@/features/dashboard/new-interview-dialog"
import { rowBadge } from "@/features/dashboard/interview-status"
import { SendInviteDialog } from "@/features/dashboard/send-invite-dialog"
import { useCurrentUser } from "@/features/auth/auth-context"
import { ROLE_HOME } from "@/features/auth/types"
import {
  recruiterFilter,
  schedulerLabel,
} from "@/features/dashboard/interview-scheduler"
import {
  useInterviews,
  useUpdateInterviewCandidate,
  type InterviewRow,
} from "@/services/hr"

/**
 * Why a sent interview can't be re-sent, or null when it can. Stands in for the
 * buttons' tooltips, because the state a disabled control is in is never
 * self-evident.
 *
 * Mirrors the invite endpoint's 409: once the sitting has started, ended, been
 * replaced or expired, a fresh invitation can't help — it needs a new interview.
 */
function resendBlocked(row: InterviewRow, now: number): string | null {
  if (row.status === "consent_given" || row.status === "in_progress") {
    return "Can't re-send: the candidate has already started"
  }
  if (
    row.status !== "created" ||
    (row.expiryAt !== null && row.expiryAt <= now)
  ) {
    return "Can't re-send: this interview has ended or expired. Create a new one."
  }
  return null
}

/** Its held credits are waiting for a Refund-or-Reschedule choice. */
function creditsOnHold(row: InterviewRow): boolean {
  return row.canRefund || row.canReschedule
}

/**
 * One line under the status badge on where the row's credits stand, or null
 * when there is nothing to say (never charged, or spent on a sitting).
 */
function CreditNote({ row }: { row: InterviewRow }) {
  if (creditsOnHold(row)) {
    return (
      <span className="text-xs font-medium whitespace-nowrap text-amber-700 dark:text-amber-400">
        {row.creditsCharged
          ? `${row.creditsCharged} credits on hold`
          : "Credits on hold"}
      </span>
    )
  }
  if (row.creditState === "refunded") {
    return (
      <span className="text-xs whitespace-nowrap text-muted-foreground">
        Credits refunded
      </span>
    )
  }
  if (row.creditState === "rescheduled") {
    return (
      <span className="text-xs whitespace-nowrap text-muted-foreground">
        Rescheduled
      </span>
    )
  }
  return null
}

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
  /** The draft whose candidate is being corrected, or null. */
  const [editing, setEditing] = React.useState<InterviewRow | null>(null)
  const update = useUpdateInterviewCandidate()
  const held = useHeldCreditsChoice()

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
      cell: (row) => {
        // A draft has no invitation and no clock yet — say so rather than
        // showing its creation as if it were the send.
        if (row.isDraft) {
          return (
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="font-semibold whitespace-nowrap">
                Not sent yet
              </span>
              <span className="text-xs whitespace-nowrap text-muted-foreground">
                saved{" "}
                {formatDistanceToNow(new Date(row.createdAt), {
                  addSuffix: true,
                })}
              </span>
            </div>
          )
        }
        // The last send, else creation — rows from before drafts existed were
        // emailed at creation and carry no `invitedAt`.
        const sentAt = row.invitedAt ?? row.createdAt
        return (
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="font-semibold whitespace-nowrap">
              {format(new Date(sentAt), "EEE, MMM d")}
            </span>
            <span className="text-xs whitespace-nowrap text-muted-foreground">
              {formatDistanceToNow(new Date(sentAt), { addSuffix: true })}
            </span>
            {row.expiryAt !== null ? (
              <span className="text-xs whitespace-nowrap text-muted-foreground">
                link {row.expiryAt > Date.now() ? "expires" : "expired"}{" "}
                {formatDistanceToNow(new Date(row.expiryAt), {
                  addSuffix: true,
                })}
              </span>
            ) : null}
          </div>
        )
      },
    },
    // No Score column: a score only exists once a sitting is completed, and
    // completed sittings are on Results. Here it was a column of dashes.
    {
      id: "status",
      header: "Status",
      cell: (row) => (
        <div className="flex flex-col items-start gap-1">
          <StatusBadge {...rowBadge(row)} />
          <CreditNote row={row} />
        </div>
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
          {schedulerLabel(row)}
        </span>
      ),
    },
  ]

  const filters: Array<FilterSpec<InterviewRow>> =
    // HR only ever sees their own interviews, so a "whose is this" filter would
    // have exactly one entry. Shared with Results, which reads the same rows.
    // The Status filter is gone: on a page that already excludes finished
    // sittings, the remaining states are visible in the column and rarely worth
    // narrowing to.
    user.role === "hr" ? [] : [recruiterFilter(rows)]

  const visibleColumns =
    user.role === "hr"
      ? columns.filter((column) => column.id !== "scheduledBy")
      : columns

  // The header's chips, in the order the description names them: drafts, then
  // invited, under way, and ended without a report. Empty groups are left out.
  const tally = (match: (row: InterviewRow) => boolean) =>
    rows.filter(match).length
  const groups = [
    { label: "draft", tone: "neutral", count: tally((row) => row.isDraft) },
    {
      label: "invited",
      tone: "brand",
      count: tally((row) => !row.isDraft && row.status === "created"),
    },
    {
      label: "under way",
      tone: "success",
      count: tally(
        (row) => row.status === "consent_given" || row.status === "in_progress"
      ),
    },
    {
      label: "with credits on hold",
      tone: "warning",
      count: tally(creditsOnHold),
    },
    {
      label: "ended without a report",
      tone: "warning",
      count: tally(
        (row) =>
          row.status !== "created" &&
          row.status !== "consent_given" &&
          row.status !== "in_progress"
      ),
    },
  ] as const

  return (
    <>
      <PageHeader
        title="Interviews"
        icon={CalendarClock}
        description="Drafts waiting to be sent, and sittings still in flight: invited, under way, or ended without a report. Finished ones are on Results."
        meta={
          data
            ? groups
                .filter((group) => group.count > 0)
                .map((group) => (
                  <MetaChip key={group.label} tone={group.tone}>
                    {group.count} {group.label}
                  </MetaChip>
                ))
            : null
        }
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
        // Same reasoning as Results: a name typed into the box should surface
        // that person, not everyone whose email happens to contain it.
        searchPrimary={(row) => row.candidateName}
        searchPlaceholder="Search candidate, email or role…"
        filters={filters}
        /* A draft offers Send and Edit — the only state in which the
           candidate's details can still change. A sent row offers Re-send, one
           button per channel rather than a `⋯` menu; each opens the same dialog
           with its own channel pre-selected, so "Both" is still one click away.

           Re-send buttons stay on screen and go disabled when the server would
           refuse them, rather than disappearing: an empty Actions cell reads as
           "this row has no actions", which sent recruiters looking for a
           permission problem. The tooltip says why. */
        inlineActions={(row) => {
          if (row.isDraft) {
            return (
              <>
                <IconAction
                  label="Edit candidate"
                  Icon={Pencil}
                  onSelect={() => setEditing(row)}
                />
                <IconAction
                  label="Send invite"
                  Icon={Send}
                  tone="positive"
                  onSelect={() => setInviting({ row, channel: "email" })}
                />
              </>
            )
          }
          /* An interview that ended unattempted: re-sending can't help, and
             what is left to decide is its credits. */
          if (creditsOnHold(row)) {
            const target = {
              interviewId: row.interviewId,
              candidateName: row.candidateName,
              credits: row.creditsCharged || undefined,
            }
            const credits = target.credits
              ? `${target.credits} credits`
              : "credits"
            return (
              <>
                <IconAction
                  label={`Refund ${credits}`}
                  Icon={RotateCcw}
                  tone="positive"
                  disabled={!row.canRefund || held.refundPending}
                  onSelect={() => held.refund(target)}
                />
                <IconAction
                  label="Reschedule for the same candidate (no new credits)"
                  Icon={CalendarSync}
                  disabled={!row.canReschedule}
                  onSelect={() => held.reschedule(target)}
                />
              </>
            )
          }
          const blocked = resendBlocked(row, now)
          return (
            <>
              <IconAction
                label={blocked ?? "Re-send invite by email"}
                Icon={Mail}
                disabled={blocked !== null}
                onSelect={() => setInviting({ row, channel: "email" })}
              />
              <IconAction
                label={blocked ?? "Send invite on WhatsApp"}
                Icon={MessageCircle}
                disabled={blocked !== null}
                onSelect={() => setInviting({ row, channel: "whatsapp" })}
              />
            </>
          )
        }}
        emptyMessage="Nothing in flight. Schedule candidates from a job's shortlist, or check Results for finished sittings."
      />

      <NewInterviewDialog open={creating} onOpenChange={setCreating} />

      {held.dialogs}

      <EditCandidateDialog
        contact={
          editing
            ? { name: editing.candidateName, email: editing.candidateEmail }
            : null
        }
        description="Only possible before the invitation is sent. The invite goes to whatever is saved here."
        pending={update.isPending}
        onSave={(changes) =>
          update.mutateAsync({
            interviewId: editing!.interviewId,
            changes: {
              ...(changes.name !== undefined
                ? { candidateName: changes.name }
                : {}),
              ...(changes.email !== undefined
                ? { candidateEmail: changes.email }
                : {}),
            },
          })
        }
        onOpenChange={(next) => {
          if (!next) setEditing(null)
        }}
      />

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
