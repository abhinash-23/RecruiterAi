import { cn } from "@/lib/utils"

/**
 * The AI host's presence: a ring of petals that spins while it is speaking and
 * settles when it isn't.
 *
 * Deliberately abstract rather than a face or a photo — a synthetic human
 * likeness invites the candidate to read expression into it, and there is none
 * to read. The animation exists only to answer "is it my turn yet?".
 */
export function AiAvatar({
  speaking,
  className,
}: {
  speaking?: boolean
  className?: string
}) {
  return (
    <div
      className={cn("relative grid size-36 place-items-center", className)}
      aria-hidden
    >
      {/* Halo — widens while speaking. */}
      <span
        className={cn(
          "absolute inset-0 rounded-full border-4 transition-all duration-500",
          speaking
            ? "scale-105 border-emerald-500/30"
            : "scale-100 border-border/70"
        )}
      />
      <span
        className={cn(
          "absolute inset-2 rounded-full border transition-colors duration-500",
          speaking ? "border-emerald-500/20" : "border-transparent"
        )}
      />

      {/* Petals. `motion-safe` only: this loops forever, so anyone who asked
          for reduced motion gets the static version. */}
      <span
        className={cn(
          "relative grid size-24 place-items-center",
          speaking && "motion-safe:animate-[spin_6s_linear_infinite]"
        )}
      >
        {[0, 60, 120, 180, 240, 300].map((angle) => (
          <span
            key={angle}
            style={{ transform: `rotate(${angle}deg) translateY(-26%)` }}
            className={cn(
              "absolute h-10 w-6 rounded-full transition-colors duration-500",
              speaking ? "bg-emerald-500/85" : "bg-emerald-600/45"
            )}
          />
        ))}
        <span className="absolute size-6 rounded-full bg-background" />
      </span>
    </div>
  )
}
