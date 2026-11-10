import * as React from "react"
import {
  Info,
  ListChecks,
  Mic,
  Settings2,
  Target,
  type LucideIcon,
} from "lucide-react"

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  formatPct,
  selectionThreshold,
} from "@/features/dashboard/selection-threshold"
import { INTERVIEW_ROUND_OPTIONS, type InterviewRound } from "@/services/admin"
import { cn } from "@/lib/utils"

const ROUND_LABEL: Record<InterviewRound, string> = {
  psychometrics: "Psychometrics",
  softskills: "Soft skills",
  resume: "Resume",
  jd: "Job description",
}

/**
 * How this job's interviews will run — the bar, the rounds, the format — as
 * three tiles side by side rather than three full-width strips.
 *
 * All three are decided here and stated nowhere on the interview itself, which
 * is why they are on the job at all. The one rule they share is said once, in
 * the header: each is frozen onto an interview as it is created, so a change
 * applies to interviews scheduled from now on and never moves one already sent.
 */
export function JobSetupPanel({
  selectionThresholdPct,
  jobRounds,
  defaultRounds,
}: {
  selectionThresholdPct?: number | null
  /** The job's own rounds, or null when it follows the company defaults. */
  jobRounds: readonly InterviewRound[] | null | undefined
  /** Today's company defaults, once loaded — shown for a job that follows them. */
  defaultRounds: readonly InterviewRound[] | undefined
}) {
  const bar = selectionThreshold(selectionThresholdPct)
  const ownRounds = Boolean(jobRounds)
  const rounds = jobRounds ?? defaultRounds

  return (
    <section className="flex flex-col gap-4 rounded-2xl bg-card p-5 shadow-brand-sm ring-1 ring-foreground/10">
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <div className="flex items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-lg bg-accent-brand-muted text-accent-brand">
            <Settings2 className="size-4" />
          </span>
          <h2 className="font-heading text-base font-semibold">
            Interview setup
          </h2>
        </div>
        <p className="text-xs text-muted-foreground">
          Applies to interviews scheduled from now on. Anyone already scheduled
          keeps what they were sent.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {/* The bar every interview from here is judged against. A recruiter
            reading a NOT SELECTED later has no other way to find out what it
            was. */}
        <SetupTile
          icon={Target}
          label="Selection bar"
          tag={bar.isDefault ? "Platform default" : "Set for this job"}
          tagTone={bar.isDefault ? "neutral" : "brand"}
          info={
            bar.isDefault
              ? "This job sets no bar, so the platform default applies. Edit the job to choose its own."
              : "Chosen for this job. Edit the job to change it."
          }
        >
          <div className="flex items-center gap-4">
            <ScoreRing value={bar.value} />
            <p className="text-sm text-muted-foreground">
              Overall score an interview must reach to come out{" "}
              <span className="font-medium text-foreground">Selected</span>.
            </p>
          </div>
        </SetupTile>

        {/* A job on the company defaults is named as such, with today's list,
            because it will follow the next change the admin makes. */}
        <SetupTile
          icon={ListChecks}
          label="Rounds"
          tag={ownRounds ? "This job's own" : "Company defaults"}
          tagTone={ownRounds ? "brand" : "neutral"}
          info={
            ownRounds
              ? "Chosen for this job. Edit the job to change them."
              : "Follows the company's interview defaults, including any later change to them."
          }
        >
          {rounds ? (
            <ol className="flex flex-wrap gap-1.5">
              {INTERVIEW_ROUND_OPTIONS.filter((round) =>
                rounds.includes(round)
              ).map((round, index) => (
                <li
                  key={round}
                  className="group/round flex items-center gap-1.5 rounded-full bg-muted py-1 pr-2.5 pl-1 text-xs font-medium transition-colors hover:bg-accent-brand-muted hover:text-accent-brand"
                >
                  <span className="flex size-5 items-center justify-center rounded-full bg-background text-[0.625rem] font-semibold text-muted-foreground tabular-nums transition-colors group-hover/round:bg-accent-brand group-hover/round:text-white">
                    {index + 1}
                  </span>
                  {ROUND_LABEL[round]}
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-muted-foreground">
              The company&rsquo;s default rounds.
            </p>
          )}
        </SetupTile>

        {/* **Which interview these candidates will sit**, said where they are
            scheduled. Stated unconditionally rather than read off
            `job.voiceMode`: the schedule call sends `voice_mode: true` as an
            override, so the job's own flag no longer decides — and until
            2026-09-09, when it did, nothing on any screen said so. */}
        <SetupTile
          icon={Mic}
          label="Interview"
          tag="Written fallback"
          tagTone="neutral"
          info="A candidate whose browser or microphone can't do the spoken interview gets the written one automatically, with the same questions and the same scoring."
        >
          <div className="flex items-center gap-4">
            <span className="relative flex size-14 shrink-0 items-center justify-center">
              <span className="absolute inset-0 rounded-full bg-accent-brand/15 motion-safe:animate-ping motion-safe:[animation-duration:2.4s]" />
              <span className="relative flex size-12 items-center justify-center rounded-full brand-gradient text-white shadow-brand">
                <Mic className="size-5" />
              </span>
            </span>
            <div className="min-w-0">
              <p className="font-heading text-lg leading-tight font-semibold">
                Spoken
              </p>
              <p className="text-sm text-muted-foreground">
                The candidate talks to Elena, the same as New interview.
              </p>
            </div>
          </div>
        </SetupTile>
      </div>
    </section>
  )
}

function SetupTile({
  icon: Icon,
  label,
  tag,
  tagTone,
  info,
  children,
}: {
  icon: LucideIcon
  label: string
  tag: string
  tagTone: "brand" | "neutral"
  info: string
  children: React.ReactNode
}) {
  return (
    <div className="group/tile flex min-w-0 flex-col gap-3 rounded-xl border border-border/70 bg-background/40 p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-accent-brand/40 hover:shadow-brand-sm motion-reduce:hover:translate-y-0">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Icon className="size-3.5 transition-colors group-hover/tile:text-accent-brand" />
          {label}
        </p>
        <div className="flex items-center gap-1">
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[0.6875rem] font-medium whitespace-nowrap",
              tagTone === "brand"
                ? "bg-accent-brand-muted text-accent-brand"
                : "bg-muted text-muted-foreground"
            )}
          >
            {tag}
          </span>
          <Tooltip>
            <TooltipTrigger
              aria-label={`About ${label.toLowerCase()}`}
              className="flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <Info className="size-3.5" />
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-64 text-pretty">
              {info}
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
      {children}
    </div>
  )
}

/** A percentage as a ring that fills in when it first appears. */
function ScoreRing({ value }: { value: number }) {
  const radius = 24
  const circumference = 2 * Math.PI * radius
  const clamped = Math.max(0, Math.min(100, value))

  // Drawn empty on the first frame, then filled, so the transition runs.
  const [shown, setShown] = React.useState(0)
  React.useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(clamped))
    return () => cancelAnimationFrame(frame)
  }, [clamped])

  return (
    <div className="relative size-14 shrink-0">
      <svg viewBox="0 0 56 56" className="size-full -rotate-90" aria-hidden>
        <circle
          cx="28"
          cy="28"
          r={radius}
          fill="none"
          strokeWidth="5"
          className="stroke-muted"
        />
        <circle
          cx="28"
          cy="28"
          r={radius}
          fill="none"
          strokeWidth="5"
          strokeLinecap="round"
          className="stroke-accent-brand transition-[stroke-dashoffset] duration-1000 ease-out motion-reduce:transition-none"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - shown / 100)}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-sm font-bold tabular-nums">
        {formatPct(value)}%
      </span>
    </div>
  )
}
