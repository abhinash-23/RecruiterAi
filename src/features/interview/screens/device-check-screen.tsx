import * as React from "react"
import {
  AlertTriangle,
  ArrowRight,
  Camera,
  CheckCircle2,
  Circle,
  Loader2,
  Mic,
  RefreshCw,
  Volume2,
  type LucideIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"

import {
  isAppleMobile,
  isInAppBrowser,
  playTestSound,
  useCameraPicture,
  useDeviceList,
  useMicLevel,
  type DeviceOption,
} from "../use-device-check"
import { Shell } from "./shell"

/** `idle` waits on the candidate; `pending` on the device. */
type Tone = "idle" | "pending" | "ok" | "problem"

/** The candidate's own picture, mirrored the way a mirror would show it. */
export function LivePreview({
  stream,
  onVideo,
  className,
  children,
}: {
  stream: MediaStream | null
  /** The element, for anything that reads frames off it. */
  onVideo?: (node: HTMLVideoElement | null) => void
  className?: string
  children?: React.ReactNode
}) {
  // A callback ref, like `CameraPane`: it attaches the stream to whatever node
  // is mounted, including after the stream is swapped for another camera.
  const attach = React.useCallback(
    (node: HTMLVideoElement | null) => {
      if (node && stream && node.srcObject !== stream) node.srcObject = stream
      onVideo?.(node)
    },
    [stream, onVideo]
  )

  return (
    <div
      className={cn(
        "relative aspect-video overflow-hidden rounded-xl bg-surface-dark",
        className
      )}
    >
      <video
        ref={attach}
        autoPlay
        muted
        playsInline
        className="size-full -scale-x-100 object-cover"
      />
      {children}
    </div>
  )
}

/**
 * This page's own link, to carry into a real browser.
 *
 * The link is shown as well as copied: in-app browsers are exactly where the
 * clipboard tends to be blocked, and a field the candidate can select by hand
 * still works there.
 */
function CopyLink() {
  const [copied, setCopied] = React.useState(false)
  const field = React.useRef<HTMLInputElement | null>(null)
  const href = window.location.href

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(href)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      field.current?.select()
    }
  }

  return (
    <div className="flex gap-2">
      <Input
        ref={field}
        readOnly
        value={href}
        aria-label="Interview link"
        onFocus={(event) => event.currentTarget.select()}
        className="h-8 min-w-0 flex-1 bg-background font-mono text-xs"
      />
      <Button size="sm" variant="outline" onClick={() => void copy()}>
        {copied ? <CheckCircle2 /> : null}
        {copied ? "Copied" : "Copy link"}
      </Button>
    </div>
  )
}

function StatusIcon({ tone }: { tone: Tone }) {
  if (tone === "ok") {
    return <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />
  }
  if (tone === "problem") {
    return <AlertTriangle className="size-4 shrink-0 text-amber-500" />
  }
  if (tone === "idle") {
    return <Circle className="size-4 shrink-0 text-muted-foreground" />
  }
  return (
    <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
  )
}

/** One device's row: what it is, how it's doing, and anything to act on. */
function CheckRow({
  icon: Icon,
  title,
  tone,
  status,
  children,
}: {
  icon: LucideIcon
  title: string
  tone: Tone
  status: string
  children?: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border p-3">
      <div className="flex items-start gap-3">
        <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted">
          <Icon className="size-4 text-muted-foreground" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{title}</p>
          <p
            className={cn(
              "mt-0.5 flex items-center gap-1.5 text-xs",
              tone === "ok"
                ? "text-emerald-600 dark:text-emerald-400"
                : tone === "problem"
                  ? "text-amber-700 dark:text-amber-400"
                  : "text-muted-foreground"
            )}
          >
            <StatusIcon tone={tone} />
            {status}
          </p>
        </div>
      </div>
      {children}
    </div>
  )
}

/** A picker for when the computer has more than one camera or microphone. */
function DevicePicker({
  label,
  devices,
  current,
  onChange,
  disabled,
}: {
  label: string
  devices: DeviceOption[]
  current: string | undefined
  onChange: (deviceId: string) => void
  disabled: boolean
}) {
  if (devices.length < 2) return null
  return (
    <Select
      value={current ?? ""}
      onValueChange={(value) => {
        if (value && value !== current) onChange(String(value))
      }}
      disabled={disabled}
    >
      <SelectTrigger aria-label={label} className="w-full">
        <SelectValue>
          {(value) =>
            devices.find((device) => device.deviceId === value)?.label ??
            "Default"
          }
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {devices.map((device) => (
          <SelectItem key={device.deviceId} value={device.deviceId}>
            {device.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/**
 * The first screen of the interview link: camera, microphone and speakers,
 * checked **before** the code is entered.
 *
 * Ahead of the code on purpose. `verify-otp` is one-shot — once a code is in,
 * the link can't be opened anywhere else — so a microphone that fails after it
 * strands the candidate on a computer they can't use. Here the link is still
 * unused, and the way out of a broken device is simply another computer.
 *
 * Nothing here talks to the server. The stream it opens is the page's own and
 * carries on into the interview, so the devices that pass here are the ones
 * the interview uses.
 */
export function DeviceCheckScreen({
  logoUrl,
  name,
  role,
  stream,
  requesting,
  mediaError,
  onCheck,
  onSwitch,
  onContinue,
}: {
  logoUrl: string | null
  name: string
  role: string
  stream: MediaStream | null
  requesting: boolean
  mediaError: string | null
  onCheck: () => void
  onSwitch: (next: { video?: string; audio?: string }) => void
  onContinue: () => void
}) {
  const [video, setVideo] = React.useState<HTMLVideoElement | null>(null)
  const picture = useCameraPicture(video, stream)
  const mic = useMicLevel(stream)
  const devices = useDeviceList(stream !== null)
  const [sound, setSound] = React.useState<"idle" | "played" | "yes" | "no">(
    "idle"
  )
  const [inApp] = React.useState(isInAppBrowser)
  const [apple] = React.useState(isAppleMobile)

  const videoTrack = stream?.getVideoTracks()[0]
  const audioTrack = stream?.getAudioTracks()[0]

  const cameraOk = picture === "ok"
  const micOk = mic.heard
  const soundOk = sound === "yes"
  const ready = cameraOk && micOk && soundOk

  const greeting = name ? `Hi ${name.split(" ")[0]}. ` : ""
  const forRole = role ? ` for the ${role} interview` : ""

  const help = (
    <p className="text-xs text-muted-foreground">
      Still not working? Your link hasn&rsquo;t been used yet, so you can open
      this same link on another computer or phone and try there.
    </p>
  )

  /* Shown before the check and during it: a browser inside Instagram or
     LinkedIn often refuses the camera, and the fix is the same either way. */
  const inAppWarning = inApp ? (
    <div
      role="alert"
      className="flex flex-col gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300"
    >
      <p className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
        <span>
          This link opened inside another app, which may not allow your camera.
          Copy the link and open it in Chrome or Safari instead.
        </span>
      </p>
      <CopyLink />
    </div>
  ) : null

  /* -------------------------------------------------- before permission - */

  if (!stream) {
    return (
      <Shell
        logoUrl={logoUrl}
        title="Check your camera and microphone"
        description={`${greeting}Before you enter your code, let's make sure everything works${forRole}.`}
        footer={
          <Button onClick={onCheck} disabled={requesting}>
            {requesting ? (
              <Loader2 className="animate-spin" />
            ) : mediaError ? (
              <RefreshCw />
            ) : (
              <Camera />
            )}
            {requesting
              ? "Waiting for permission…"
              : mediaError
                ? "Try again"
                : "Start the check"}
          </Button>
        }
      >
        <div className="flex flex-col gap-3 text-sm text-muted-foreground">
          {inAppWarning}
          <ul className="flex flex-col gap-2">
            <li className="flex items-center gap-2">
              <Camera className="size-4 shrink-0" />
              Your camera shows a clear picture
            </li>
            <li className="flex items-center gap-2">
              <Mic className="size-4 shrink-0" />
              Your microphone can hear you
            </li>
            <li className="flex items-center gap-2">
              <Volume2 className="size-4 shrink-0" />
              You can hear sound from your speakers or headphones
            </li>
          </ul>
          <p>
            Your browser will ask to use your camera and microphone. Choose{" "}
            <span className="font-medium text-foreground">Allow</span>.
          </p>
          {mediaError ? (
            <>
              <p
                role="alert"
                className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive"
              >
                {mediaError}
              </p>
              {help}
            </>
          ) : null}
        </div>
      </Shell>
    )
  }

  /* ---------------------------------------------------- the check itself - */

  return (
    <Shell
      logoUrl={logoUrl}
      title="Check your camera and microphone"
      description="All three need a green tick before you continue."
      footer={
        <Button onClick={onContinue} disabled={!ready}>
          Continue to your code
          <ArrowRight data-icon="inline-end" />
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        {inAppWarning}
        <LivePreview stream={stream} onVideo={setVideo}>
          {picture !== "ok" ? (
            <div className="absolute inset-0 grid place-items-center bg-surface-dark/70 px-6 text-center text-sm text-white/80">
              {picture === "dark"
                ? "Your picture is too dark"
                : "Waiting for your camera…"}
            </div>
          ) : null}
        </LivePreview>

        <CheckRow
          icon={Camera}
          title="Camera"
          tone={cameraOk ? "ok" : picture === "dark" ? "problem" : "pending"}
          status={
            cameraOk
              ? "Working. We can see you."
              : picture === "dark"
                ? "Too dark. Turn on a light, or uncover the camera."
                : "Starting your camera…"
          }
        >
          <DevicePicker
            label="Camera"
            devices={devices.cameras}
            current={videoTrack?.getSettings().deviceId}
            onChange={(deviceId) => onSwitch({ video: deviceId })}
            disabled={requesting}
          />
        </CheckRow>

        <CheckRow
          icon={Mic}
          title="Microphone"
          tone={micOk ? "ok" : mic.paused ? "idle" : "pending"}
          status={
            micOk
              ? "Working. We can hear you."
              : mic.paused
                ? "Your browser needs a tap before it can listen."
                : "Say something out loud, like your name."
          }
        >
          {mic.paused && !micOk ? (
            <div>
              <Button variant="outline" size="sm" onClick={mic.resume}>
                <Mic />
                Tap to test your microphone
              </Button>
            </div>
          ) : null}
          <div
            className="h-2 overflow-hidden rounded-full bg-muted"
            role="meter"
            aria-label="Microphone level"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(mic.level * 100)}
          >
            <div
              className={cn(
                "h-full rounded-full transition-[width] duration-75",
                micOk ? "bg-emerald-500" : "bg-brand-blue"
              )}
              style={{ width: `${Math.round(mic.level * 100)}%` }}
            />
          </div>
          <DevicePicker
            label="Microphone"
            devices={devices.microphones}
            current={audioTrack?.getSettings().deviceId}
            onChange={(deviceId) => onSwitch({ audio: deviceId })}
            disabled={requesting}
          />
        </CheckRow>

        <CheckRow
          icon={Volume2}
          title="Speakers"
          tone={soundOk ? "ok" : sound === "no" ? "problem" : "idle"}
          status={
            soundOk
              ? "Working. You can hear us."
              : sound === "no"
                ? apple
                  ? "Turn off silent mode (the switch on the side), turn the volume up, then play it again."
                  : "Turn your volume up, unmute, or plug in headphones, then play it again."
                : sound === "played"
                  ? "Did you hear the sound?"
                  : "Play a short sound to check you can hear the interviewer."
          }
        >
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                playTestSound()
                setSound("played")
              }}
            >
              <Volume2 />
              {sound === "idle" ? "Play test sound" : "Play again"}
            </Button>
            {sound === "played" || sound === "no" ? (
              <>
                <Button size="sm" onClick={() => setSound("yes")}>
                  I heard it
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSound("no")}
                >
                  I didn&rsquo;t hear anything
                </Button>
              </>
            ) : null}
          </div>
        </CheckRow>

        {mediaError ? (
          <p
            role="alert"
            className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {mediaError}
          </p>
        ) : null}
        {!ready ? (
          <div className="flex flex-col items-start gap-2">
            {/* For a camera or headset unplugged mid-check: the tracks end and
                nothing on screen moves. Re-opening picks up whatever is
                plugged in now. */}
            <Button
              variant="ghost"
              size="sm"
              className="-ml-2"
              onClick={() => onSwitch({})}
              disabled={requesting}
            >
              <RefreshCw />
              Restart camera and microphone
            </Button>
            {help}
          </div>
        ) : null}
      </div>
    </Shell>
  )
}
