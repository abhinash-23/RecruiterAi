/** React Query bindings for the company-level endpoints. */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import {
  deleteBrandingLogo,
  getBranding,
  getCompanyAuditLogs,
  getCompanyDashboard,
  getCompanyProfile,
  getInterviewDefaults,
  getPublicBranding,
  updateBranding,
  updateCompanyProfile,
  updateInterviewDefaults,
  uploadBrandingLogo,
  type Branding,
} from "./company"

export const companyKeys = {
  dashboard: ["company", "dashboard"] as const,
  auditLogs: (limit: number) => ["company", "audit-logs", limit] as const,
  profile: ["company", "profile"] as const,
  branding: ["company", "branding"] as const,
  interviewDefaults: ["company", "interview-defaults"] as const,
}

export function useCompanyDashboard() {
  return useQuery({
    queryKey: companyKeys.dashboard,
    queryFn: getCompanyDashboard,
  })
}

/**
 * This company's audit trail.
 *
 * `enabled` matters: a super admin gets 403 here (they read
 * `/platform/audit-logs` instead), so callers that pick an endpoint by role
 * must switch the query off rather than just varying its arguments — React
 * Query fires the request regardless of what the parameters say.
 */
export function useCompanyAuditLogs(limit = 50, enabled = true) {
  return useQuery({
    queryKey: companyKeys.auditLogs(limit),
    queryFn: () => getCompanyAuditLogs(limit),
    enabled,
  })
}

export function useCompanyProfile() {
  return useQuery({ queryKey: companyKeys.profile, queryFn: getCompanyProfile })
}

/**
 * This company's branding — the one `/api/company/*` read the API spec opens to
 * **HR as well as Admin** (§5 and §7: "readable by any of the client's staff,
 * admin and HR alike… writes stay admin-only"), precisely so every dashboard
 * renders the client's look from one call.
 *
 * `enabled` is still needed for the super admin, who has no company to ask
 * about.
 *
 * `retry: false` matters here: where a deployment gates this read like the
 * writes, HR gets a 403, and a retry would spend two requests per page load
 * discovering that twice. The long `staleTime` is because a logo changes about
 * as often as a company renames itself.
 */
export function useBranding(enabled = true) {
  return useQuery({
    queryKey: companyKeys.branding,
    queryFn: getBranding,
    enabled,
    retry: false,
    staleTime: 10 * 60_000,
  })
}

/**
 * The company's scheduling defaults.
 *
 * `enabled` again: this is an Admin endpoint, and HR — who schedule far more
 * interviews than any Admin does — are refused. They send the fields blank
 * instead, and the server applies the same defaults on their behalf.
 */
/**
 * The **public** branding — no token, no session.
 *
 * This is what a candidate page uses: pass the interview id from the invitation
 * link and the server resolves whose interview it is. Nothing here touches
 * `/api/company/*`, so it works for someone who has no account at all.
 *
 * `retry: false` because a wrong id isn't an error to retry — the server
 * answers platform defaults — and a long `staleTime` because branding is
 * effectively static for the length of a sitting.
 */
export function usePublicBranding(
  scope: { company?: string; interview?: string },
  enabled = true
) {
  return useQuery({
    queryKey: ["branding", "public", scope.company ?? "", scope.interview ?? ""],
    queryFn: () => getPublicBranding(scope),
    enabled,
    retry: false,
    staleTime: 10 * 60_000,
  })
}

export function useInterviewDefaults(enabled = true) {
  return useQuery({
    queryKey: companyKeys.interviewDefaults,
    queryFn: getInterviewDefaults,
    enabled,
  })
}

export function useCompanyMutations() {
  const client = useQueryClient()
  const reportError = (error: Error) => toast.error(error.message)

  return {
    updateProfile: useMutation({
      mutationFn: updateCompanyProfile,
      onSuccess: () => {
        toast.success("Company profile updated.")
        void client.invalidateQueries({ queryKey: companyKeys.profile })
        void client.invalidateQueries({ queryKey: companyKeys.dashboard })
      },
      onError: reportError,
    }),

    updateBranding: useMutation({
      mutationFn: updateBranding,
      onSuccess: () => {
        toast.success("Branding updated.")
        void client.invalidateQueries({ queryKey: companyKeys.branding })
      },
      onError: reportError,
    }),

    // The logo is its own endpoint pair rather than a field on the branding
    // PATCH, so it invalidates the same query from two more places. The
    // refreshed `logoUrl` carries a new `?v=` stamp, which is what actually
    // gets the browser to drop the old file.
    uploadLogo: useMutation({
      mutationFn: uploadBrandingLogo,
      onSuccess: (logoUrl) => {
        toast.success("Logo updated.")
        // Written straight into the cache as well as invalidated: the upload
        // already returned the new URL, and waiting for the refetch leaves the
        // old logo on screen for as long as the round trip takes.
        client.setQueryData<Branding>(companyKeys.branding, (current) =>
          current ? { ...current, logoUrl } : current
        )
        void client.invalidateQueries({ queryKey: companyKeys.branding })
      },
      onError: reportError,
    }),

    removeLogo: useMutation({
      mutationFn: deleteBrandingLogo,
      onSuccess: () => {
        toast.success("Logo removed.")
        client.setQueryData<Branding>(companyKeys.branding, (current) =>
          current ? { ...current, logoUrl: null } : current
        )
        void client.invalidateQueries({ queryKey: companyKeys.branding })
      },
      onError: reportError,
    }),

    updateInterviewDefaults: useMutation({
      mutationFn: updateInterviewDefaults,
      onSuccess: () => {
        toast.success("Interview defaults updated.")
        void client.invalidateQueries({
          queryKey: companyKeys.interviewDefaults,
        })
      },
      onError: reportError,
    }),
  }
}
