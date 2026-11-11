/**
 * Razorpay Checkout, loaded the first time an admin pays rather than with the
 * app: it is a third-party script nobody but an admin buying credits needs.
 */

const CHECKOUT_SRC = "https://checkout.razorpay.com/v1/checkout.js"

export interface RazorpayFailure {
  error: {
    code?: string
    description?: string
    reason?: string
  }
}

export interface RazorpayOptions {
  key: string
  order_id: string
  amount: number
  currency: string
  name: string
  description: string
  prefill?: { name?: string; email?: string; contact?: string }
  theme?: { color?: string }
  handler: (response: {
    razorpay_order_id: string
    razorpay_payment_id: string
    razorpay_signature: string
  }) => void
  modal?: { ondismiss?: () => void }
}

interface RazorpayInstance {
  open: () => void
  on: (event: "payment.failed", handler: (r: RazorpayFailure) => void) => void
}

type RazorpayConstructor = new (options: RazorpayOptions) => RazorpayInstance

declare global {
  interface Window {
    Razorpay?: RazorpayConstructor
  }
}

let loading: Promise<RazorpayConstructor> | null = null

/**
 * Resolves with the Checkout constructor, injecting the script once. A failed
 * load is forgotten so the next attempt tries again instead of replaying the
 * same rejection.
 */
export function loadRazorpay(): Promise<RazorpayConstructor> {
  if (window.Razorpay) return Promise.resolve(window.Razorpay)
  if (loading) return loading

  loading = new Promise<RazorpayConstructor>((resolve, reject) => {
    const script = document.createElement("script")
    script.src = CHECKOUT_SRC
    script.async = true
    script.onload = () => {
      if (window.Razorpay) resolve(window.Razorpay)
      else reject(new Error("Razorpay Checkout didn't start."))
    }
    script.onerror = () => {
      script.remove()
      reject(
        new Error(
          "Couldn't load Razorpay Checkout. Check your connection, or turn off any blocker for checkout.razorpay.com."
        )
      )
    }
    document.head.appendChild(script)
  }).catch((error: unknown) => {
    loading = null
    throw error
  })

  return loading
}
