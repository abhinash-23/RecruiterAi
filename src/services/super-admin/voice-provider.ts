/**
 * ============================================================================
 * VOICE PROVIDER — `/api/platform/voice-provider`, super admin only
 * ============================================================================
 * Which provider speaks every voice interview, for the whole platform. A switch
 * applies to interviews that **start** afterwards; one already running finishes
 * on the provider it started with.
 *
 * | Call                                 | Does                               |
 * | ------------------------------------ | ---------------------------------- |
 * | `GET /platform/voice-provider`       | the current one, and every option  |
 * | `PUT /platform/voice-provider`       | switch; answers with the same page |
 *
 * **Build the list from the response.** Providers are added on the server over
 * time, so no name is hard-coded here. Not the general `/settings` store:
 * `GET /settings` leaves it out and `PUT /settings/voice_provider` is a 422.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import { currentAccessToken } from "@/services/auth-service"
import { apiFetch } from "@/services/http-client"

export interface VoiceProviderOption {
  /** Sent back to switch. */
  id: string
  name: string
  /** False: not set up on the server, so it can't be chosen. */
  ready: boolean
  /** What the tech team still has to add, e.g. `GEMINI_API_KEYS`. */
  missing: string[]
  current: boolean
}

export interface VoiceProviderState {
  current: string
  currentName: string
  /**
   * False only when the current provider has lost its setup since. Voice
   * interviews then fall back to the typed interview until it's fixed.
   */
  currentReady: boolean
  /** `server_default`: nobody has chosen on this page yet. */
  chosenBy: "super_admin" | "server_default"
  /** UTC ISO. Null while it's the server default. */
  changedAt: string | null
  changedByEmail: string | null
  /** The server's master switch: off, nothing runs in voice. */
  voiceInterviewsEnabled: boolean
  /** In display order. */
  providers: VoiceProviderOption[]
}

type Raw = Record<string, unknown>

const str = (value: unknown) => (typeof value === "string" ? value : "")
const strOrNull = (value: unknown) =>
  typeof value === "string" && value ? value : null

function toOption(value: unknown): VoiceProviderOption {
  const raw = (value ?? {}) as Raw
  return {
    id: str(raw.id),
    name: str(raw.name) || str(raw.id),
    ready: raw.ready === true,
    missing: Array.isArray(raw.missing)
      ? raw.missing.filter((item): item is string => typeof item === "string")
      : [],
    current: raw.current === true,
  }
}

function toState(value: unknown): VoiceProviderState {
  const raw = (value ?? {}) as Raw
  const providers = Array.isArray(raw.providers)
    ? raw.providers.map(toOption).filter((option) => option.id)
    : []
  const current = str(raw.current)
  return {
    current,
    currentName:
      str(raw.currentName) ||
      providers.find((option) => option.id === current)?.name ||
      current,
    // Only an explicit false warns: a missing flag isn't a broken provider.
    currentReady: raw.currentReady !== false,
    chosenBy: raw.chosenBy === "super_admin" ? "super_admin" : "server_default",
    changedAt: strOrNull(raw.changedAt),
    changedByEmail: strOrNull(raw.changedByEmail),
    voiceInterviewsEnabled: raw.voiceInterviewsEnabled !== false,
    providers,
  }
}

export async function getVoiceProvider(): Promise<VoiceProviderState> {
  const response = await apiFetch<{ voiceProvider: unknown }>(
    "/platform/voice-provider",
    { token: currentAccessToken() }
  )
  return toState(response.voiceProvider)
}

export async function setVoiceProvider(
  provider: string
): Promise<{ changed: boolean; state: VoiceProviderState }> {
  const response = await apiFetch<{ changed?: boolean; voiceProvider: unknown }>(
    "/platform/voice-provider",
    { method: "PUT", token: currentAccessToken(), body: { provider } }
  )
  return {
    changed: response.changed !== false,
    state: toState(response.voiceProvider),
  }
}

export const voiceProviderKey = ["platform", "voice-provider"] as const

export function useVoiceProvider() {
  return useQuery({ queryKey: voiceProviderKey, queryFn: getVoiceProvider })
}

export function useSetVoiceProvider() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: setVoiceProvider,
    onSuccess: ({ changed, state }) => {
      // The reply is the page, already updated: render straight from it.
      queryClient.setQueryData(voiceProviderKey, state)
      toast.success(
        changed
          ? `Voice provider switched to ${state.currentName}.`
          : `${state.currentName} was already the voice provider.`
      )
      // The switch is in the audit log now.
      void queryClient.invalidateQueries({
        queryKey: ["platform", "audit-logs"],
      })
    },
    // The server's own sentence: "Gemini Live is not set up on this server
    // yet (missing: GEMINI_API_KEYS)…".
    onError: (error: Error) =>
      toast.error(error.message || "Couldn't switch the voice provider."),
  })
}
