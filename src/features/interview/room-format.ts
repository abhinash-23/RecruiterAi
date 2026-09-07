/**
 * The two literals both interview rooms read from, and nothing else.
 *
 * A file of their own rather than a couple of exports beside the chrome
 * components: a module that exports both a component and a plain function opts
 * the whole file out of Fast Refresh, so editing the top bar would reload the
 * page — and the page in question is one a candidate is sitting an interview in.
 */

/** A/B/C/D/E — how the host reads the options out, spoken and written. */
export const OPTION_LETTERS = "ABCDEFGHIJ".split("")

/** `mm:ss`, floored at zero: a negative clock is a bug, not a countdown. */
export function formatClock(seconds: number) {
  const safe = Math.max(0, seconds)
  const minutes = Math.floor(safe / 60)
  return `${String(minutes).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`
}
