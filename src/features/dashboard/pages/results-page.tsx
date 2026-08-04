import { useNavigate } from "react-router-dom"
import { FileText } from "lucide-react"

import { DataTable, type Column } from "@/components/shared/data-table"
import { IconAction } from "@/components/shared/icon-action"
import { PageHeader } from "@/components/shared/page-header"
import { StatusBadge } from "@/components/shared/status-badge"
import { useCurrentUser } from "@/features/auth/auth-context"
import { ROLE_HOME } from "@/features/auth/types"
import {
  isSelectedResult,
  useInterviews,
  type InterviewRow,
} from "@/services/hr"
import { cn } from "@/lib/utils"

function scoreTone(score: number | null) {
  if (score === null) return "text-muted-foreground"
  if (score >= 70) return "text-emerald-600 dark:text-emerald-400"
  if (score >= 40) return "text-amber-600 dark:text-amber-400"
  return "text-destructive"
}

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
        <span className={cn("text-lg font-semibold", scoreTone(row.overallScore))}>
          {row.overallScore ?? "—"}
        </span>
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
  ]

  return (
    <>
      <PageHeader
        title="Results"
        description="Completed interviews with a scored report. Open one for the round breakdown, answers and vitals."
      />

      <DataTable
        rows={rows}
        columns={columns}
        getRowId={(row) => row.interviewId}
        loading={isLoading}
        onRowClick={open}
        searchAccessor={(row) =>
          `${row.candidateName} ${row.candidateEmail} ${row.role}`
        }
        searchPlaceholder="Search candidate, email or role…"
        filters={[
          {
            id: "outcome",
            label: "Outcome",
            options: [
              { value: "selected", label: "Selected" },
              { value: "rejected", label: "Not selected" },
            ],
            // Matched on the normalised outcome, never the raw string: the
            // server sends "NOT SELECTED" with a space where the docs promise
            // "NOT_SELECTED", so a literal comparison silently matches nothing.
            predicate: (row, value) =>
              row.result === null
                ? false
                : isSelectedResult(row.result) === (value === "selected"),
          },
        ]}
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
