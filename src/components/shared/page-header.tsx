import type { ReactNode } from "react"
import type { LucideIcon } from "lucide-react"

import { cn } from "@/lib/utils"

interface PageHeaderProps {
  title: string
  description?: string
  /**
   * The page's own icon, drawn in a brand tile beside the title — the same
   * icon the sidebar uses for it, so the two read as one place.
   */
  icon?: LucideIcon
  /** A small line under the description: counts, status chips. See `MetaChip`. */
  meta?: ReactNode
  /** Buttons or filters aligned to the right of the title. */
  actions?: ReactNode
  className?: string
}

export function PageHeader({
  title,
  description,
  icon: Icon,
  meta,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-start justify-between gap-4",
        className
      )}
    >
      <div className="flex min-w-0 items-start gap-4">
        {Icon ? (
          <span className="hidden size-12 shrink-0 items-center justify-center rounded-2xl brand-gradient text-white shadow-brand sm:flex">
            <Icon className="size-6" />
          </span>
        ) : null}
        <div className="min-w-0">
          {/* Wraps on a phone rather than truncating: a candidate's name cut to
              "Abhinash Pedd…" is the one thing on the page that must be readable. */}
          <h1 className="font-heading text-xl font-bold tracking-tight break-words sm:truncate sm:text-2xl">
            {title}
          </h1>
          {description ? (
            <p className="mt-0.5 max-w-3xl text-sm break-words text-muted-foreground">
              {description}
            </p>
          ) : null}
          {meta ? (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {meta}
            </div>
          ) : null}
        </div>
      </div>
      {actions ? (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </div>
  )
}

const CHIP_TONE = {
  neutral: "border-border bg-background text-muted-foreground",
  success:
    "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  warning:
    "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  danger: "border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-400",
  brand: "border-accent-brand/25 bg-accent-brand-muted text-accent-brand",
} as const

/** A small pill for a header's `meta` line: "4 open", "1 failed". */
export function MetaChip({
  tone = "neutral",
  className,
  children,
}: {
  tone?: keyof typeof CHIP_TONE
  className?: string
  children: ReactNode
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium tabular-nums",
        CHIP_TONE[tone],
        className
      )}
    >
      {children}
    </span>
  )
}
