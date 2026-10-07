import * as React from "react"

import { INTERVIEW_ROUND_OPTIONS, type InterviewRound } from "@/services/admin"

/**
 * ============================================================================
 * INTERVIEW ROUNDS — one picker for every place rounds are chosen
 * ============================================================================
 * The company defaults, a job, a schedule batch and a direct interview all pick
 * from the same four rounds under the same rules, so they share this rather
 * than four copies drifting apart:
 *
 *  - **At least one.** The server refuses an empty list with a 422, so the
 *    last chip that's on can't be switched off.
 *  - **Canonical order**, not click order — the API's own order, and the one
 *    every screen lists them in.
 *
 * The other rule lives in {@link useRoundSelection}: a picker **starts from a
 * base** (the company defaults, or the job's own rounds), and `rounds` is sent
 * only when the recruiter actually changed it. Sending the untouched prefill
 * would work, but it freezes a job at today's defaults instead of following
 * them.
 */

/** Same rounds, whatever the order. */
export function sameRounds(
  a: readonly InterviewRound[],
  b: readonly InterviewRound[]
): boolean {
  return a.length === b.length && a.every((round) => b.includes(round))
}

/** `["softskills", "jd"]` → `softskills · jd`, in canonical order. */
export function formatRounds(rounds: readonly InterviewRound[]): string {
  return INTERVIEW_ROUND_OPTIONS.filter((round) => rounds.includes(round)).join(
    " · "
  )
}

/**
 * A rounds selection that remembers whether anyone touched it.
 *
 * `base` is what the picker opens with — the company defaults, or a job's own
 * list. Until it loads (or if it can't: an older deployment refusing HR) the
 * picker shows all four, which is the platform's own default set.
 *
 * `changed` is true only when the shown selection differs from `base`; that is
 * the signal to send `rounds` at all. Picking your way back to the base counts
 * as unchanged, so it keeps inheriting.
 */
export function useRoundSelection(
  base: readonly InterviewRound[] | null | undefined
) {
  const [picked, setPicked] = React.useState<InterviewRound[] | null>(null)

  const rounds = picked ?? [...(base ?? INTERVIEW_ROUND_OPTIONS)]
  const changed = picked !== null && !(base && sameRounds(picked, base))

  return {
    rounds,
    changed,
    setRounds: setPicked,
    /** Back to following `base`. */
    reset: React.useCallback(() => setPicked(null), []),
  }
}
