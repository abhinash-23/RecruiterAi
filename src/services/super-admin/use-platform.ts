/** React Query bindings for the platform-wide read endpoints. */

import { useQuery } from "@tanstack/react-query"

import { getPlatformAnalytics, getPlatformAuditLogs } from "./platform"

export const platformKeys = {
  analytics: ["platform", "analytics"] as const,
  auditLogs: (limit: number) => ["platform", "audit-logs", limit] as const,
}

export function usePlatformAnalytics() {
  return useQuery({
    queryKey: platformKeys.analytics,
    queryFn: getPlatformAnalytics,
  })
}

/**
 * The platform-wide audit trail — super admin only.
 *
 * `enabled` matters: any other role gets 403, so a caller that picks an
 * endpoint by role has to switch this off rather than just passing different
 * arguments. React Query issues the request either way.
 */
export function usePlatformAuditLogs(limit = 50, enabled = true) {
  return useQuery({
    queryKey: platformKeys.auditLogs(limit),
    queryFn: () => getPlatformAuditLogs(limit),
    enabled,
  })
}
