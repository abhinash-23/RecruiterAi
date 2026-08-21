import { Link, useNavigate } from "react-router-dom"
import { formatDistanceToNow } from "date-fns"
import {
  ArrowRight,
  Briefcase,
  Building2,
  CalendarClock,
  CheckCircle2,
  Clock,
  ShieldAlert,
  Users,
  type LucideIcon,
} from "lucide-react"

import { PageHeader } from "@/components/shared/page-header"
import { StatusBadge } from "@/components/shared/status-badge"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { NAVIGATION } from "@/config/navigation"
import {
  badgeStatus,
  STATUS_LABEL,
} from "@/features/dashboard/interview-status"
import { useCurrentUser } from "@/features/auth/auth-context"
import { ROLE_HOME, ROLE_LABEL, type Role } from "@/features/auth/types"
import { useCompanyDashboard } from "@/services/admin"
import {
  useInterviews,
  useJobs,
  type InterviewRow,
  type InterviewStatus,
  type Job,
} from "@/services/hr"
import {
  usePlatformAnalytics,
  type CompanyAnalytics,
} from "@/services/super-admin"
import { cn } from "@/lib/utils"

function StatCard({
  label,
  value,
  hint,
  Icon,
}: {
  label: string
  value: number | string
  /** A second figure the headline number invites — kept small and secondary. */
  hint?: string
  Icon: LucideIcon
}) {
  return (
    <Card>
      <CardContent className="flex items-start justify-between gap-3 py-4">
        <div className="min-w-0">
          <p className="truncate text-sm text-muted-foreground">{label}</p>
          {/* Proportional figures, not `tabular-nums`: equal-width digits are
              for numbers that line up vertically, and at this size they just
              make a value like 121 read loose. */}
          <p className="mt-1 text-3xl font-semibold">{value}</p>
          {hint ? (
            <p className="mt-1 truncate text-xs text-muted-foreground">{hint}</p>
          ) : null}
        </div>
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
          <Icon className="size-4 text-muted-foreground" />
        </span>
      </CardContent>
    </Card>
  )
}

function StatGrid({
  loading,
  stats,
}: {
  loading: boolean
  stats: Array<{
    label: string
    value: number | string
    hint?: string
    Icon: LucideIcon
  }>
}) {
  if (loading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((key) => (
          <Skeleton key={key} className="h-24 w-full" />
        ))}
      </div>
    )
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {stats.map((stat) => (
        <StatCard key={stat.label} {...stat} />
      ))}
    </div>
  )
}

/**
 * A ratio against its limit — a meter, not a chart.
 *
 * One hue on a recessive track, because the quantity is a magnitude rather than
 * an identity: two colours here would imply two *kinds* of thing.
 */
function Meter({
  label,
  percent,
  hint,
}: {
  label: string
  percent: number
  hint?: string
}) {
  const value = Math.max(0, Math.min(100, Math.round(percent)))

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-sm tabular-nums text-muted-foreground">
          {value}%
        </span>
      </div>
      <Progress value={value} />
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

/**
 * How invitations end, as two meters.
 *
 * The same pair of rates whether they are one company's or the whole
 * platform's, so both dashboards render this rather than their own copy.
 */
function RatesCard({
  loading,
  completionPct,
  abandonmentPct,
  description,
}: {
  loading: boolean
  completionPct: number
  abandonmentPct: number
  description: string
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Sitting rates</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {loading ? (
          <Skeleton className="h-12 w-full" />
        ) : (
          <>
            <Meter
              label="Completed"
              percent={completionPct}
              hint="Invitations that ended in a scored report."
            />
            <Meter
              label="Abandoned"
              percent={abandonmentPct}
              hint="Started, then left before finishing."
            />
          </>
        )}
      </CardContent>
    </Card>
  )
}

/** Every status an interview can hold, in lifecycle order. */
const PIPELINE_STAGES: Array<{ status: InterviewStatus; label: string }> = [
  { status: "created", label: "Invited" },
  { status: "consent_given", label: "Consent given" },
  { status: "in_progress", label: "In progress" },
  { status: "completed", label: "Completed" },
  { status: "abandoned", label: "Abandoned" },
  { status: "expired", label: "Expired" },
  { status: "consent_refused", label: "Consent refused" },
  { status: "superseded", label: "Superseded" },
]

/**
 * Where every interview currently sits.
 *
 * A **list with proportion bars**, not a stacked bar or a pie: eight states all
 * carry meaning, and eight colours would be unreadable — the count is the
 * message and the bar is just its shape. Each row is named, so nothing depends
 * on colour to be understood.
 */
function PipelineCard({
  counts,
  loading,
}: {
  counts: Record<string, number>
  loading: boolean
}) {
  // Case-normalised, and anything the lifecycle list doesn't name is appended
  // rather than dropped: this card is fed by two different endpoints, and a key
  // spelled unexpectedly should show up as an odd row, not as a missing count.
  const tally = new Map(
    Object.entries(counts).map(([key, value]) => [key.toLowerCase(), value])
  )

  const known = PIPELINE_STAGES.map((stage) => ({
    key: stage.status as string,
    label: stage.label,
    count: tally.get(stage.status) ?? 0,
  }))

  const named = new Set(PIPELINE_STAGES.map((stage) => stage.status as string))
  const extra = [...tally.entries()]
    .filter(([key]) => !named.has(key))
    .map(([key, count]) => ({
      key,
      label: key.replace(/_/g, " "),
      count,
    }))

  const rows = [...known, ...extra].filter((row) => row.count > 0)
  const total = rows.reduce((sum, row) => sum + row.count, 0)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pipeline</CardTitle>
        <CardDescription>
          Every interview by the state it&rsquo;s in right now.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {loading ? (
          <>
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-2/3" />
          </>
        ) : total === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing scheduled yet.
          </p>
        ) : (
          rows.map((row) => (
            <div key={row.key} className="flex flex-col gap-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm">{row.label}</span>
                <span className="text-sm font-medium tabular-nums">
                  {row.count}
                </span>
              </div>
              <Progress value={(row.count / total) * 100} />
            </div>
          ))
        )}
      </CardContent>
    </Card>
  )
}

/** The handful of sittings worth looking at first. */
function RecentInterviews({
  rows,
  loading,
  onOpen,
}: {
  rows: InterviewRow[]
  loading: boolean
  onOpen: (row: InterviewRow) => void
}) {
  const recent = [...rows]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 6)

  return (
    // The column span belongs to the wrapper that stacks this with the links,
    // not to this card.
    <Card>
      <CardHeader>
        <CardTitle>Latest interviews</CardTitle>
        <CardDescription>
          The six most recently invited. Finished ones open their report.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-0 py-0">
        {loading ? (
          <div className="flex flex-col gap-2 py-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : recent.length === 0 ? (
          <p className="py-6 text-sm text-muted-foreground">
            No interviews yet — schedule candidates from a job&rsquo;s shortlist.
          </p>
        ) : (
          recent.map((row, index) => (
            <div key={row.interviewId}>
              {index > 0 ? <Separator /> : null}
              <button
                type="button"
                // Only a report is worth opening; an invited candidate has
                // nothing behind the row yet.
                disabled={!row.hasResults}
                onClick={() => onOpen(row)}
                className={cn(
                  "flex w-full items-center gap-3 py-2.5 text-left",
                  row.hasResults
                    ? "cursor-pointer hover:opacity-80"
                    : "cursor-default"
                )}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {row.candidateName}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {row.role} ·{" "}
                    {formatDistanceToNow(new Date(row.createdAt), {
                      addSuffix: true,
                    })}
                  </p>
                </div>

                {row.overallScore !== null ? (
                  <span className="shrink-0 text-sm font-semibold tabular-nums">
                    {row.overallScore}
                  </span>
                ) : null}

                <StatusBadge
                  status={badgeStatus(row.status)}
                  label={STATUS_LABEL[row.status] ?? row.status}
                />
              </button>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  )
}

/** Quick links into the role's own sections, minus the dashboard itself. */
function QuickLinks() {
  const user = useCurrentUser()
  const links = NAVIGATION[user.role]
    .flatMap((group) => group.items)
    .filter((item) => !item.end)
    .slice(0, 4)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Jump to</CardTitle>
        <CardDescription>The parts of the console you use most.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        {links.map((item) => (
          <Button key={item.to} variant="outline" nativeButton={false} render={<Link to={item.to} />}>
              <item.Icon />
              {item.label}
              <ArrowRight data-icon="inline-end" />
            </Button>
        ))}
      </CardContent>
    </Card>
  )
}

/** Everyone the tenant has seated, whatever the role. */
function seatCount(users: Record<string, number>) {
  return Object.values(users).reduce((sum, n) => sum + n, 0)
}

/** `{ admin: 3, hr: 10 }` → `3 Admin · 10 HR`, busiest role first. */
function roleBreakdown(usersByRole: Record<string, number> | undefined) {
  const parts = Object.entries(usersByRole ?? {})
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .map(
      ([role, count]) =>
        `${count} ${ROLE_LABEL[role as Role] ?? role.replace(/_/g, " ")}`
    )

  return parts.length > 0 ? parts.join(" · ") : undefined
}

/**
 * Every tenant, busiest first.
 *
 * The one place on this page where the numbers have a name against them, and a
 * table because four unrelated figures per row is a reading task rather than a
 * comparison — bars would invite an eye to rank columns that don't share units.
 * `tenancyEnforced: false` is the row that matters most: that tenant can read
 * other tenants' interviews, so it is called out rather than left to a column.
 */
function ClientsCard({
  companies,
  loading,
}: {
  companies: CompanyAnalytics[]
  loading: boolean
}) {
  const rows = [...companies].sort(
    (a, b) => b.interviews.total - a.interviews.total
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle>Clients</CardTitle>
        <CardDescription>
          Every tenant on the platform, busiest first.
        </CardDescription>
        <CardAction>
          <Button
            variant="ghost"
            size="sm"
            nativeButton={false}
            render={<Link to="/super-admin/admins" />}
          >
            Manage
            <ArrowRight data-icon="inline-end" />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="py-0">
        {loading ? (
          <div className="flex flex-col gap-2 py-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : rows.length === 0 ? (
          <p className="py-6 text-sm text-muted-foreground">
            No clients yet — the first one is created from Org Management.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Client</TableHead>
                <TableHead className="w-28 text-right">Interviews</TableHead>
                {/* Wide enough for the bar the cell draws, not just its
                    percentage: at full width the numbers alone left the table
                    reading as three figures pinned to a far edge. */}
                <TableHead className="hidden w-56 sm:table-cell">
                  Completed
                </TableHead>
                <TableHead className="w-20 text-right">Users</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((company) => (
                <TableRow key={company.companyId}>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-medium">
                        {company.name}
                      </span>
                      {company.isActive ? null : (
                        <StatusBadge status="disabled" />
                      )}
                      {company.tenancyEnforced ? null : (
                        <Badge
                          variant="outline"
                          className="border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-400"
                        >
                          <ShieldAlert />
                          Shared data
                        </Badge>
                      )}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {company.slug}
                    </p>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {company.interviews.total}
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <div className="flex items-center gap-3">
                      <Progress
                        value={company.interviews.completionRatePct}
                        className="flex-1"
                      />
                      <span className="w-10 shrink-0 text-right tabular-nums text-muted-foreground">
                        {company.interviews.completionRatePct}%
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {seatCount(company.users)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}

/** Super admin's landing page: platform-wide aggregates, no candidate data. */
function PlatformOverview() {
  const { data, isLoading } = usePlatformAnalytics()

  const clients = data?.totalClients ?? 0
  const active = data?.activeClients ?? 0
  const unassigned = data?.unassignedInterviews ?? 0

  return (
    <>
      <StatGrid
        loading={isLoading}
        stats={[
          {
            label: "Clients",
            value: clients,
            hint:
              clients === 0
                ? undefined
                : active === clients
                  ? "All active"
                  : `${active} active`,
            Icon: Building2,
          },
          {
            label: "Interviews",
            value: data?.totalInterviews ?? 0,
            // Worth surfacing only when there are any: these belong to no
            // tenant, so every client without isolation enforced can read them.
            hint: unassigned > 0 ? `${unassigned} tied to no client` : undefined,
            Icon: CalendarClock,
          },
          {
            label: "Completion rate",
            value: `${data?.completionRatePct ?? 0}%`,
            hint: `${data?.abandonmentRatePct ?? 0}% abandoned`,
            Icon: CheckCircle2,
          },
          {
            label: "Users",
            value: data?.totalUsers ?? 0,
            hint: roleBreakdown(data?.usersByRole),
            Icon: Users,
          },
        ]}
      />

      {/* Not the other roles' two columns: their tall card is a list that grows
          a row at a time, and a column can absorb it. This one is a table of
          every tenant — as tall as the client list happens to be, and taller
          than any stack of meters put beside it, which left a third of the page
          empty. Rows across the full width instead, so nothing has to match a
          neighbour's height. */}
      <ClientsCard companies={data?.companies ?? []} loading={isLoading} />

      {/* No `items-start` here, unlike the list-and-pipeline grids: these three
          are within a row of each other's height already, and letting them
          share the tallest reads as one band rather than three ragged cards. */}
      <div className="grid gap-4 lg:grid-cols-3">
        <RatesCard
          loading={isLoading}
          completionPct={data?.completionRatePct ?? 0}
          abandonmentPct={data?.abandonmentRatePct ?? 0}
          description="How invitations end, across every client."
        />
        <PipelineCard
          counts={data?.interviewsByStatus ?? {}}
          loading={isLoading}
        />
        <QuickLinks />
      </div>
    </>
  )
}

function openJobs(jobs: Job[] | undefined) {
  return (jobs ?? []).filter((job) => job.status === "open").length
}

/** The two cards every staff dashboard ends with, whatever fed the numbers. */
function Body({
  counts,
  countsLoading,
  rows,
  rowsLoading,
  rates,
}: {
  counts: Record<string, number>
  countsLoading: boolean
  rows: InterviewRow[]
  rowsLoading: boolean
  rates?: React.ReactNode
}) {
  const user = useCurrentUser()
  const navigate = useNavigate()

  /**
   * The links go under whichever column is shorter, and `rates` decides which
   * that is: admin has it, so the left column is two cards against the list's
   * one and the links even the right side up. HR doesn't, so the left column is
   * the pipeline alone and they belong there instead. Only one branch renders.
   */
  const links = <QuickLinks />
  const linksUnderList = Boolean(rates)

  return (
    // `items-start` because a grid stretches its items by default, and the left
    // column is three cards tall against the list's one. Stretched, the list
    // card kept its six rows at the top and padded the remaining half of its own
    // height with nothing — which reads as content that failed to load rather
    // than as a card that is simply shorter. Each card sizes to itself instead.
    <div className="grid items-start gap-4 lg:grid-cols-3">
      <div className="flex flex-col gap-4">
        {rates}
        <PipelineCard counts={counts} loading={countsLoading} />
        {linksUnderList ? null : links}
      </div>

      {/* Never a full-width row across the foot of the page: that pushes the
          links below the fold, and a shortcut nobody scrolls to is no shortcut. */}
      <div className="flex flex-col gap-4 lg:col-span-2">
        <RecentInterviews
          rows={rows}
          loading={rowsLoading}
          onOpen={(row) =>
            navigate(`${ROLE_HOME[user.role]}/results/${row.interviewId}`)
          }
        />
        {linksUnderList ? links : null}
      </div>
    </div>
  )
}

/** Admin's landing page: the company aggregates, including the HR seat count. */
function AdminOverview() {
  const dashboard = useCompanyDashboard()
  const jobs = useJobs()
  const interviews = useInterviews()

  const summary = dashboard.data?.interviews

  return (
    <>
      <StatGrid
        loading={dashboard.isLoading}
        stats={[
          { label: "Open jobs", value: openJobs(jobs.data), Icon: Briefcase },
          {
            label: "Interviews",
            value: summary?.total ?? 0,
            Icon: CalendarClock,
          },
          {
            label: "Completed",
            value: summary?.byStatus.completed ?? 0,
            Icon: CheckCircle2,
          },
          {
            label: "HR seats",
            value: dashboard.data?.hrs.total ?? 0,
            Icon: Users,
          },
        ]}
      />

      <Body
        // The company endpoint's own tallies, so these agree with the tiles
        // above rather than with however many rows the list happened to return.
        counts={summary?.byStatus ?? {}}
        countsLoading={dashboard.isLoading}
        rows={interviews.data ?? []}
        rowsLoading={interviews.isLoading}
        rates={
          <RatesCard
            loading={dashboard.isLoading}
            completionPct={summary?.completionRatePct ?? 0}
            abandonmentPct={summary?.abandonmentRatePct ?? 0}
            description="How invitations end, across the company."
          />
        }
      />
    </>
  )
}

/**
 * HR's landing page: the same counts, tallied from the two lists HR is allowed
 * to read.
 *
 * `/api/company/dashboard` would hand these over pre-aggregated, but it — like
 * every `/api/company/*` endpoint — answers *"Requires a company administrator
 * account"* for this role. The lists behind the Jobs and Interviews pages are
 * already fetched and cached by the time anyone reaches those pages, so
 * counting them here costs nothing extra.
 */
function HrOverview() {
  const jobs = useJobs()
  const interviews = useInterviews()

  const rows = interviews.data ?? []
  const count = (status: InterviewStatus) =>
    rows.filter((row) => row.status === status).length

  // One pass rather than one filter per stage — the pipeline card wants them
  // all, and the list is the only source HR has for them.
  const counts = rows.reduce<Record<string, number>>((tally, row) => {
    tally[row.status] = (tally[row.status] ?? 0) + 1
    return tally
  }, {})

  return (
    <>
      <StatGrid
        loading={interviews.isLoading || jobs.isLoading}
        stats={[
          { label: "Open jobs", value: openJobs(jobs.data), Icon: Briefcase },
          { label: "Interviews", value: rows.length, Icon: CalendarClock },
          { label: "Completed", value: count("completed"), Icon: CheckCircle2 },
          { label: "Awaiting start", value: count("created"), Icon: Clock },
        ]}
      />

      <Body
        counts={counts}
        countsLoading={interviews.isLoading}
        rows={rows}
        rowsLoading={interviews.isLoading}
      />
    </>
  )
}

/**
 * The landing page for every role.
 *
 * Which counts appear depends on what the API will answer for the role, and
 * each variant is its own component so no role ever mounts a query it isn't
 * allowed to make: a super admin is structurally excluded from candidate and
 * interview data, and HR from everything under `/api/company/*`.
 */
export function OverviewPage() {
  const user = useCurrentUser()

  return (
    <>
      <PageHeader
        title={`Welcome back, ${user.name.split(" ")[0] || user.email}`}
        description={[ROLE_LABEL[user.role], user.companyName]
          .filter(Boolean)
          .join(" · ")}
      />

      {user.role === "super_admin" ? (
        <PlatformOverview />
      ) : user.role === "admin" ? (
        <AdminOverview />
      ) : (
        <HrOverview />
      )}
    </>
  )
}
