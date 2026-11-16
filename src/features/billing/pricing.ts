import { usePlatformSettings } from "@/services/super-admin"

/** The prices, as platform settings, and what applies until they're set. */
export const PRICE_SETTINGS = {
  signup: { key: "billing_signup_credits", fallback: 200 },
  interview: { key: "billing_interview_credits", fallback: 50 },
  /** One credit's price in US cents — 70, so a 50-credit interview is $35. */
  creditPrice: { key: "billing_credit_price_cents", fallback: 70 },
} as const

/** A stored setting as a number: the store may hold `50` or `{ value: 50 }`. */
export function storedNumber(value: unknown): number | null {
  if (typeof value === "number") return value
  if (value && typeof value === "object" && "value" in value) {
    const inner = (value as { value: unknown }).value
    return typeof inner === "number" ? inner : null
  }
  return null
}

/** Below two interviews' worth at the current price. */
export function isLowBalance(balance: number, interviewCost: number) {
  return balance < interviewCost * 2
}

/**
 * The platform's current prices, for the super admin. Falls back to the
 * defaults while the settings load, or if they can't be read.
 */
export function useCreditPricing() {
  const settings = usePlatformSettings()
  return {
    settings,
    signupCredits:
      storedNumber(settings.data?.[PRICE_SETTINGS.signup.key]) ??
      PRICE_SETTINGS.signup.fallback,
    interviewCost:
      storedNumber(settings.data?.[PRICE_SETTINGS.interview.key]) ??
      PRICE_SETTINGS.interview.fallback,
    creditPriceCents:
      storedNumber(settings.data?.[PRICE_SETTINGS.creditPrice.key]) ??
      PRICE_SETTINGS.creditPrice.fallback,
  }
}
