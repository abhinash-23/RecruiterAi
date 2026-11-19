import * as React from "react"
import { format, formatDistanceToNow } from "date-fns"
import {
  AlertTriangle,
  BadgePlus,
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
  AdminCreditLog,
  AdminPayments,
  BalanceFigure,
  FigureGrid,
} from "@/features/billing/admin-billing-tables"
import {
  GrantCreditsDialog,
  type GrantTarget,
} from "@/features/billing/grant-credits-dialog"
import {
  isLowBalance,
  PRICE_SETTINGS,
  useCreditPricing,
} from "@/features/billing/pricing"
import {
  billingKeys,
  formatAmounts,
  creditsUsedNote,
  formatCredits,
  sumRefunded,
  formatMoney,
  sumAmounts,
  useAdminBilling,
  usePlatformBilling,
  type AdminCredits,
} from "@/services/billing"
import { putPlatformSetting, settingsKeys } from "@/services/super-admin"

/** Below two interviews' worth at the current price. */
function isLow(admin: AdminCredits, interviewCost: number) {
  return isLowBalance(admin.balance, interviewCost)
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
  creditPrice,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  signup: number
  interview: number
  /** US cents per credit. */
  creditPrice: number
}) {
  const client = useQueryClient()
  const [signupValue, setSignupValue] = React.useState(String(signup))
  const [interviewValue, setInterviewValue] = React.useState(String(interview))
  const [priceValue, setPriceValue] = React.useState(String(creditPrice))

  const save = useMutation({
    /* `PUT /settings/{key}` takes an object as its `value` and answers 422 to a
       bare number, so each price is stored as `{ value: n }` — the shape
       `storedNumber` already reads back. */
    mutationFn: async () => {
      if (Number(signupValue) !== signup) {
        await putPlatformSetting(PRICE_SETTINGS.signup.key, {
          value: Number(signupValue),
        })
      }
      if (Number(interviewValue) !== interview) {
        await putPlatformSetting(PRICE_SETTINGS.interview.key, {
          value: Number(interviewValue),
        })
      }
      if (Number(priceValue) !== creditPrice) {
        await putPlatformSetting(PRICE_SETTINGS.creditPrice.key, {
          value: Number(priceValue),
        })
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
  const valid =
    whole(signupValue, 0) && whole(interviewValue, 1) && whole(priceValue, 1)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings2 className="size-4" />
            Credit pricing
          </DialogTitle>
          <DialogDescription>
            Prices are in US dollars; Stripe adds tax for the buyer&rsquo;s
            region at checkout. Changes apply from now on: existing admins keep
            their balance, and interviews already sent keep the price they were
            charged.
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
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="price-credit">Price of one credit (US cents)</Label>
            <Input
              id="price-credit"
              type="number"
              min={1}
              value={priceValue}
              onChange={(event) => setPriceValue(event.target.value)}
              aria-invalid={!whole(priceValue, 1)}
            />
          </div>
        </div>
        {valid ? (
          <p className="text-xs text-muted-foreground">
            An interview costs{" "}
            <span className="font-medium text-foreground">
              {formatMoney(Number(interviewValue) * Number(priceValue), "usd")}
            </span>{" "}
            plus tax. A new admin starts with{" "}
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
  onGrant,
}: {
  admin: AdminCredits | null
  onClose: () => void
  onGrant: (target: GrantTarget) => void
}) {
  const detail = useAdminBilling(admin?.adminId ?? null)
  const summary = detail.data?.admin ?? admin
  const log = detail.data?.transactions ?? []

  return (
    <Dialog open={admin !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-6xl">
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
          <div className="-mt-2 flex justify-end">
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                onGrant({
                  adminId: summary.adminId,
                  adminName: summary.adminName,
                  balance: summary.balance,
                })
              }
            >
              <BadgePlus />
              Add credits
            </Button>
          </div>
        ) : null}

        {summary ? (
          <FigureGrid
            figures={[
              { label: "Balance", value: formatCredits(summary.balance) },
              {
                label: "Bought",
                value: formatCredits(summary.creditsBought),
                note:
                  summary.creditsGranted > 0
                    ? `+ ${formatCredits(summary.creditsGranted)} added by hand`
                    : undefined,
              },
              {
                label: "Used",
                value: formatCredits(summary.creditsUsed),
                note: creditsUsedNote(summary.creditsRefunded),
              },
              {
                label: "Paid",
                value: formatAmounts(summary.amountPaid),
                note: "Tax included",
              },
            ]}
          />
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
              <AdminCreditLog log={log} loading={detail.isLoading} />
            </TabsContent>
            <TabsContent value="payments" className="min-w-0">
              <AdminPayments
                payments={detail.data?.payments ?? []}
                loading={detail.isLoading}
              />
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  )
}

/**
 * Every admin's credits, for the super admin: what each holds, bought and
 * paid, the prices, and **Add credits** — the one way credits arrive without
 * a payment, for a pilot or a goodwill top-up.
 */
export function PlatformBillingPage() {
  const billing = usePlatformBilling()
  const { settings, signupCredits, interviewCost, creditPriceCents } =
    useCreditPricing()
  const [viewing, setViewing] = React.useState<AdminCredits | null>(null)
  const [pricing, setPricing] = React.useState(false)
  const [granting, setGranting] = React.useState<GrantTarget | null>(null)

  const admins = billing.data ?? []
  const totalBalance = admins.reduce((sum, a) => sum + a.balance, 0)
  const totalPaid = sumAmounts(admins.map((a) => a.amountPaid))
  const totalGranted = admins.reduce((sum, a) => sum + a.creditsGranted, 0)
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
        <BalanceFigure balance={row.balance} interviewCost={interviewCost} />
      ),
    },
    {
      id: "bought",
      header: "Bought",
      hideOnMobile: true,
      cell: (row) => (
        <div className="flex flex-col gap-0.5">
          <span className="tabular-nums">
            {formatCredits(row.creditsBought)}
          </span>
          {row.creditsGranted > 0 ? (
            <span className="text-xs whitespace-nowrap text-muted-foreground tabular-nums">
              + {formatCredits(row.creditsGranted)} added
            </span>
          ) : null}
        </div>
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
          {formatAmounts(row.amountPaid)}
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
        description="Every admin's credits and payments. Add credits to an admin by hand, and set the prices."
        meta={
          settings.data ? (
            <>
              <MetaChip tone="brand">
                {formatMoney(interviewCost * creditPriceCents, "usd")} per
                interview
              </MetaChip>
              <MetaChip>{interviewCost} credits per interview</MetaChip>
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
                note={creditsUsedNote(sumRefunded(admins))}
              />
              <StatCard
                label="Revenue"
                value={formatAmounts(totalPaid)}
                icon={CreditCard}
                tone="neutral"
                note={
                  totalGranted > 0
                    ? `Tax included. ${formatCredits(totalGranted)} credits added by hand`
                    : "All payments, tax included"
                }
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
          <>
            <IconAction
              label="Add credits"
              Icon={BadgePlus}
              tone="positive"
              onSelect={() =>
                setGranting({
                  adminId: row.adminId,
                  adminName: row.adminName,
                  balance: row.balance,
                })
              }
            />
            <IconAction
              label="View payments and credit log"
              Icon={Eye}
              onSelect={() => setViewing(row)}
            />
          </>
        )}
        emptyMessage={
          billing.isError ? "Billing isn't available yet." : "No admins yet."
        }
      />

      <AdminBillingDialog
        admin={viewing}
        onClose={() => setViewing(null)}
        onGrant={setGranting}
      />

      <GrantCreditsDialog
        target={granting}
        interviewCost={interviewCost}
        onClose={() => setGranting(null)}
      />

      {/* Keyed so it opens on the stored values, not the last ones typed. */}
      <PricingDialog
        key={`${pricing}-${signupCredits}-${interviewCost}-${creditPriceCents}`}
        open={pricing}
        onOpenChange={setPricing}
        signup={signupCredits}
        interview={interviewCost}
        creditPrice={creditPriceCents}
      />
    </>
  )
}
