import type { ReactNode } from "react"
import type { LucideIcon } from "lucide-react"

import { Card } from "@/components/ui/card"
import { cn } from "@/lib/utils"

/** Written out in full so Tailwind finds every class at build time. */
const TONE = {
  brand: { tile: "bg-accent-brand-muted text-accent-brand", bar: "bg-accent-brand" },
  success: {
    tile: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    bar: "bg-emerald-500",
  },
  info: {
    tile: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
    bar: "bg-sky-500",
  },
  warning: {
    tile: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
    bar: "bg-amber-500",
  },
  danger: {
    tile: "bg-red-500/10 text-red-600 dark:text-red-400",
    bar: "bg-red-500",
  },
  neutral: { tile: "bg-muted text-muted-foreground", bar: "bg-foreground/40" },
} as const

export type StatTone = keyof typeof TONE

/**
 * One figure on a dashboard: what it is, the number, and one line saying what
 * it means — either a plain `note`, or a `rate` drawn as a bar with
 * `rateText` beside the percentage.
 *
 * The label row has a fixed height so a label that wraps to two lines can't
 * push its number below its neighbours' — a row of these keeps one baseline.
 */
export function StatCard({
  label,
  value,
  icon: Icon,
  tone = "brand",
  note,
  rate,
  rateText,
  className,
}: {
  label: string
  value: ReactNode
  icon: LucideIcon
  tone?: StatTone
  note?: ReactNode
  /** 0–100. When set, replaces `note` with a bar and the percentage. */
  rate?: number
  rateText?: ReactNode
  className?: string
}) {
  return (
    <Card
      className={cn(
        "gap-0 px-5 transition-shadow hover:shadow-brand",
        className
      )}
    >
      <div className="flex h-10 items-start justify-between gap-3">
        <p className="text-sm leading-5 font-medium text-muted-foreground">
          {label}
        </p>
        <span
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-xl",
            TONE[tone].tile
          )}
        >
          <Icon className="size-[1.125rem]" />
        </span>
      </div>

      <p className="mt-1 truncate text-3xl font-bold tracking-tight tabular-nums">
        {value}
      </p>

      {rate !== undefined || note ? (
        <div className="mt-auto pt-4">
          {rate !== undefined ? (
            <>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className={cn(
                    "h-full rounded-full transition-[width] duration-700 ease-out",
                    TONE[tone].bar
                  )}
                  style={{ width: `${Math.max(0, Math.min(100, rate))}%` }}
                />
              </div>
              <p className="mt-2 truncate text-xs text-muted-foreground">
                <span className="font-semibold text-foreground tabular-nums">
                  {rate.toFixed(1)}%
                </span>{" "}
                {rateText}
              </p>
            </>
          ) : (
            <p className="truncate text-xs text-muted-foreground">{note}</p>
          )}
        </div>
      ) : null}
    </Card>
  )
}
