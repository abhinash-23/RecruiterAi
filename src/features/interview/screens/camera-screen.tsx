import { ArrowRight, AudioLines, Check, Headphones } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
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
      // Wide for a spoken interview: the camera and the quiet-room card sit
      // side by side, so the whole step fits a laptop screen without a scroll.
      wide={Boolean(host)}
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
        {host ? (
          <div className={cn("grid gap-3", stream && "md:grid-cols-2")}>
            {/* From `md` the preview drops its 16:9 box and stretches to the
                card beside it, so the two columns end level; `object-cover`
                crops the sides rather than letterboxing. */}
            {stream ? (
              <LivePreview
                stream={stream}
                className="md:aspect-auto md:h-full md:min-h-56"
              />
            ) : null}
            <QuietRoomCard hostName={host.name} />
          </div>
        ) : stream ? (
          <LivePreview stream={stream} />
        ) : null}
        {host ? (
          <div className="flex items-start gap-3 rounded-xl border p-3">
            <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-emerald-500/10">
              <AudioLines className="size-4 text-emerald-600 dark:text-emerald-400" />
            </div>
            <p className="text-sm text-foreground">
              {/* Disclosed before the interview starts: disclosure rules now
                  apply in the EU and Illinois, and NYC requires advance notice
                  (2026-11-16 guide). Whether a person reviews the result is a
                  per-customer statement and is not made here. */}
              You&rsquo;ll be speaking with{" "}
              <span className="font-semibold">{host.name}</span>, an AI
              interviewer.
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
        {host ? (
          <p>Keep your face in the frame. The interview opens full screen.</p>
        ) : (
          <p>
            Find somewhere quiet and well lit, and keep your face in the frame.
            The interview opens full screen.
          </p>
        )}
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

const QUIET_ROOM_STEPS = [
  "Find a quiet room and close the door",
  "Make sure no one else is speaking nearby",
  "Switch off the TV, music and phone notifications",
  "Wear headphones if you have them",
  "Speak clearly, and pause briefly when you finish an answer",
]

/**
 * The setup a spoken interview needs, said before it starts.
 *
 * The interviewer hears everything the microphone does, and on rev 7 the
 * server decides when the candidate has spoken: a TV, a colleague or the
 * interviewer's own voice from the speakers can cut them off mid-sentence or
 * be taken for an answer. Advice is the one fix the candidate controls, so it
 * gets a card rather than a clause in a sentence.
 */
function QuietRoomCard({ hostName }: { hostName: string }) {
  return (
    <div className="flex flex-col gap-2.5 rounded-xl border border-amber-500/25 bg-amber-500/5 p-3">
      <div className="flex items-center gap-2">
        <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-amber-500/10">
          <Headphones className="size-4 text-amber-600 dark:text-amber-400" />
        </span>
        <p className="text-sm font-semibold text-foreground">
          Before you begin
        </p>
      </div>
      <p className="text-sm text-foreground">
        {hostName} hears everything your microphone picks up. A quiet setting
        keeps the conversation smooth and your answers clear.
      </p>
      <ul className="flex flex-col gap-1.5">
        {QUIET_ROOM_STEPS.map((step) => (
          <li
            key={step}
            className="flex items-start gap-2 text-sm text-foreground"
          >
            <Check className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <span>{step}</span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">
        Background noise can interrupt {hostName} or be mistaken for your
        answer.
      </p>
    </div>
  )
}
