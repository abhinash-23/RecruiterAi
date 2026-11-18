/** React Query bindings for the platform-wide read endpoints. */

import { useMutation, useQuery } from "@tanstack/react-query"
import { toast } from "sonner"

import {
  ApiError,
  isMissingEndpoint,
  type DownloadedFile,
} from "@/services/http-client"
import { saveFile } from "@/lib/save-file"

import {
  exportPlatformAuditLogs,
  getAuditLogActions,
  getPlatformAnalytics,
  getPlatformAuditLogs,
  type AuditLogFilters,
  type AuditLogPageRequest,
} from "./platform"

export const platformKeys = {
  analytics: ["platform", "analytics"] as const,
  auditLogs: (request: AuditLogPageRequest) =>
    ["platform", "audit-logs", request] as const,
  auditActions: ["platform", "audit-logs", "actions"] as const,
}

export function usePlatformAnalytics() {
  return useQuery({
    queryKey: platformKeys.analytics,
    queryFn: getPlatformAnalytics,
  })
}

/**
 * One page of the platform-wide audit trail — super admin only.
 *
 * `enabled` matters: any other role gets 403, so a caller that picks an
 * endpoint by role has to switch this off rather than just passing different
 * arguments. React Query issues the request either way.
 */
export function usePlatformAuditLogs(
  request: AuditLogPageRequest,
  enabled = true
) {
  return useQuery({
    queryKey: platformKeys.auditLogs(request),
    queryFn: () => getPlatformAuditLogs(request),
    enabled,
    // Keep the old rows on screen while the next page or a new search loads,
    // so the table doesn't flash empty on every click.
    placeholderData: (previous) => previous,
  })
}

/** The Actions filter's choices. `null` data: the backend doesn't have them yet. */
export function useAuditLogActions(enabled = true) {
  return useQuery({
    queryKey: platformKeys.auditActions,
    queryFn: getAuditLogActions,
    enabled,
    staleTime: 5 * 60_000,
  })
}

/**
 * The sentence for a failed export. A 422 with a string `detail` is the
 * server's own ("More than 50,000 entries match…"); a validation list is a
 * malformed date, which the reader fixes by checking the dates.
 */
function exportErrorMessage(error: Error): string {
  if (isMissingEndpoint(error)) {
    return "Exporting the audit log isn't available on this server yet."
  }
  if (error instanceof ApiError && error.status === 422) {
    const detail = (error.body as { detail?: unknown } | null)?.detail
    return typeof detail === "string" && detail.trim()
      ? detail
      : "Check the dates and try again."
  }
  return error.message || "Couldn't export the audit log."
}

/**
 * Downloads the audit trail as CSV, saved under the server's file name.
 *
 * `download` picks the endpoint: the platform's by default, or the company's
 * (`exportCompanyAuditLogs`) on an admin's own page. Both take the same
 * filters and answer with the same file and the same errors.
 */
export function useExportAuditLogs(
  download: (filters: AuditLogFilters) => Promise<DownloadedFile> = exportPlatformAuditLogs
) {
  return useMutation({
    mutationFn: async (filters: AuditLogFilters) => {
      const file = await download(filters)
      saveFile(file.blob, file.filename)
      return file
    },
    onError: (error: Error) => toast.error(exportErrorMessage(error)),
  })
}
