import * as React from "react"
import { format } from "date-fns"
import {
  BadgePlus,
  Building2,
  CalendarClock,
  CreditCard,
  Receipt,
} from "lucide-react"

import { StatusBadge } from "@/components/shared/status-badge"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Progress } from "@/components/ui/progress"
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
import { isLowBalance } from "@/features/billing/pricing"
import {
  formatAmounts,
  formatCredits,
  useAdminBilling,
} from "@/services/billing"

import { STATUS_LABEL, STATUS_OPTIONS } from "./interview-status"
import {
  interviewsUnderway,
  type OrgDirectory,
  type OrgFacts,
} from "./org-directory"

/** A dash for a figure whose list didn't load, rather than a misleading 0. */
const DASH = "—"

const TAB_CLASS = "px-3 max-sm:px-2 max-sm:[&_svg]:hidden"

/**
 * An organization's credits left, for a table cell: the same colours as the
 * Credits page, or a dash when billing isn't available.
 */
export function OrgCreditsCell({
  org,
  directory,
}: {
  org: OrgFacts | null
  directory: OrgDirectory
}) {
  if (!org?.credits) {
    return <span className="text-muted-foreground">{DASH}</span>
  }
  return (
    <BalanceFigure
      balance={org.credits.balance}
      interviewCost={directory.interviewCost}
    />
  )
}

/** Every status the organization has interviews in, in lifecycle order. */
function InterviewBreakdown({ org }: { org: OrgFacts }) {
  const interviews = org.analytics?.interviews
  if (!interviews) {
    return (
      <p className="py-6 text-sm text-muted-foreground">
        Interview figures aren&rsquo;t available right now.
      </p>
    )
  }
  if (interviews.total === 0) {
    return (
      <p className="py-6 text-sm text-muted-foreground">
        No interviews created yet.
      </p>
    )
  }

  const known = new Set<string>(STATUS_OPTIONS.map((option) => option.value))
  const rows = [
    ...STATUS_OPTIONS.map((option) => option.value),
    // Any status the server adds later still gets a row.
    ...Object.keys(interviews.byStatus).filter((status) => !known.has(status)),
  ]
    .map((status) => ({ status, count: interviews.byStatus[status] ?? 0 }))
    .filter((row) => row.count > 0)

  return (
    <div className="flex flex-col divide-y rounded-xl border">
      {rows.map((row) => {
        const share = (row.count / interviews.total) * 100
        return (
          <div
            key={row.status}
            className="flex items-center gap-3 px-4 py-2.5 text-sm"
          >
            <span className="w-24 shrink-0 font-medium sm:w-32">
              {STATUS_LABEL[row.status] ?? row.status.replace(/_/g, " ")}
            </span>
            <Progress
              value={share}
              aria-label={`${STATUS_LABEL[row.status] ?? row.status} share`}
              className="flex-1"
            />
            <span className="w-24 shrink-0 text-right tabular-nums">
              <span className="font-semibold">{row.count}</span>
              <span className="text-muted-foreground">
                {" "}
                · {Math.round(share)}%
              </span>
            </span>
          </div>
        )
      })}
    </div>
  )
}

/**
 * One organization at a glance, for the super admin: its interviews, seats
 * and credits on one screen, with the credit log and payments a tab away.
 */
export function OrgOverviewDialog({
  companyId,
  directory,
  onClose,
}: {
  companyId: string | null
  directory: OrgDirectory
  onClose: () => void
}) {
  const org = directory.find(companyId)
  const detail = useAdminBilling(
    org?.credits?.adminId ?? (directory.billingAvailable ? companyId : null)
  )
  const credits = detail.data?.admin ?? org?.credits ?? null
  const interviews = org?.analytics?.interviews
  const completed = interviews?.byStatus.completed ?? 0
  const hrUsers = org?.admin?.hrCount ?? org?.analytics?.users.hr ?? null
  const low =
    credits !== null && isLowBalance(credits.balance, directory.interviewCost)
  const [granting, setGranting] = React.useState<GrantTarget | null>(null)

  return (
    <Dialog
      open={companyId !== null}
      onOpenChange={(next) => !next && onClose()}
    >
      {/* `6xl`: the credit log's five columns — a long Stripe or candidate
          name in Details among them — clipped "Balance after" at `4xl`. */}
      <DialogContent className="sm:max-w-6xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2 text-lg font-bold">
            <Building2 className="size-5 text-accent-brand" />
            {org?.name ?? "Organization"}
            {org ? (
              <StatusBadge
                status={
                  (org.admin?.isActive ?? org.analytics?.isActive ?? true)
                    ? "active"
                    : "disabled"
                }
              />
            ) : null}
            {low ? (
              <Badge
                variant="outline"
                className="border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-400"
              >
                Credits running low
              </Badge>
            ) : null}
          </DialogTitle>
          <DialogDescription>
            {org?.admin
              ? `${org.admin.fullName || "Admin"} · ${org.admin.email} · created ${format(new Date(org.admin.createdAt), "d MMM yyyy")}`
              : "Interviews, team and credits for this organization."}
          </DialogDescription>
        </DialogHeader>

        {org ? (
          <FigureGrid
            figures={[
              {
                label: "Interviews",
                value: interviews?.total ?? DASH,
                note: "Created, all time",
              },
              {
                label: "Completed",
                value: interviews ? completed : DASH,
                note: interviews
                  ? `${interviews.completionRatePct}% completion`
                  : undefined,
              },
              {
                label: "In progress",
                value: interviews ? interviewsUnderway(org.analytics) : DASH,
                note: interviews
                  ? `${interviews.abandonmentRatePct}% abandoned`
                  : undefined,
              },
              {
                label: "HR users",
                value: hrUsers ?? DASH,
                note: org.admin?.lastLogin
                  ? `Admin signed in ${format(new Date(org.admin.lastLogin), "d MMM")}`
                  : "Admin never signed in",
              },
              {
                label: "Credits left",
                value: credits ? (
                  <BalanceFigure
                    balance={credits.balance}
                    interviewCost={directory.interviewCost}
                    className="font-bold"
                  />
                ) : (
                  DASH
                ),
                note: credits
                  ? `About ${Math.floor(credits.balance / Math.max(1, directory.interviewCost))} interviews`
                  : undefined,
              },
              {
                label: "Credits used",
                value: credits ? formatCredits(credits.creditsUsed) : DASH,
                note: credits ? "Net of refunds" : undefined,
              },
              {
                label: "Bought",
                value: credits ? formatCredits(credits.creditsBought) : DASH,
              },
              {
                label: "Paid",
                value: credits ? formatAmounts(credits.amountPaid) : DASH,
                note: credits ? "Tax included" : undefined,
              },
            ]}
          />
        ) : null}

        {credits ? (
          <div className="-mt-1 flex justify-end">
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                setGranting({
                  adminId: credits.adminId,
                  adminName: credits.adminName || org?.name || "this admin",
                  balance: credits.balance,
                })
              }
            >
              <BadgePlus />
              Add credits
            </Button>
          </div>
        ) : null}

        {org ? (
          <Tabs defaultValue="interviews" className="min-w-0 gap-3">
            {/* Icons drop on a phone so all three tabs fit on one line. */}
            <TabsList className="max-w-full">
              <TabsTrigger value="interviews" className={TAB_CLASS}>
                <CalendarClock />
                Interviews
              </TabsTrigger>
              <TabsTrigger value="log" className={TAB_CLASS}>
                <Receipt />
                Credit log
              </TabsTrigger>
              <TabsTrigger value="payments" className={TAB_CLASS}>
                <CreditCard />
                Payments
              </TabsTrigger>
            </TabsList>
            <TabsContent value="interviews" className="min-w-0">
              <InterviewBreakdown org={org} />
            </TabsContent>
            <TabsContent value="log" className="min-w-0">
              {detail.isError || !directory.billingAvailable ? (
                <p className="py-6 text-sm text-muted-foreground">
                  The credit log isn&rsquo;t available right now.
                </p>
              ) : (
                <AdminCreditLog
                  log={detail.data?.transactions ?? []}
                  loading={detail.isLoading}
                />
              )}
            </TabsContent>
            <TabsContent value="payments" className="min-w-0">
              {detail.isError || !directory.billingAvailable ? (
                <p className="py-6 text-sm text-muted-foreground">
                  Payments aren&rsquo;t available right now.
                </p>
              ) : (
                <AdminPayments
                  payments={detail.data?.payments ?? []}
                  loading={detail.isLoading}
                />
              )}
            </TabsContent>
          </Tabs>
        ) : null}

        <GrantCreditsDialog
          target={granting}
          interviewCost={directory.interviewCost}
          onClose={() => setGranting(null)}
        />
      </DialogContent>
    </Dialog>
  )
}
