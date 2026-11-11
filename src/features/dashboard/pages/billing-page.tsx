import * as React from "react"
import {
  CalendarCheck,
  Coins,
  CreditCard,
  Plus,
  Receipt,
  Send,
  Wallet,
} from "lucide-react"

import { DataTable } from "@/components/shared/data-table"
import { MetaChip, PageHeader } from "@/components/shared/page-header"
import { StatCard } from "@/components/shared/stat-card"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { BuyCreditsDialog } from "@/features/billing/buy-credits-dialog"
import {
  paymentColumns,
  transactionColumns,
  transactionFilters,
} from "@/features/billing/credit-tables"
import {
  formatCredits,
  formatPaise,
  useCreditTransactions,
  usePayments,
  useWallet,
} from "@/services/billing"

/**
 * The admin's wallet: the balance, buying more through Razorpay, and where
 * every credit went. Credits are shared with the admin's HRs, who see the
 * balance in their top bar but can't buy or read this page.
 */
export function BillingPage() {
  const wallet = useWallet()
  const transactions = useCreditTransactions()
  const payments = usePayments()
  const [buying, setBuying] = React.useState(false)

  const log = transactions.data?.rows ?? []
  const paid = (payments.data?.rows ?? []).filter((p) => p.status === "paid")

  // From the rows loaded (the latest 200), which is the whole history for
  // nearly every company; the notes say so when it isn't.
  const spent = log
    .filter((row) => row.type === "interview_charge")
    .reduce((sum, row) => sum + Math.abs(row.amount), 0)
  const refunded = log
    .filter((row) => row.type === "refund")
    .reduce((sum, row) => sum + row.amount, 0)
  const interviewsSent = log.filter(
    (row) => row.type === "interview_charge"
  ).length
  const paidTotal = paid.reduce((sum, row) => sum + row.totalPaise, 0)
  const partialLog =
    transactions.data !== undefined && transactions.data.count > log.length
  const partialPayments =
    payments.data !== undefined &&
    payments.data.count > payments.data.rows.length

  if (wallet.isError) {
    return (
      <>
        <PageHeader title="Billing & Credits" icon={Wallet} />
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <span className="flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
              <Wallet className="size-6" />
            </span>
            <p className="font-medium">Credits aren&rsquo;t available yet</p>
            <p className="max-w-md text-sm text-muted-foreground">
              {wallet.error.message} Billing appears here once the server has it
              switched on.
            </p>
          </CardContent>
        </Card>
      </>
    )
  }

  const data = wallet.data
  const low = data !== undefined && data.interviewsLeft < 2

  return (
    <>
      <PageHeader
        title="Billing & Credits"
        icon={Wallet}
        description="Your company's credits, shared with your HR team. Buy more here, and see where every credit went."
        meta={
          data ? (
            <>
              <MetaChip tone="brand">
                <Coins className="size-3" />
                {formatCredits(data.balance)} credits
              </MetaChip>
              <MetaChip>
                {formatCredits(data.interviewCost)} credits per interview
              </MetaChip>
              {low ? (
                <MetaChip
                  tone={data.interviewsLeft === 0 ? "danger" : "warning"}
                >
                  {data.interviewsLeft === 0 ? "Out of credits" : "Running low"}
                </MetaChip>
              ) : null}
            </>
          ) : null
        }
        actions={
          <Button onClick={() => setBuying(true)} disabled={!data}>
            <Plus />
            Buy credits
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {/* The balance: the same card as its neighbours, marked out only by
            the accent edge and the one action on the page that matters. */}
        {data ? (
          <Card className="relative gap-0 px-5 transition-shadow hover:shadow-brand">
            <span
              aria-hidden
              className="absolute inset-y-0 left-0 w-1 bg-accent-brand"
            />
            <div className="flex h-10 items-start justify-between gap-3">
              <p className="text-sm leading-5 font-medium text-muted-foreground">
                Available credits
              </p>
              <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent-brand-muted text-accent-brand">
                <Coins className="size-[1.125rem]" />
              </span>
            </div>
            <p className="mt-1 truncate text-3xl font-bold tracking-tight tabular-nums">
              {formatCredits(data.balance)}
            </p>
            <div className="mt-auto flex items-center justify-between gap-2 pt-4">
              <p className="truncate text-xs text-muted-foreground">
                1 credit = ₹1
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setBuying(true)}
                className="shrink-0"
              >
                <Plus />
                Top up
              </Button>
            </div>
          </Card>
        ) : (
          <Skeleton className="h-36 w-full rounded-2xl" />
        )}

        <StatCard
          label="Interviews left"
          value={data ? data.interviewsLeft : "-"}
          icon={CalendarCheck}
          tone={
            !data
              ? "neutral"
              : data.interviewsLeft === 0
                ? "danger"
                : low
                  ? "warning"
                  : "success"
          }
          note={
            data
              ? `${formatCredits(data.interviewCost)} credits each, charged when sent`
              : null
          }
        />
        <StatCard
          label="Spent on interviews"
          value={formatCredits(spent - refunded)}
          icon={Send}
          tone="brand"
          note={
            <>
              {interviewsSent} sent
              {refunded > 0 ? `, ${formatCredits(refunded)} refunded` : ""}
              {partialLog ? " (latest 200 entries)" : ""}
            </>
          }
        />
        <StatCard
          label="Total purchased"
          value={formatPaise(paidTotal)}
          icon={CreditCard}
          tone="info"
          note={
            <>
              {paid.length} {paid.length === 1 ? "payment" : "payments"}, GST
              included{partialPayments ? " (latest 200)" : ""}
            </>
          }
        />
      </div>

      <Tabs defaultValue="log" className="gap-4">
        <TabsList>
          <TabsTrigger value="log" className="px-3">
            <Receipt />
            Credit log
            {transactions.data ? (
              <span className="text-xs text-muted-foreground tabular-nums">
                {transactions.data.count}
              </span>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="payments" className="px-3">
            <CreditCard />
            Payments
            {payments.data ? (
              <span className="text-xs text-muted-foreground tabular-nums">
                {payments.data.count}
              </span>
            ) : null}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="log">
          <DataTable
            rows={log}
            columns={transactionColumns({ showUser: true })}
            getRowId={(row) => row.id}
            loading={transactions.isLoading}
            filters={transactionFilters(log, { byUser: true })}
            searchAccessor={(row) =>
              `${row.candidateName ?? ""} ${row.jobTitle ?? ""} ${row.user?.fullName ?? ""}`
            }
            searchPlaceholder="Search candidate, job or person…"
            pageSize={10}
            emptyMessage="No credit movements yet."
          />
        </TabsContent>

        <TabsContent value="payments">
          <DataTable
            rows={payments.data?.rows ?? []}
            columns={paymentColumns({ showPaidBy: true })}
            getRowId={(row) => row.id}
            loading={payments.isLoading}
            filters={[
              {
                id: "status",
                label: "Status",
                options: [
                  { value: "paid", label: "Paid" },
                  { value: "failed", label: "Failed" },
                  { value: "created", label: "Not completed" },
                ],
                predicate: (row, value) => row.status === value,
              },
            ]}
            searchAccessor={(row) =>
              `${row.razorpayPaymentId ?? ""} ${row.razorpayOrderId ?? ""} ${row.paidBy?.fullName ?? ""}`
            }
            searchPlaceholder="Search payment ID…"
            pageSize={10}
            emptyMessage="No payments yet. Buy credits to see them here."
          />
        </TabsContent>
      </Tabs>

      {data ? (
        <BuyCreditsDialog
          open={buying}
          onOpenChange={setBuying}
          wallet={data}
        />
      ) : null}
    </>
  )
}
