/**
 * ============================================================================
 * CREDITS AND PAYMENTS — `/api/billing/*`, `/api/notifications`,
 * `/api/platform/billing`
 * ============================================================================
 * Interviews cost credits. One wallet per admin, shared with their HRs; the
 * admin tops it up through Razorpay Checkout. **The server does all pricing,
 * charging and checking** — nothing here computes an amount that is sent, and
 * the browser never holds a Razorpay secret.
 *
 * Money is always **paise** on the wire (₹590.00 = `59000`).
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
  gstPercent: number
  interviewsLeft: number
}

export type TransactionType =
  "signup_bonus" | "purchase" | "interview_charge" | "refund"

export const TRANSACTION_LABEL: Record<TransactionType, string> = {
  signup_bonus: "Free credits",
  purchase: "Purchased",
  interview_charge: "Interview sent",
  refund: "Refund",
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

export type PaymentStatus = "created" | "paid" | "failed"

export interface Payment {
  id: string
  credits: number
  amountPaise: number
  gstPaise: number
  totalPaise: number
  status: PaymentStatus
  razorpayOrderId: string | null
  razorpayPaymentId: string | null
  paidBy: BillingUser | null
  createdAt: string
  paidAt: string | null
}

export interface Paged<T> {
  /** Total matching rows on the server, which may exceed `rows.length`. */
  count: number
  rows: T[]
}

export interface CreditOrder {
  orderId: string
  /** Razorpay's public key id. Always from here, never hard-coded. */
  keyId: string
  credits: number
  amountPaise: number
  gstPaise: number
  totalPaise: number
  currency: string
}

export interface VerifiedPayment {
  creditsAdded: number
  balance: number
}

/** What Checkout's success handler receives, sent on as-is. */
export interface RazorpaySuccess {
  razorpay_order_id: string
  razorpay_payment_id: string
  razorpay_signature: string
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
  creditsBought: number
  /** Net of refunds. */
  creditsUsed: number
  /** GST included. */
  amountPaidPaise: number
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
  gst_percent: number
  interviews_left: number
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

interface RawPayment {
  id: string | number
  credits: number
  amount_paise: number
  gst_paise: number
  total_paise: number
  status: PaymentStatus
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
  credits_used: number
  amount_paid_paise: number
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
    gstPercent: raw.gst_percent,
    interviewsLeft: raw.interviews_left,
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
  return {
    id: String(raw.id),
    credits: raw.credits,
    amountPaise: raw.amount_paise,
    gstPaise: raw.gst_paise,
    totalPaise: raw.total_paise,
    status: raw.status,
    razorpayOrderId: raw.razorpay_order_id ?? null,
    razorpayPaymentId: raw.razorpay_payment_id ?? null,
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
    creditsUsed: raw.credits_used,
    amountPaidPaise: raw.amount_paid_paise,
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
 * Opens a Razorpay order for `credits`. The server prices it, adds GST, and
 * answers with what Checkout needs; only the credit count goes up.
 */
export async function createCreditOrder(credits: number): Promise<CreditOrder> {
  const response = await authed<{
    order_id: string
    key_id: string
    credits: number
    amount_paise: number
    gst_paise: number
    total_paise: number
    currency: string
  }>("/billing/orders", { method: "POST", body: { credits } })

  return {
    orderId: response.order_id,
    keyId: response.key_id,
    credits: response.credits,
    amountPaise: response.amount_paise,
    gstPaise: response.gst_paise,
    totalPaise: response.total_paise,
    currency: response.currency,
  }
}

/**
 * Hands Checkout's three values to the server, which checks the signature,
 * re-reads the payment from Razorpay and adds the credits. Safe to repeat: a
 * payment is credited once.
 */
export async function verifyCreditPayment(
  payment: RazorpaySuccess
): Promise<VerifiedPayment> {
  const response = await authed<{ credits_added: number; balance: number }>(
    "/billing/verify",
    { method: "POST", body: payment }
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

const RUPEES = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/** `59000` → `₹590.00`. */
export function formatPaise(paise: number): string {
  return RUPEES.format(paise / 100)
}

const COUNT = new Intl.NumberFormat("en-IN")

/** `12500` → `12,500`, Indian grouping. */
export function formatCredits(credits: number): string {
  return COUNT.format(credits)
}
