import { useNavigate } from "react-router-dom"
import { FileText } from "lucide-react"

import {
  DataTable,
  type Column,
  type FilterSpec,
} from "@/components/shared/data-table"
import { IconAction } from "@/components/shared/icon-action"
import { PageHeader } from "@/components/shared/page-header"
import { StatusBadge } from "@/components/shared/status-badge"
import { useCurrentUser } from "@/features/auth/auth-context"
import { ROLE_HOME } from "@/features/auth/types"
import {
  recruiterFilter,
  schedulerLabel,
} from "@/features/dashboard/interview-scheduler"
import {
  formatPct,
  selectionThreshold,
} from "@/features/dashboard/selection-threshold"
import { scoreTone } from "@/features/dashboard/score-tone"
import {
  isSelectedResult,
  useInterviews,
  type InterviewRow,
} from "@/services/hr"
import { cn } from "@/lib/utils"

/**
 * Finished interviews only — the same `GET /api/interviews` list as the
 * Interviews page, narrowed to rows that actually have a report.
 *
 * There is no separate "results" endpoint for a list: a report is fetched one
 * interview at a time via `GET /api/get-results/{id}`, which is what the detail
 * page does.
 */
export function ResultsPage() {
  const user = useCurrentUser()
  const navigate = useNavigate()
  const { data, isLoading } = useInterviews()

  const rows = (data ?? []).filter((row) => row.hasResults)

  const open = (row: InterviewRow) =>
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
      id: "answered",
      header: "Answered",
      hideOnMobile: true,
      className: "tabular-nums",
      cell: (row) => row.answered ?? "—",
    },
    {
      id: "score",
      header: "Score",
      className: "tabular-nums",
      cell: (row) => (
        <div className="flex flex-col gap-0.5">
          <span
            className={cn(
              "text-lg leading-none font-semibold",
              scoreTone(row.overallScore)
            )}
          >
            {row.overallScore ?? "—"}
          </span>
          {/* The bar under the score, so a 78 marked "Not selected" is readable
              as such in the list rather than only in the report. Only beside a
              real score: on a sitting with nothing to judge yet, the bar it will
              face is not what the row is about. */}
          {row.overallScore !== null ? (
            <span className="text-[11px] text-muted-foreground tabular-nums">
              bar {formatPct(selectionThreshold(row.selectionThresholdPct).value)}
            </span>
          ) : null}
        </div>
      ),
    },
    {
      id: "outcome",
      header: "Outcome",
      cell: (row) =>
        row.result ? (
          <StatusBadge
            status={isSelectedResult(row.result) ? "completed" : "disabled"}
            label={isSelectedResult(row.result) ? "Selected" : "Not selected"}
          />
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      // Null for machine-key and legacy rows. An admin filtering by recruiter
      // has to be able to see what they filtered by; an HR only ever sees their
      // own candidates, so this is dropped for them below — the same rule as the
      // Interviews list, which reads the very same rows.
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

  const outcomeFilter: FilterSpec<InterviewRow> = {
    id: "outcome",
    label: "Outcome",
    options: [
      { value: "selected", label: "Selected" },
      { value: "rejected", label: "Not selected" },
    ],
    // Matched on the normalised outcome, never the raw string: the server sends
    // "NOT SELECTED" with a space where the docs promise "NOT_SELECTED", so a
    // literal comparison silently matches nothing.
    predicate: (row, value) =>
      row.result === null
        ? false
        : isSelectedResult(row.result) === (value === "selected"),
  }

  /*
   * HR sees only their own candidates, so a "whose is this" dropdown would have
   * exactly one entry and narrow nothing. The admin gets it, built from the rows
   * on screen — see `recruiterFilter`.
   */
  const filters =
    user.role === "hr" ? [outcomeFilter] : [outcomeFilter, recruiterFilter(rows)]

  const visibleColumns =
    user.role === "hr"
      ? columns.filter((column) => column.id !== "scheduledBy")
      : columns

  return (
    <>
      <PageHeader
        title="Results"
        description="Completed interviews with a scored report. Open one for the round breakdown, answers and vitals."
      />

      <DataTable
        rows={rows}
        columns={visibleColumns}
        getRowId={(row) => row.interviewId}
        loading={isLoading}
        onRowClick={open}
        searchAccessor={(row) =>
          `${row.candidateName} ${row.candidateEmail} ${row.role}`
        }
        // The name is what a recruiter is nearly always looking for, and on this
        // data an email substring drowns it — see `searchPrimary`.
        searchPrimary={(row) => row.candidateName}
        searchPlaceholder="Search candidate, email or role…"
        filters={filters}
        // The one action this page has, straight in the cell — a `⋯` menu
        // hiding a single item is two clicks for no reason.
        inlineActions={(row) => (
          <IconAction
            label="View report"
            Icon={FileText}
            onSelect={() => open(row)}
          />
        )}
        emptyMessage="No completed interviews yet."
      />
    </>
  )
}
