import { useQuery } from "@tanstack/react-query"
import { AlertTriangle, Loader2, VideoOff } from "lucide-react"

import { getRecordingPlaybackUrl } from "@/services/hr"

/**
 * Playback for a sitting's recording.
 *
 * The URL is fetched on demand rather than with the report, because
 * `GET /api/recordings/{id}/playback-url` mints a **time-limited** link — one
 * handed out with the rest of the page would already be expiring by the time
 * anyone opened this tab. `staleTime: 0` and no cache for the same reason: a
 * revisit gets a fresh one.
 */
export function RecordingPanel({
  recordingSessionId,
}: {
  recordingSessionId: string | null
}) {
  const playback = useQuery({
    queryKey: ["recording", recordingSessionId],
    queryFn: () => getRecordingPlaybackUrl(recordingSessionId!),
    enabled: Boolean(recordingSessionId),
    staleTime: 0,
    gcTime: 0,
    retry: false,
  })

  if (!recordingSessionId) {
    return (
      <div className="flex flex-col items-start gap-2 py-4">
        <p className="flex items-center gap-2 font-medium">
          <VideoOff className="size-4 text-muted-foreground" />
          No recording for this sitting.
        </p>
        <p className="text-sm text-muted-foreground">
          A video appears here only when the candidate&rsquo;s browser uploaded
          one and the deployment has recording storage configured.
        </p>
      </div>
    )
  }

  if (playback.isLoading) {
    return (
      <p className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Preparing playback…
      </p>
    )
  }

  if (playback.isError || !playback.data) {
    return (
      <div className="flex flex-col items-start gap-2 py-4">
        <p className="flex items-center gap-2 font-medium">
          <AlertTriangle className="size-4 text-amber-500" />
          This recording can&rsquo;t be played right now.
        </p>
        <p className="text-sm text-muted-foreground">
          The upload may still be finalising, or the playback link expired —
          reopen this tab to request a fresh one.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {/* `key` on the URL: a refreshed link has to reload the element, and a
          <video> keeps playing the old source when only `src` changes. */}
      <video
        key={playback.data}
        src={playback.data}
        controls
        playsInline
        className="w-full rounded-xl bg-black"
      />
      <p className="text-xs text-muted-foreground">
        The playback link is time-limited and issued per view.
      </p>
    </div>
  )
}
