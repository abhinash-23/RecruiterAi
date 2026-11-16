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

import * as React from "react"

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

/* -------------------------------------------------------------------------- */
/*  Between tabs                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Stripe opens in a **new tab**, so the payment finishes in a different tab
 * from the one that started it. The returning tab confirms the payment, then
 * says so on this channel; the tab still showing "waiting for payment" hears
 * it and moves on by itself. Same origin only, by the browser's own rule.
 */
export type CheckoutMessage =
  | { type: "paid"; sessionId: string; creditsAdded: number; balance: number }
  | { type: "cancelled" }

const CHANNEL = "recruiterai.checkout"

export function announceCheckout(message: CheckoutMessage) {
  if (typeof BroadcastChannel === "undefined") return
  const channel = new BroadcastChannel(CHANNEL)
  channel.postMessage(message)
  channel.close()
}

/** Listens while `active`; the handler always sees the latest render's state. */
export function useCheckoutMessages(
  active: boolean,
  onMessage: (message: CheckoutMessage) => void
) {
  const handler = React.useRef(onMessage)
  React.useEffect(() => {
    handler.current = onMessage
  })
  React.useEffect(() => {
    if (!active || typeof BroadcastChannel === "undefined") return
    const channel = new BroadcastChannel(CHANNEL)
    channel.onmessage = (event: MessageEvent<CheckoutMessage>) =>
      handler.current(event.data)
    return () => channel.close()
  }, [active])
}

/**
 * Opens a blank tab **now**, inside the click, and returns it to be pointed
 * at Stripe once the server answers. Opened after the `await` instead, it
 * would no longer count as the click's doing and the browser's popup blocker
 * would stop it. Null when it was blocked anyway — the caller then goes to
 * Stripe in this tab, as before.
 */
export function openCheckoutTab(): Window | null {
  const tab = window.open("", "_blank")
  if (!tab) return null
  try {
    tab.document.title = "Opening secure payment…"
    tab.document.body.style.cssText =
      "margin:0;display:grid;place-items:center;height:100vh;font:15px system-ui,sans-serif;color:#64748b;background:#0f1115"
    tab.document.body.textContent = "Opening Stripe’s secure payment page…"
  } catch {
    // A browser that won't let us write to it still lets us navigate it.
  }
  return tab
}

/**
 * After a payment confirmed in the Stripe tab: close that tab, which this
 * app opened, so the admin lands back on the one they started from. Does
 * nothing in a tab the browser didn't let us open.
 */
export function closeCheckoutTab() {
  try {
    window.close()
  } catch {
    // Not ours to close.
  }
}

export function clearPendingCheckout() {
  try {
    sessionStorage.removeItem(PENDING_KEY)
  } catch {
    // Nothing to clear.
  }
}
