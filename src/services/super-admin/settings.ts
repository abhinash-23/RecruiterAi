/**
 * ============================================================================
 * PLATFORM SETTINGS AND DEFAULT BRANDING — `/api/settings`, `/api/branding`
 * ============================================================================
 * Platform-wide defaults, not per-client. A client that hasn't configured its
 * own white-label inherits what's here.
 *
 * Not to be confused with `/api/company/branding` in `@/services/admin`, which
 * is one client's own.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import { currentAccessToken } from "@/services/auth-service"
import { apiFetch } from "@/services/http-client"

export interface PlatformBranding {
  appName: string
  logoUrl: string | null
  primaryColor: string
  accentColor: string
}

function authedToken() {
  return currentAccessToken()
}

/** The whole settings store, shape decided by whatever has written to it. */
export async function getPlatformSettings(): Promise<Record<string, unknown>> {
  const response = await apiFetch<Record<string, unknown>>("/settings", {
    token: authedToken(),
  })
  // The envelope carries `status` alongside the real keys — drop it so the UI
  // doesn't render it as a setting.
  return Object.fromEntries(
    Object.entries(response).filter(([key]) => key !== "status")
  )
}

export async function putPlatformSetting(
  key: string,
  value: unknown
): Promise<void> {
  await apiFetch(`/settings/${encodeURIComponent(key)}`, {
    method: "PUT",
    token: authedToken(),
    body: { value },
  })
}

/** The platform's default branding, as served to unknown/absent client slugs. */
export async function getPlatformBranding(): Promise<PlatformBranding> {
  const response = await apiFetch<{
    status: string
    branding: PlatformBranding
  }>("/branding")
  return response.branding
}

export async function updatePlatformBranding(input: {
  appName?: string
  primaryColor?: string
  accentColor?: string
}): Promise<PlatformBranding> {
  const body: Record<string, string> = {}
  if (input.appName !== undefined) body.app_name = input.appName.trim()
  if (input.primaryColor !== undefined) body.primary_color = input.primaryColor
  if (input.accentColor !== undefined) body.accent_color = input.accentColor

  const response = await apiFetch<{
    status: string
    branding: PlatformBranding
  }>("/settings/branding", { method: "PATCH", token: authedToken(), body })
  return response.branding
}

/* -------------------------------------------------------------- bindings - */

export const settingsKeys = {
  settings: ["platform", "settings"] as const,
  branding: ["platform", "branding"] as const,
}

export function usePlatformSettings() {
  return useQuery({
    queryKey: settingsKeys.settings,
    queryFn: getPlatformSettings,
  })
}

export function usePlatformBranding() {
  return useQuery({
    queryKey: settingsKeys.branding,
    queryFn: getPlatformBranding,
  })
}

export function useSettingsMutations() {
  const client = useQueryClient()

  return {
    updateBranding: useMutation({
      mutationFn: updatePlatformBranding,
      onSuccess: () => {
        toast.success("Default branding updated.")
        void client.invalidateQueries({ queryKey: settingsKeys.branding })
      },
      onError: (error: Error) => toast.error(error.message),
    }),
  }
}
