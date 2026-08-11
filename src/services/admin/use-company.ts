/** React Query bindings for the company-level endpoints. */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import { refreshDerivedReads } from "@/services/derived-reads"
import { STATIC_READ } from "@/services/query-defaults"

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
 * discovering that twice. {@link STATIC_READ} for why this one read is exempt
 * even from the refetch every other page visit gets — a logo changes about as
 * often as a company renames itself, and for HR each attempt is another refusal.
 */
export function useBranding(enabled = true) {
  return useQuery({
    queryKey: companyKeys.branding,
    queryFn: getBranding,
    enabled,
    retry: false,
    ...STATIC_READ,
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
 * answers platform defaults — and {@link STATIC_READ} because branding is
 * effectively static for the length of a sitting. Staying quiet matters more here
 * than anywhere: this runs on the candidate's machine alongside the camera, the
 * microphone, and a video streaming out over its own socket.
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
    ...STATIC_READ,
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
        refreshDerivedReads(client)
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
    //
    // Both of these write the cache *and* invalidate, and the invalidate is not
    // belt-and-braces: the server resolves an empty slot to the other one, so
    // only a refetch knows what the *other* slot now points at. The local write
    // is just to keep the slot you touched from showing its old file for the
    // length of a round trip.
    uploadLogo: useMutation({
      mutationFn: uploadBrandingLogo,
      onSuccess: ({ theme, logoUrl }) => {
        toast.success(
          theme === "light" ? "Light-theme logo updated." : "Logo updated."
        )
        client.setQueryData<Branding>(companyKeys.branding, (current) =>
          current
            ? {
                ...current,
                ...(theme === "light"
                  ? { logoLightUrl: logoUrl }
                  : // The legacy field *is* the dark slot, so they move together.
                    { logoUrl, logoDarkUrl: logoUrl }),
              }
            : current
        )
        void client.invalidateQueries({ queryKey: companyKeys.branding })
      },
      onError: reportError,
    }),

    removeLogo: useMutation({
      mutationFn: deleteBrandingLogo,
      onSuccess: (_result, theme) => {
        toast.success(
          theme === "light"
            ? "Light-theme logo removed."
            : theme === "dark"
              ? "Dark-theme logo removed."
              : "Logos removed."
        )
        client.setQueryData<Branding>(companyKeys.branding, (current) => {
          if (!current) return current
          if (theme === "light") return { ...current, logoLightUrl: null }
          if (theme === "dark") {
            return { ...current, logoUrl: null, logoDarkUrl: null }
          }
          // No theme means both — the endpoint's contract, not a default.
          return {
            ...current,
            logoUrl: null,
            logoDarkUrl: null,
            logoLightUrl: null,
          }
        })
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
        refreshDerivedReads(client)
      },
      onError: reportError,
    }),
  }
}
