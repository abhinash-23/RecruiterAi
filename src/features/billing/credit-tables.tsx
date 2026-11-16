import type { Column, FilterSpec } from "@/components/shared/data-table"
import { StatusBadge } from "@/components/shared/status-badge"
import {
  PAYMENT_STATUS_LABEL,
  TRANSACTION_LABEL,
  formatCredits,
  formatMoney,
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
                : row.type === "grant"
                  ? "Added by Recruiter AI"
                  : row.paymentId
                    ? "Card payment"
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

/** Status → the badge tone it wears; the words come from the service. */
const PAYMENT_TONE: Record<string, string> = {
  paid: "completed",
  failed: "rejected",
  created: "draft",
  expired: "expired",
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
            {formatMoney(row.subtotalMinor, row.currency)}
          </span>
          {/* Tax is known only once paid, and named for where it came from:
              GST on the old rupee payments, the buyer's region on Stripe. */}
          {row.taxMinor ? (
            <span className="text-xs whitespace-nowrap text-muted-foreground">
              + {formatMoney(row.taxMinor, row.currency)}{" "}
              {row.currency === "inr"
                ? "GST"
                : `tax${row.billingCountry ? ` (${[row.billingCountry, row.billingRegion].filter(Boolean).join(" / ")})` : ""}`}
            </span>
          ) : null}
        </div>
      ),
    },
    {
      id: "total",
      header: "Total paid",
      cell: (row) => (
        <span className="font-semibold whitespace-nowrap tabular-nums">
          {row.totalMinor !== null
            ? formatMoney(row.totalMinor, row.currency)
            : "—"}
        </span>
      ),
    },
    {
      id: "status",
      header: "Status",
      cell: (row) => (
        <div className="flex flex-col items-start gap-0.5">
          <StatusBadge
            status={PAYMENT_TONE[row.status] ?? row.status}
            label={PAYMENT_STATUS_LABEL[row.status] ?? row.status}
          />
          {row.failureReason ? (
            <span className="max-w-48 text-xs text-muted-foreground">
              {row.failureReason}
            </span>
          ) : null}
        </div>
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
    header: "Reference",
    hideOnMobile: true,
    cell: (row) => (
      <div className="flex flex-col gap-0.5">
        <span className="font-mono text-xs break-all text-muted-foreground">
          {row.reference ?? "-"}
        </span>
        <span className="text-[0.6875rem] text-muted-foreground capitalize">
          {row.provider}
        </span>
      </div>
    ),
  })
  return columns
}
