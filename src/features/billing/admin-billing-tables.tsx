import type { ReactNode } from "react"
import { AlertTriangle } from "lucide-react"

import { DataTable } from "@/components/shared/data-table"
import {
  formatCredits,
  type CreditTransaction,
  type Payment,
} from "@/services/billing"
import { cn } from "@/lib/utils"

import {
  paymentColumns,
  transactionColumns,
  transactionFilters,
} from "./credit-tables"
import { isLowBalance } from "./pricing"

/**
 * A balance as the super admin sees it: red at zero, amber with a warning
 * icon once it's below two interviews' worth.
 */
export function BalanceFigure({
  balance,
  interviewCost,
  className,
}: {
  balance: number
  interviewCost: number
  className?: string
}) {
  const low = isLowBalance(balance, interviewCost)
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 font-semibold tabular-nums",
        balance === 0
          ? "text-red-600 dark:text-red-400"
          : low
            ? "text-amber-600 dark:text-amber-400"
            : "text-foreground",
        className
      )}
    >
      {formatCredits(balance)}
      {low ? (
        <AlertTriangle className="size-3.5" aria-label="Running low" />
      ) : null}
    </span>
  )
}

/** The figures row at the top of a super-admin detail dialog. */
export function FigureGrid({
  figures,
}: {
  figures: Array<{ label: string; value: ReactNode; note?: string }>
}) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {figures.map((figure) => (
        <div
          key={figure.label}
          className="min-w-0 rounded-xl border bg-muted/30 px-3 py-2.5"
        >
          <p className="text-xs text-muted-foreground">{figure.label}</p>
          <p className="truncate text-lg font-bold tabular-nums">
            {figure.value}
          </p>
          {figure.note ? (
            <p className="truncate text-xs text-muted-foreground">
              {figure.note}
            </p>
          ) : null}
        </div>
      ))}
    </div>
  )
}

/** One admin's credit log, without HR names: the super admin never sees them. */
export function AdminCreditLog({
  log,
  loading,
}: {
  log: CreditTransaction[]
  loading: boolean
}) {
  return (
    <DataTable
      rows={log}
      columns={transactionColumns({ showUser: false })}
      getRowId={(row) => row.id}
      loading={loading}
      filters={transactionFilters(log, { byUser: false })}
      emptyMessage="No credit movements yet."
    />
  )
}

/** One admin's payments. Checkouts that were never paid are left out. */
export function AdminPayments({
  payments,
  loading,
}: {
  payments: Payment[]
  loading: boolean
}) {
  return (
    <DataTable
      rows={payments.filter((p) => p.status !== "created")}
      columns={paymentColumns({ showPaidBy: true })}
      getRowId={(row) => row.id}
      loading={loading}
      emptyMessage="No payments yet."
    />
  )
}
