/**
 * The round trip to Stripe Checkout and back.
 *
 *   Buy → POST /billing/orders → Stripe's page → back here → POST /billing/verify
 *
 * The admin **leaves the app** for Stripe's hosted page, so whatever was on
 * screen is gone when they return. Two things carry the purchase across:
 *
 *  - the return URL, which Stripe fills with `?session_id=cs_…`;
 *  - a copy of that id in `sessionStorage`, for a return that somehow lost
 *    its query string. Per tab, and only ever an id — never a token.
 *
 * Both return pages are the Billing page itself, so nothing needs a route of
 * its own: the page reads its query string and confirms, or says "cancelled".
 */

const PENDING_KEY = "recruiterai.pendingStripeSession"

/** Stripe replaces this, literally, with the real checkout id. */
const SESSION_PLACEHOLDER = "{CHECKOUT_SESSION_ID}"

export const CHECKOUT_PARAM = {
  session: "session_id",
  payment: "payment",
  cancelled: "cancelled",
} as const

/**
 * Where Stripe sends the admin afterwards: this page, by path — the app uses
 * real paths, not `#/` routes, so the backend's hash-route defaults would
 * land on the wrong page. Both must be pages of this app's origin, or the
 * order is refused with a 422.
 */
export function checkoutReturnUrls() {
  const page = `${window.location.origin}${window.location.pathname}`
  return {
    successUrl: `${page}?${CHECKOUT_PARAM.session}=${SESSION_PLACEHOLDER}`,
    cancelUrl: `${page}?${CHECKOUT_PARAM.payment}=${CHECKOUT_PARAM.cancelled}`,
  }
}

export function rememberPendingCheckout(sessionId: string) {
  try {
    sessionStorage.setItem(PENDING_KEY, sessionId)
  } catch {
    // Storage blocked: the return URL still carries the id.
  }
}

export function readPendingCheckout(): string | null {
  try {
    return sessionStorage.getItem(PENDING_KEY)
  } catch {
    return null
  }
}

export function clearPendingCheckout() {
  try {
    sessionStorage.removeItem(PENDING_KEY)
  } catch {
    // Nothing to clear.
  }
}
