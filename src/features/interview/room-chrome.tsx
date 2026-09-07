import * as React from "react"
import {
  Briefcase,
  Check,
  Clock,
  Copy,
  // Corner brackets — the conventional fullscreen mark. `Maximize2`'s diagonal
  // arrows are already the video pane's expand toggle a column away, and the
  // two controls do different things.
  Maximize,
  Maximize2,
  Minimize2,
  Volume2,
  VolumeX,
} from "lucide-react"

import { ApiImage } from "@/components/shared/api-image"
import { Button } from "@/components/ui/button"
import type { CandidateSession } from "@/services/interview"
import { cn } from "@/lib/utils"

import { formatClock } from "./room-format"
import { RoundStepper } from "./round-stepper"

/**
 * ============================================================================
 * WHAT THE TWO ROOMS SHARE
 * ============================================================================
 * There are two interview rooms — the typed one (`interview-room.tsx`) and the
 * spoken one (`voice-room.tsx`) — and the frame around them is the same room:
 * the same top bar, the same camera pane, the same clock. Only the middle
 * column differs, because only the *answering* differs.
 *
 * Lifted here rather than copied so the two can't drift. A candidate moved from
 * voice to typed mid-interview by a dropped socket sees this chrome stay
 * completely still, which is most of what makes the handover unremarkable to
 * them; two copies of it would eventually disagree about the clock's format or
 * where the interview id lives, and the seam would show at exactly the wrong
 * moment.
 */

/**
 * Shown when the company hasn't uploaded a logo of its own. The wordmark alone —
 * the lettered square was removed by request.
 */
function ProductMark() {
  return (
    <span className="font-extrabold tracking-tight whitespace-nowrap">
      Recruiter<span className="text-brand-pink">AI</span>
    </span>
  )
}

/** Copy control for the interview id in the top bar. */
function CopyId({ value }: { value: string }) {
  const [copied, setCopied] = React.useState(false)

  return (
    <button
      type="button"
      aria-label="Copy interview ID"
      onClick={() => {
        void navigator.clipboard
          .writeText(value)
          .then(() => {
            setCopied(true)
            window.setTimeout(() => setCopied(false), 1500)
          })
          .catch(() => undefined)
      }}
      className="flex items-center gap-1.5 rounded-md px-2 py-1 font-mono text-[11px] text-white/60 transition-colors hover:bg-white/10 hover:text-white/90"
    >
      {value}
      {copied ? (
        <Check className="size-3 text-emerald-400" />
      ) : (
        <Copy className="size-3" />
      )}
    </button>
  )
}

export interface RoomTopBarProps {
  session: CandidateSession
  /** The company's logo, from the public branding for this interview. */
  logoUrl: string | null
  /** Which round the current question belongs to, 1-based as the API sends it. */
  round: number
  /** Seconds left in the sitting. */
  secondsLeft: number
  inFullscreen: boolean
  /**
   * False where the browser has no Fullscreen API — notably iOS Safari, which
   * has none outside `<video>`. The control is hidden rather than shown broken.
   */
  fullscreenSupported: boolean
  /** Entering needs a fresh user gesture, so this must be a real button press. */
  onToggleFullscreen: () => void
}

/**
 * The room's top bar: whose interview this is, how far through it, and how long
 * is left.
 *
 * There is deliberately **no footer** in either room. The two things a candidate
 * might want from one — the interview id, to quote in a support email, and the
 * way out — live here and under the camera instead, where they stay visible
 * without competing with the answer controls for the bottom of the screen.
 */
export function RoomTopBar({
  session,
  logoUrl,
  round,
  secondsLeft,
  inFullscreen,
  fullscreenSupported,
  onToggleFullscreen,
}: RoomTopBarProps) {
  return (
    <header className="flex shrink-0 flex-wrap items-center gap-3 bg-surface-dark px-4 py-2.5 text-white">
      {/* The company's own logo when they have one, exactly as their staff
          see it — the candidate is being interviewed by them, not by us. */}
      {logoUrl ? (
        <ApiImage
          src={logoUrl}
          alt="Company logo"
          className="h-7 w-auto max-w-40 shrink-0 object-contain"
          fallback={<ProductMark />}
          pending={<span className="h-7 w-7" />}
        />
      ) : (
        <ProductMark />
      )}

      {session.rounds.length > 1 ? (
        <RoundStepper
          rounds={session.rounds.map((entry) => ({
            id: String(entry.round),
            name: entry.name,
          }))}
          activeIndex={Math.max(0, round - 1)}
          className="mx-auto [&_span]:text-white/60"
        />
      ) : (
        <span className="mx-auto" />
      )}

      <div className="flex flex-wrap items-center gap-2">
        {/* A way *in* only — never a way out.

            Hidden once fullscreen, deliberately: offering an Exit control on
            the interview chrome invites the candidate to leave, which is the
            opposite of what the room wants, and the browser already provides
            every exit anyone needs (Escape, F11, window controls). Also
            hidden entirely where fullscreen isn't available — notably iOS
            Safari — rather than shown as a control that does nothing. */}
        {fullscreenSupported && !inFullscreen ? (
          <button
            type="button"
            onClick={onToggleFullscreen}
            aria-label="Enter fullscreen"
            title="Enter fullscreen"
            className="flex items-center gap-1.5 rounded-lg bg-white/10 px-2.5 py-1.5 text-white/70 transition-colors hover:bg-white/20 hover:text-white"
          >
            <Maximize className="size-3.5" />
            {/* The label is the affordance on a bar of unlabelled pills; it
                drops below `sm`, where the row is already tight. */}
            <span className="hidden text-xs font-semibold sm:inline">
              Fullscreen
            </span>
          </button>
        ) : null}

        <span className="flex items-center gap-1.5 rounded-lg bg-white/10 px-2.5 py-1.5 text-sm font-semibold tabular-nums">
          <Clock className="size-3.5 text-white/60" />
          {formatClock(secondsLeft)}
        </span>

        <span className="flex items-center gap-1.5 rounded-lg bg-white/10 px-2.5 py-1.5">
          <Briefcase className="size-3.5 text-white/60" />
          <span className="flex flex-col leading-none">
            <span className="text-[9px] tracking-wider text-white/50 uppercase">
              Position
            </span>
            <span className="text-xs font-semibold">{session.role}</span>
          </span>
        </span>

        <span className="flex items-center gap-2 rounded-lg bg-white/10 px-2.5 py-1.5 text-xs font-semibold">
          <span className="grid size-5 place-items-center rounded-full bg-white/15 text-[10px]">
            {session.candidateName.slice(0, 1).toUpperCase()}
          </span>
          {session.candidateName}
        </span>

        <CopyId value={session.interviewId} />
      </div>
    </header>
  )
}

export interface CameraPaneProps {
  /**
   * The camera, which this pane attaches to its own `<video>`.
   *
   * **Attached here rather than by an effect in the page**, and that is a bug
   * fix rather than a preference. The two rooms each render their own pane, so
   * handing a spoken sitting over to the typed one *replaces the DOM element* —
   * and the page's effect only re-ran when the stream or the stage changed,
   * neither of which happens at a handover. The candidate's picture went black
   * mid-interview while the REC badge went on claiming to record it.
   */
  stream: MediaStream | null
  /**
   * The page's own handle on the element, populated as a courtesy: the vitals
   * sampler reads frames off it.
   */
  videoRef: React.RefObject<HTMLVideoElement | null>
  cameraOn: boolean
  /** Whether the sitting is actually being recorded and uploaded. */
  videoRecording: boolean
  hostMuted: boolean
  onToggleHostMuted: () => void
}

/**
 * The candidate's own picture, and the two controls that float over it.
 *
 * The REC badge is only shown when a recording is genuinely being uploaded: a
 * badge over a sitting nobody is recording is a claim the candidate can't check.
 *
 * No camera toggle: the sitting is recorded and the candidate agreed to be
 * visible for it, so an off switch here only invites a recording nobody can use.
 */
export function CameraPane({
  stream,
  videoRef,
  cameraOn,
  videoRecording,
  hostMuted,
  onToggleHostMuted,
}: CameraPaneProps) {
  const [expanded, setExpanded] = React.useState(false)

  /**
   * Attaches the camera to whichever element is currently mounted.
   *
   * A callback ref, so it runs on the *element* rather than on a render: it
   * fires when this pane mounts, again if React ever swaps the node, and again
   * when the stream itself changes — which is exactly the set of moments the
   * page's effect was missing.
   */
  const attach = React.useCallback(
    (node: HTMLVideoElement | null) => {
      videoRef.current = node
      if (node && stream) node.srcObject = stream
    },
    [stream, videoRef]
  )

  return (
    <div
      className={cn(
        "relative shrink-0 overflow-hidden rounded-xl bg-surface-dark",
        expanded ? "aspect-video lg:aspect-4/3" : "aspect-video"
      )}
    >
      <video
        ref={attach}
        autoPlay
        muted
        playsInline
        className="size-full object-cover"
      />

      {!cameraOn ? (
        <div className="absolute inset-0 grid place-items-center bg-surface-dark/90 text-sm text-white/70">
          Camera off
        </div>
      ) : null}

      {videoRecording ? (
        <span className="absolute top-3 left-3 flex items-center gap-1.5 rounded-md bg-black/60 px-2 py-1 text-[11px] font-semibold text-white">
          <span className="size-2 rounded-full bg-red-500 motion-safe:animate-pulse" />
          REC
        </span>
      ) : null}

      {/* Controls float over the video so they don't steal vertical space from
          the notes card beneath. */}
      <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-black/55 p-1.5 backdrop-blur">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={hostMuted ? "Unmute the host" : "Mute the host"}
          onClick={onToggleHostMuted}
          className="rounded-full text-white hover:bg-white/20"
        >
          {hostMuted ? <VolumeX /> : <Volume2 />}
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={expanded ? "Shrink video" : "Expand video"}
          onClick={() => setExpanded((current) => !current)}
          className="rounded-full text-white hover:bg-white/20"
        >
          {expanded ? <Minimize2 /> : <Maximize2 />}
        </Button>
      </div>
    </div>
  )
}
