/**
 * ============================================================================
 * CREDITS AND PAYMENTS — `/api/billing/*`, `/api/notifications`,
 * `/api/platform/billing`
 * ============================================================================
 * Interviews cost credits. One wallet per admin, shared with their HRs; the
 * admin tops it up through **Stripe Checkout** — Stripe's own hosted page,
 * reached by a redirect. **The server does all pricing, charging and
 * checking**: the browser sends a credit count and never an amount, and holds
 * no Stripe key or script.
 *
 * Money is in a currency's **minor unit** on the wire — US cents for Stripe
 * (`3500` = $35.00), paise on the Razorpay payments made before it, which
 * still appear in the history.
 *
 * | Call                                          | Who                  |
 * |-----------------------------------------------|----------------------|
 * | `GET  /billing/wallet`                        | admin, HR            |
 * | `GET  /billing/transactions`                  | admin                |
 * | `GET  /billing/payments`                      | admin                |
 * | `POST /billing/orders`                        | admin                |
 * | `POST /billing/verify`                        | admin                |
 * | `POST /hr/interviews/:id/refund`              | creating HR, admin   |
 * | `POST /hr/interviews/:id/reschedule`          | creating HR, admin   |
 * | `GET  /notifications`, `POST …/:id/read`      | admin, HR            |
 * | `GET  /platform/billing`                      | super admin          |
 * | `GET  /platform/admins/:id/billing`           | super admin          |
 * | `POST /platform/admins/:id/credits`           | super admin          |
 */

import { currentAccessToken } from "@/services/auth-service"
import { ApiError, apiFetch, type RequestOptions } from "@/services/http-client"

/* ========================================================================== */
/*  Types                                                                     */
/* ========================================================================== */

export interface Wallet {
  balance: number
  /** Credits one interview costs. Can change: never assume 50. */
  interviewCost: number
  interviewsLeft: number
  /** ISO code, lower case — `usd`. */
  currency: string
  /**
   * Price of one credit and of one interview, in the currency's minor unit.
   * **Null on a backend that predates Stripe**, which has no price to show —
   * the Buy flow stays shut rather than inventing one.
   */
  creditPriceMinor: number | null
  interviewPriceMinor: number | null
  /** Stripe adds the buyer's regional tax on its page; say so beside a price. */
  taxAddedAtCheckout: boolean
}

export type TransactionType =
  "signup_bonus" | "purchase" | "interview_charge" | "refund" | "grant"

export const TRANSACTION_LABEL: Record<TransactionType, string> = {
  signup_bonus: "Free credits",
  purchase: "Purchased",
  interview_charge: "Interview sent",
  refund: "Refund",
  grant: "Added by Recruiter AI",
}

export interface BillingUser {
  userId: string
  fullName: string
}

export interface CreditTransaction {
  id: string
  type: TransactionType
  /** Positive for credits in, negative for credits out. */
  amount: number
  balanceAfter: number
  interviewId: string | null
  candidateName: string | null
  jobTitle: string | null
  paymentId: string | null
  note: string | null
  /** Who caused it. `null` for system rows, and always for the super admin. */
  user: BillingUser | null
  createdAt: string
}

/** `created` is a checkout opened and never completed. */
export type PaymentStatus = "created" | "paid" | "failed" | "expired"

export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  created: "Not completed",
  paid: "Paid",
  failed: "Failed",
  expired: "Expired",
}

export interface Payment {
  id: string
  /** `stripe`, or `razorpay` on payments from before Stripe. */
  provider: string
  credits: number
  /** ISO code, lower case — `usd`, or `inr` on old Razorpay rows. */
  currency: string
  /** Minor units. Tax and total are known only once paid. */
  subtotalMinor: number
  taxMinor: number | null
  totalMinor: number | null
  status: PaymentStatus
  /** Where the tax came from — "CA" / "ON". Null for untaxed payments. */
  billingCountry: string | null
  billingRegion: string | null
  /**
   * For support: Stripe's payment id (`pi_…`). **On a Stripe row still
   * `created` it is the checkout id (`cs_…`)** — which is what verify takes,
   * so a payment whose tab was closed can still be confirmed from the list.
   */
  reference: string | null
  failureReason: string | null
  paidBy: BillingUser | null
  createdAt: string
  paidAt: string | null
}

export interface Paged<T> {
  /** Total matching rows on the server, which may exceed `rows.length`. */
  count: number
  rows: T[]
}

/** A Stripe Checkout page opened for one purchase. */
export interface CheckoutSession {
  paymentId: string
  /** `cs_…` — what verify takes once Stripe sends the admin back. */
  sessionId: string
  /** Stripe's hosted page. The browser leaves the app for it. */
  checkoutUrl: string
  credits: number
  currency: string
  subtotalMinor: number
  taxAddedAtCheckout: boolean
}

export interface VerifiedPayment {
  creditsAdded: number
  balance: number
}

export interface GrantResult {
  creditsAdded: number
  balance: number
}

export interface RefundResult {
  creditsRefunded: number
  balance: number
}

export interface RescheduleResult {
  /** `null` when the interview didn't come from a job. */
  candidateId: string | null
  interviewId: string
  interviewLink: string
  otpCode: string
  emailSent: boolean
  linkExpiresAt: string | null
  rescheduledFrom: string
}

/** How an interview ended without being attempted, so its credits are held. */
export type HoldReason = "expired" | "replaced" | "declined" | "closed"

export const HOLD_REASON_LABEL: Record<HoldReason, string> = {
  expired: "Expired",
  replaced: "Replaced",
  declined: "Declined",
  closed: "Closed",
}

export interface BillingNotification {
  id: string
  type: string
  reason: HoldReason | null
  interviewId: string | null
  candidateName: string | null
  jobTitle: string | null
  message: string
  /** True once the HR or the admin has chosen Refund or Reschedule. */
  resolved: boolean
  readAt: string | null
  createdAt: string
}

export interface NotificationFeed {
  unread: number
  notifications: BillingNotification[]
}

/** One admin's credits, as the super admin sees them. */
export interface AdminCredits {
  adminId: string
  adminName: string
  balance: number
  /** Paid purchases only. */
  creditsBought: number
  /** Added by hand by the super admin, without a payment. */
  creditsGranted: number
  /** Net of refunds. */
  creditsUsed: number
  /**
   * Paid so far, tax included, **per currency** in minor units —
   * `{ usd: 70000 }`. An `inr` entry only for payments made before Stripe.
   */
  amountPaid: Record<string, number>
  lastPaymentAt: string | null
}

export interface AdminBillingDetail {
  admin: AdminCredits
  payments: Payment[]
  transactions: CreditTransaction[]
}

/* ========================================================================== */
/*  Wire format                                                               */
/* ========================================================================== */

interface RawWallet {
  balance: number
  interview_cost: number
  interviews_left: number
  currency?: string
  credit_price_cents?: number | null
  interview_price_cents?: number | null
  tax_added_at_checkout?: boolean
}

interface RawTransaction {
  id: string | number
  type: TransactionType
  amount: number
  balance_after: number
  interview_id?: string | null
  candidate_name?: string | null
  job_title?: string | null
  payment_id?: string | null
  note?: string | null
  user?: BillingUser | null
  created_at: string
}

/**
 * Both shapes: the Stripe-era fields, and the Razorpay-era ones a backend
 * from before the switch still sends — read as the same row either way.
 */
interface RawPayment {
  id: string | number
  provider?: string | null
  credits: number
  currency?: string | null
  subtotal_minor?: number | null
  tax_minor?: number | null
  total_minor?: number | null
  status: PaymentStatus
  billing_country?: string | null
  billing_region?: string | null
  reference?: string | null
  failure_reason?: string | null
  amount_paise?: number | null
  gst_paise?: number | null
  total_paise?: number | null
  razorpay_order_id?: string | null
  razorpay_payment_id?: string | null
  paid_by?: BillingUser | null
  created_at: string
  paid_at?: string | null
}

interface RawNotification {
  id: string | number
  type: string
  reason?: HoldReason | null
  interview_id?: string | null
  candidate_name?: string | null
  job_title?: string | null
  message: string
  resolved: boolean
  read_at?: string | null
  created_at: string
}

interface RawAdminCredits {
  admin_id: string
  admin_name: string
  balance: number
  credits_bought: number
  credits_granted?: number | null
  credits_used: number
  amount_paid?: Record<string, number> | null
  /** The pre-Stripe field: rupees only. */
  amount_paid_paise?: number | null
  last_payment_at?: string | null
}

function authed<T>(path: string, options: Omit<RequestOptions, "token"> = {}) {
  return apiFetch<T>(path, { ...options, token: currentAccessToken() })
}

function requireId(value: string | undefined, what: string): string {
  const id = value?.trim()
  if (!id) throw new Error(`Missing ${what}. Cannot build the request URL.`)
  return encodeURIComponent(id)
}

function toWallet(raw: RawWallet): Wallet {
  return {
    balance: raw.balance,
    interviewCost: raw.interview_cost,
    interviewsLeft: raw.interviews_left,
    currency: (raw.currency ?? "usd").toLowerCase(),
    creditPriceMinor: raw.credit_price_cents ?? null,
    interviewPriceMinor:
      raw.interview_price_cents ??
      (raw.credit_price_cents != null
        ? raw.credit_price_cents * raw.interview_cost
        : null),
    taxAddedAtCheckout: raw.tax_added_at_checkout === true,
  }
}

function toTransaction(raw: RawTransaction): CreditTransaction {
  return {
    id: String(raw.id),
    type: raw.type,
    amount: raw.amount,
    balanceAfter: raw.balance_after,
    interviewId: raw.interview_id ?? null,
    candidateName: raw.candidate_name ?? null,
    jobTitle: raw.job_title ?? null,
    paymentId: raw.payment_id ?? null,
    note: raw.note ?? null,
    user: raw.user ?? null,
    createdAt: raw.created_at,
  }
}

function toPayment(raw: RawPayment): Payment {
  // A row with no `provider` is the pre-Stripe shape, which was Razorpay's.
  const legacy = raw.provider == null && raw.subtotal_minor == null
  return {
    id: String(raw.id),
    provider: raw.provider ?? (legacy ? "razorpay" : "stripe"),
    credits: raw.credits,
    currency: (raw.currency ?? (legacy ? "inr" : "usd")).toLowerCase(),
    subtotalMinor: raw.subtotal_minor ?? raw.amount_paise ?? 0,
    taxMinor: raw.tax_minor ?? raw.gst_paise ?? null,
    totalMinor: raw.total_minor ?? raw.total_paise ?? null,
    status: raw.status,
    billingCountry: raw.billing_country ?? null,
    billingRegion: raw.billing_region ?? null,
    reference:
      raw.reference ?? raw.razorpay_payment_id ?? raw.razorpay_order_id ?? null,
    failureReason: raw.failure_reason ?? null,
    paidBy: raw.paid_by ?? null,
    createdAt: raw.created_at,
    paidAt: raw.paid_at ?? null,
  }
}

function toNotification(raw: RawNotification): BillingNotification {
  return {
    id: String(raw.id),
    type: raw.type,
    reason: raw.reason ?? null,
    interviewId: raw.interview_id ?? null,
    candidateName: raw.candidate_name ?? null,
    jobTitle: raw.job_title ?? null,
    message: raw.message,
    resolved: raw.resolved,
    readAt: raw.read_at ?? null,
    createdAt: raw.created_at,
  }
}

function toAdminCredits(raw: RawAdminCredits): AdminCredits {
  return {
    adminId: raw.admin_id,
    adminName: raw.admin_name,
    balance: raw.balance,
    creditsBought: raw.credits_bought,
    creditsGranted: raw.credits_granted ?? 0,
    creditsUsed: raw.credits_used,
    amountPaid:
      raw.amount_paid ??
      (raw.amount_paid_paise ? { inr: raw.amount_paid_paise } : {}),
    lastPaymentAt: raw.last_payment_at ?? null,
  }
}

/* ========================================================================== */
/*  Errors                                                                    */
/* ========================================================================== */

export interface CreditShortfall {
  balance: number | null
  required: number | null
}

/**
 * The shortfall behind a `402 insufficient_credits`, or null for any other
 * error.
 *
 * Branches on the **code**, not the status: verify also answers 402 (payment not
 * captured), and that one carries no code. Reads the numbers from the top level
 * or from inside `detail`, since FastAPI nests an object `detail` either way.
 */
export function creditShortfall(error: unknown): CreditShortfall | null {
  if (!(error instanceof ApiError) || error.status !== 402) return null

  const body = (error.body ?? {}) as Record<string, unknown>
  const nested =
    body.detail && typeof body.detail === "object"
      ? (body.detail as Record<string, unknown>)
      : {}
  const code = error.code ?? nested.code
  if (code !== "insufficient_credits") return null

  const number = (value: unknown) => (typeof value === "number" ? value : null)
  return {
    balance: number(body.balance) ?? number(nested.balance),
    required: number(body.required) ?? number(nested.required),
  }
}

/* ========================================================================== */
/*  Calls                                                                     */
/* ========================================================================== */

export async function getWallet(): Promise<Wallet> {
  return toWallet(await authed<RawWallet>("/billing/wallet"))
}

export interface TransactionFilters {
  type?: TransactionType
  userId?: string
  /** `YYYY-MM-DD`. */
  dateFrom?: string
  /** `YYYY-MM-DD`, inclusive of the whole day. */
  dateTo?: string
  limit?: number
  offset?: number
}

export async function listTransactions(
  filters: TransactionFilters = {}
): Promise<Paged<CreditTransaction>> {
  const query = new URLSearchParams()
  if (filters.type) query.set("type", filters.type)
  if (filters.userId) query.set("user_id", filters.userId)
  if (filters.dateFrom) query.set("date_from", filters.dateFrom)
  if (filters.dateTo) query.set("date_to", filters.dateTo)
  query.set("limit", String(filters.limit ?? 200))
  query.set("offset", String(filters.offset ?? 0))

  const response = await authed<{
    count: number
    transactions: RawTransaction[]
  }>(`/billing/transactions?${query}`)
  return {
    count: response.count,
    rows: response.transactions.map(toTransaction),
  }
}

export async function listPayments(
  page: { limit?: number; offset?: number } = {}
): Promise<Paged<Payment>> {
  const query = new URLSearchParams({
    limit: String(page.limit ?? 200),
    offset: String(page.offset ?? 0),
  })
  const response = await authed<{ count: number; payments: RawPayment[] }>(
    `/billing/payments?${query}`
  )
  return { count: response.count, rows: response.payments.map(toPayment) }
}

/**
 * Opens a Stripe Checkout page for `credits`. The server prices it and Stripe
 * adds the buyer's tax on its own page; only the credit count goes up.
 *
 * `successUrl` and `cancelUrl` must be pages of this app (a 422 otherwise).
 * `{CHECKOUT_SESSION_ID}` in the success URL is literal: Stripe replaces it
 * with the real id when it sends the admin back.
 *
 * **Each call opens a new checkout**, so the caller disables its button after
 * the first press.
 */
export async function createCheckout(input: {
  credits: number
  successUrl: string
  cancelUrl: string
}): Promise<CheckoutSession> {
  const response = await authed<{
    payment_id: string | number
    session_id: string
    checkout_url: string
    credits: number
    currency: string
    subtotal_cents: number
    tax_added_at_checkout?: boolean
  }>("/billing/orders", {
    method: "POST",
    body: {
      credits: input.credits,
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
    },
  })

  return {
    paymentId: String(response.payment_id),
    sessionId: response.session_id,
    checkoutUrl: response.checkout_url,
    credits: response.credits,
    currency: (response.currency ?? "usd").toLowerCase(),
    subtotalMinor: response.subtotal_cents,
    taxAddedAtCheckout: response.tax_added_at_checkout === true,
  }
}

/**
 * Asks the server to confirm a checkout with Stripe and add its credits.
 *
 * **Safe to repeat**: a refresh of the success page, or a second press, adds
 * the credits once and answers the same. A `402` is "not paid yet" — the bank
 * may still be confirming — and is worth a "Check again".
 */
export async function verifyCheckout(
  sessionId: string
): Promise<VerifiedPayment> {
  const response = await authed<{ credits_added: number; balance: number }>(
    "/billing/verify",
    { method: "POST", body: { session_id: sessionId } }
  )
  return { creditsAdded: response.credits_added, balance: response.balance }
}

/**
 * The super admin adds credits to an admin's wallet by hand — no payment.
 * The admin sees it in their credit log as "Added by Recruiter AI" with the
 * note, never with the super admin's name.
 */
export async function grantCredits(input: {
  adminId: string
  credits: number
  note?: string
}): Promise<GrantResult> {
  const note = input.note?.trim()
  const response = await authed<{ credits_added: number; balance: number }>(
    `/platform/admins/${requireId(input.adminId, "admin id")}/credits`,
    {
      method: "POST",
      body: { credits: input.credits, ...(note ? { note } : {}) },
    }
  )
  return { creditsAdded: response.credits_added, balance: response.balance }
}

export async function refundInterview(
  interviewId: string
): Promise<RefundResult> {
  const response = await authed<{ credits_refunded: number; balance: number }>(
    `/hr/interviews/${requireId(interviewId, "interview id")}/refund`,
    { method: "POST" }
  )
  return {
    creditsRefunded: response.credits_refunded,
    balance: response.balance,
  }
}

/**
 * A **new** interview for the same candidate, settings and owner, paid for by
 * the old one's held credits. Leaving `linkExpiryHours` out keeps the old
 * interview's window.
 */
export async function rescheduleInterview({
  interviewId,
  linkExpiryHours,
}: {
  interviewId: string
  linkExpiryHours?: number
}): Promise<RescheduleResult> {
  const response = await authed<RescheduleResult>(
    `/hr/interviews/${requireId(interviewId, "interview id")}/reschedule`,
    {
      method: "POST",
      body:
        linkExpiryHours !== undefined
          ? { link_expiry_hours: linkExpiryHours }
          : {},
    }
  )
  return {
    candidateId: response.candidateId ?? null,
    interviewId: response.interviewId,
    interviewLink: response.interviewLink,
    otpCode: response.otpCode,
    emailSent: response.emailSent,
    linkExpiresAt: response.linkExpiresAt ?? null,
    rescheduledFrom: response.rescheduledFrom,
  }
}

export async function listNotifications(limit = 50): Promise<NotificationFeed> {
  const response = await authed<{
    unread: number
    notifications: RawNotification[]
  }>(`/notifications?limit=${limit}`)
  return {
    unread: response.unread,
    notifications: response.notifications.map(toNotification),
  }
}

export async function markNotificationRead(id: string): Promise<void> {
  await authed(`/notifications/${requireId(id, "notification id")}/read`, {
    method: "POST",
  })
}

export async function getPlatformBilling(): Promise<AdminCredits[]> {
  const response = await authed<{ admins: RawAdminCredits[] }>(
    "/platform/billing"
  )
  return response.admins.map(toAdminCredits)
}

export async function getAdminBilling(
  adminId: string,
  limit = 200
): Promise<AdminBillingDetail> {
  const response = await authed<{
    admin: RawAdminCredits
    payments: RawPayment[]
    transactions: RawTransaction[]
  }>(
    `/platform/admins/${requireId(adminId, "admin id")}/billing?limit=${limit}`
  )
  return {
    admin: toAdminCredits(response.admin),
    payments: response.payments.map(toPayment),
    transactions: response.transactions.map(toTransaction),
  }
}

/* ========================================================================== */
/*  Formatting                                                                */
/* ========================================================================== */

const MONEY = new Map<string, Intl.NumberFormat>()

/**
 * Minor units in a currency → `$35.00`, or `₹590.00` for an old Razorpay row.
 * Rupees keep Indian grouping (`₹1,18,000.00`), dollars the US one.
 */
export function formatMoney(minor: number, currency: string): string {
  const code = currency.toUpperCase()
  let format = MONEY.get(code)
  if (!format) {
    format = new Intl.NumberFormat(code === "INR" ? "en-IN" : "en-US", {
      style: "currency",
      currency: code,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
    MONEY.set(code, format)
  }
  return format.format(minor / 100)
}

/**
 * A per-currency total — `{ usd: 70000, inr: 5900 }` → `$700.00 · ₹59.00`,
 * dollars first. A dash for nothing paid.
 */
export function formatAmounts(amounts: Record<string, number>): string {
  const entries = Object.entries(amounts)
    .filter(([, minor]) => minor > 0)
    .sort(([a], [b]) =>
      a === "usd" ? -1 : b === "usd" ? 1 : a.localeCompare(b)
    )
  if (entries.length === 0) return formatMoney(0, "usd")
  return entries.map(([code, minor]) => formatMoney(minor, code)).join(" · ")
}

/** Adds per-currency totals together, for a column summary. */
export function sumAmounts(
  list: Array<Record<string, number>>
): Record<string, number> {
  const total: Record<string, number> = {}
  for (const amounts of list) {
    for (const [code, minor] of Object.entries(amounts)) {
      total[code] = (total[code] ?? 0) + minor
    }
  }
  return total
}

const COUNT = new Intl.NumberFormat("en-IN")

/** `12500` → `12,500`, Indian grouping. */
export function formatCredits(credits: number): string {
  return COUNT.format(credits)
}
