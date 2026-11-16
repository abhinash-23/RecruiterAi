import { ArrowRight, AudioLines } from "lucide-react"

import { Button } from "@/components/ui/button"
import type { VoiceHost } from "@/services/voice"

import { LivePreview } from "./device-check-screen"
import { Shell } from "./shell"

/**
 * The last screen before the room.
 *
 * The devices were already checked on the first screen, before the code, so
 * this is a moment to sit up straight rather than a test: the candidate's own
 * picture, and Start. If the camera dropped in between (a phone backgrounded
 * while they fetched the code), Start re-opens it — see `useMediaStream`.
 *
 * ⚠️ `onStart` is called straight from the click handler, and the handler is
 * deliberately **not** async: entering fullscreen needs a live user gesture, and
 * the first `await` in an async body ends that window.
 */
export function CameraScreen({
  logoUrl,
  stream,
  host,
  onStart,
  busy,
  mediaError,
  error,
}: {
  logoUrl: string | null
  stream: MediaStream | null
  /** Who they'll speak with, for a voice interview; null for a typed one. */
  host?: VoiceHost | null
  onStart: () => void
  busy: boolean
  /** From `getUserMedia` — a blocked permission reads differently from a fault. */
  mediaError: string | null
  error: string | null
}) {
  return (
    <Shell
      logoUrl={logoUrl}
      title="Ready to start"
      description="You'll be visible for the whole interview, and the recording is shared with the recruiter."
      footer={
        <Button onClick={onStart} disabled={busy}>
          {busy ? "Starting…" : "Start interview"}
          {!busy ? <ArrowRight data-icon="inline-end" /> : null}
        </Button>
      }
    >
      <div className="flex flex-col gap-3 text-sm text-muted-foreground">
        {stream ? <LivePreview stream={stream} /> : null}
        {host ? (
          <div className="flex items-start gap-3 rounded-xl border p-3">
            <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-emerald-500/10">
              <AudioLines className="size-4 text-emerald-600 dark:text-emerald-400" />
            </div>
            <p className="text-sm text-foreground">
              You&rsquo;ll be speaking with{" "}
              <span className="font-semibold">{host.name}</span>.
              {host.languageLabel ? (
                <>
                  {" "}
                  This interview will be conducted in{" "}
                  <span className="font-semibold">{host.languageLabel}</span>.
                </>
              ) : null}
              <span className="mt-0.5 block text-xs text-muted-foreground">
                The questions on screen are in English.
              </span>
            </p>
          </div>
        ) : null}
        <p>
          Find somewhere quiet and well lit, and keep your face in the frame.
          The interview opens full screen.
        </p>
        {mediaError ? (
          <p
            role="alert"
            className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive"
          >
            {mediaError}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    </Shell>
  )
}
