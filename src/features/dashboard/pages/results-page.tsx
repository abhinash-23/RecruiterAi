import * as React from "react"
import { useNavigate } from "react-router-dom"
import { BarChart3, FileArchive, FileText } from "lucide-react"

import {
  DataTable,
  type Column,
  type FilterSpec,
} from "@/components/shared/data-table"
import { IconAction } from "@/components/shared/icon-action"
import { MetaChip, PageHeader } from "@/components/shared/page-header"
import { StatusBadge } from "@/components/shared/status-badge"
import { Button } from "@/components/ui/button"
import { useCurrentUser } from "@/features/auth/auth-context"
import { ROLE_HOME } from "@/features/auth/types"
import {
  recruiterFilter,
  schedulerLabel,
} from "@/features/dashboard/interview-scheduler"
import { FitCell } from "@/features/dashboard/fit-score"
import {
  formatPct,
  selectionThreshold,
} from "@/features/dashboard/selection-threshold"
import {
  BulkReportDialog,
  DownloadSelectedButton,
  ReportDownloadButton,
} from "@/features/dashboard/report-downloads"
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
  /* Rows ticked for a ZIP, and the dialog for everything else — by date,
     outcome and job. Both download PDF reports; neither changes anything. */
  const [picked, setPicked] = React.useState<string[]>([])
  const [bulkOpen, setBulkOpen] = React.useState(false)

  const rows = (data ?? []).filter((row) => row.hasResults)
  const selected = rows.filter(
    (row) => row.result !== null && isSelectedResult(row.result)
  ).length
  const notSelected = rows.filter(
    (row) => row.result !== null && !isSelectedResult(row.result)
  ).length

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
      // The resume fit, scored before the sitting: "82% · Strong fit", or
      // "Analysing…" while the list re-reads itself (see `useInterviews`).
      id: "fit",
      header: "Fit",
      hideOnMobile: true,
      cell: (row) => <FitCell fit={row.fit} />,
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
        <span
          className={cn(
            "text-lg leading-none font-semibold",
            scoreTone(row.overallScore)
          )}
        >
          {row.overallScore ?? "—"}
        </span>
      ),
    },
    {
      /*
       * The bar this interview was judged against, beside the score and before
       * the outcome, so a 49.7 marked Selected next to a 45.3 marked Not
       * selected explains itself. It is the interview's own bar, fixed when it
       * was scheduled from the job's setting at the time — not the job's
       * current one, which may have changed since.
       */
      id: "threshold",
      header: "Selection bar",
      className: "tabular-nums",
      cell: (row) => {
        const bar = selectionThreshold(row.selectionThresholdPct)
        return (
          <div className="flex flex-col gap-0.5">
            <span className="font-medium">{formatPct(bar.value)}%</span>
            {/* Only from a backend that sends no bar: what judged it is then
                assumed, and said to be. */}
            {bar.isDefault ? (
              <span className="text-[0.6875rem] text-muted-foreground">
                default
              </span>
            ) : null}
          </div>
        )
      },
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
    user.role === "hr"
      ? [outcomeFilter]
      : [outcomeFilter, recruiterFilter(rows)]

  const visibleColumns =
    user.role === "hr"
      ? columns.filter((column) => column.id !== "scheduledBy")
      : columns

  return (
    <>
      <PageHeader
        title="Results"
        icon={BarChart3}
        description="Completed interviews with a scored report. Open one for the round breakdown, answers and vitals."
        meta={
          isLoading ? null : (
            <>
              <MetaChip>{rows.length} completed</MetaChip>
              {selected > 0 ? (
                <MetaChip tone="success">{selected} selected</MetaChip>
              ) : null}
              {notSelected > 0 ? (
                <MetaChip>{notSelected} not selected</MetaChip>
              ) : null}
            </>
          )
        }
        actions={
          picked.length > 0 ? (
            <DownloadSelectedButton interviewIds={picked} />
          ) : (
            <Button
              variant="outline"
              onClick={() => setBulkOpen(true)}
              disabled={rows.length === 0}
            >
              <FileArchive />
              Download results
            </Button>
          )
        }
      />

      <BulkReportDialog open={bulkOpen} onOpenChange={setBulkOpen} />

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
        // Ticked rows go into one ZIP from the header button.
        selectable
        selectedIds={picked}
        onSelectionChange={setPicked}
        // Straight in the cell — a `⋯` menu hiding two items is two clicks
        // for no reason.
        inlineActions={(row) => (
          <>
            <IconAction
              label="View report"
              Icon={FileText}
              onSelect={() => open(row)}
            />
            <ReportDownloadButton
              interviewId={row.interviewId}
              variant="icon"
            />
          </>
        )}
        emptyMessage="No completed interviews yet."
      />
    </>
  )
}
