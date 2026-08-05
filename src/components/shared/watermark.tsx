/**
 * The product mark, on every screen.
 *
 * Mounted once beside the router rather than in each layout, because "every
 * screen" includes the ones that aren't in a layout at all — the landing page,
 * login, and the candidate's interview, which is its own full-height shell.
 *
 * Three things make it a watermark rather than a footer:
 *
 *  - `pointer-events-none`, so it can sit over a button without swallowing the
 *    click. Nothing here is interactive, so nothing is lost.
 *  - `z-40`, which is **below** dialogs and their backdrop (`z-50`). A mark
 *    floating over a modal's own footer reads as part of the modal.
 *  - Faint and small enough to ignore, in the bottom-right corner where no
 *    screen puts anything it needs read.
 */
export function Watermark() {
  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-end"
      // Decorative: it repeats on every screen, and a screen reader announcing
      // it at the end of each one is noise, not information.
      aria-hidden="true"
    >
      {/* Flush into the corner, with only the inner edge rounded, so it reads as
          part of the frame rather than something left lying there.

          The faint backdrop is what keeps it readable everywhere: the landing
          page's footer is dark whatever the theme, so bare theme-coloured text
          disappears there entirely in light mode. Sitting on the page's own
          background means one pair of colours works over every surface the mark
          can land on. */}
      <span className="rounded-tl-md bg-background/70 px-2.5 pt-0.5 pb-1 text-[10px] leading-none tracking-wide text-foreground/35 backdrop-blur-[2px]">
        {/* Not a hard-coded year: a stale copyright line is a small thing that
            makes a product look abandoned. */}
        &copy; {new Date().getFullYear()} powered by RecruiterAI
      </span>
    </div>
  )
}
