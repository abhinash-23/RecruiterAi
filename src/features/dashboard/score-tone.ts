/**
 * What a score is printed in.
 *
 * Colour before digits: a recruiter scanning a list reads the band, then the
 * number. The bands are a product decision — 70 and 40 — and they were written
 * out four times, so changing them changed some screens and not others.
 *
 * **The bottom band is the argument, not a copy/paste difference.** It differed
 * between those four, and one of them was right to differ: a low *fit* score
 * means a weak match on a candidate nobody has judged yet, while a low
 * *interview* score is a result. `low` is how a caller says which it has, so the
 * shortlist's grey reads as a choice rather than as drift.
 */
export type LowScoreMeaning =
  /** A result, and a poor one — painted as such. */
  | "poor"
  /** Only a weak signal. Held to the muted tone; no verdict implied. */
  | "weak"

const GOOD = "text-emerald-600 dark:text-emerald-400"
const MIDDLING = "text-amber-600 dark:text-amber-400"
const POOR = "text-destructive"
/** Also what a missing score reads as: nothing to say, said quietly. */
const MUTED = "text-muted-foreground"

export function scoreTone(
  score: number | null | undefined,
  low: LowScoreMeaning = "poor"
): string {
  // Null is "not scored", never zero — an unanalysed candidate must not read as
  // one who scored nothing.
  if (score === null || score === undefined) return MUTED
  if (score >= 70) return GOOD
  if (score >= 40) return MIDDLING
  return low === "weak" ? MUTED : POOR
}
