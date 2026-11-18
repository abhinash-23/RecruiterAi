import * as React from "react"
import { useSearchParams } from "react-router-dom"
import {
  CalendarCheck,
  Coins,
  CreditCard,
  Plus,
  Receipt,
  RefreshCw,
  Send,
  Wallet,
} from "lucide-react"
import { toast } from "sonner"

import { DataTable } from "@/components/shared/data-table"
import { IconAction } from "@/components/shared/icon-action"
import { MetaChip, PageHeader } from "@/components/shared/page-header"
import { StatCard } from "@/components/shared/stat-card"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { BuyCreditsDialog } from "@/features/billing/buy-credits-dialog"
import { CheckoutReturnDialog } from "@/features/billing/checkout-return-dialog"
import { AmountsByCurrency } from "@/features/billing/credit-cells"
import {
  paymentColumns,
  transactionColumns,
  transactionFilters,
} from "@/features/billing/credit-tables"
import {
  announceCheckout,
  CHECKOUT_PARAM,
  clearPendingCheckout,
  closeCheckoutTab,
  readPendingCheckout,
} from "@/features/billing/stripe-checkout"
import {
  PAYMENT_STATUS_LABEL,
  formatCredits,
  formatMoney,
  sumAmounts,
  useCreditTransactions,
  usePayments,
  useWallet,
} from "@/services/billing"

/**
 * The admin's wallet: the balance, buying more through Stripe, and where
 * every credit went. Credits are shared with the admin's HRs, who see the
 * balance in their top bar but can't buy or read this page.
 */
export function BillingPage() {
  const wallet = useWallet()
  const transactions = useCreditTransactions()
  const payments = usePayments()
  const [buying, setBuying] = React.useState(false)

  /* Stripe sends the admin back here: `?session_id=cs_…` after paying,
     `?payment=cancelled` after backing out. The id is read from the URL, or
     from this tab's copy if the URL somehow lost it. */
  const [params, setParams] = useSearchParams()
  const returnedSession = params.has(CHECKOUT_PARAM.session)
    ? params.get(CHECKOUT_PARAM.session)?.startsWith("cs_")
      ? params.get(CHECKOUT_PARAM.session)
      : readPendingCheckout()
    : null
  const cancelled =
    params.get(CHECKOUT_PARAM.payment) === CHECKOUT_PARAM.cancelled
  /** A row's "Check payment": an unfinished Stripe checkout, confirmed late. */
  const [checking, setChecking] = React.useState<string | null>(null)
  const confirming = returnedSession ?? checking

  const clearReturn = React.useCallback(() => {
    setParams(
      (current) => {
        const next = new URLSearchParams(current)
        next.delete(CHECKOUT_PARAM.session)
        next.delete(CHECKOUT_PARAM.payment)
        return next
      },
      { replace: true }
    )
  }, [setParams])

  // Backing out on Stripe's page isn't an error — say so once, then tidy up.
  React.useEffect(() => {
    if (!cancelled) return
    clearPendingCheckout()
    toast.info("Payment cancelled. Nothing was charged.")
    // The tab that opened Stripe is waiting; tell it, and step out of its way.
    announceCheckout({ type: "cancelled" })
    clearReturn()
    closeCheckoutTab()
  }, [cancelled, clearReturn])

  const log = transactions.data?.rows ?? []
  /* A Razorpay order opened and never paid isn't a payment, so those stay
     hidden. A Stripe checkout that wasn't completed is listed: it may have
     been paid in a tab that closed before coming back, and Check payment on
     its row confirms it. */
  const attempts = (payments.data?.rows ?? []).filter(
    (p) => p.status !== "created" || p.provider === "stripe"
  )
  const paid = attempts.filter((p) => p.status === "paid")

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
  const paidTotal = sumAmounts(
    paid.map((row) => ({ [row.currency]: row.totalMinor ?? 0 }))
  )
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
                {data.interviewPriceMinor !== null
                  ? `${formatMoney(data.interviewPriceMinor, data.currency)} per interview`
                  : `${formatCredits(data.interviewCost)} credits per interview`}
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
          value={<AmountsByCurrency amounts={paidTotal} />}
          icon={CreditCard}
          tone="info"
          note={
            <>
              {paid.length} {paid.length === 1 ? "payment" : "payments"}, tax
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
                {attempts.length}
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
            rows={attempts}
            columns={paymentColumns({ showPaidBy: true })}
            getRowId={(row) => row.id}
            loading={payments.isLoading}
            filters={[
              {
                id: "status",
                label: "Status",
                options: (
                  ["paid", "created", "failed", "expired"] as const
                ).map((value) => ({
                  value,
                  label: PAYMENT_STATUS_LABEL[value],
                })),
                predicate: (row, value) => row.status === value,
              },
            ]}
            searchAccessor={(row) =>
              `${row.reference ?? ""} ${row.paidBy?.fullName ?? ""}`
            }
            searchPlaceholder="Search reference or person…"
            inlineActions={(row) =>
              row.provider === "stripe" &&
              row.status === "created" &&
              row.reference?.startsWith("cs_") ? (
                <IconAction
                  label="Check payment"
                  Icon={RefreshCw}
                  onSelect={() => setChecking(row.reference)}
                />
              ) : null
            }
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

      {confirming ? (
        <CheckoutReturnDialog
          key={confirming}
          sessionId={confirming}
          interviewCost={data?.interviewCost ?? 1}
          onClose={() => {
            // Back from Stripe in its own tab: close it, so the admin is left
            // on the tab they started from, which already shows the credits.
            if (returnedSession) closeCheckoutTab()
            setChecking(null)
            clearReturn()
          }}
          onStartAgain={() => {
            setChecking(null)
            clearReturn()
            setBuying(true)
          }}
        />
      ) : null}
    </>
  )
}
