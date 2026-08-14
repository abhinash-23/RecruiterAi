import { cn } from "@/lib/utils"

/**
 * The AI host's presence: a plasma sphere that burns while it is speaking and
 * cools when it isn't.
 *
 * Deliberately abstract rather than a face or a photo — a synthetic human
 * likeness invites the candidate to read expression into it, and there is none
 * to read. The animation exists only to answer "is it my turn yet?", which is
 * why the two states are separated by brightness *and* motion rather than by
 * colour alone: a still, dim sphere means the floor is yours.
 *
 * Drawn in CSS rather than shipped as an image or a video. It has to respond to
 * `speaking` on the frame the host stops talking, it costs no request on a page
 * where the candidate is already uploading video, and it stays sharp at any size.
 *
 * Everything inside is sized as a fraction of the outer box, so the whole orb
 * scales from that one class. It carries its **own dark ground** for the same
 * reason a bulb needs a night sky: this reads as a light source, and the room
 * follows the app's theme — on a light background a glow with no dark behind it
 * looks like a smudge. The bloom deliberately spills outside the sphere, so the
 * container needs padding around it or the card's `overflow-hidden` clips it.
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
      className={cn("relative grid size-28 place-items-center", className)}
      aria-hidden
    >
      {/* The glow thrown past the sphere's own edge. */}
      <span
        className={cn(
          "absolute inset-[-28%] rounded-full transition-all duration-700",
          speaking ? "scale-105 opacity-100" : "scale-95 opacity-40"
        )}
        style={{
          // The brand's own two hues, in the order `brand-gradient` runs them:
          // blue at the source, pink as it thins out.
          background:
            "radial-gradient(circle, rgba(0,82,255,0.42) 0%, rgba(255,0,128,0.16) 48%, transparent 72%)",
        }}
      />

      <span className="absolute inset-0 overflow-hidden rounded-full bg-[#03060e] ring-1 ring-brand-blue/25">
        {/* The body of the sphere: bright at the middle, falling to almost black
            at the rim so the edge reads as curvature rather than as a cut-out. */}
        <span
          className={cn(
            "absolute inset-0 transition-opacity duration-700",
            speaking ? "opacity-100" : "opacity-55"
          )}
          style={{
            background:
              "radial-gradient(circle at 50% 50%, rgba(190,205,255,0.34) 0%, rgba(0,82,255,0.46) 38%, rgba(120,20,90,0.3) 66%, rgba(2,6,23,0.92) 88%)",
          }}
        />

        {/* Filaments, as two spoke sets turning against each other — one set on
            its own reads as a spinning wheel, two as turbulence. One set per
            brand hue, so the crossings shift blue to pink as they pass. Masked
            to fade at the core and the rim, or the spokes would converge on a
            hard point in the centre and stop dead at the edge. */}
        <span
          className={cn(
            "absolute inset-0 transition-opacity duration-700",
            speaking
              ? "opacity-100 motion-safe:animate-[spin_16s_linear_infinite]"
              : "opacity-35"
          )}
          style={{
            background:
              "repeating-conic-gradient(from 0deg, transparent 0deg 2.2deg, rgba(130,165,255,0.55) 2.2deg 2.7deg, transparent 2.7deg 5.4deg)",
            maskImage:
              "radial-gradient(circle, transparent 12%, #000 32%, #000 66%, transparent 82%)",
            WebkitMaskImage:
              "radial-gradient(circle, transparent 12%, #000 32%, #000 66%, transparent 82%)",
            filter: "blur(0.5px)",
          }}
        />
        <span
          className={cn(
            "absolute inset-0 transition-opacity duration-700",
            speaking
              ? "opacity-100 motion-safe:animate-[spin_26s_linear_infinite_reverse]"
              : "opacity-25"
          )}
          style={{
            background:
              "repeating-conic-gradient(from 18deg, transparent 0deg 3.5deg, rgba(255,120,190,0.3) 3.5deg 4.1deg, transparent 4.1deg 9deg)",
            maskImage:
              "radial-gradient(circle, transparent 18%, #000 40%, #000 62%, transparent 76%)",
            WebkitMaskImage:
              "radial-gradient(circle, transparent 18%, #000 40%, #000 62%, transparent 76%)",
            filter: "blur(1px)",
          }}
        />

        {/* The core. Its bloom is a box-shadow rather than another gradient
            layer, so it lights the filaments crossing behind it — white at the
            middle through brand blue to brand pink, the wordmark's own run.

            The beat is the point: two pulses a cycle, so it reads as a question
            being asked rather than as an idle glow. `translate` centres it and
            the keyframes animate `transform`, which in Tailwind v4 are separate
            properties — so the two compose instead of one replacing the other,
            the trap that made the password eye jump. */}
        <span
          className={cn(
            "absolute top-1/2 left-1/2 h-[22%] w-[22%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white transition-all duration-700",
            speaking ? "motion-safe:animate-orb-speak" : "scale-90 opacity-80"
          )}
          style={{
            boxShadow: speaking
              ? "0 0 12px 6px rgba(255,255,255,0.8), 0 0 34px 14px rgba(0,82,255,0.75), 0 0 64px 28px rgba(255,0,128,0.4)"
              : "0 0 10px 4px rgba(190,205,255,0.35), 0 0 26px 10px rgba(0,82,255,0.22)",
            filter: "blur(1px)",
          }}
        />
      </span>
    </div>
  )
}
