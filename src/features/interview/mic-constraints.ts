/**
 * The microphone's audio constraints, in one place — the sitting's stream and
 * the voice interview's re-acquire both use them.
 *
 * Per the backend's 2026-11-16 voice guide:
 *
 * | Setting | Value | Why |
 * |---|---|---|
 * | `echoCancellation` | on | the interviewer plays through the speakers while the mic is open; only the device can remove her well |
 * | `autoGainControl` | on | keeps quiet speakers audible |
 * | `noiseSuppression` | on, **behind a switch** | removes room noise, but can clip short answers and soft voices — both teams want to compare |
 * | `channelCount` | 1 | mono, which is what the wire carries |
 *
 * The switch is `VITE_MIC_NOISE_SUPPRESSION=false` at build time.
 */
export const MIC_NOISE_SUPPRESSION =
  import.meta.env.VITE_MIC_NOISE_SUPPRESSION !== "false"

export function micAudioConstraints(deviceId?: string): MediaTrackConstraints {
  return {
    echoCancellation: true,
    noiseSuppression: MIC_NOISE_SUPPRESSION,
    autoGainControl: true,
    channelCount: 1,
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
  }
}

/**
 * What the browser actually applied, which is not always what was asked for —
 * Safari in particular is free to ignore a constraint. Logged and sent to the
 * server with the session id, so a bad sitting can be read back.
 */
export function describeMicTrack(
  track: MediaStreamTrack | undefined
): Record<string, unknown> {
  if (!track) return { track: "none" }
  const settings = track.getSettings()
  return {
    echoCancellation: settings.echoCancellation ?? null,
    noiseSuppression: settings.noiseSuppression ?? null,
    autoGainControl: settings.autoGainControl ?? null,
    sampleRate: settings.sampleRate ?? null,
    channelCount: settings.channelCount ?? null,
    deviceLabel: track.label || null,
  }
}
