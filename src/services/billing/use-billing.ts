/** React Query bindings for credits, payments and the hold notifications. */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import { refreshCreditReads } from "@/services/credit-reads"
import { hrKeys } from "@/services/hr"

import {
  createCreditOrder,
  getAdminBilling,
  getPlatformBilling,
  getWallet,
  listNotifications,
  listPayments,
  listTransactions,
  markNotificationRead,
  refundInterview,
  rescheduleInterview,
  verifyCreditPayment,
  type NotificationFeed,
} from "./billing"

export const billingKeys = {
  wallet: ["billing", "wallet"] as const,
  transactions: ["billing", "transactions"] as const,
  payments: ["billing", "payments"] as const,
  notifications: ["notifications"] as const,
  platform: ["billing", "platform"] as const,
  admin: (adminId: string) => ["billing", "platform", adminId] as const,
}

/**
 * How often the bell re-reads. Nothing in this browser causes a hold — a link
 * expires, a candidate declines — so this is one of the few reads that has to
 * ask on a timer.
 */
const NOTIFICATIONS_POLL_MS = 60_000

/**
 * The balance and current prices. Admin and HR only: the super admin gets 403
 * and sees every admin's balance on their own page instead.
 *
 * A deployment without billing answers 404, and the UI treats any error as
 * "no wallet to show" rather than a failure — the chip and the cost lines
 * simply stay hidden until the backend has the feature.
 */
export function useWallet(enabled = true) {
  return useQuery({
    queryKey: billingKeys.wallet,
    queryFn: getWallet,
    enabled,
  })
}

export function useCreditTransactions(enabled = true) {
  return useQuery({
    queryKey: billingKeys.transactions,
    queryFn: () => listTransactions({ limit: 200 }),
    enabled,
  })
}

export function usePayments(enabled = true) {
  return useQuery({
    queryKey: billingKeys.payments,
    queryFn: () => listPayments({ limit: 200 }),
    enabled,
  })
}

export function useNotifications(enabled = true) {
  return useQuery({
    queryKey: billingKeys.notifications,
    queryFn: () => listNotifications(50),
    enabled,
    refetchInterval: NOTIFICATIONS_POLL_MS,
  })
}

export function usePlatformBilling() {
  return useQuery({
    queryKey: billingKeys.platform,
    queryFn: getPlatformBilling,
  })
}

export function useAdminBilling(adminId: string | null) {
  return useQuery({
    queryKey: billingKeys.admin(adminId ?? ""),
    queryFn: () => getAdminBilling(adminId!),
    enabled: Boolean(adminId),
  })
}

/* -------------------------------------------------------------- mutations - */

/** After any credit move: the wallet, history, bell and interview rows. */
function useRefreshAfterCredits() {
  const client = useQueryClient()
  return () => {
    refreshCreditReads(client)
    void client.invalidateQueries({ queryKey: hrKeys.interviews })
  }
}

/**
 * The two halves of a purchase. No toasts: the buy dialog shows every state
 * itself, including the ones that aren't failures (Checkout closed, a verify
 * that timed out after the money was taken).
 */
export function useCreditPurchase() {
  const refresh = useRefreshAfterCredits()

  return {
    order: useMutation({ mutationFn: createCreditOrder }),
    verify: useMutation({
      mutationFn: verifyCreditPayment,
      onSettled: refresh,
    }),
  }
}

export function useRefundInterview() {
  const refresh = useRefreshAfterCredits()

  return useMutation({
    mutationFn: refundInterview,
    onSuccess: (result) => {
      toast.success(
        `${result.creditsRefunded} credits refunded. Balance: ${result.balance}.`
      )
      refresh()
    },
    onError: (error: Error) => {
      toast.error(error.message)
      // A 409 means someone else already chose; the refetch shows what.
      refresh()
    },
  })
}

/** No success toast: the dialog shows the new link, or the code to send. */
export function useRescheduleInterview() {
  const refresh = useRefreshAfterCredits()

  return useMutation({
    mutationFn: rescheduleInterview,
    onSuccess: refresh,
    onError: (error: Error) => {
      toast.error(error.message)
      refresh()
    },
  })
}

/**
 * Marks one notification read, updating the bell's count at once rather than
 * after the next poll.
 */
export function useMarkNotificationRead() {
  const client = useQueryClient()

  return useMutation({
    mutationFn: markNotificationRead,
    onMutate: (id) => {
      client.setQueryData<NotificationFeed>(
        billingKeys.notifications,
        (feed) => {
          if (!feed) return feed
          const target = feed.notifications.find((n) => n.id === id)
          if (!target || target.readAt) return feed
          return {
            unread: Math.max(0, feed.unread - 1),
            notifications: feed.notifications.map((n) =>
              n.id === id ? { ...n, readAt: new Date().toISOString() } : n
            ),
          }
        }
      )
    },
  })
}
