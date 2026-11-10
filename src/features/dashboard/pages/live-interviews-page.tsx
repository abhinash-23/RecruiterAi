import { Link } from "react-router-dom"
import { formatDistanceToNow } from "date-fns"
import { ArrowRight, Radio, RefreshCw, Video } from "lucide-react"

import { MetaChip, PageHeader } from "@/components/shared/page-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useCurrentUser } from "@/features/auth/auth-context"
import { ROLE_HOME } from "@/features/auth/types"
import { useLiveInterviews, type InterviewRow } from "@/services/hr"

/**
 * The pulsing dot. Red only for a sitting genuinely under way — a candidate who
 * has just consented is on the camera step and not yet publishing, and marking
 * that "live" sends recruiters to a black rectangle.
 */
function LiveDot({ streaming }: { streaming: boolean }) {
  const tone = streaming ? "bg-red-500" : "bg-amber-500"
  return (
    <span className="relative flex size-2.5 shrink-0" aria-hidden>
      {streaming ? (
        <span
          className={`absolute inline-flex size-full animate-ping rounded-full ${tone} opacity-75`}
        />
      ) : null}
      <span className={`relative inline-flex size-2.5 rounded-full ${tone}`} />
    </span>
  )
}

function LiveCard({ row, href }: { row: InterviewRow; href: string }) {
  const streaming = row.status === "in_progress"

  return (
    <Link
      to={href}
      className="group rounded-2xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <Card className="h-full transition-shadow group-hover:shadow-brand group-hover:ring-accent-brand/40">
        <CardContent className="flex h-full flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <span
              className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-0.5 text-[0.6875rem] font-semibold tracking-wide uppercase ${
                streaming
                  ? "border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-400"
                  : "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-400"
              }`}
            >
              <LiveDot streaming={streaming} />
              {streaming ? "Live now" : "Starting"}
            </span>
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent-brand-muted text-accent-brand">
              <Video className="size-[1.125rem]" />
            </span>
          </div>

          <div className="min-w-0">
            <p className="truncate text-lg font-bold">{row.candidateName}</p>
            <p className="truncate text-sm text-muted-foreground">{row.role}</p>
          </div>

          <dl className="mt-auto flex flex-wrap items-baseline gap-x-4 gap-y-1 border-t pt-3 text-xs text-muted-foreground">
            <div className="flex items-baseline gap-1">
              <dt>Started</dt>
              <dd className="font-medium text-foreground">
                {formatDistanceToNow(new Date(row.createdAt), {
                  addSuffix: true,
                })}
              </dd>
            </div>
            {row.answered !== null ? (
              <div className="flex items-baseline gap-1">
                <dt>Answered</dt>
                <dd className="font-medium text-foreground tabular-nums">
                  {row.answered}
                </dd>
              </div>
            ) : null}
          </dl>

          <span className="flex items-center gap-1.5 text-sm font-semibold text-accent-brand">
            Watch live
            <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
          </span>
        </CardContent>
      </Card>
    </Link>
  )
}

/**
 * Every interview being sat right now, as cards.
 *
 * Cards rather than the `DataTable` every other list uses: this page holds a
 * handful of rows at most, and each is a thing to *open* rather than a record to
 * sort, filter and act on in place.
 *
 * HR sees their own sittings; an admin sees the company's — the same visibility
 * rule `GET /api/interviews` applies everywhere else, including its dependence
 * on the tenant having data isolation enforced.
 */
export function LiveInterviewsPage() {
  const user = useCurrentUser()
  const { data, isLoading, isFetching, refetch } = useLiveInterviews()

  const rows = data ?? []
  const streaming = rows.filter((row) => row.status === "in_progress").length
  const starting = rows.length - streaming

  return (
    <>
      <PageHeader
        title="Live Interviews"
        icon={Radio}
        description="Sittings under way right now. Open one to watch the candidate, follow their answers as they give them, and see their vitals."
        meta={
          isLoading ? null : rows.length === 0 ? (
            <MetaChip>None under way</MetaChip>
          ) : (
            <>
              {streaming > 0 ? (
                <MetaChip tone="danger">{streaming} live now</MetaChip>
              ) : null}
              {starting > 0 ? (
                <MetaChip tone="warning">{starting} starting</MetaChip>
              ) : null}
            </>
          )
        }
        actions={
          <Button
            variant="outline"
            onClick={() => void refetch()}
            disabled={isFetching}
          >
            <RefreshCw className={isFetching ? "animate-spin" : undefined} />
            Refresh
          </Button>
        }
      />

      {isLoading ? (
        <div className="grid gap-4 min-[1920px]:grid-cols-4 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((key) => (
            <Skeleton key={key} className="h-48 w-full rounded-2xl" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <span className="mb-1 flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
              <Radio className="size-6" />
            </span>
            <p className="font-medium">Nobody is sitting an interview.</p>
            <p className="max-w-md text-sm text-muted-foreground">
              A card appears here the moment a candidate consents and opens
              their camera. This list refreshes on its own.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 min-[1920px]:grid-cols-4 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((row) => (
            <LiveCard
              key={row.interviewId}
              row={row}
              href={`${ROLE_HOME[user.role]}/live/${row.interviewId}`}
            />
          ))}
        </div>
      )}
    </>
  )
}
