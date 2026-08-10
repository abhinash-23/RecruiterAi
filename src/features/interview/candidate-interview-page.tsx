import * as React from "react"
import { AlertTriangle, ArrowRight, CheckCircle2, Loader2 } from "lucide-react"

import { ApiImage } from "@/components/shared/api-image"
import { ConfirmDialog } from "@/components/shared/confirm-dialog"
import { useThemedLogo } from "@/components/shared/use-themed-logo"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { usePublicBranding } from "@/services/admin"
import {
  finishInterview,
  heartbeat,
  initVitals,
  parseInterviewLink,
  reportInterviewClosed,
  resendOtp,
  sendVitalsFrame,
  speechToText,
  submitAnswer,
  submitConsent,
  submitVoiceAnswer,
  verifyOtp,
  type CandidateSession,
  type InterviewLinkParams,
} from "@/services/interview"
import { useLivePublish, type LiveExchange, type LiveInsight } from "@/services/live"

import { InterviewRoom } from "./interview-room"
import { matchSpokenChoice, stripSendCommand } from "./match-spoken-option"
import type { TranscriptEntry } from "./transcript"
import { useDictation, type HeardWords } from "./use-dictation"
import { captureFrame, useMediaStream } from "./use-media-stream"
import { useProctoring } from "./use-proctoring"
import { useRecording } from "./use-recording"
import { useSpeech, useVoiceRecorder } from "./use-speech"

type Stage = "code" | "consent" | "camera" | "sitting" | "done" | "dead"

/** The in-flight action, so each button can show its own spinner. */
type Action = "verify" | "resend" | "submit"

/**
 * An answer on its way out, when the caller can't rely on the `answer` state.
 *
 * The voice paths match an option and submit it in the same tick, and `answer`
 * at that point still holds the value from before the match — so they say what
 * they mean instead. `scored` is the one kind that is *already* answered:
 * `submit-answer-voice` transcribes and scores in a single call, and submitting
 * it again would double-answer the question.
 */
type Outgoing =
  | { kind: "option"; index: number }
  | { kind: "text"; text: string }
  | { kind: "scored"; text: string }

/** The API expects a keep-alive about twice a minute. */
const HEARTBEAT_MS = 30_000
/** Vitals need a steady trickle of frames, not a flood. */
const VITALS_FRAME_MS = 3000
/*
 * There is no proctoring flush timer. The tab-switch total is cumulative and
 * rides on calls already being made — every vitals frame, then `finish-interview`
 * as the authoritative last word — so nothing needs its own schedule, its own
 * retry, or a beacon on the way out.
 */
/**
 * How long the camera may see no face before the sitting is held.
 *
 * Not zero, deliberately. `face_detected` goes false for a turn of the head, a
 * reach for a glass of water, or one badly-lit frame, and halting an interview
 * on a single miss would make the room unusable. Several consecutive misses is
 * a candidate who has left, covered the lens, or is no longer the one sitting
 * it — which is the case worth stopping for.
 */
const FACE_GRACE_MS = 6000

let entrySeq = 0
function makeEntry(
  speaker: TranscriptEntry["speaker"],
  text: string
): TranscriptEntry {
  entrySeq += 1
  return { id: `e${entrySeq}`, speaker, text, at: Date.now() }
}

/** Centred card used by every step before the room itself. */
function Shell({
  title,
  description,
  children,
  footer,
  logoUrl,
}: {
  title: string
  description?: string
  children?: React.ReactNode
  footer?: React.ReactNode
  /** The hiring company's logo, when their branding has one. */
  logoUrl?: string | null
}) {
  return (
    <div className="flex min-h-svh items-center justify-center bg-muted/30 p-6">
      <Card className="w-full max-w-lg">
        {/* Above the title on every step before the room, so the candidate sees
            whose process this is from the first screen. */}
        {logoUrl ? (
          <div className="px-6">
            <ApiImage
              src={logoUrl}
              alt="Company logo"
              className="h-8 w-auto max-w-44 object-contain"
            />
          </div>
        ) : null}
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </CardHeader>
        {children ? <CardContent>{children}</CardContent> : null}
        {footer ? (
          <CardFooter className="justify-end gap-2">{footer}</CardFooter>
        ) : null}
      </Card>
    </div>
  )
}

/**
 * What the candidate sees while `verify-otp` is in flight.
 *
 * That call is not a code check — it is where the server writes the whole
 * question set, and it routinely runs for the better part of a minute. A spinner
 * inside the Start button leaves the form on screen looking as though nothing
 * happened, and a candidate who presses it again, or reloads, loses the sitting.
 * So the card becomes the wait: it says what is being built, and that it is
 * theirs to leave alone.
 */
function PreparingCard({
  logoUrl,
  role,
}: {
  logoUrl: string | null
  role: string
}) {
  // Only for the reassurance line. Deliberately not a progress bar: the server
  // reports no progress, and a bar that invents one is a lie that also stalls
  // visibly at 90%.
  const [seconds, setSeconds] = React.useState(0)
  React.useEffect(() => {
    const timer = window.setInterval(() => setSeconds((n) => n + 1), 1000)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <Shell
      logoUrl={logoUrl}
      title="Preparing your interview"
      description={`Your questions are being written for the ${role} role. This usually takes under a minute.`}
    >
      <div className="flex items-center gap-3 rounded-xl border p-4">
        <Loader2 className="size-5 shrink-0 animate-spin text-brand-blue" />
        <div className="min-w-0">
          <p className="text-sm font-medium">
            {seconds < 30
              ? "Building your question set…"
              : "Still working — this one's taking longer than usual."}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Keep this tab open. It starts on its own when it&rsquo;s ready —
            there&rsquo;s nothing else to press.
          </p>
        </div>
      </div>
    </Shell>
  )
}

/**
 * The candidate's whole sitting.
 *
 *   code → consent → camera → room → finished
 *
 * No login and no account: the invitation link carries the interview id and
 * email, a 6-digit code proves identity, and the resulting *candidate token*
 * lives in component state only. It is deliberately never written to the app's
 * auth session — a candidate is not a user, and the token is refused on every
 * staff endpoint anyway.
 *
 * Several failures are terminal by design (link opened in a second tab,
 * expired, consent already refused), so they end at a dead-end screen instead of
 * offering a retry that cannot work.
 */
export function CandidateInterviewPage() {
  const [link] = React.useState<InterviewLinkParams | null>(() =>
    parseInterviewLink()
  )

  const [stage, setStage] = React.useState<Stage>("code")
  const [error, setError] = React.useState<string | null>(null)
  const [notice, setNotice] = React.useState<string | null>(null)
  /** Which action is in flight, so only its own button shows a spinner. */
  const [busy, setBusy] = React.useState<Action | null>(null)

  const [otp, setOtp] = React.useState("")
  const [session, setSession] = React.useState<CandidateSession | null>(null)
  const [position, setPosition] = React.useState(0)
  const [answer, setAnswer] = React.useState("")
  /**
   * The same value, readable and writable *between* renders.
   *
   * Dictation delivers an answer a few words at a time, several updates inside
   * one render, and each one has to build on the last. Reading `answer` there
   * reads whatever it was when the render began, so the words pile up on a stale
   * base and only the final fragment survives.
   */
  const answerRef = React.useRef("")
  /** The only way the answer is ever set, so the two can't drift apart. */
  const putAnswer = (next: string) => {
    answerRef.current = next
    setAnswer(next)
  }
  const [transcript, setTranscript] = React.useState<TranscriptEntry[]>([])
  const [secondsLeft, setSecondsLeft] = React.useState(0)
  const [confirmEnd, setConfirmEnd] = React.useState(false)

  /**
   * What has been asked and answered, and the latest vitals frame reading —
   * kept only to publish to a watching recruiter. The candidate's own screen
   * shows the conversation through `transcript` instead.
   */
  const [exchanges, setExchanges] = React.useState<LiveExchange[]>([])
  const [liveVitals, setLiveVitals] = React.useState<Record<
    string,
    unknown
  > | null>(null)

  /**
   * True once the camera has reported no face for longer than the grace period.
   *
   * While it holds, the sitting does not advance: the question is covered, the
   * answer controls are dead, the microphone is closed and the clock stops. An
   * interview answered by someone the camera can't see isn't evidence of
   * anything.
   */
  const [faceLost, setFaceLost] = React.useState(false)
  /** When the current run of face-less frames began; null while a face is seen. */
  const faceLostSinceRef = React.useRef<number | null>(null)

  /**
   * Fullscreen and tab-switch tracking, live only while they're actually
   * sitting — waiting-room time in a background tab is not a tab switch.
   */
  const proctoring = useProctoring(stage === "sitting")
  // Pulled out because the vitals effect depends on it: the hook's return object
  // is rebuilt every render, so depending on `proctoring` would tear down and
  // restart the frame sampler on every tick of the clock. `readTabSwitches` is
  // stable.
  const { readTabSwitches } = proctoring

  // Public branding, resolved from the interview id in the link — no token and
  // no company slug, which is the only way a candidate page can know whose
  // interview this is. Failure just means the product's own mark.
  const branding = usePublicBranding(
    { interview: link?.interviewId },
    Boolean(link?.interviewId)
  )
  // The candidate's screens honour the theme too: they run in the same shell,
  // and a logo drawn for a dark background vanishes into a light one.
  const logoUrl = useThemedLogo(branding.data)

  const media = useMediaStream()
  const speech = useSpeech()

  /**
   * Voice control lives in `handleHeard`, far below — it needs the current
   * question, which doesn't exist yet. This forwards to whichever version of it
   * belongs to the latest render.
   */
  const heardRef = React.useRef<(heard: HeardWords) => void>(() => {})
  const dictation = useDictation(
    "en-IN",
    React.useCallback((heard: HeardWords) => heardRef.current(heard), [])
  )
  // Pulled out here because the callbacks are stable and several effects below
  // depend on them; the `dictation` object itself is rebuilt every render, and
  // depending on that re-runs those effects on every tick of the clock.
  const { setDeaf, deafenFor, consume, reset: resetHeard } = dictation
  const recorder = useVoiceRecorder(media.stream)
  const videoRef = React.useRef<HTMLVideoElement | null>(null)

  const recording = useRecording({
    stream: media.stream,
    token: session?.candidateToken ?? null,
    interviewId: session?.interviewId ?? null,
  })

  const question = session?.questions[position]

  /**
   * What a watching recruiter sees. Memoised so its identity changes only when
   * the content does — the hook broadcasts on every change, and the clock
   * re-renders this component once a second.
   */
  const insight = React.useMemo<Omit<LiveInsight, "at">>(
    () => ({
      candidateName: session?.candidateName ?? "",
      role: session?.role ?? "",
      position: position + 1,
      totalQuestions: session?.questions.length ?? 0,
      currentQuestion: question?.question ?? null,
      currentRound: question?.roundName ?? null,
      secondsLeft,
      exchanges,
      vitals: liveVitals,
    }),
    [session, position, question, secondsLeft, exchanges, liveVitals]
  )

  // Publishes the camera to any recruiter watching, once the sitting is under
  // way — never before, because the consent screen comes first and it is where
  // the candidate is told this can happen. Entirely best-effort: see the hook.
  useLivePublish({
    stream: media.stream,
    token: session?.candidateToken ?? null,
    interviewId: session?.interviewId ?? null,
    enabled: stage === "sitting",
    insight,
  })

  /* ------------------------------------------------------------- helpers - */

  const say = (text: string) =>
    setTranscript((current) => [...current, makeEntry("host", text)])

  /**
   * Runs one action, tracking which one so a spinner lands on the button that
   * was actually pressed. "Send me a fresh code" used to put "Checking…" on the
   * Start button, which reads as though the code had been submitted.
   */
  const run = async (work: () => Promise<void>, action: Action = "submit") => {
    setBusy(action)
    setError(null)
    setNotice(null)
    try {
      await work()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong.")
    } finally {
      setBusy(null)
    }
  }

  /* -------------------------------------------------------------- camera - */

  // Attach the stream once the <video> exists. Doing it in a ref callback would
  // fire before the room has mounted on the first render.
  React.useEffect(() => {
    if (videoRef.current && media.stream) {
      videoRef.current.srcObject = media.stream
    }
  }, [media.stream, stage])

  /* ---------------------------------------------------------- keep-alive - */

  React.useEffect(() => {
    if (stage !== "sitting" || !session) return

    const timer = window.setInterval(() => {
      void heartbeat(session.candidateToken, {
        sessionId: session.sessionId,
        interviewId: session.interviewId,
      })
        .then((result) => {
          if (!result.active) {
            setStage("dead")
            setError(
              "This session was closed by the server. Contact the recruiter to reopen it."
            )
          }
        })
        // A single dropped heartbeat isn't fatal — the next one may land.
        .catch(() => undefined)
    }, HEARTBEAT_MS)

    return () => window.clearInterval(timer)
  }, [stage, session])

  /* -------------------------------------------------------------- timer -- */

  React.useEffect(() => {
    // Held while the camera can't see them. They can't answer during that time,
    // so charging them for it would punish a candidate for a webcam that
    // slipped — and the hold is what stops this being a way to buy thinking
    // time, since nothing can be submitted either.
    //
    // Leaving fullscreen deliberately does *not* hold the clock: it is recorded
    // for the recruiter and otherwise ignored, so someone who drops out
    // mid-answer just carries on.
    if (stage !== "sitting" || faceLost) return

    const timer = window.setInterval(() => {
      setSecondsLeft((current) => (current > 0 ? current - 1 : 0))
    }, 1000)

    return () => window.clearInterval(timer)
  }, [stage, faceLost])

  /* ------------------------------------------------------------- vitals -- */

  React.useEffect(() => {
    if (stage !== "sitting" || !session || !media.stream) return

    // Best-effort throughout: vitals are a nice-to-have signal for the
    // recruiter, never a reason to interrupt someone's interview.
    void initVitals(session.candidateToken, {
      sessionId: session.sessionId,
    }).catch(() => undefined)

    const timer = window.setInterval(() => {
      const frame = captureFrame(videoRef.current)
      if (!frame) return
      void sendVitalsFrame(session.candidateToken, {
        sessionId: session.sessionId,
        frameBase64: frame,
        timestampMs: Date.now(),
        // Read from the ref, not from render state: this closure is captured
        // when the interval is created and would otherwise ship the count as it
        // stood at the start of the sitting, forever.
        tabSwitchCount: readTabSwitches(),
      })
        // Kept so a watching recruiter gets the reading the candidate's own
        // frame already produced, rather than the server being asked twice.
        .then((reading) => {
          setLiveVitals(reading.raw)

          if (reading.faceDetected) {
            faceLostSinceRef.current = null
            setFaceLost(false)
            return
          }

          const since = faceLostSinceRef.current ?? Date.now()
          faceLostSinceRef.current = since
          if (Date.now() - since >= FACE_GRACE_MS) setFaceLost(true)
        })
        // A failed frame is *not* a missing face. The endpoint is best-effort
        // and a network blip must never be read as the candidate leaving —
        // holding an interview over a 500 is the worse failure by far.
        .catch(() => undefined)
    }, VITALS_FRAME_MS)

    return () => {
      window.clearInterval(timer)
      // Whatever comes next starts from "we can see them", so a stale run of
      // misses can't hold the room the moment vitals resume.
      faceLostSinceRef.current = null
      setFaceLost(false)
    }
  }, [stage, session, media.stream, readTabSwitches])

  /* ----------------------------------------------------- video recording - */

  // Started from an effect, not from `beginSitting`: the stream is React state
  // and is still null in the tick that requests it. Best-effort throughout — a
  // deployment with no recording storage simply doesn't record, and that must
  // never stop someone sitting their interview.
  const startRecording = recording.start
  React.useEffect(() => {
    if (stage !== "sitting" || !media.stream) return
    void startRecording()
  }, [stage, media.stream, startRecording])

  /* ------------------------------------------- read each question aloud -- */

  // Only speaks; the transcript entry is pushed by whatever advanced the
  // question, so this effect never has to write state React is rendering from.
  //
  // Depends on `speech.speak` — a stable callback — and NOT on the `speech`
  // object, which is rebuilt every render. Depending on the object re-ran this
  // effect on each render, and since the clock re-renders once a second, every
  // utterance was cancelled and restarted a second in: the host never got past
  // the first word of a question.
  const { speak } = speech
  React.useEffect(() => {
    if (stage !== "sitting" || !question) return

    const spoken = question.options.length
      ? `${question.question} Your options are: ${question.options
          .map((option, index) => `${String.fromCharCode(65 + index)}. ${option}`)
          .join(". ")}`
      : question.question

    // A new question starts from silence. The mic is open across the whole
    // sitting, so without this the words that answered the last question are
    // still in the buffer and would answer this one too — and the recogniser is
    // still settling the tail of them, which is what the window covers.
    resetHeard()
    deafenFor(1200)
    speak(spoken)
  }, [stage, question, speak, resetHeard, deafenFor])

  /* --------------------------------------------------- abandonment beacon */

  React.useEffect(() => {
    if (stage !== "sitting" || !session) return

    const onHide = () =>
      reportInterviewClosed({
        sessionId: session.sessionId,
        interviewId: session.interviewId,
        reason: "pagehide",
      })

    window.addEventListener("pagehide", onHide)
    return () => window.removeEventListener("pagehide", onHide)
  }, [stage, session])

  /* ------------------------------------------------------------ actions - */

  const verify = () =>
    run(async () => {
      if (!link) return
      const next = await verifyOtp({
        interviewId: link.interviewId,
        email: link.email,
        otp,
      })
      setSession(next)
      setSecondsLeft(next.timeMinutes * 60)
      setStage("consent")
    }, "verify")

  const sendFreshCode = () =>
    run(async () => {
      if (!link) return
      const result = await resendOtp({
        interviewId: link.interviewId,
        email: link.email,
      })
      setNotice(
        result.emailSent
          ? "A fresh code is on its way to your inbox."
          : result.message
      )
    }, "resend")

  const consent = (given: boolean) =>
    run(async () => {
      if (!session || !link) return
      await submitConsent(session.candidateToken, {
        interviewId: session.interviewId,
        candidateEmail: link.email,
        consentGiven: given,
      })

      if (!given) {
        setStage("dead")
        setError(
          "You declined to continue. This interview is now closed and the recruiter has been notified."
        )
        return
      }
      setStage("camera")
    })

  const beginSitting = () => {
    /* Fired here rather than inside `run`, and before any `await`: a
       `requestFullscreen` is only granted while a user gesture is still being
       processed, and the first await in the async body ends that window. This
       call sits directly in the click handler's synchronous path, which is the
       only place the browser reliably honours it. Its own failure is swallowed
       inside the hook — a browser that refuses fullscreen must not stop someone
       sitting their interview. */
    void proctoring.enter()

    return run(async () => {
      if (!session) return
      await media.request()

      const first = session.questions[0]
      setTranscript([
        makeEntry(
          "host",
          `Hello ${session.candidateName}, welcome to your interview for the ${session.role} position. There are ${session.totalQuestions} questions across ${Math.max(1, session.totalRounds)} rounds. Let's begin.`
        ),
        ...(first ? [makeEntry("host", first.question)] : []),
      ])
      setStage("sitting")
    })
  }

  /**
   * Closes the sitting properly: flushes the recording, then
   * `POST /api/finish-interview`, which scores what was answered and returns
   * the report.
   *
   * Used by the last question **and** by "End interview". The alternative —
   * `interview-closed` — marks the sitting *abandoned*, which is right for a
   * tab that vanished and wrong for someone who deliberately stopped: it
   * throws away answers the server has already scored.
   */
  const finishSitting = async (current: CandidateSession) => {
    speech.cancel()
    // The mic is opened once and stays open across every question, so it is
    // still live here — and the browser's in-use indicator with it.
    void dictation.stop()

    // Before `finish`: this flushes the tail of the video, finalises the
    // upload and links it to the interview, so the recruiter's report has a
    // recording to play. Failures are swallowed inside the hook.
    await recording.stop()

    // The call still matters — it's what closes the sitting and scores it for
    // the recruiter — but its report is deliberately not shown, so a failure
    // changes nothing the candidate sees. Ending on an error screen would
    // suggest the sitting didn't count, and the link can't be reopened to
    // prove otherwise.
    try {
      /* The authoritative tab-switch total, and always sent — including zero,
         which is what distinguishes "tracked, clean" from "never tracked" on
         the recruiter's report. This is also the only report that lands when
         the camera died earlier and took the frame traffic with it, so any
         switch after the last frame exists nowhere else. */
      await finishInterview(
        current.candidateToken,
        current.sessionId,
        proctoring.readTabSwitches()
      )
    } catch {
      /* already submitted answer by answer; nothing more to do here */
    }

    media.stop()
    setStage("done")
  }

  /**
   * Records the answer, logs it, and moves on — or finishes.
   *
   * With no argument it submits whatever is in `answer`, which is what a click
   * or a keystroke leaves behind. The voice paths pass the answer in explicitly
   * instead: they match an option and submit it in the same tick, and `answer`
   * at that point still holds the value from *before* the match.
   */
  const send = (outgoing?: Outgoing) =>
    run(async () => {
      if (!session || !question) return
      // The controls are disabled while the camera can't see them, but a voice
      // match already in flight when the hold began would otherwise still land.
      // Nothing is submitted for a candidate who isn't on camera.
      if (faceLost) return

      const letter = (index: number) => String.fromCharCode(65 + index)

      // MCQ and Likert answers are the option *index*; open questions send
      // text. Sending the wrong kind scores zero without erroring.
      const value: string | number =
        outgoing?.kind === "option"
          ? outgoing.index
          : outgoing?.kind === "text"
            ? outgoing.text.trim()
            : question.options.length > 0
              ? Number(answer)
              : answer.trim()

      const shown =
        outgoing?.kind === "scored"
          ? outgoing.text
          : typeof value === "number"
            ? `${letter(value)}. ${question.options[value]}`
            : value

      setTranscript((current) => [...current, makeEntry("candidate", shown)])

      // Recorded here because this is the only place that knows *which*
      // question the answer belongs to — the transcript interleaves the host's
      // own filler lines, so pairing it back up afterwards is guesswork.
      setExchanges((current) => [
        ...current,
        {
          questionIndex: question.questionIndex,
          round: question.roundName,
          question: question.question,
          answer: shown,
          at: Date.now(),
        },
      ])

      // `submit-answer-voice` transcribed *and* scored it, so submitting again
      // would double-answer the question.
      if (outgoing?.kind !== "scored") {
        await submitAnswer(session.candidateToken, {
          sessionId: session.sessionId,
          questionIndex: question.questionIndex,
          answer: value,
        })
      }

      putAnswer("")

      if (position + 1 < session.questions.length) {
        const next = session.questions[position + 1]
        setPosition((current) => current + 1)
        say("Got it, thank you.")
        if (next) say(next.question)
        return
      }

      await finishSitting(session)
    })

  /* ------------------------------------------------- live voice control -- */

  /**
   * The microphone stays open across questions, so what it hears has to be acted
   * on *while it is still open* — a candidate saying "select option A" expects
   * that option answered and the next question read out, without touching
   * anything. This is where that happens.
   *
   * Deafness while the host speaks is not optional. The host reads the question
   * **and every option** aloud, so on a laptop's speakers the recogniser hears
   * "A. Strongly Disagree" and would answer the question itself.
   */
  /**
   * Closes the microphone the moment the sitting is held.
   *
   * Not merely disabling the button: the mic is open across every question, so
   * leaving it running would keep transcribing — and the words of someone the
   * camera can't see are exactly what must not become an answer.
   */
  React.useEffect(() => {
    if (!faceLost) return
    speech.cancel()
    void dictation.stop()
    // `dictation.stop` is stable; `speech.cancel` is a stable callback too, but
    // the object around it is rebuilt every render — see the note on the
    // read-aloud effect above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [faceLost])

  React.useEffect(() => {
    setDeaf(speech.speaking)
    // Both edges get a grace window. Starting: `speechSynthesis` cancels the
    // previous utterance before queuing the next, so `speaking` dips false for a
    // moment while the host is audibly still going. Stopping: the recogniser
    // lags the audio, so the host's last few words settle after it has finished.
    deafenFor(500)
  }, [speech.speaking, setDeaf, deafenFor])

  /**
   * Held while an answer is on its way to the server. The recogniser goes on
   * delivering updates while it flies, and without this a single "option B"
   * submits again on the next word heard — answering the question that followed.
   */
  const sendingRef = React.useRef(false)

  /** Submits, holding the latch until the answer is in and the page has moved on. */
  const sendLatched = (outgoing: Outgoing) => {
    sendingRef.current = true
    void send(outgoing).finally(() => {
      sendingRef.current = false
    })
  }

  /**
   * Called by the recogniser every time the words change — not from an effect.
   *
   * A dictated answer arrives a word at a time, and each arrival has to be
   * judged on its own: is this enough to answer, or is the candidate mid-phrase?
   */
  const handleHeard = ({ settled, live }: HeardWords) => {
    if (stage !== "sitting" || !session || !question) return
    if (sendingRef.current) return

    /* ---- multiple choice: act the moment the choice is unambiguous ------ */
    if (question.options.length > 0) {
      // A named letter is safe to act on mid-phrase: "option A" can't turn into
      // some other option. Saying the option's own words has to wait for the
      // recogniser to settle, because "strongly…" is the start of two of them.
      const named = matchSpokenChoice(live, question.options)
      const banked = matchSpokenChoice(settled, question.options)

      const index =
        named?.via === "letter"
          ? named.index
          : banked && banked.via !== "partial"
            ? banked.index
            : null

      if (index === null) return

      resetHeard()
      putAnswer(String(index))
      sendLatched({ kind: "option", index })
      return
    }

    /* ---- open question: words land in the box as they settle ------------ */
    if (!settled) return

    const { body, send: asked } = stripSendCommand(consume())
    // Composed off the ref, not the state: two updates can arrive between
    // renders, and the second would otherwise overwrite the first.
    const next = [answerRef.current.trim(), body].filter(Boolean).join(" ")
    putAnswer(next)

    if (asked && next.trim()) {
      sendLatched({ kind: "text", text: next })
    }
  }

  React.useEffect(() => {
    heardRef.current = handleHeard
  })

  /**
   * Applies a spoken answer captured in one go — the candidate closing the mic
   * themselves, or a browser with no live recogniser at all.
   *
   * A confident match is submitted; a loose one is only *selected*, because on a
   * Likert scale the option next to the right one is the opposite answer and a
   * mishearing must not be scored before the candidate has seen it.
   */
  const applySpoken = (heard: string) => {
    if (!session || !question) return

    if (question.options.length === 0) {
      // Appended, not replaced: a candidate who typed half an answer and then
      // spoke the rest shouldn't lose the half they typed.
      const { body, send: asked } = stripSendCommand(heard)
      const next = [answerRef.current.trim(), body].filter(Boolean).join(" ")
      putAnswer(next)

      if (asked && next.trim()) {
        void send({ kind: "text", text: next })
        return
      }
      setNotice("Transcribed — check it reads right, then send your answer.")
      return
    }

    const match = matchSpokenChoice(heard, question.options)
    if (!match) {
      setError(
        `I heard “${heard}”, which doesn't match an option. Try saying the letter — “option A” — or tap your choice.`
      )
      return
    }

    putAnswer(String(match.index))

    if (match.via === "partial") {
      setNotice(
        `Heard “${heard}” — that looks like option ${String.fromCharCode(65 + match.index)}. Send it, or tap a different option.`
      )
      return
    }

    void send({ kind: "option", index: match.index })
  }

  /**
   * Opens the microphone, or closes it.
   *
   * Opening it is the *only* thing the candidate has to do: it stays open across
   * every remaining question, going deaf while the host reads and picking the
   * answer up again afterwards.
   */
  const toggleRecording = () => {
    if (!session || !question) return

    /* ---- the browser's own recogniser, when it has one ----------------- */
    if (dictation.supported) {
      if (!dictation.listening) {
        // Silence the host first, and clear any stale notice — the mic is open
        // now, so "option B is selected" from the last attempt is misleading.
        speech.cancel()
        setError(null)
        setNotice(null)
        if (!dictation.start()) {
          setError(
            "Your browser wouldn't start the microphone. Check its permission, or type your answer instead."
          )
        }
        return
      }

      // Closing it deliberately. Anything left unconsumed is the tail of an
      // answer, or a choice the live pass wasn't confident enough to act on.
      void (async () => {
        const heard = await dictation.stop()
        if (heard) applySpoken(heard)
      })()
      return
    }

    /* ---- otherwise: record, upload, let the server transcribe ---------- */
    if (!recorder.recording) {
      speech.cancel()
      // `start` returns false when the browser refuses — say so, rather than
      // leaving a button that looks like it simply doesn't work.
      if (!recorder.start()) {
        setError(
          "Your browser wouldn't start the microphone. Check its permission, or type your answer instead."
        )
      }
      return
    }

    void run(async () => {
      const audio = await recorder.stop()
      if (!audio) {
        setError("Nothing was recorded — try again.")
        return
      }

      /* ---- multiple choice: transcribe, then match to an option --------- */
      if (question.options.length > 0) {
        // Deliberately NOT `submit-answer-voice` here. That endpoint scores the
        // sentence as free text, so "option A" is marked against a question
        // whose only right answer is the index 0 — spoken answers scored zero
        // no matter what the candidate said.
        const heard = await speechToText(session.candidateToken, {
          audioBase64: audio,
        })

        if (!heard) {
          setError(
            "That didn't come through clearly. Try again, or choose an option."
          )
          return
        }

        applySpoken(heard)
        return
      }

      /* ---- open question: transcribed and scored in one call ------------ */
      const result = await submitVoiceAnswer(session.candidateToken, {
        sessionId: session.sessionId,
        questionIndex: question.questionIndex,
        audioBase64: audio,
      })

      // A failure to understand speech arrives as HTTP 200 with an empty
      // transcription, not an exception — so check before advancing.
      if (!result.understood) {
        setError(
          "That didn't come through clearly. Try again, or type your answer instead."
        )
        return
      }

      await send({ kind: "scored", text: result.transcription })
    })
  }

  /**
   * "End interview" — submits the sitting as it stands.
   *
   * It used to report the interview *closed*, which the API records as
   * abandonment: the recruiter saw "Abandoned" and no report, even though
   * every answer given had already been scored. Finishing keeps them.
   */
  const endEarly = () =>
    run(async () => {
      if (!session) return
      await finishSitting(session)
    })

  /* ------------------------------------------------------------ screens - */

  if (!link) {
    return (
      <Shell
        logoUrl={logoUrl}
        title="This link isn't complete"
        description="It's missing the interview id, so this page can't tell which interview to open."
      >
        <p className="text-sm text-muted-foreground">
          Reply to your invitation and ask for the link to be sent again. A
          working one contains <span className="font-mono">interview_id</span>{" "}
          in its address — your one-time code is still valid, so nothing has
          been lost.
        </p>
      </Shell>
    )
  }

  if (stage === "dead") {
    return (
      <Shell title="Interview closed" description={error ?? undefined}>
        <p className="text-sm text-muted-foreground">
          If you think this is a mistake, reply to your invitation email and the
          recruiter can issue a new link.
        </p>
      </Shell>
    )
  }

  if (stage === "done") {
    return (
      <Shell
        logoUrl={logoUrl}
        title="Thank you — you're all done"
        description={`Your answers for ${link.role || "this"} Role have been submitted.`}
      >
        {/* No score. `finish-interview` returns one, but a candidate reading
            their own automated mark before a human has looked at the interview
            invites an argument about a number the recruiter may not even act
            on. The result is theirs to deliver. */}
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <CheckCircle2 className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
          The recruiter will be in touch. You can close this tab.
        </div>
      </Shell>
    )
  }

  if (stage === "code") {
    // Takes over the whole card rather than sitting in the button: this is a
    // ~minute of question generation, not a round trip.
    if (busy === "verify") {
      return (
        <PreparingCard logoUrl={logoUrl} role={link.role || "interview"} />
      )
    }

    return (
      <Shell
        logoUrl={logoUrl}
        title={`Hello${link.name ? `, ${link.name}` : ""}`}
        description={`Enter the 6-digit code from your invitation email to start your ${link.role || "interview"}.`}
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => void sendFreshCode()}
              disabled={Boolean(busy)}
            >
              {busy === "resend" ? (
                <>
                  <Loader2 className="animate-spin" />
                  Sending…
                </>
              ) : (
                "Re-Send OTP"
              )}
            </Button>
            {/* No pending state of its own — the whole card is replaced the
                moment this is pressed, so a "Checking…" label here would be
                unreachable. TypeScript says as much if it's left in. */}
            <Button
              onClick={() => void verify()}
              disabled={Boolean(busy) || otp.trim().length < 4}
            >
              Start
              <ArrowRight data-icon="inline-end" />
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="otp">Access code</Label>
            <Input
              id="otp"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={otp}
              onChange={(event) => setOtp(event.target.value)}
              placeholder="123456"
              className="font-mono text-lg tracking-[0.3em]"
            />
          </div>

          {notice ? (
            <p className="text-sm text-emerald-700 dark:text-emerald-400">
              {notice}
            </p>
          ) : null}
          {error ? (
            <p
              role="alert"
              className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {error}
            </p>
          ) : null}
        </div>
      </Shell>
    )
  }

  if (stage === "consent") {
    return (
      <Shell
        logoUrl={logoUrl}
        title="Before we begin"
        description="This interview is recorded and scored automatically."
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => void consent(false)}
              disabled={Boolean(busy)}
            >
              I don&rsquo;t consent
            </Button>
            <Button onClick={() => void consent(true)} disabled={Boolean(busy)}>
              {busy ? "Saving…" : "I consent — continue"}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3 text-sm text-muted-foreground">
          <p>
            Your camera and microphone are used during the interview, and your
            answers are scored by an automated system and shared with the
            recruiting team at the company you applied to.
          </p>
          {/* Required before the publisher side may run: a candidate has to be
              told they can be watched *while* they sit, which is a different
              thing from a recording reviewed afterwards. */}
          <p>A recruiter may view your interview live.</p>
          <p className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-amber-700 dark:text-amber-400">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            Declining ends this interview permanently — the link cannot be
            reused.
          </p>
          {error ? (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          ) : null}
        </div>
      </Shell>
    )
  }

  if (stage === "camera") {
    return (
      <Shell
        logoUrl={logoUrl}
        title="Turn on your camera"
        description="You'll be visible for the whole interview, and the recording is shared with the recruiter."
        footer={
          <Button onClick={() => void beginSitting()} disabled={Boolean(busy)}>
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
          {media.error ? (
            <p
              role="alert"
              className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive"
            >
              {media.error}
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

  if (!session || !question) {
    return (
      <Shell logoUrl={logoUrl} title="Preparing your interview">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </Shell>
    )
  }

  return (
    <>
      <InterviewRoom
        session={session}
        question={question}
        position={position}
        transcript={transcript}
        secondsLeft={secondsLeft}
        videoRef={videoRef}
        cameraOn={media.cameraOn}
        recording={
          dictation.supported ? dictation.listening : recorder.recording
        }
        onToggleRecording={toggleRecording}
        voiceSupported={
          dictation.supported || (recorder.supported && Boolean(media.stream))
        }
        videoRecording={recording.recording}
        liveTranscript={dictation.listening ? dictation.text : null}
        logoUrl={logoUrl}
        hostSpeaking={speech.speaking}
        hostMuted={speech.muted}
        onToggleHostMuted={speech.toggleMuted}
        answer={answer}
        onAnswerChange={putAnswer}
        onSubmit={() => void send()}
        busy={Boolean(busy)}
        error={error}
        notice={notice}
        // The camera being off is the same problem arriving sooner: no frames
        // are sent at all, so `face_detected` never turns false and the hold
        // would never engage.
        faceLost={faceLost || !media.cameraOn}
        // Leaving fullscreen is recorded, not enforced — the sitting carries on
        // either way. The toggle is a convenience, not a gate.
        inFullscreen={proctoring.inFullscreen}
        fullscreenSupported={proctoring.supported}
        onToggleFullscreen={() => void proctoring.toggle()}
        onEnd={() => setConfirmEnd(true)}
      />

      {/* The link dies once the sitting is submitted, so a misclick on "End
          interview" costs the candidate every question they hadn't reached. */}
      <ConfirmDialog
        open={confirmEnd}
        onOpenChange={setConfirmEnd}
        title="End the interview now?"
        description={`You've answered ${position} of ${session.questions.length} questions. What you've answered will be submitted and scored, and the remaining questions will be left blank. This link can't be reopened.`}
        confirmLabel="End and submit"
        onConfirm={() => void endEarly()}
      />
    </>
  )
}
