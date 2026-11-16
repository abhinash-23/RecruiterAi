import * as React from "react"

/**
 * ============================================================================
 * DEVICE CHECK — is the camera showing a picture, is the microphone hearing?
 * ============================================================================
 * Everything here runs in the browser and needs no token, which is the point:
 * the check happens **before** the code is entered, while the link is still
 * unused. A candidate whose microphone fails here can switch computers and open
 * the same link; one who found out after `verify-otp` could not.
 */

/**
 * Level the microphone has to pass, on the 0–1 scale `useMicLevel` reports.
 *
 * Set for speech at a normal distance, not for a breath: the browser's noise
 * suppression is on (see `useMediaStream`), so room hum sits well under this,
 * and a fan won't pass for a voice.
 */
const SPEECH_LEVEL = 0.18

/** How long the voice has to be heard, in total, before the mic passes. */
const HEARD_MS = 400

/**
 * Mean brightness, 0–255, under which the picture counts as dark.
 *
 * A covered lens or a privacy shutter reads around 0–5; a dim room is still
 * comfortably above 20. Between the two is a picture nobody could judge from.
 */
const DARK_LUMA = 14

/**
 * How loud the microphone is right now, and whether it has heard speech.
 *
 * Read with an `AnalyserNode` on the stream's own audio track — the same track
 * the interview records and Elena listens to, so a pass here means the
 * microphone the interview will actually use.
 *
 * `heard` is remembered per microphone: choosing a different one starts the
 * test again, because the old one passing says nothing about the new one —
 * but switching *cameras* re-opens the audio too, and that keeps its tick.
 *
 * **`paused` is Safari.** An `AudioContext` may only start inside a click, and
 * this one is created a beat after "Start the check", once permission comes
 * back — so Safari can hold it suspended, the meter reads silence, and a
 * working microphone never passes. Any tap on the page resumes it; `paused`
 * lets the screen ask for that tap rather than leave the bar flat.
 */
export function useMicLevel(stream: MediaStream | null) {
  const [level, setLevel] = React.useState(0)
  const [heardDevice, setHeardDevice] = React.useState<string | null>(null)
  const [paused, setPaused] = React.useState(false)
  const contextRef = React.useRef<AudioContext | null>(null)
  const track = stream?.getAudioTracks()[0] ?? null
  const device = track ? track.getSettings().deviceId || track.label : null

  React.useEffect(() => {
    if (!track) return

    const AudioContextClass =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext
    if (!AudioContextClass) return

    const context = new AudioContextClass()
    contextRef.current = context
    // iOS also reports "interrupted" (a call, Siri) — anything but running
    // means the meter is deaf.
    const sync = () => setPaused(context.state !== "running")
    const wake = () => {
      if (context.state !== "running") {
        void context.resume().then(sync, sync)
      }
    }
    context.addEventListener("statechange", sync)
    // Opened after an await, so some browsers start it suspended; the first
    // tap anywhere on the page is a gesture Safari will accept.
    void context.resume().then(sync, sync)
    document.addEventListener("pointerdown", wake)
    document.addEventListener("keydown", wake)
    const source = context.createMediaStreamSource(new MediaStream([track]))
    const analyser = context.createAnalyser()
    analyser.fftSize = 1024
    source.connect(analyser)

    const samples = new Float32Array(analyser.fftSize)
    let frame = 0
    let lastPaint = 0
    let lastTick = performance.now()
    let heardFor = 0

    const tick = (now: number) => {
      analyser.getFloatTimeDomainData(samples)
      let sum = 0
      for (const sample of samples) sum += sample * sample
      const rms = Math.sqrt(sum / samples.length)
      // Speech is logarithmic; a linear bar barely moves for a normal voice.
      // −50 dB reads as empty and −10 dB as full.
      const db = 20 * Math.log10(Math.max(rms, 1e-5))
      const next = Math.min(1, Math.max(0, (db + 50) / 40))

      const elapsed = now - lastTick
      lastTick = now
      if (next >= SPEECH_LEVEL) {
        heardFor += elapsed
        if (heardFor >= HEARD_MS) setHeardDevice(device)
      }

      // ~15 paints a second is smooth for a bar and spares the render.
      if (now - lastPaint > 66) {
        lastPaint = now
        setLevel(next)
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener("pointerdown", wake)
      document.removeEventListener("keydown", wake)
      context.removeEventListener("statechange", sync)
      source.disconnect()
      if (contextRef.current === context) contextRef.current = null
      void context.close().catch(() => undefined)
    }
  }, [track, device])

  return {
    level: track ? level : 0,
    heard: device !== null && heardDevice === device,
    paused: track ? paused : false,
    /** For a click handler: resumes inside the gesture, which Safari needs. */
    resume: () => void contextRef.current?.resume().catch(() => undefined),
  }
}

export type CameraPicture = "waiting" | "ok" | "dark"

/**
 * Whether the camera is producing a picture anyone could see.
 *
 * Twice a second it shrinks the current frame to 32×18 and averages the
 * brightness. That catches what a granted permission does not: a covered lens,
 * a privacy shutter, a virtual camera sending black, or a driver that opened
 * but never delivers frames (`videoWidth` stays 0).
 */
export function useCameraPicture(
  video: HTMLVideoElement | null,
  stream: MediaStream | null
): CameraPicture {
  const [reading, setReading] = React.useState<{
    track: string
    picture: CameraPicture
  } | null>(null)
  const track = stream?.getVideoTracks()[0] ?? null

  React.useEffect(() => {
    if (!video || !track) return
    const canvas = document.createElement("canvas")
    canvas.width = 32
    canvas.height = 18
    const context = canvas.getContext("2d", { willReadFrequently: true })
    if (!context) return

    // Only re-renders when the answer changes, not on every sample.
    const report = (picture: CameraPicture) =>
      setReading((prev) =>
        prev?.track === track.id && prev.picture === picture
          ? prev
          : { track: track.id, picture }
      )

    const timer = window.setInterval(() => {
      if (!video.videoWidth || track.readyState !== "live") {
        report("waiting")
        return
      }
      context.drawImage(video, 0, 0, canvas.width, canvas.height)
      const { data } = context.getImageData(0, 0, canvas.width, canvas.height)
      let sum = 0
      for (let i = 0; i < data.length; i += 4) {
        sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
      }
      const luma = sum / (data.length / 4)
      report(luma < DARK_LUMA ? "dark" : "ok")
    }, 500)

    return () => window.clearInterval(timer)
  }, [video, track])

  return reading && track && reading.track === track.id
    ? reading.picture
    : "waiting"
}

export interface DeviceOption {
  deviceId: string
  label: string
}

/**
 * The cameras and microphones this computer has, kept current as headsets and
 * webcams are plugged in or out.
 *
 * Labels are empty until camera permission is granted, so the list is only
 * read once `granted` — before that the browser reports nameless devices.
 */
export function useDeviceList(granted: boolean) {
  const [devices, setDevices] = React.useState<{
    cameras: DeviceOption[]
    microphones: DeviceOption[]
  }>({ cameras: [], microphones: [] })

  React.useEffect(() => {
    const media = navigator.mediaDevices
    if (!granted || !media?.enumerateDevices) return

    let live = true
    const read = async () => {
      const all = await media.enumerateDevices().catch(() => [])
      if (!live) return
      const pick = (kind: MediaDeviceKind, fallback: string) =>
        all
          .filter((device) => device.kind === kind && device.deviceId)
          /* Kept: Chrome's "default" entry, labelled "Default - <name>" — it is
             what an unconstrained stream opens, so it is the one to show as
             selected. Dropped: Windows' "communications" alias of the same. */
          .filter((device) => device.deviceId !== "communications")
          .map((device, index) => ({
            deviceId: device.deviceId,
            label: device.label || `${fallback} ${index + 1}`,
          }))
      setDevices({
        cameras: pick("videoinput", "Camera"),
        microphones: pick("audioinput", "Microphone"),
      })
    }

    void read()
    media.addEventListener?.("devicechange", read)
    return () => {
      live = false
      media.removeEventListener?.("devicechange", read)
    }
  }, [granted])

  return devices
}

/** How long speech may take to start before the chime plays instead. */
const SPEECH_START_TIMEOUT_MS = 1500

/**
 * An English voice that sounds like a person, where the browser has one:
 * the online "Google" / "Natural" voices first, then any English voice.
 * Null leaves the browser's default, which is still English on most setups.
 */
function pickEnglishVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices()
  const english = voices.filter((voice) => /^en(-|_|$)/i.test(voice.lang))
  return (
    english.find((voice) => /natural|google/i.test(voice.name)) ??
    english.find((voice) => voice.default) ??
    english[0] ??
    null
  )
}

/**
 * The speaker check: **a spoken greeting** — "Hello! Are you ready for
 * your interview?…" — because a candidate who can hear a voice can hear the
 * interviewer, which a beep only suggests. Spoken by the browser's own
 * speech, so it needs no download and no backend, and works before the code.
 *
 * Falls back to the chime when the browser has no speech, or it doesn't start
 * in time (some Linux builds ship without voices): the check must never be
 * unpassable for want of a voice.
 */
export function playTestSound() {
  const synth =
    typeof window !== "undefined" && "speechSynthesis" in window
      ? window.speechSynthesis
      : null
  if (!synth || typeof SpeechSynthesisUtterance === "undefined") {
    playChime()
    return
  }

  const utterance = new SpeechSynthesisUtterance(
    "Hello! Are you ready for your interview? If you can hear me clearly, press I heard it."
  )
  utterance.lang = "en-US"
  utterance.rate = 1
  utterance.volume = 1
  const voice = pickEnglishVoice()
  if (voice) utterance.voice = voice

  let started = false
  utterance.onstart = () => {
    started = true
  }
  utterance.onerror = () => {
    if (!started) playChime()
  }

  // A press while it's still talking starts it again rather than queueing.
  synth.cancel()
  synth.speak(utterance)
  // Chrome sometimes leaves the queue paused after a cancel.
  synth.resume()

  window.setTimeout(() => {
    if (started) return
    synth.cancel()
    playChime()
  }, SPEECH_START_TIMEOUT_MS)
}

/**
 * A short two-note chime through the speakers — the fallback when the
 * browser can't speak. Synthesised, so there is nothing to download.
 */
function playChime() {
  const AudioContextClass =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext
  if (!AudioContextClass) return

  const context = new AudioContextClass()
  const notes = [
    { frequency: 660, at: 0 },
    { frequency: 880, at: 0.35 },
    { frequency: 660, at: 0.7 },
    { frequency: 880, at: 1.05 },
  ]
  for (const note of notes) {
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    oscillator.type = "sine"
    oscillator.frequency.value = note.frequency
    const start = context.currentTime + note.at
    gain.gain.setValueAtTime(0.0001, start)
    gain.gain.exponentialRampToValueAtTime(0.35, start + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.3)
    oscillator.connect(gain).connect(context.destination)
    oscillator.start(start)
    oscillator.stop(start + 0.32)
  }
  window.setTimeout(() => void context.close().catch(() => undefined), 1800)
}

/**
 * iPhone or iPad, including iPadOS reporting itself as a Mac.
 *
 * Only for wording: on iOS the ring/silent switch mutes Web Audio, so a
 * candidate who hears nothing on the speaker test most likely has it on.
 */
export function isAppleMobile(): boolean {
  if (typeof navigator === "undefined") return false
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.userAgent.includes("Macintosh") && navigator.maxTouchPoints > 1)
  )
}

/**
 * A browser built into another app — the page a link opens in when it is
 * tapped inside Instagram, Facebook, LinkedIn, Snapchat, TikTok, Line, WeChat
 * or an Android app's WebView.
 *
 * Several of these refuse the camera outright, or ask and then deliver
 * nothing, and the candidate has no way to tell that from a broken webcam.
 * Detected by user agent, which is a heuristic: a miss just means the normal
 * check runs, and a false hit only shows advice beside the normal check.
 */
export function isInAppBrowser(): boolean {
  if (typeof navigator === "undefined") return false
  return /FBAN|FBAV|FB_IAB|FBIOS|Instagram|LinkedInApp|Snapchat|musical_ly|BytedanceWebview|TikTok|Line\/|MicroMessenger|; wv\)/i.test(
    navigator.userAgent
  )
}
