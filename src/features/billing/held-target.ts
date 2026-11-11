/** The interview whose held credits are being decided. */
export interface HeldCreditsTarget {
  interviewId: string
  candidateName: string
  /** Shown on the buttons when known; the server refunds what was charged. */
  credits?: number
}

/** "50 credits", or "the credits" when the amount isn't known here. */
export function creditsText(target: HeldCreditsTarget) {
  return target.credits ? `${target.credits} credits` : "the credits"
}
