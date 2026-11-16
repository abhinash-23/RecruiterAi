import * as React from "react"

import { changedVoiceSettings, type VoiceSettings } from "@/services/voice"

/**
 * A form's voice settings, over a `base` it inherits from — the company
 * defaults on a new interview, the job's effective settings when scheduling.
 *
 * The same shape as `useRoundSelection`: it follows `base` until someone picks
 * something, and `changed` is only the keys that now differ from it. That is
 * the whole request contract — anything sent is pinned at this layer and stops
 * inheriting, so an untouched form sends nothing at all.
 */
export function useVoiceSelection(base: VoiceSettings | null | undefined) {
  const [picked, setPicked] = React.useState<VoiceSettings>({})
  const start = React.useMemo(() => base ?? {}, [base])
  const value = React.useMemo(() => ({ ...start, ...picked }), [start, picked])
  const changed = changedVoiceSettings(start, value)

  return {
    value,
    /** Only the keys that differ from `base`, or undefined for none. */
    changed: changed as VoiceSettings | undefined,
    set: React.useCallback(
      (key: string, next: string) =>
        setPicked((current) => ({ ...current, [key]: next })),
      []
    ),
    /** Back to following `base`, for one key or all of them. */
    reset: React.useCallback((key?: string) => {
      setPicked((current) => {
        if (!key) return {}
        const { [key]: _dropped, ...rest } = current
        void _dropped
        return rest
      })
    }, []),
  }
}
