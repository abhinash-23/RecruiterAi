/**
 * How far **this tab** got with an interview — so a reload can say what
 * happened instead of offering a code screen that can no longer help.
 *
 * `verified` covers consent and the camera step; `sitting` is the interview
 * itself; `done` is submitted; `closed` is any other dead end.
 */
export type SittingMark = "verified" | "sitting" | "done" | "closed"

const MARK_PREFIX = "recruiterai.sitting."

/**
 * What this tab last recorded for the interview, or null.
 *
 * `sessionStorage`, so it survives a reload of this tab and nothing else — a
 * new tab or another device starts at the code screen as before. It holds the
 * stage and nothing more: **never the candidate token**, which would turn a
 * stray script into someone else's sitting.
 */
export function readSittingMark(interviewId: string): SittingMark | null {
  try {
    const value = sessionStorage.getItem(MARK_PREFIX + interviewId)
    return value === "verified" ||
      value === "sitting" ||
      value === "done" ||
      value === "closed"
      ? value
      : null
  } catch {
    return null
  }
}

export function writeSittingMark(interviewId: string, mark: SittingMark) {
  try {
    sessionStorage.setItem(MARK_PREFIX + interviewId, mark)
  } catch {
    // Storage blocked: a reload then shows the code screen, as it always did.
  }
}
