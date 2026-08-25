import { DEFAULT_SELECTION_THRESHOLD_PCT } from "@/services/hr"

/**
 * How the selection bar is read and written wherever it appears — the job list,
 * the job's own header, and the verdict on a finished interview.
 *
 * One module because the *absence* of a value has meaning and every screen has
 * to say the same thing about it. A job that sets no threshold, and a result
 * from before the backend could carry one, are both judged on the platform
 * default; rendering either as an empty cell would read as "no bar at all",
 * which is the one thing it never means.
 */

/** The bar in force, and whether it is the job's own or the platform's. */
export function selectionThreshold(pct?: number | null): {
  value: number
  isDefault: boolean
} {
  return pct == null
    ? { value: DEFAULT_SELECTION_THRESHOLD_PCT, isDefault: true }
    : { value: pct, isDefault: false }
}

/**
 * `80.0` → `"80"`, `77.5` → `"77.5"`.
 *
 * The API sends these as floats, and "80.0%" on a whole-number bar reads as a
 * precision the setting doesn't have — it is set by typing an integer.
 */
export function formatPct(value: number): string {
  return String(Number(value.toFixed(1)))
}

/**
 * The bar as a phrase: `"80%"`, or `"75% (default)"` when nothing set one.
 *
 * The qualifier is not noise — it is the difference between a number someone
 * chose for this job and one that came with the platform, and it is what tells a
 * reader whether editing the job would change it.
 */
export function selectionThresholdLabel(pct?: number | null): string {
  const { value, isDefault } = selectionThreshold(pct)
  return isDefault ? `${formatPct(value)}% (default)` : `${formatPct(value)}%`
}
