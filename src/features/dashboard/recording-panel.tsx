import { useQuery } from "@tanstack/react-query"
import { AlertTriangle, Loader2, VideoOff } from "lucide-react"

import { getInterviewRecording } from "@/services/hr"
import { ONE_SHOT_READ } from "@/services/query-defaults"

/**
 * Playback for a sitting's recording.
 *
 * Resolved from the **interview id** — the backend's recommended route returns
 * that interview's latest finalized recording, so nothing here depends on
 * `get-results` carrying a recording id (it doesn't).
 *
 * The URL is fetched on demand rather than with the report, because it is a
 * signed link that expires in about an hour: one handed out with the rest of the
 * page would already be expiring by the time anyone opened this tab. `staleTime`
 * and `gcTime` of 0 for the same reason — a revisit gets a fresh one. The video
 * itself is retained indefinitely; only the link is short-lived.
 */
export function RecordingPanel({
  // Typed as the route param actually is, rather than asserted: with no id there
  // is nothing to ask for, and the query stays off and renders "no recording".
  interviewId,
}: {
  interviewId: string | undefined
}) {
  const recording = useQuery({
    queryKey: ["recording", interviewId ?? ""],
    queryFn: () => getInterviewRecording(interviewId!),
    enabled: Boolean(interviewId),
    staleTime: 0,
    gcTime: 0,
    retry: false,
    // Not even on window focus: a re-read mints a *different* URL, which would
    // hand the <video> a new src and restart playback under whoever was
    // watching — alt-tabbing mid-video would send them back to 0:00.
    ...ONE_SHOT_READ,
  })

  if (recording.isLoading) {
    return (
      <p className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Preparing playback…
      </p>
    )
  }

  // Only a real failure — the service turns a 404 into `null` below, not an
  // error, because that status is the endpoint's ordinary "nothing to play".
  if (recording.isError) {
    return (
      <div className="flex flex-col items-start gap-2 py-4">
        <p className="flex items-center gap-2 font-medium">
          <AlertTriangle className="size-4 text-amber-500" />
          This recording can&rsquo;t be played right now.
        </p>
        <p className="text-sm text-muted-foreground">
          The playback link couldn&rsquo;t be issued. Reopen this tab to request
          a fresh one.
        </p>
      </div>
    )
  }

  // "There is no recording" and "you aren't the one who may watch it" arrive as
  // the same 404 — only the HR who created the interview and that company's
  // admin can play it. So this is the only wording that is true either way.
  if (!recording.data) {
    return (
      <div className="flex flex-col items-start gap-2 py-4">
        <p className="flex items-center gap-2 font-medium">
          <VideoOff className="size-4 text-muted-foreground" />
          No recording for this sitting.
        </p>
        <p className="text-sm text-muted-foreground">
          A video appears here once the candidate&rsquo;s browser has streamed
          one and it has been sealed — and only for the recruiter who created the
          interview and their company&rsquo;s admin.
        </p>
      </div>
    )
  }

  const { playbackUrl, mimeType } = recording.data

  return (
    <div className="flex flex-col gap-2">
      {/* `key` on the URL: a refreshed link has to reload the element, and a
          <video> keeps playing the old source when only `src` changes.

          The type is declared through a <source> rather than guessed by the
          browser, because the signed storage URL carries no file extension and
          the container is whatever the candidate's browser could record — webm
          on Chromium, possibly mp4 elsewhere. */}
      <video
        key={playbackUrl}
        controls
        playsInline
        preload="metadata"
        className="w-full rounded-xl bg-black"
      >
        <source src={playbackUrl} {...(mimeType ? { type: mimeType } : {})} />
      </video>
      <p className="text-xs text-muted-foreground">
        The playback link is time-limited and issued per view. The recording
        itself is kept indefinitely.
      </p>
    </div>
  )
}
