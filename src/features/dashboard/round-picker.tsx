import { Button } from "@/components/ui/button"
import { INTERVIEW_ROUND_OPTIONS, type InterviewRound } from "@/services/admin"

/**
 * The four rounds as chips. The rules for every picker in the app — at least
 * one, canonical order, prefill from a base and send only when changed — are
 * set out in `./rounds`.
 */
export function RoundPicker({
  value,
  onChange,
  disabled,
}: {
  value: readonly InterviewRound[]
  onChange: (next: InterviewRound[]) => void
  disabled?: boolean
}) {
  const toggle = (round: InterviewRound) => {
    const on = value.includes(round)
    if (on && value.length === 1) return
    onChange(
      INTERVIEW_ROUND_OPTIONS.filter((option) =>
        option === round ? !on : value.includes(option)
      )
    )
  }

  return (
    <div className="flex flex-wrap gap-2">
      {INTERVIEW_ROUND_OPTIONS.map((round) => {
        const on = value.includes(round)
        const last = on && value.length === 1
        return (
          <Button
            key={round}
            type="button"
            variant={on ? "default" : "outline"}
            size="sm"
            aria-pressed={on}
            /* The last one on refuses the click but keeps its look: `disabled`
               would fade it, and a faded chip reads as switched off — the
               opposite of the truth. The reason is on hover. */
            aria-disabled={last || undefined}
            disabled={disabled}
            title={last ? "At least one round is required" : undefined}
            onClick={() => toggle(round)}
          >
            {round}
          </Button>
        )
      })}
    </div>
  )
}
