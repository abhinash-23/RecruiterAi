/**
 * The landing page's stateful behaviour, kept out of the components: cursor
 * glow, nav state, scroll reveals, the hero word rotator, and the demo
 * interview session.
 */
import * as React from "react"
import { consentStatements, fallbackQuestions } from "./data"
import { callModel, isTouchDevice, prefersReducedMotion } from "./lib"
/* ==========================================================================
   use-mouse-glow.ts
   ========================================================================== */

/**
 * Tracks the cursor for the ambient brand glow. Stays `null` on touch devices
 * and when reduced motion is requested — no listener is attached and the glow
 * is never rendered.
 */
export function useMouseGlow(): { x: number; y: number } | null {
  const [position, setPosition] = React.useState<{
    x: number
    y: number
  } | null>(null)

  React.useEffect(() => {
    if (isTouchDevice() || prefersReducedMotion()) return

    const onMove = (event: MouseEvent) => {
      setPosition({ x: event.clientX, y: event.clientY })
    }

    window.addEventListener("mousemove", onMove, { passive: true })
    return () => window.removeEventListener("mousemove", onMove)
  }, [])

  return position
}

/* ==========================================================================
   use-nav-state.ts
   ========================================================================== */

const NAV_HEIGHT = 80
const ACTIVE_OFFSET = 120

export interface NavState {
  /** Which nav link should read as active. */
  activeSection: string
  /** Whether the page has scrolled far enough to show the nav backdrop. */
  scrolled: boolean
  /** Contrast of the section currently sitting behind the nav bar. */
  theme: "dark" | "light"
}

/**
 * Tracks the scroll-driven navigation state: the active section, whether the
 * bar has a backdrop yet, and whether it sits on a dark or light section.
 * Section contrast is read from `data-nav-theme` attributes in the DOM, so
 * sections declare their own nav treatment.
 */
export function useNavState(sections: readonly string[]): NavState {
  const [state, setState] = React.useState<NavState>({
    activeSection: sections[0] ?? "",
    scrolled: false,
    theme: "dark",
  })

  React.useEffect(() => {
    const read = (): NavState => {
      const scrollY = window.scrollY

      let activeSection = sections[0] ?? ""
      for (const id of sections) {
        const el = document.getElementById(id)
        if (el && el.offsetTop <= scrollY + ACTIVE_OFFSET) {
          activeSection = id
        }
      }

      // Default to the dark hero treatment until a section claims the bar.
      let theme: NavState["theme"] = "dark"
      const themePos = scrollY + NAV_HEIGHT / 2
      document
        .querySelectorAll<HTMLElement>("[data-nav-theme]")
        .forEach((section) => {
          const top = section.offsetTop
          if (top <= themePos && top + section.offsetHeight > themePos) {
            theme = section.dataset.navTheme === "light" ? "light" : "dark"
          }
        })

      return { activeSection, scrolled: scrollY > 20, theme }
    }

    const update = () => {
      const next = read()
      setState((prev) =>
        prev.activeSection === next.activeSection &&
        prev.scrolled === next.scrolled &&
        prev.theme === next.theme
          ? prev
          : next
      )
    }

    update()
    window.addEventListener("scroll", update, { passive: true })
    window.addEventListener("resize", update)

    return () => {
      window.removeEventListener("scroll", update)
      window.removeEventListener("resize", update)
    }
  }, [sections])

  return state
}

/* ==========================================================================
   use-scroll-reveal.ts
   ========================================================================== */

/**
 * Reveals every `.reveal` descendant of `containerRef` once it scrolls into
 * view by stamping `data-revealed="true"` on it. Elements are unobserved after
 * their first reveal, so the animation never replays.
 */
export function useScrollReveal(
  containerRef: React.RefObject<HTMLElement | null>
) {
  React.useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const targets = container.querySelectorAll<HTMLElement>(".reveal")

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          ;(entry.target as HTMLElement).dataset.revealed = "true"
          observer.unobserve(entry.target)
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -60px 0px" }
    )

    targets.forEach((el) => observer.observe(el))

    return () => observer.disconnect()
  }, [containerRef])
}

/* ==========================================================================
   use-staggered-steps.ts
   ========================================================================== */

/**
 * Once the returned ref scrolls into view, walks the step indices one at a
 * time so each step can light up in sequence. Returns how many steps have been
 * activated so far, and whether the group has entered the viewport at all.
 */
export function useStaggeredSteps(count: number, intervalMs = 250) {
  const containerRef = React.useRef<HTMLDivElement | null>(null)
  const [entered, setEntered] = React.useState(false)
  const [activeCount, setActiveCount] = React.useState(0)

  React.useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return
        setEntered(true)
        observer.disconnect()
      },
      { threshold: 0.3 }
    )

    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  React.useEffect(() => {
    if (!entered) return

    const timers: number[] = []
    for (let i = 0; i < count; i++) {
      timers.push(
        window.setTimeout(() => setActiveCount(i + 1), 300 + i * intervalMs)
      )
    }

    return () => timers.forEach(window.clearTimeout)
  }, [entered, count, intervalMs])

  return { containerRef, entered, activeCount }
}

/* ==========================================================================
   use-word-rotator.ts
   ========================================================================== */

const INTERVAL_MS = 2200

export interface WordRotatorRefs {
  /** The rotator slot — supplies the font metrics used for measuring. */
  slotRef: React.RefObject<HTMLSpanElement | null>
  /** A hidden span used to measure each word off-screen. */
  measureRef: React.RefObject<HTMLSpanElement | null>
}

export interface WordRotator {
  /** Word currently on screen. */
  current: string
  /** Word sliding out of view; `null` before the first swap. */
  previous: string | null
  /** Measured width of `current`, so the slot can animate its width. */
  width: number | undefined
}

/**
 * Cycles the hero headline verb, measuring each word so the surrounding text
 * glides instead of snapping between widths. Rotation is skipped entirely when
 * the visitor prefers reduced motion.
 */
export function useWordRotator(
  words: readonly string[],
  { slotRef, measureRef }: WordRotatorRefs
): WordRotator {
  const [index, setIndex] = React.useState(0)
  const [width, setWidth] = React.useState<number | undefined>(undefined)

  const current = words[index] ?? ""
  const previous = index === 0 ? null : (words[index - 1] ?? null)

  const measure = React.useCallback(
    (word: string) => {
      const slot = slotRef.current
      const measurer = measureRef.current
      if (!slot || !measurer) return

      const styles = window.getComputedStyle(slot)
      measurer.style.fontSize = styles.fontSize
      measurer.style.letterSpacing = styles.letterSpacing
      measurer.textContent = word
      setWidth(measurer.offsetWidth)
    },
    [slotRef, measureRef]
  )

  React.useEffect(() => {
    measure(current)

    const onResize = () => measure(current)
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [current, measure])

  React.useEffect(() => {
    if (prefersReducedMotion() || words.length < 2) return

    const timer = window.setInterval(() => {
      setIndex((i) => (i + 1) % words.length)
    }, INTERVAL_MS)

    return () => window.clearInterval(timer)
  }, [words])

  return { current, previous, width }
}

/* ==========================================================================
   use-interview-session.ts
   ========================================================================== */

export type InterviewStep = "consent" | "camera" | "session" | "summary"

export interface ChatMessage {
  id: number
  sender: "ai" | "candidate"
  text: string
  pending?: boolean
}

export interface SessionMetrics {
  attention: number
  confidence: number
  engagement: number
  stress: number
  hr: number
  hrv: number
  risk: number
  composite: number
}

const INITIAL_METRICS: SessionMetrics = {
  attention: 94,
  confidence: 68,
  engagement: 72,
  stress: 24,
  hr: 72,
  hrv: 48,
  risk: 12,
  composite: 0,
}

const TOTAL_QUESTIONS = 5

const GAZE_STATES = ["On-screen", "On-screen", "On-screen", "Brief away"]

interface DeviceChoice {
  cameras: MediaDeviceInfo[]
  microphones: MediaDeviceInfo[]
}

/** Maps a getUserMedia rejection onto the guidance shown to the candidate. */
function describeCameraError(error: unknown): string {
  const err = error as { name?: string; message?: string }

  switch (err?.name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
      return "Camera and microphone access was denied. Please enable permissions in your browser settings."
    case "NotFoundError":
    case "DevicesNotFoundError":
      return "No camera or microphone found. Please connect a device and try again."
    case "NotReadableError":
    case "TrackStartError":
      return "Your camera is already in use by another application. Please close it and try again."
    case "OverconstrainedError":
    case "ConstraintNotSatisfiedError":
      return "The selected camera does not meet the requirements. Try a different device."
    case "NotSupportedError":
      return "Your browser does not support camera access. Please use Chrome, Firefox, or Safari."
    default:
      break
  }

  if (err?.message === "BrowserNotSupported") {
    return "Your browser does not support camera access. Please use Chrome, Firefox, or Safari."
  }
  if (err?.message === "InsecureConnection") {
    return "Camera access requires a secure connection (HTTPS) or localhost."
  }

  return `An unexpected error occurred: ${err?.message ?? "unknown error"}`
}

/**
 * Drives the demo interview: consent gate, camera handshake, the adaptive
 * question loop, and the closing summary. Media tracks are always released
 * when the session ends or the component unmounts.
 *
 * `videoRef` is supplied by the caller so the hook returns plain values only.
 */
export function useInterviewSession(
  videoRef: React.RefObject<HTMLVideoElement | null>
) {
  const [step, setStep] = React.useState<InterviewStep>("consent")
  const [consents, setConsents] = React.useState<Record<string, boolean>>({})
  const [cameraStatus, setCameraStatus] = React.useState("")
  const [cameraError, setCameraError] = React.useState<string | null>(null)
  const [requesting, setRequesting] = React.useState(false)
  const [devices, setDevices] = React.useState<DeviceChoice | null>(null)
  const [selectedCamera, setSelectedCamera] = React.useState<string>("")
  const [selectedMic, setSelectedMic] = React.useState<string>("")
  const [demoMode, setDemoMode] = React.useState(false)
  const [messages, setMessages] = React.useState<ChatMessage[]>([])
  const [questionIndex, setQuestionIndex] = React.useState(0)
  const [awaitingModel, setAwaitingModel] = React.useState(false)
  const [metrics, setMetrics] = React.useState<SessionMetrics>(INITIAL_METRICS)
  const [gaze, setGaze] = React.useState(GAZE_STATES[0])

  const streamRef = React.useRef<MediaStream | null>(null)
  const messageId = React.useRef(0)
  const compositeRef = React.useRef(0)

  const allConsented = consentStatements.every((item) => consents[item.id])

  const stopStream = React.useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
  }, [videoRef])

  // Release the camera if the component unmounts mid-session.
  React.useEffect(() => stopStream, [stopStream])

  /**
   * Puts the live stream into the <video> once both exist.
   *
   * `startCamera` can't do this on its own, and that is why the tile was black:
   * the element only renders on the **session** step, so at the moment
   * permission is granted — still on the camera step — `videoRef.current` is
   * null and the assignment there is a no-op. A second later `beginSession`
   * mounts a fresh <video> that nobody has handed a stream to.
   *
   * Keyed on `step` because that is what mounts the element. Re-running is
   * harmless: it bails when the element already has this exact stream.
   */
  React.useEffect(() => {
    const video = videoRef.current
    const stream = streamRef.current
    if (!video || !stream || video.srcObject === stream) return

    video.srcObject = stream
    // Autoplay is declared on the element, but a source attached after mount
    // doesn't always start on its own. A rejection here is a browser policy
    // decision, not something the demo can act on.
    void video.play().catch(() => undefined)
  }, [step, videoRef])

  // Illustrative vitals drift while the session is live.
  React.useEffect(() => {
    if (step !== "session") return

    const timer = window.setInterval(() => {
      setMetrics((prev) => ({
        ...prev,
        hr: 70 + Math.floor(Math.random() * 6),
        hrv: 46 + Math.floor(Math.random() * 6),
      }))
      setGaze(GAZE_STATES[Math.floor(Math.random() * GAZE_STATES.length)])
    }, 2000)

    return () => window.clearInterval(timer)
  }, [step])

  const toggleConsent = (id: string) => {
    setConsents((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  const toggleAllConsent = () => {
    const next = !allConsented
    setConsents(
      Object.fromEntries(consentStatements.map((item) => [item.id, next]))
    )
  }

  /**
   * Claims the next message id. Must be called outside the state updater —
   * batched updaters all run after the increments, so reading the ref inside
   * one would hand the same id to several messages.
   */
  const nextMessageId = () => {
    messageId.current += 1
    return messageId.current
  }

  const pushMessage = (message: Omit<ChatMessage, "id">) => {
    const id = nextMessageId()
    setMessages((prev) => [...prev, { ...message, id }])
  }

  const replacePending = (text: string) => {
    const id = nextMessageId()
    setMessages((prev) => [
      ...prev.filter((m) => !m.pending),
      { id, sender: "ai" as const, text },
    ])
  }

  const startQuestioning = async () => {
    setMessages([
      {
        id: nextMessageId(),
        sender: "ai",
        text: "Generating question…",
        pending: true,
      },
    ])

    const answer = await callModel(
      "You are an AI interviewer for a Senior Backend Engineer role. Ask one concise, role-aware question at a time. Do not include any preamble, just the question.",
      "Start the interview."
    )

    replacePending(answer ?? fallbackQuestions[0])
  }

  const beginSession = () => {
    setStep("session")
    void startQuestioning()
  }

  const startCamera = async () => {
    setRequesting(true)
    setCameraError(null)
    setCameraStatus("Requesting camera and microphone permission…")

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("BrowserNotSupported")
      }
      if (!window.isSecureContext) {
        throw new Error("InsecureConnection")
      }

      // Probe for permission first so device labels are populated.
      const probe = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      })
      const available = await navigator.mediaDevices.enumerateDevices()
      probe.getTracks().forEach((track) => track.stop())

      const cameras = available.filter((d) => d.kind === "videoinput")
      const microphones = available.filter((d) => d.kind === "audioinput")

      if (cameras.length > 1 || microphones.length > 1) {
        setDevices({ cameras, microphones })
      }

      setCameraStatus("Access granted. Starting session…")

      const stream = await navigator.mediaDevices.getUserMedia({
        video: selectedCamera ? { deviceId: { exact: selectedCamera } } : true,
        audio: selectedMic ? { deviceId: { exact: selectedMic } } : true,
      })

      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
      }

      window.setTimeout(beginSession, 1000)
    } catch (error) {
      setCameraStatus("Camera access failed.")
      setCameraError(describeCameraError(error))
    } finally {
      setRequesting(false)
    }
  }

  const useDemoVideo = () => {
    stopStream()
    setDemoMode(true)
    setCameraError(null)
    setCameraStatus("Using demo mode. Starting session…")
    window.setTimeout(beginSession, 1000)
  }

  /** Derives illustrative signal movement from the candidate's answer. */
  const applyHeuristicMetrics = (text: string) => {
    const length = text.length
    const words = text.trim().split(/\s+/).length
    const contribution = Math.min(
      20,
      Math.floor(words / 8) + Math.floor(length / 40)
    )
    compositeRef.current = Math.min(100, compositeRef.current + contribution)

    setMetrics({
      attention: 88 + Math.floor(Math.random() * 10),
      confidence: Math.min(100, 55 + Math.floor(words / 3)),
      engagement: Math.min(100, 60 + Math.floor(length / 15)),
      stress: Math.max(10, 30 - Math.floor(words / 10)),
      hr: 68 + Math.floor(Math.random() * 8),
      hrv: 44 + Math.floor(Math.random() * 8),
      risk: Math.max(8, 15 - Math.floor(words / 20)),
      composite: compositeRef.current,
    })
  }

  const finish = () => {
    stopStream()
    setStep("summary")
  }

  const submitAnswer = async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || awaitingModel) return

    pushMessage({ sender: "candidate", text: trimmed })
    setAwaitingModel(true)
    pushMessage({ sender: "ai", text: "Analyzing response…", pending: true })

    const raw = await callModel(
      'You are evaluating a candidate\'s response for a Senior Backend Engineer role. Provide a JSON object with two keys: "next_question" (a string with the next question) and "confidence" (a number 0-100 representing the candidate\'s confidence). If the interview is over (after 5 questions), set "next_question" to "END".',
      `Candidate response: "${trimmed}"`
    )

    let handled = false

    if (raw) {
      try {
        const parsed = JSON.parse(raw) as {
          next_question?: string
          confidence?: number
        }
        const confidence = parsed.confidence ?? 70
        compositeRef.current = Math.min(
          100,
          compositeRef.current + Math.floor(confidence / 5)
        )
        setMetrics((prev) => ({
          ...prev,
          confidence,
          composite: compositeRef.current,
        }))

        if (
          parsed.next_question === "END" ||
          questionIndex >= TOTAL_QUESTIONS - 1
        ) {
          setMessages((prev) => prev.filter((m) => !m.pending))
          finish()
        } else {
          replacePending(
            parsed.next_question ?? fallbackQuestions[questionIndex + 1]
          )
          setQuestionIndex((i) => i + 1)
        }
        handled = true
      } catch {
        handled = false
      }
    }

    if (!handled) {
      // No model available — fall back to the scripted question set.
      applyHeuristicMetrics(trimmed)
      const nextIndex = questionIndex + 1
      setQuestionIndex(nextIndex)

      if (nextIndex < fallbackQuestions.length) {
        replacePending(fallbackQuestions[nextIndex])
      } else {
        setMessages((prev) => prev.filter((m) => !m.pending))
        finish()
      }
    }

    setAwaitingModel(false)
  }

  const summary = {
    composite: metrics.composite,
    risk: Math.max(12, 25 - Math.floor(metrics.composite / 5)),
    fit: Math.min(99, 70 + Math.floor(metrics.composite / 4)),
  }

  return {
    step,
    setStep,
    consents,
    allConsented,
    toggleConsent,
    toggleAllConsent,
    cameraStatus,
    cameraError,
    requesting,
    devices,
    selectedCamera,
    setSelectedCamera,
    selectedMic,
    setSelectedMic,
    demoMode,
    startCamera,
    useDemoVideo,
    messages,
    questionIndex,
    totalQuestions: TOTAL_QUESTIONS,
    awaitingModel,
    submitAnswer,
    metrics,
    gaze,
    summary,
    stopStream,
  }
}
