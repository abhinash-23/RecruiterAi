import type { Column, FilterSpec } from "@/components/shared/data-table"
import { StatusBadge } from "@/components/shared/status-badge"
import {
  TRANSACTION_LABEL,
  formatCredits,
  formatPaise,
  type CreditTransaction,
  type Payment,
  type TransactionType,
} from "@/services/billing"
import { cn } from "@/lib/utils"

import { TypePill, When } from "./credit-cells"

/**
 * The credit log's columns. `showUser` is off for the super admin, whose rows
 * carry no user: they never see which HR did what.
 */
export function transactionColumns({
  showUser,
}: {
  showUser: boolean
}): Array<Column<CreditTransaction>> {
  const columns: Array<Column<CreditTransaction>> = [
    {
      id: "when",
      header: "Date",
      cell: (row) => <When iso={row.createdAt} />,
    },
    {
      id: "type",
      header: "Type",
      cell: (row) => <TypePill type={row.type} />,
    },
    {
      id: "details",
      header: "Details",
      hideOnMobile: true,
      cell: (row) =>
        row.candidateName || row.jobTitle ? (
          <div className="min-w-0">
            <p className="truncate font-medium">{row.candidateName ?? "-"}</p>
            {row.jobTitle ? (
              <p className="truncate text-xs text-muted-foreground">
                {row.jobTitle}
              </p>
            ) : null}
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">
            {row.note ??
              (row.type === "signup_bonus"
                ? "Welcome credits"
                : row.paymentId
                  ? "Razorpay payment"
                  : "")}
          </span>
        ),
    },
  ]

  if (showUser) {
    columns.push({
      id: "user",
      header: "By",
      hideOnMobile: true,
      cell: (row) => (
        <span className="text-xs text-muted-foreground">
          {row.user?.fullName ?? "System"}
        </span>
      ),
    })
  }

  columns.push(
    {
      id: "amount",
      header: "Credits",
      className: "text-right",
      cell: (row) => (
        <span
          className={cn(
            "block text-right font-semibold whitespace-nowrap tabular-nums",
            row.amount > 0
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-foreground"
          )}
        >
          {row.amount > 0 ? "+" : "−"}
          {formatCredits(Math.abs(row.amount))}
        </span>
      ),
    },
    {
      id: "balance",
      header: "Balance after",
      className: "text-right",
      hideOnMobile: true,
      cell: (row) => (
        <span className="block text-right whitespace-nowrap text-muted-foreground tabular-nums">
          {formatCredits(row.balanceAfter)}
        </span>
      ),
    }
  )
  return columns
}

export function transactionFilters(
  rows: CreditTransaction[],
  { byUser }: { byUser: boolean }
): Array<FilterSpec<CreditTransaction>> {
  const filters: Array<FilterSpec<CreditTransaction>> = [
    {
      id: "type",
      label: "Type",
      options: (Object.keys(TRANSACTION_LABEL) as TransactionType[]).map(
        (type) => ({ value: type, label: TRANSACTION_LABEL[type] })
      ),
      predicate: (row, value) => row.type === value,
    },
  ]

  if (byUser) {
    const people = new Map<string, string>()
    for (const row of rows) {
      if (row.user) people.set(row.user.userId, row.user.fullName)
    }
    if (people.size > 1) {
      filters.push({
        id: "user",
        label: "By",
        options: [...people].map(([value, label]) => ({ value, label })),
        predicate: (row, value) => row.user?.userId === value,
      })
    }
  }
  return filters
}

const PAYMENT_STATUS: Record<string, { status: string; label: string }> = {
  paid: { status: "completed", label: "Paid" },
  failed: { status: "rejected", label: "Failed" },
  created: { status: "draft", label: "Not completed" },
}

export function paymentColumns({
  showPaidBy,
}: {
  showPaidBy: boolean
}): Array<Column<Payment>> {
  const columns: Array<Column<Payment>> = [
    {
      id: "when",
      header: "Date",
      cell: (row) => <When iso={row.paidAt ?? row.createdAt} />,
    },
    {
      id: "credits",
      header: "Credits",
      cell: (row) => (
        <span className="font-semibold tabular-nums">
          {formatCredits(row.credits)}
        </span>
      ),
    },
    {
      id: "amount",
      header: "Amount",
      hideOnMobile: true,
      cell: (row) => (
        <div className="flex flex-col gap-0.5 tabular-nums">
          <span className="whitespace-nowrap">
            {formatPaise(row.amountPaise)}
          </span>
          <span className="text-xs whitespace-nowrap text-muted-foreground">
            + {formatPaise(row.gstPaise)} GST
          </span>
        </div>
      ),
    },
    {
      id: "total",
      header: "Total paid",
      cell: (row) => (
        <span className="font-semibold whitespace-nowrap tabular-nums">
          {formatPaise(row.totalPaise)}
        </span>
      ),
    },
    {
      id: "status",
      header: "Status",
      cell: (row) => (
        <StatusBadge
          {...(PAYMENT_STATUS[row.status] ?? {
            status: row.status,
            label: row.status,
          })}
        />
      ),
    },
  ]

  if (showPaidBy) {
    columns.push({
      id: "paidBy",
      header: "Paid by",
      hideOnMobile: true,
      cell: (row) => (
        <span className="text-xs text-muted-foreground">
          {row.paidBy?.fullName ?? "-"}
        </span>
      ),
    })
  }

  columns.push({
    id: "reference",
    header: "Payment ID",
    hideOnMobile: true,
    cell: (row) => (
      <span className="font-mono text-xs break-all text-muted-foreground">
        {row.razorpayPaymentId ?? row.razorpayOrderId ?? "-"}
      </span>
    ),
  })
  return columns
}
