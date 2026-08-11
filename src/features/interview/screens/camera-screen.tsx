import { ArrowRight } from "lucide-react"

import { Button } from "@/components/ui/button"

import { Shell } from "./shell"

/**
 * The camera check, and the last screen before the room.
 *
 * ⚠️ `onStart` is called straight from the click handler, and the handler is
 * deliberately **not** async: entering fullscreen needs a live user gesture, and
 * the first `await` in an async body ends that window.
 */
export function CameraScreen({
  logoUrl,
  onStart,
  busy,
  mediaError,
  error,
}: {
  logoUrl: string | null
  onStart: () => void
  busy: boolean
  /** From `getUserMedia` — a blocked permission reads differently from a fault. */
  mediaError: string | null
  error: string | null
}) {
  return (
    <Shell
      logoUrl={logoUrl}
      title="Turn on your camera"
      description="You'll be visible for the whole interview, and the recording is shared with the recruiter."
      footer={
        <Button onClick={onStart} disabled={busy}>
          {busy ? "Starting…" : "Allow and start"}
          {!busy ? <ArrowRight data-icon="inline-end" /> : null}
        </Button>
      }
    >
      <div className="flex flex-col gap-3 text-sm text-muted-foreground">
        <p>
          Find somewhere quiet and well lit. You can turn the picture off
          mid-interview if you need to.
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
