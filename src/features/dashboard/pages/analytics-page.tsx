import { Link } from "react-router-dom"
import {
  AlertTriangle,
  Building2,
  CalendarClock,
  CheckCircle2,
  ShieldCheck,
  Users,
  type LucideIcon,
} from "lucide-react"

import { DataTable, type Column } from "@/components/shared/data-table"
import { PageHeader } from "@/components/shared/page-header"
import { StatusBadge } from "@/components/shared/status-badge"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ROLE_HOME } from "@/features/auth/types"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import {
  usePlatformAnalytics,
  type CompanyAnalytics,
} from "@/services/super-admin"

/**
 * One headline number.
 *
 * Proportional figures, not `tabular-nums`: equal-width digits are for columns
 * that line up vertically, and at this size they only make a value read loose.
 */
function Tile({
  label,
  value,
  hint,
  Icon,
}: {
  label: string
  value: number | string
  hint?: string
  Icon: LucideIcon
}) {
  return (
    <Card>
      <CardContent className="flex items-start justify-between gap-3 py-4">
        <div className="min-w-0">
          <p className="truncate text-sm text-muted-foreground">{label}</p>
          <p className="mt-1 text-3xl font-semibold">{value}</p>
          {hint ? (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {hint}
            </p>
          ) : null}
        </div>
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
          <Icon className="size-4 text-muted-foreground" />
        </span>
      </CardContent>
    </Card>
  )
}

/** "1 admin · 2 hr" — reads better than a row of badges at this density. */
function roleSummary(users: Record<string, number>) {
  const parts = Object.entries(users)
    .filter(([, count]) => count > 0)
    .map(([role, count]) => `${count} ${role.replace(/_/g, " ")}`)
  return parts.join(" · ") || "—"
}

/**
 * Platform-wide aggregates for the super admin.
 *
 * Aggregate-only by design: this tier has no route to an individual interview
 * or candidate, and the API refuses one regardless of permissions.
 */
export function AnalyticsPage() {
  const { data, isLoading } = usePlatformAnalytics()

  const leaky = (data?.companies ?? []).filter(
    (company) => !company.tenancyEnforced
  )

  const columns: Array<Column<CompanyAnalytics>> = [
    {
      id: "company",
      header: "Client",
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.name}</p>
          <p className="truncate font-mono text-xs text-muted-foreground">
            {row.slug}
          </p>
        </div>
      ),
    },
    {
      id: "interviews",
      header: "Interviews",
      className: "w-28 tabular-nums",
      cell: (row) => (
        <span className="font-medium">{row.interviews.total}</span>
      ),
    },
    {
      id: "completion",
      header: "Completion",
      hideOnMobile: true,
      // Fixed width: left to stretch, one client's bar ran the width of the
      // table and read as a progress indicator for the page.
      className: "w-48",
      cell: (row) => (
        <div className="flex w-36 flex-col gap-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-xs tabular-nums text-muted-foreground">
              {row.interviews.completionRatePct}%
            </span>
            <span className="text-xs text-muted-foreground">
              {row.interviews.byStatus.completed ?? 0}/{row.interviews.total}
            </span>
          </div>
          <Progress value={row.interviews.completionRatePct} />
        </div>
      ),
    },
    {
      id: "users",
      header: "Users",
      hideOnMobile: true,
      className: "w-40",
      cell: (row) => (
        <span className="text-sm text-muted-foreground">
          {roleSummary(row.users)}
        </span>
      ),
    },
    {
      id: "status",
      header: "Status",
      cell: (row) => (
        <div className="flex flex-col items-start gap-1">
          <StatusBadge status={row.isActive ? "active" : "disabled"} />
          {!row.tenancyEnforced ? (
            <Badge
              variant="outline"
              className="h-auto gap-1 border-amber-500/40 py-0.5 text-[11px] font-normal whitespace-normal text-amber-700 dark:text-amber-400"
            >
              <AlertTriangle className="size-3" />
              Not isolated
            </Badge>
          ) : null}
        </div>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title="Analytics"
        description="Interview volume and completion across every client. No drill-down to individual interviews — the platform tier can't see candidate data."
      />

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((key) => (
            <Skeleton key={key} className="h-24 w-full" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Tile
            label="Clients"
            value={data?.totalClients ?? 0}
            hint={`${data?.activeClients ?? 0} active`}
            Icon={Building2}
          />
          <Tile
            label="Interviews"
            value={data?.totalInterviews ?? 0}
            hint={`${data?.unassignedInterviews ?? 0} unassigned`}
            Icon={CalendarClock}
          />
          <Tile
            label="Completion"
            value={`${data?.completionRatePct ?? 0}%`}
            hint={`${data?.abandonmentRatePct ?? 0}% abandoned`}
            Icon={CheckCircle2}
          />
          <Tile
            label="Users"
            value={data?.totalUsers ?? 0}
            hint={roleSummary(data?.usersByRole ?? {})}
            Icon={Users}
          />
        </div>
      )}

      {/* The warning carries the fix rather than describing where it lives:
          "Admin Management → Enforce data isolation" is two navigations and a
          guess at which row, from a page that already knows the answer. */}
      {leaky.length > 0 ? (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
          <AlertTriangle className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">
              {leaky.length} client{leaky.length === 1 ? "" : "s"} can read other
              clients&rsquo; interviews
            </p>
            <p className="text-xs text-muted-foreground">
              Data isolation is off for {leaky.map((c) => c.name).join(", ")}.
              Turn it on from that tenant&rsquo;s row — the shield button.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={<Link to={`${ROLE_HOME.super_admin}/admins`} />}
          >
            <ShieldCheck />
            Fix in Admin Management
          </Button>
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Per-client volume</CardTitle>
          <CardDescription>
            Interview counts and completion rate for each tenant.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <DataTable
            rows={data?.companies ?? []}
            columns={columns}
            getRowId={(row) => row.companyId}
            loading={isLoading}
            searchAccessor={(row) => `${row.name} ${row.slug}`}
            searchPlaceholder="Search client…"
            emptyMessage="No clients yet."
          />
        </CardContent>
      </Card>
    </>
  )
}
