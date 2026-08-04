import { cn } from "@/lib/utils"

export interface RoundStep {
  id: string
  name: string
}

interface RoundStepperProps {
  rounds: RoundStep[]
  /** Index of the round the current question belongs to. */
  activeIndex: number
  className?: string
}

/**
 * Progress across the interview's rounds, shown in the top bar.
 *
 * Numbers rather than round names: four names would not fit beside the timer,
 * and the current round's name is already printed above the question itself.
 */
export function RoundStepper({
  rounds,
  activeIndex,
  className,
}: RoundStepperProps) {
  if (rounds.length === 0) return null

  return (
    <div className={cn("flex flex-col items-center gap-1", className)}>
      <div className="flex w-full items-center justify-between gap-2">
        <span className="text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
          Progress rounds
        </span>
        <span className="text-xs font-semibold text-brand-blue tabular-nums">
          {activeIndex + 1}/{rounds.length}
        </span>
      </div>

      <ol className="flex items-center">
        {rounds.map((round, index) => {
          const done = index < activeIndex
          const active = index === activeIndex
          return (
            <li key={round.id} className="flex items-center">
              <span
                title={round.name}
                aria-current={active ? "step" : undefined}
                className={cn(
                  "flex size-5 items-center justify-center rounded-full border text-[10px] font-bold tabular-nums transition-colors",
                  done && "border-brand-blue bg-brand-blue text-white",
                  active && "border-brand-blue text-brand-blue",
                  !done && !active && "border-border text-muted-foreground"
                )}
              >
                {index + 1}
              </span>
              {index < rounds.length - 1 ? (
                <span
                  className={cn(
                    "h-px w-10 sm:w-16",
                    done ? "bg-brand-blue" : "bg-border"
                  )}
                />
              ) : null}
            </li>
          )
        })}
      </ol>
      <span className="sr-only">
        Current round: {rounds[activeIndex]?.name}
      </span>
    </div>
  )
}
