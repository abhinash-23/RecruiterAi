import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

type Tone = "positive" | "warning" | "danger" | "info" | "neutral"

const TONE_CLASS: Record<Tone, string> = {
  positive:
    "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20",
  warning:
    "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20",
  danger: "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20",
  info: "bg-brand-blue/10 text-brand-blue border-brand-blue/20",
  neutral: "bg-muted text-muted-foreground border-transparent",
}

/** Maps every status string in the app onto a tone and a readable label. */
const STATUS_TONE: Record<string, { tone: Tone; label: string }> = {
  active: { tone: "positive", label: "Active" },
  disabled: { tone: "danger", label: "Disabled" },
  expired: { tone: "danger", label: "Expired" },
  scheduled: { tone: "info", label: "Scheduled" },
  ongoing: { tone: "warning", label: "Ongoing" },
  completed: { tone: "positive", label: "Completed" },
  cancelled: { tone: "neutral", label: "Cancelled" },
  pending: { tone: "warning", label: "Pending" },
  shortlisted: { tone: "positive", label: "Shortlisted" },
  rejected: { tone: "danger", label: "Rejected" },
  on_hold: { tone: "neutral", label: "On hold" },
  starter: { tone: "neutral", label: "Starter" },
  professional: { tone: "info", label: "Professional" },
  enterprise: { tone: "positive", label: "Enterprise" },
}

interface StatusBadgeProps {
  status: string
  /** Overrides the mapped label. */
  label?: string
  className?: string
}

export function StatusBadge({ status, label, className }: StatusBadgeProps) {
  const mapped = STATUS_TONE[status] ?? {
    tone: "neutral" as Tone,
    label: status,
  }

  return (
    <Badge
      variant="outline"
      className={cn("border", TONE_CLASS[mapped.tone], className)}
    >
      {label ?? mapped.label}
    </Badge>
  )
}
