import type { QueryClient } from "@tanstack/react-query"

/**
 * Marks the wallet, the credit history and the notifications stale after
 * anything that moves credits: sending a draft, scheduling from a job, a
 * refund, a reschedule, a purchase.
 *
 * Its own module, like `derived-reads.ts`, so the HR hooks can call it without
 * importing the billing hooks, which import theirs.
 */
export function refreshCreditReads(client: QueryClient) {
  void client.invalidateQueries({ queryKey: ["billing"] })
  void client.invalidateQueries({ queryKey: ["notifications"] })
}
