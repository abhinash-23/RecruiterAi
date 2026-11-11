import * as React from "react"
import { format, formatDistanceToNow } from "date-fns"
import {
  AlertTriangle,
  Building2,
  Coins,
  CreditCard,
  Eye,
  Loader2,
  Receipt,
  Settings2,
  TrendingDown,
} from "lucide-react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import { DataTable, type Column } from "@/components/shared/data-table"
import { IconAction } from "@/components/shared/icon-action"
import { MetaChip, PageHeader } from "@/components/shared/page-header"
import { StatCard } from "@/components/shared/stat-card"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  paymentColumns,
  transactionColumns,
  transactionFilters,
} from "@/features/billing/credit-tables"
import {
  billingKeys,
  formatCredits,
  formatPaise,
  useAdminBilling,
  usePlatformBilling,
  type AdminCredits,
} from "@/services/billing"
import {
  putPlatformSetting,
  settingsKeys,
  usePlatformSettings,
} from "@/services/super-admin"
import { cn } from "@/lib/utils"

/** The two prices, as platform settings, and what applies until they're set. */
const PRICE_SETTINGS = {
  signup: { key: "billing_signup_credits", fallback: 200 },
  interview: { key: "billing_interview_credits", fallback: 50 },
} as const

/** A stored setting as a number: the store may hold `50` or `{ value: 50 }`. */
function storedNumber(value: unknown): number | null {
  if (typeof value === "number") return value
  if (value && typeof value === "object" && "value" in value) {
    const inner = (value as { value: unknown }).value
    return typeof inner === "number" ? inner : null
  }
  return null
}

/** Below two interviews' worth at the current price. */
function isLow(admin: AdminCredits, interviewCost: number) {
  return admin.balance < interviewCost * 2
}

/**
 * The two prices: free credits for a new admin, and credits per interview.
 * Each applies from now on; nothing already sent is repriced.
 */
function PricingDialog({
  open,
  onOpenChange,
  signup,
  interview,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  signup: number
  interview: number
}) {
  const client = useQueryClient()
  const [signupValue, setSignupValue] = React.useState(String(signup))
  const [interviewValue, setInterviewValue] = React.useState(String(interview))

  const save = useMutation({
    mutationFn: async () => {
      if (Number(signupValue) !== signup) {
        await putPlatformSetting(PRICE_SETTINGS.signup.key, Number(signupValue))
      }
      if (Number(interviewValue) !== interview) {
        await putPlatformSetting(
          PRICE_SETTINGS.interview.key,
          Number(interviewValue)
        )
      }
    },
    onSuccess: () => {
      toast.success("Pricing updated.")
      void client.invalidateQueries({ queryKey: settingsKeys.settings })
      void client.invalidateQueries({ queryKey: billingKeys.platform })
      onOpenChange(false)
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const whole = (value: string, min: number) =>
    Number.isInteger(Number(value)) && Number(value) >= min && value !== ""
  const valid = whole(signupValue, 0) && whole(interviewValue, 1)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings2 className="size-4" />
            Credit pricing
          </DialogTitle>
          <DialogDescription>
            1 credit = ₹1, GST added at checkout. Changes apply from now on:
            existing admins keep their balance, and interviews already sent keep
            the price they were charged.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="price-signup">Free credits for a new admin</Label>
            <Input
              id="price-signup"
              type="number"
              min={0}
              value={signupValue}
              onChange={(event) => setSignupValue(event.target.value)}
              aria-invalid={!whole(signupValue, 0)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="price-interview">Credits per interview</Label>
            <Input
              id="price-interview"
              type="number"
              min={1}
              value={interviewValue}
              onChange={(event) => setInterviewValue(event.target.value)}
              aria-invalid={!whole(interviewValue, 1)}
            />
          </div>
        </div>
        {whole(signupValue, 0) && whole(interviewValue, 1) ? (
          <p className="text-xs text-muted-foreground">
            A new admin starts with{" "}
            {Math.floor(Number(signupValue) / Number(interviewValue))} free
            interviews.
          </p>
        ) : null}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={save.isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={() => save.mutate()}
            disabled={!valid || save.isPending}
          >
            {save.isPending ? (
              <>
                <Loader2 className="animate-spin" />
                Saving…
              </>
            ) : (
              "Save pricing"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** One admin's payments and credit log. Read only, and without HR names. */
function AdminBillingDialog({
  admin,
  onClose,
}: {
  admin: AdminCredits | null
  onClose: () => void
}) {
  const detail = useAdminBilling(admin?.adminId ?? null)
  const summary = detail.data?.admin ?? admin
  const log = detail.data?.transactions ?? []

  return (
    <Dialog open={admin !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg font-bold">
            <Building2 className="size-5 text-accent-brand" />
            {summary?.adminName}
          </DialogTitle>
          <DialogDescription>
            Credits and payments for this admin and their HR team.
          </DialogDescription>
        </DialogHeader>

        {summary ? (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {[
              { label: "Balance", value: formatCredits(summary.balance) },
              { label: "Bought", value: formatCredits(summary.creditsBought) },
              { label: "Used", value: formatCredits(summary.creditsUsed) },
              { label: "Paid", value: formatPaise(summary.amountPaidPaise) },
            ].map((figure) => (
              <div
                key={figure.label}
                className="rounded-xl border bg-muted/30 px-3 py-2.5"
              >
                <p className="text-xs text-muted-foreground">{figure.label}</p>
                <p className="text-lg font-bold tabular-nums">{figure.value}</p>
              </div>
            ))}
          </div>
        ) : null}

        {detail.isError ? (
          <p className="text-sm text-destructive">{detail.error.message}</p>
        ) : (
          <Tabs defaultValue="log" className="min-w-0 gap-3">
            <TabsList>
              <TabsTrigger value="log" className="px-3">
                <Receipt />
                Credit log
              </TabsTrigger>
              <TabsTrigger value="payments" className="px-3">
                <CreditCard />
                Payments
              </TabsTrigger>
            </TabsList>
            <TabsContent value="log" className="min-w-0">
              <DataTable
                rows={log}
                columns={transactionColumns({ showUser: false })}
                getRowId={(row) => row.id}
                loading={detail.isLoading}
                filters={transactionFilters(log, { byUser: false })}
                emptyMessage="No credit movements yet."
              />
            </TabsContent>
            <TabsContent value="payments" className="min-w-0">
              <DataTable
                rows={(detail.data?.payments ?? []).filter(
                  (p) => p.status !== "created"
                )}
                columns={paymentColumns({ showPaidBy: true })}
                getRowId={(row) => row.id}
                loading={detail.isLoading}
                emptyMessage="No payments yet."
              />
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  )
}

/**
 * Every admin's credits, for the super admin. **Read only by design**: credits
 * come from paying and nowhere else, so there is no control to add any. The
 * only thing set here is the price.
 */
export function PlatformBillingPage() {
  const billing = usePlatformBilling()
  const settings = usePlatformSettings()
  const [viewing, setViewing] = React.useState<AdminCredits | null>(null)
  const [pricing, setPricing] = React.useState(false)

  const signupCredits =
    storedNumber(settings.data?.[PRICE_SETTINGS.signup.key]) ??
    PRICE_SETTINGS.signup.fallback
  const interviewCost =
    storedNumber(settings.data?.[PRICE_SETTINGS.interview.key]) ??
    PRICE_SETTINGS.interview.fallback

  const admins = billing.data ?? []
  const totalBalance = admins.reduce((sum, a) => sum + a.balance, 0)
  const totalPaid = admins.reduce((sum, a) => sum + a.amountPaidPaise, 0)
  const totalUsed = admins.reduce((sum, a) => sum + a.creditsUsed, 0)
  const lowCount = admins.filter((a) => isLow(a, interviewCost)).length

  const columns: Array<Column<AdminCredits>> = [
    {
      id: "admin",
      header: "Admin",
      cell: (row) => <span className="font-medium">{row.adminName}</span>,
    },
    {
      id: "balance",
      header: "Balance",
      cell: (row) => (
        <span
          className={cn(
            "inline-flex items-center gap-1.5 font-semibold tabular-nums",
            row.balance === 0
              ? "text-red-600 dark:text-red-400"
              : isLow(row, interviewCost)
                ? "text-amber-600 dark:text-amber-400"
                : "text-foreground"
          )}
        >
          {formatCredits(row.balance)}
          {isLow(row, interviewCost) ? (
            <AlertTriangle className="size-3.5" aria-label="Running low" />
          ) : null}
        </span>
      ),
    },
    {
      id: "bought",
      header: "Bought",
      hideOnMobile: true,
      cell: (row) => (
        <span className="tabular-nums">{formatCredits(row.creditsBought)}</span>
      ),
    },
    {
      id: "used",
      header: "Used",
      hideOnMobile: true,
      cell: (row) => (
        <span className="tabular-nums">{formatCredits(row.creditsUsed)}</span>
      ),
    },
    {
      id: "paid",
      header: "Amount paid",
      cell: (row) => (
        <span className="whitespace-nowrap tabular-nums">
          {formatPaise(row.amountPaidPaise)}
        </span>
      ),
    },
    {
      id: "last",
      header: "Last payment",
      hideOnMobile: true,
      cell: (row) =>
        row.lastPaymentAt ? (
          <div className="flex flex-col gap-0.5">
            <span className="whitespace-nowrap">
              {format(new Date(row.lastPaymentAt), "d MMM yyyy")}
            </span>
            <span className="text-xs whitespace-nowrap text-muted-foreground">
              {formatDistanceToNow(new Date(row.lastPaymentAt), {
                addSuffix: true,
              })}
            </span>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">Never</span>
        ),
    },
  ]

  return (
    <>
      <PageHeader
        title="Credits"
        icon={Coins}
        description="Every admin's credits and payments. Credits only come from paying, so nothing here adds any. You set the price."
        meta={
          settings.data ? (
            <>
              <MetaChip tone="brand">
                {interviewCost} credits per interview
              </MetaChip>
              <MetaChip>{signupCredits} free credits for new admins</MetaChip>
              {lowCount > 0 ? (
                <MetaChip tone="warning">{lowCount} running low</MetaChip>
              ) : null}
            </>
          ) : null
        }
        actions={
          <Button
            variant="outline"
            onClick={() => setPricing(true)}
            disabled={!settings.data}
          >
            <Settings2 />
            Edit pricing
          </Button>
        }
      />

      {billing.isError ? (
        <div className="flex items-start gap-2 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-5 py-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <p>
            {billing.error.message} Credits appear here once the server has
            billing switched on.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {billing.isLoading ? (
            Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-36 w-full rounded-2xl" />
            ))
          ) : (
            <>
              <StatCard
                label="Admins"
                value={admins.length}
                icon={Building2}
                tone="brand"
                note="With a credit wallet"
              />
              <StatCard
                label="Credits held"
                value={formatCredits(totalBalance)}
                icon={Coins}
                tone="success"
                note="Unspent, across every admin"
              />
              <StatCard
                label="Credits used"
                value={formatCredits(totalUsed)}
                icon={TrendingDown}
                tone="info"
                note="Net of refunds"
              />
              <StatCard
                label="Revenue"
                value={formatPaise(totalPaid)}
                icon={CreditCard}
                tone="neutral"
                note="All payments, GST included"
              />
            </>
          )}
        </div>
      )}

      <DataTable
        rows={admins}
        columns={columns}
        getRowId={(row) => row.adminId}
        loading={billing.isLoading}
        onRowClick={setViewing}
        searchAccessor={(row) => row.adminName}
        searchPlaceholder="Search admin…"
        filters={[
          {
            id: "low",
            label: "Balance",
            options: [{ value: "low", label: "Running low" }],
            predicate: (row) => isLow(row, interviewCost),
          },
        ]}
        inlineActions={(row) => (
          <IconAction
            label="View payments and credit log"
            Icon={Eye}
            onSelect={() => setViewing(row)}
          />
        )}
        emptyMessage={
          billing.isError ? "Billing isn't available yet." : "No admins yet."
        }
      />

      <AdminBillingDialog admin={viewing} onClose={() => setViewing(null)} />

      {/* Keyed so it opens on the stored values, not the last ones typed. */}
      <PricingDialog
        key={`${pricing}-${signupCredits}-${interviewCost}`}
        open={pricing}
        onOpenChange={setPricing}
        signup={signupCredits}
        interview={interviewCost}
      />
    </>
  )
}
