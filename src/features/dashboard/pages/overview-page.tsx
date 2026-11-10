import { Link, useNavigate } from "react-router-dom"
import { formatDistanceToNow } from "date-fns"
import {
  ArrowRight,
  ArrowUpRight,
  Briefcase,
  Building2,
  CalendarClock,
  CheckCircle2,
  Clock,
  Compass,
  Gauge,
  Layers,
  Mail,
  ShieldAlert,
  ShieldCheck,
  Users,
  type LucideIcon,
} from "lucide-react"

import { StatCard } from "@/components/shared/stat-card"
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
import { rowBadge } from "@/features/dashboard/interview-status"
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

/** WhatsMore's opening line, by the hour of the viewer's own clock. */
function greetingFor(hour: number) {
  if (hour < 12) return "Good morning"
  if (hour < 17) return "Good afternoon"
  return "Good evening"
}

function BannerChip({
  icon: Icon,
  children,
}: {
  icon: LucideIcon
  children: React.ReactNode
}) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-accent-brand/15 bg-background/70 px-2.5 py-1">
      <Icon className="size-3.5 shrink-0 text-accent-brand" />
      <span className="truncate">{children}</span>
    </span>
  )
}

/**
 * The one figure the banner holds beside the greeting: a count, how much of
 * its whole it is, and the way into the page that manages it.
 */
function BannerPanel({
  icon: Icon,
  label,
  value,
  unit,
  rate,
  caption,
  to,
  linkLabel,
  loading,
}: {
  icon: LucideIcon
  label: string
  value: number
  unit: string
  /** 0–100, drawn as the bar under the figure. */
  rate: number
  caption: string
  to: string
  linkLabel: string
  loading: boolean
}) {
  return (
    <div className="rounded-2xl border border-accent-brand/15 bg-card/80 p-5">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <Icon className="size-4 text-accent-brand" />
          {label}
        </span>
        <Link
          to={to}
          className="inline-flex items-center gap-0.5 text-xs font-medium text-accent-brand hover:underline"
        >
          {linkLabel}
          <ArrowUpRight className="size-3.5" />
        </Link>
      </div>
      {loading ? (
        <Skeleton className="mt-3 h-9 w-28" />
      ) : (
        <p className="mt-2 flex items-baseline gap-1.5">
          <span className="text-3xl font-bold tracking-tight text-accent-brand tabular-nums">
            {value}
          </span>
          <span className="text-sm text-muted-foreground">{unit}</span>
        </p>
      )}
      {/* Decorative: the caption under it says the same thing in words. */}
      <div
        aria-hidden
        className="mt-3 h-1.5 overflow-hidden rounded-full bg-accent-brand/15"
      >
        <div
          className="h-full rounded-full brand-gradient transition-[width] duration-700 ease-out"
          style={{
            width: `${loading ? 0 : Math.max(0, Math.min(100, rate))}%`,
          }}
        />
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {loading ? " " : caption}
      </p>
    </div>
  )
}

/**
 * Who is signed in, the way WhatsMore's dashboard opens: a greeting, the name,
 * and pills for company, email and role — with an optional figure beside it.
 */
function WelcomeBanner({ panel }: { panel?: React.ReactNode }) {
  const user = useCurrentUser()
  const greeting = greetingFor(new Date().getHours())

  return (
    <Card className="bg-linear-to-br from-accent-brand-muted/60 to-card ring-accent-brand/15">
      <CardContent
        className={cn(
          "grid gap-6",
          panel ? "lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-center" : null
        )}
      >
        <div className="flex min-w-0 flex-col gap-3">
          <div className="min-w-0">
            <p className="text-sm text-muted-foreground">{greeting},</p>
            {/* Wraps on a phone rather than truncating, as `PageHeader` does. */}
            <h1 className="font-heading text-xl font-bold tracking-tight wrap-break-word sm:text-2xl">
              {user.name || user.email}
            </h1>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            {user.companyName ? (
              <BannerChip icon={Building2}>{user.companyName}</BannerChip>
            ) : null}
            <BannerChip icon={Mail}>{user.email}</BannerChip>
            <BannerChip icon={ShieldCheck}>{ROLE_LABEL[user.role]}</BannerChip>
          </div>
        </div>
        {panel}
      </CardContent>
    </Card>
  )
}

/** A section's bold heading and one line under it, as WhatsMore titles them. */
function SectionHeading({
  id,
  title,
  description,
}: {
  id: string
  title: string
  description: string
}) {
  return (
    <div>
      <h2 id={id} className="font-heading text-lg font-bold">
        {title}
      </h2>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  )
}

/** A card's bold title with its small brand icon. */
function IconTitle({
  icon: Icon,
  children,
}: {
  icon: LucideIcon
  children: React.ReactNode
}) {
  return (
    <CardTitle className="flex items-center gap-2 font-bold">
      <Icon className="size-4 shrink-0 text-accent-brand" />
      {children}
    </CardTitle>
  )
}

type Stat = React.ComponentProps<typeof StatCard>

function StatGrid({
  loading,
  stats,
  title,
  description,
}: {
  loading: boolean
  stats: Stat[]
  title: string
  description: string
}) {
  return (
    <section aria-labelledby="kpi-heading" className="flex flex-col gap-4">
      <SectionHeading
        id="kpi-heading"
        title={title}
        description={description}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {loading
          ? stats.map((stat) => (
              <Skeleton key={stat.label} className="h-36 w-full rounded-2xl" />
            ))
          : stats.map((stat, index) => (
              <StatCard
                key={stat.label}
                {...stat}
                // Two across between `sm` and `lg` would leave an odd last
                // card alone in half a row; it takes the whole row instead.
                className={
                  stats.length % 2 === 1 && index === stats.length - 1
                    ? "sm:max-lg:col-span-2"
                    : undefined
                }
              />
            ))}
      </div>
    </section>
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
        <span className="text-sm text-muted-foreground tabular-nums">
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
      <CardHeader className="border-b">
        <IconTitle icon={Gauge}>Sitting rates</IconTitle>
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
      <CardHeader className="border-b">
        <IconTitle icon={Layers}>Pipeline</IconTitle>
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

/** Rows the latest-interviews card always shows, and the most it ever shows. */
const RECENT_MIN = 6
const RECENT_MAX = 12

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
    .slice(0, RECENT_MAX)
  const always = recent.slice(0, RECENT_MIN)
  const extra = recent.slice(RECENT_MIN)

  const item = (row: InterviewRow, index: number) => (
    <div key={row.interviewId} className="w-full">
      {index > 0 ? <Separator /> : null}
      <button
        type="button"
        // Only a report is worth opening; an invited candidate has nothing
        // behind the row yet.
        disabled={!row.hasResults}
        onClick={() => onOpen(row)}
        className={cn(
          "flex w-full items-center gap-3 py-2.5 text-left",
          row.hasResults ? "cursor-pointer hover:opacity-80" : "cursor-default"
        )}
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{row.candidateName}</p>
          <p className="truncate text-xs text-muted-foreground">
            {row.role} ·{" "}
            {formatDistanceToNow(new Date(row.createdAt), { addSuffix: true })}
          </p>
        </div>

        {row.overallScore !== null ? (
          <span className="shrink-0 text-sm font-semibold tabular-nums">
            {row.overallScore}
          </span>
        ) : null}

        <StatusBadge {...rowBadge(row)} />
      </button>
    </div>
  )

  return (
    // The column span belongs to the wrapper in `Body`, not to this card;
    // `h-full` lets that wrapper stretch it to the neighbouring column.
    <Card className="h-full">
      <CardHeader className="border-b">
        <IconTitle icon={CalendarClock}>Latest interviews</IconTitle>
        <CardDescription>
          The most recently invited. Finished ones open their report.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col gap-0 py-0">
        {loading ? (
          <div className="flex flex-col gap-2 py-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : recent.length === 0 ? (
          <p className="py-6 text-sm text-muted-foreground">
            No interviews yet. Schedule candidates from a job&rsquo;s shortlist.
          </p>
        ) : (
          <>
            {always.map(item)}

            {/* The rest fill whatever height the card is stretched to, and
                only that: the outer box is `flex-1` with nothing in flow, so
                it adds no height of its own and the card never outgrows its
                neighbour. Inside, a wrapping column sends every row that
                doesn't fit whole into a second column, which `overflow-hidden`
                clips — so the list ends on a full row, never half of one. */}
            {extra.length > 0 ? (
              <div className="relative min-h-0 flex-1">
                <div className="absolute inset-0 flex flex-col flex-wrap content-start overflow-hidden">
                  {/* Zero-height, and first on purpose: a flex line always
                      takes its first item even when it doesn't fit, so without
                      this the first extra row was placed regardless and cut in
                      half whenever there was room for less than one. This takes
                      that slot instead, and a row that can't fit whole wraps
                      out of sight like the rest. */}
                  <div aria-hidden className="w-full" />
                  {extra.map((row, index) => item(row, index + RECENT_MIN))}
                </div>
              </div>
            ) : null}
          </>
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
      <CardHeader className="border-b">
        <IconTitle icon={Compass}>Jump to</IconTitle>
        <CardDescription>
          The parts of the console you use most.
        </CardDescription>
      </CardHeader>
      {/* Equal columns rather than a wrapping row: across the full width,
          buttons hugging their labels left most of the card empty. */}
      <CardContent className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {links.map((item) => (
          <Button
            key={item.to}
            variant="outline"
            className="justify-start"
            nativeButton={false}
            render={<Link to={item.to} />}
          >
            <item.Icon />
            {item.label}
            <ArrowRight data-icon="inline-end" className="ml-auto" />
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
      <CardHeader className="border-b">
        <IconTitle icon={Building2}>Clients</IconTitle>
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
            No clients yet. The first one is created from Org Management.
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
                      <span className="w-10 shrink-0 text-right text-muted-foreground tabular-nums">
                        {company.interviews.completionRatePct}%
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground tabular-nums">
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
      <WelcomeBanner
        panel={
          <BannerPanel
            icon={Building2}
            label="Clients"
            value={clients}
            unit="on the platform"
            rate={clients === 0 ? 0 : (active / clients) * 100}
            caption={
              clients === 0
                ? "No clients yet"
                : active === clients
                  ? "All active"
                  : `${active} of ${clients} active`
            }
            to="/super-admin/admins"
            linkLabel="Manage"
            loading={isLoading}
          />
        }
      />

      <StatGrid
        loading={isLoading}
        title="Platform performance"
        description="Every client's interviews and seats, all time."
        stats={[
          {
            label: "Interviews",
            value: data?.totalInterviews ?? 0,
            icon: CalendarClock,
            tone: unassigned > 0 ? "warning" : "brand",
            // Worth surfacing only when there are any: these belong to no
            // tenant, so every client without isolation enforced can read them.
            note:
              unassigned > 0
                ? `${unassigned} tied to no client`
                : "Across every client",
          },
          {
            label: "Completion rate",
            value: `${data?.completionRatePct ?? 0}%`,
            icon: CheckCircle2,
            tone: "success",
            note: `${data?.abandonmentRatePct ?? 0}% abandoned`,
          },
          {
            label: "Users",
            value: data?.totalUsers ?? 0,
            icon: Users,
            tone: "info",
            note: roleBreakdown(data?.usersByRole),
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

      {/* No `items-start` here, unlike the list-and-pipeline grids: these two
          are within a row of each other's height already, and letting them
          share the taller reads as one band rather than two ragged cards. */}
      <div className="grid gap-4 lg:grid-cols-2">
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
      </div>

      <QuickLinks />
    </>
  )
}

function openJobs(jobs: Job[] | undefined) {
  return (jobs ?? []).filter((job) => job.status === "open").length
}

/** Staff banners' figure: the jobs still hiring, against every job. */
function OpenJobsPanel({
  jobs,
  loading,
}: {
  jobs: Job[] | undefined
  loading: boolean
}) {
  const user = useCurrentUser()
  const total = jobs?.length ?? 0
  const open = openJobs(jobs)

  return (
    <BannerPanel
      icon={Briefcase}
      label="Open jobs"
      value={open}
      unit="hiring now"
      rate={total === 0 ? 0 : (open / total) * 100}
      caption={total === 0 ? "No jobs yet" : `${open} of ${total} jobs open`}
      to={`${ROLE_HOME[user.role]}/jobs`}
      linkLabel="Jobs"
      loading={loading}
    />
  )
}

/** `part` as a share of `whole`, 0 when there is no whole to share. */
function share(part: number, whole: number) {
  return whole === 0 ? 0 : (part / whole) * 100
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
  rates: React.ReactNode
}) {
  const user = useCurrentUser()
  const navigate = useNavigate()

  return (
    <>
      {/* Stretched, on purpose: the list card fills the extra height with more
          rows (see `RecentInterviews`), so both columns end on the same line
          instead of leaving a gap above the links. The left column's cards
          keep their own height inside their stretched wrapper. */}
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="flex flex-col gap-4">
          {rates}
          <PipelineCard counts={counts} loading={countsLoading} />
        </div>

        <div className="xl:col-span-2">
          <RecentInterviews
            rows={rows}
            loading={rowsLoading}
            onOpen={(row) =>
              navigate(`${ROLE_HOME[user.role]}/results/${row.interviewId}`)
            }
          />
        </div>
      </div>

      {/* A full-width row of its own, so it lines up with the stat tiles above
          instead of hanging under whichever column happened to be shorter. */}
      <QuickLinks />
    </>
  )
}

/** Admin's landing page: the company aggregates, including the HR seat count. */
function AdminOverview() {
  const dashboard = useCompanyDashboard()
  const jobs = useJobs()
  const interviews = useInterviews()

  const summary = dashboard.data?.interviews
  const hrs = dashboard.data?.hrs

  return (
    <>
      <WelcomeBanner
        panel={<OpenJobsPanel jobs={jobs.data} loading={jobs.isLoading} />}
      />

      <StatGrid
        loading={dashboard.isLoading}
        title="Hiring performance"
        description="How the company's interviews are going, all time."
        stats={[
          {
            label: "Interviews",
            value: summary?.total ?? 0,
            icon: CalendarClock,
            tone: "brand",
            note: "Across the company",
          },
          {
            label: "Completed",
            value: summary?.byStatus.completed ?? 0,
            icon: CheckCircle2,
            tone: "success",
            rate: summary?.completionRatePct ?? 0,
            rateText: "of interviews",
          },
          {
            label: "HR seats",
            value: hrs?.total ?? 0,
            icon: Users,
            tone: "info",
            ...(hrs && hrs.total > 0
              ? { rate: share(hrs.active, hrs.total), rateText: "active" }
              : { note: "No HR accounts yet" }),
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

  // The company endpoint's rates, rebuilt from the list: its figures match
  // completed ÷ every interview and abandoned ÷ every interview (59 of 72 →
  // 82%, 2 of 72 → 3%), so HR's meters mean the same thing as admin's.
  const percent = (status: InterviewStatus) =>
    rows.length === 0 ? 0 : Math.round((count(status) / rows.length) * 100)

  return (
    <>
      <WelcomeBanner
        panel={<OpenJobsPanel jobs={jobs.data} loading={jobs.isLoading} />}
      />

      <StatGrid
        loading={interviews.isLoading}
        title="Hiring performance"
        description="How your interviews are going, all time."
        stats={[
          {
            label: "Interviews",
            value: rows.length,
            icon: CalendarClock,
            tone: "brand",
            note: "Every one you can see",
          },
          {
            label: "Completed",
            value: count("completed"),
            icon: CheckCircle2,
            tone: "success",
            rate: share(count("completed"), rows.length),
            rateText: "of interviews",
          },
          {
            label: "Awaiting start",
            value: count("created"),
            icon: Clock,
            tone: "warning",
            rate: share(count("created"), rows.length),
            rateText: "not started yet",
          },
        ]}
      />

      <Body
        counts={counts}
        countsLoading={interviews.isLoading}
        rows={rows}
        rowsLoading={interviews.isLoading}
        rates={
          <RatesCard
            loading={interviews.isLoading}
            completionPct={percent("completed")}
            abandonmentPct={percent("abandoned")}
            description="How the invitations you can see end."
          />
        }
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

  // Each variant draws its own welcome banner, because the figure beside the
  // greeting comes from that variant's queries.
  return user.role === "super_admin" ? (
    <PlatformOverview />
  ) : user.role === "admin" ? (
    <AdminOverview />
  ) : (
    <HrOverview />
  )
}
