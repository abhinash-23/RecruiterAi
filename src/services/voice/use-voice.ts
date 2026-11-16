import { useQuery } from "@tanstack/react-query"

import { STATIC_READ } from "@/services/query-defaults"

import { getVoiceOptions } from "./voice"

export const voiceKeys = {
  options: ["voice", "options"] as const,
}

/**
 * The voice catalogue. Static for a session — it changes when the backend
 * team ships a voice, not when anyone here edits something.
 *
 * `data` is null on a backend without voice settings, which every panel reads
 * as "hide". No retry: a 403 for a role that can't create interviews is an
 * answer, not a blip.
 */
export function useVoiceOptions(enabled = true) {
  return useQuery({
    queryKey: voiceKeys.options,
    queryFn: getVoiceOptions,
    enabled,
    retry: false,
    ...STATIC_READ,
    staleTime: 60 * 60_000,
  })
}
