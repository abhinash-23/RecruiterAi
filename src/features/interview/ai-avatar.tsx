import { cn } from "@/lib/utils"

const BARS = [0.55, 0.85, 1, 0.75, 0.5]

/**
 * Elena's orb. A slow-turning conic gradient at rest; while she speaks it
 * blooms, rings ripple out and a small voice meter moves inside it.
 *
 * Coloured from `--orb` / `--orb-sun` rather than `--primary`, which is neutral
 * in this theme and would turn her grey.
 *
 * The bloom is drawn outside the orb's own box — give it room.
 */
export function AiAvatar({
  speaking,
  size = "md",
}: {
  speaking: boolean
  size?: "sm" | "md"
}) {
  return (
    <div
      className={cn(
        "relative grid place-items-center",
        size === "md" ? "size-28" : "size-16"
      )}
      aria-label={speaking ? "Elena is speaking" : "Elena is listening"}
      role="img"
    >
      <span
        className={cn(
          "absolute -inset-4 rounded-full bg-orb/30 blur-2xl transition-all duration-700",
          speaking ? "scale-110 opacity-100" : "scale-90 opacity-50"
        )}
      />
      {speaking ? (
        <>
          <span className="absolute inset-0 rounded-full border-2 border-orb/50 motion-safe:animate-ripple" />
          <span className="absolute inset-0 rounded-full border border-orb-sun/50 [animation-delay:900ms] motion-safe:animate-ripple" />
        </>
      ) : null}

      <span className="absolute inset-0 overflow-hidden rounded-full shadow-lg ring-1 shadow-orb/30 ring-white/20">
        <span className="absolute -inset-1/2 bg-[conic-gradient(from_0deg,var(--orb),oklch(0.77_0.15_165),var(--orb-sun),var(--orb))] motion-safe:animate-orb" />
        <span className="absolute inset-[18%] rounded-full bg-white/25 blur-md" />
      </span>

      <span className="relative flex h-1/3 items-center gap-0.75">
        {BARS.map((height, index) => (
          <span
            key={index}
            style={{
              height: `${height * 100}%`,
              animationDelay: `${index * 120}ms`,
            }}
            className={cn(
              "w-1 origin-center rounded-full bg-white/90 transition-transform",
              speaking ? "motion-safe:animate-voice" : "scale-y-[0.3]"
            )}
          />
        ))}
      </span>
    </div>
  )
}
