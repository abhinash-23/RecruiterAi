import type { LucideIcon } from "lucide-react"

import { Button } from "@/components/ui/button"

/**
 * `destructive` for actions that take something away (disable, close, revoke),
 * `positive` for the ones that give it back (enable, reopen). Anything neutral
 * — edit, open, reset — takes no tone.
 */
export type IconActionTone = "destructive" | "positive"

export interface IconActionProps {
  /** The accessible name *and* the hover tooltip. */
  label: string
  Icon: LucideIcon
  onSelect: () => void
  tone?: IconActionTone
  disabled?: boolean
}

const TONE_CLASS: Record<IconActionTone, string> = {
  destructive:
    "text-destructive hover:bg-destructive/10 hover:text-destructive",
  // Matches the "Active" status badge, so the colour means the same thing in
  // both columns: this row is (or is about to be) live.
  positive:
    "text-emerald-600 hover:bg-emerald-500/10 hover:text-emerald-600 dark:text-emerald-400 dark:hover:text-emerald-400",
}

/**
 * One row action, as an icon.
 *
 * Used in a table's Actions cell where there are few enough actions to show
 * them all: each is then one click instead of two through a `⋯` menu.
 *
 * The label is required and does double duty as the accessible name and the
 * tooltip — an icon-only control that says nothing is a guess for anyone who
 * doesn't already know the page. Clicks stop propagating, because these cells
 * usually sit inside a row that navigates somewhere of its own.
 */
export function IconAction({
  label,
  Icon,
  onSelect,
  tone,
  disabled,
}: IconActionProps) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation()
        onSelect()
      }}
      className={tone ? TONE_CLASS[tone] : undefined}
    >
      <Icon />
    </Button>
  )
}
