import { cn } from "@/lib/utils"

/**
 * The AI host's presence: a glossy sphere with colour moving under its surface,
 * breathing while she speaks and held still when it is the candidate's turn.
 *
 * Deliberately abstract rather than a face or a photo — a synthetic human
 * likeness invites the candidate to read expression into it, and there is none
 * to read. It exists to answer one question, "is it my turn yet?", which is why
 * the two states differ in *motion* first: a still sphere means the floor is
 * yours. Brightness follows, so they are never told apart by colour alone.
 *
 * **Two rhythms, saying two different things.** The colour drifts on 14-to-26
 * second clocks — ambient, meaning "awake" — while the sphere itself swells on a
 * 1.7-second cadence and sheds rings, which is the voice-assistant idiom for
 * "still talking". A candidate glancing up needs the second one to be legible in
 * a fraction of a second; the first is only there so the figure isn't inert
 * between questions.
 *
 * **Emerald, not the brand's blue and pink.** The room has its own accent
 * language — the host's live dot, "Current question", the situation's left
 * border, the transcript bubbles — and all of it is green. The sphere is the
 * largest object on that card, so in brand colours it read as a foreign object
 * and competed with the one colour the candidate is meant to track. The wordmark
 * keeps the brand hues; this follows the room.
 *
 * **CSS, with no canvas and no frame loop.** The figure is five blurred colour
 * fields behind a rim light, and blur over a gradient is something the compositor
 * does on the GPU for free — where a canvas would mean `requestAnimationFrame`
 * running for the length of a sitting, on a page that is already encoding the
 * candidate's camera and holding a socket open. Waiting costs nothing at all
 * here: the animations are *paused*, not swapped for anything.
 *
 * Blur radii are in `cqw` — percentages of this element's own width — so the
 * whole sphere scales from the one size class and nothing has to be retuned to
 * show it larger. That is what `@container` is doing on the root.
 */

/**
 * The colour under the surface, back to front.
 *
 * Each field is its own element because they have to drift independently — a
 * single multi-stop gradient can be animated, but every stop moves together, and
 * what makes this read as liquid is that they don't. `screen` blending is what
 * makes the overlaps brighten rather than muddy: painted normally, the deep
 * emerald over the mint gives a flat sage, and the sphere loses its depth.
 */
const FIELDS = [
  {
    key: "mint",
    // Top-left, and the palest of them: this is the one that reads as light
    // entering the sphere rather than as colour inside it.
    style: {
      background:
        "radial-gradient(circle at 50% 50%, rgba(190,255,240,0.95) 0%, rgba(110,240,205,0.35) 45%, transparent 70%)",
      inset: "-18% 24% 34% -14%",
      filter: "blur(8cqw)",
    },
    animate: "motion-safe:animate-orb-drift-a",
  },
  {
    key: "emerald",
    // The room's own accent, and the largest field — the sphere's base note.
    style: {
      background:
        "radial-gradient(circle at 50% 50%, rgba(16,185,129,0.95) 0%, rgba(5,120,90,0.42) 48%, transparent 72%)",
      inset: "12% -12% -20% 6%",
      filter: "blur(9cqw)",
    },
    animate: "motion-safe:animate-orb-drift-b",
  },
  {
    key: "teal",
    style: {
      background:
        "radial-gradient(circle at 50% 50%, rgba(34,211,238,0.85) 0%, rgba(14,116,144,0.35) 50%, transparent 74%)",
      inset: "22% 14% -24% -10%",
      filter: "blur(10cqw)",
    },
    animate: "motion-safe:animate-orb-drift-c",
  },
  {
    key: "lime",
    // Upper-right, opposite the mint, and the warmest note in here. Without one
    // end of the range leaning yellow the sphere is a single hue at five
    // brightnesses, which is what made the last version read flat.
    style: {
      background:
        "radial-gradient(circle at 50% 50%, rgba(200,255,170,0.85) 0%, rgba(101,204,120,0.4) 46%, transparent 70%)",
      inset: "-14% -16% 40% 30%",
      filter: "blur(8cqw)",
    },
    animate: "motion-safe:animate-orb-drift-d",
  },
  {
    key: "shadow",
    // Not a colour but an absence: the reference's sphere is dark through the
    // middle, and without something eating the centre the fields above merge
    // into one flat bright disc.
    style: {
      background:
        "radial-gradient(circle at 50% 50%, rgba(1,14,10,0.95) 0%, rgba(1,14,10,0.55) 45%, transparent 70%)",
      inset: "26% 22% 10% 14%",
      filter: "blur(10cqw)",
    },
    animate: "motion-safe:animate-orb-drift-e",
  },
]

export function AiAvatar({
  speaking,
  className,
}: {
  speaking?: boolean
  className?: string
}) {
  return (
    <div
      // Decorative: everything it conveys is said in words beside it — the
      // host's name carries a live dot, and the answer controls say whose turn
      // it is.
      aria-hidden
      className={cn("relative size-28 @container", className)}
    >
      {/* The glow thrown past the sphere. Outside it, so the container needs
          padding around it or the card's `overflow-hidden` clips it flat. */}
      <span
        className={cn(
          "absolute inset-[-26%] rounded-full transition-all duration-700",
          speaking ? "scale-105 opacity-100" : "scale-95 opacity-40"
        )}
        style={{
          background:
            "radial-gradient(circle, rgba(16,185,129,0.34) 0%, rgba(13,148,136,0.13) 46%, transparent 72%)",
        }}
      />

      {/* Rings shed on the beat, which is the part that reads as *voice* from
          across a desk. Two, half a cycle apart, so there is always one on its
          way out — a single ring reads as a repeating blip instead of as a
          continuous signal. Only while speaking: this is the loudest thing the
          card does, and it must not run while the candidate is answering.

          Siblings of the sphere rather than children, because the sphere clips
          its overflow and these have to travel past its edge. */}
      {speaking ? (
        <>
          <span className="absolute inset-0 rounded-full border border-emerald-300/45 motion-safe:animate-ripple" />
          <span className="absolute inset-0 rounded-full border border-emerald-300/30 motion-safe:animate-ripple [animation-delay:850ms]" />
        </>
      ) : null}

      {/* The breath is on this wrapper, not on the fields: they are already
          animating their own drift, and a second transform on the same element
          would replace it rather than compose with it. */}
      <span
        className={cn(
          "absolute inset-0 overflow-hidden rounded-full bg-[#03100c]",
          speaking && "motion-safe:animate-orb-breathe"
        )}
      >
        {FIELDS.map((field) => (
          <span
            key={field.key}
            className={cn(
              "absolute rounded-full mix-blend-screen transition-opacity duration-700",
              field.animate,
              speaking ? "opacity-100" : "opacity-55",
              // Paused rather than removed: the fields hold the arrangement they
              // were in, so the sphere settles instead of snapping to a pose.
              !speaking && "paused"
            )}
            style={field.style}
          />
        ))}

        {/* Light wrapping the edge — bright at the rim, nothing through the
            middle. This is what makes it read as a sphere rather than as a
            circle with colour behind it. */}
        <span
          className="pointer-events-none absolute inset-0 rounded-full mix-blend-screen"
          style={{
            background:
              "radial-gradient(circle at 50% 50%, transparent 58%, rgba(205,255,235,0.16) 82%, rgba(235,255,248,0.5) 95%, rgba(255,255,255,0.28) 100%)",
          }}
        />

        {/* The specular — one soft highlight up and to the left, so every
            sphere on the page is lit from the same direction. */}
        <span
          className={cn(
            "pointer-events-none absolute inset-0 rounded-full mix-blend-screen transition-opacity duration-700",
            speaking ? "opacity-100" : "opacity-60"
          )}
          style={{
            background:
              "radial-gradient(circle at 30% 22%, rgba(255,255,255,0.5) 0%, rgba(255,255,255,0.12) 26%, transparent 46%)",
            filter: "blur(3cqw)",
          }}
        />
      </span>
    </div>
  )
}
