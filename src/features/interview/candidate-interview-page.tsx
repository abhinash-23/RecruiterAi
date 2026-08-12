import * as React from "react"

import { ConfirmDialog } from "@/components/shared/confirm-dialog"
import { useThemedLogo } from "@/components/shared/use-themed-logo"
import { usePublicBranding } from "@/services/admin"
import {
  finishInterview,
  fullQuestionText,
  parseInterviewLink,
  resendOtp,
  submitAnswer,
  submitConsent,
  verifyOtp,
  type CandidateSession,
  type InterviewLinkParams,
} from "@/services/interview"

import { InterviewRoom } from "./interview-room"
import { CameraScreen } from "./screens/camera-screen"
import { CodeScreen } from "./screens/code-screen"
import { ConsentScreen } from "./screens/consent-screen"
import { LoadingScreen, PreparingCard, SubmittingCard } from "./screens/shell"
import {
  ClosedScreen,
  DoneScreen,
  IncompleteLinkScreen,
} from "./screens/status-screens"
import type { TranscriptEntry } from "./transcript"
import { useMediaStream } from "./use-media-stream"
import { useProctoring } from "./use-proctoring"
import { useRecording } from "./use-recording"
import { useCountdown, useSittingLifecycle } from "./use-sitting-lifecycle"
import { useVitalsSampler } from "./use-vitals-sampler"
import { useVoiceAnswers, type Outgoing } from "./use-voice-answers"

type Stage = "code" | "consent" | "camera" | "sitting" | "done" | "dead"

/** The in-flight action, so each button can show its own spinner. */
/**
 * Which action is in flight. `finish` is separate from `submit` because it is a
 * different event for the candidate — the sitting ending rather than an answer
 * going — and it is the one that takes long enough to need saying so.
 */
type Action = "verify" | "resend" | "submit" | "finish"

let entrySeq = 0
function makeEntry(
  speaker: TranscriptEntry["speaker"],
  text: string
): TranscriptEntry {
  entrySeq += 1
  return { id: `e${entrySeq}`, speaker, text, at: Date.now() }
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
 *
 * **What lives where.** This file owns the stage machine, the answer flow and
 * the transcript. Everything with a life of its own has been lifted out:
 *
 *   `screens/`               the cards shown before the room
 *   `use-voice-answers`      the host's voice, the candidate's, and matching
 *   `use-vitals-sampler`     webcam frames, and the face-lost hold
 *   `use-sitting-lifecycle`  keep-alive, abandonment beacon, the clock
 *   `use-proctoring`         fullscreen and tab switching
 *   `use-recording`          the video, streamed over its own socket
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

  const sitting = stage === "sitting"
  const videoRef = React.useRef<HTMLVideoElement | null>(null)

  /**
   * Fullscreen and tab-switch tracking, live only while they're actually
   * sitting — waiting-room time in a background tab is not a tab switch.
   */
  const proctoring = useProctoring(sitting)
  // Pulled out because the vitals sampler depends on it: the hook's return
  // object is rebuilt every render, so depending on `proctoring` would tear down
  // and restart the frame sampler on every tick of the clock.
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

  const recording = useRecording({
    stream: media.stream,
    token: session?.candidateToken ?? null,
    interviewId: session?.interviewId ?? null,
  })

  const question = session?.questions[position]

  const { faceLost } = useVitalsSampler({
    active: sitting,
    session,
    stream: media.stream,
    videoRef,
    readTabSwitches,
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

  /* ---------------------------------------------------------- lifecycle -- */

  useSittingLifecycle({
    active: sitting,
    session,
    onClosed: (reason) => {
      setStage("dead")
      setError(reason)
    },
  })

  useCountdown({ active: sitting, paused: faceLost, setSecondsLeft })

  /* -------------------------------------------------------------- camera - */

  // Attach the stream once the <video> exists. Doing it in a ref callback would
  // fire before the room has mounted on the first render.
  React.useEffect(() => {
    if (videoRef.current && media.stream) {
      videoRef.current.srcObject = media.stream
    }
  }, [media.stream, stage])

  /* ----------------------------------------------------- video recording - */

  // Started from an effect, not from `beginSitting`: the stream is React state
  // and is still null in the tick that requests it. Best-effort throughout — a
  // deployment with no recording storage simply doesn't record, and that must
  // never stop someone sitting their interview.
  //
  // On the **camera** stage, not `sitting`: "recorded from start to end" is
  // decided here, and consent plus a granted camera is the moment the contract
  // names. It also means the minute someone spends adjusting their webcam is on
  // the recording, which is the point — the alternative is a video that begins
  // after whatever happened in the waiting room.
  const startRecording = recording.start
  const canRecord = stage === "camera" || sitting
  React.useEffect(() => {
    if (!canRecord || !media.stream) return
    startRecording()
  }, [canRecord, media.stream, startRecording])

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
        ...(first ? [makeEntry("host", fullQuestionText(first))] : []),
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
    // Whatever action brought us here, from this point the candidate is waiting
    // on the sitting to be submitted — and `send` arrives here still holding
    // "submit" from the answer it was sending a moment ago.
    setBusy("finish")

    /* `voice` is declared *below* this, and that is deliberate rather than
       sloppy: the three depend on each other in a cycle — `voice` needs `send`,
       `send` needs `finishSitting`, `finishSitting` needs `voice`. Closures
       capture the binding rather than the value, so this resolves fine as long
       as nothing calls it during the render pass that creates them. Nothing
       does; `useVoiceAnswers` only reaches `send` from events and effects. */
    // The mic is opened once and stays open across every question, so it is
    // still live here — and the browser's in-use indicator with it.
    voice.silence()

    // Before `finish`: this flushes the tail of the video and sends the `stop`
    // that seals the recording and links it to the interview, so the recruiter's
    // report has something to play. Bounded and best-effort inside the hook — it
    // can delay this by a few seconds, never fail it.
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
        if (next) say(fullQuestionText(next))
        return
      }

      await finishSitting(session)
    })

  const voice = useVoiceAnswers({
    active: sitting,
    session,
    question,
    faceLost,
    stream: media.stream,
    answerRef,
    putAnswer,
    send,
    run,
    setError,
    setNotice,
  })

  /*
   * There is **no live-view publisher here any more**, and this tab now holds
   * exactly one media socket: the recording stream.
   *
   * It used to publish the camera over WebRTC to any watching recruiter, and
   * relay the current question, the answers and the latest vitals reading beside
   * it on a data channel. All of it is gone: the backend now fans the recording
   * bytes out to viewers itself (`WSS /api/live-relay/{id}`), so a peer
   * connection that could never form on a corporate network is no longer between
   * a recruiter and the picture. The recruiter's vitals come from their own
   * polled read of `/vitals/report/{session_id}`.
   *
   * What that leaves the candidate's machine is the point: no `RTCPeerConnection`
   * per viewer, no ICE gathering, no second encode of the same camera — during a
   * sitting that is also recording, sampling frames and running a speech
   * recogniser.
   */

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

  if (!link) return <IncompleteLinkScreen logoUrl={logoUrl} />

  if (stage === "dead") return <ClosedScreen reason={error} />

  if (stage === "done") {
    return <DoneScreen logoUrl={logoUrl} role={link.role} />
  }

  if (stage === "code") {
    // Takes over the whole card rather than sitting in the button: this is a
    // ~minute of question generation, not a round trip.
    if (busy === "verify") {
      return <PreparingCard logoUrl={logoUrl} role={link.role || "interview"} />
    }

    return (
      <CodeScreen
        logoUrl={logoUrl}
        name={link.name}
        role={link.role}
        otp={otp}
        onOtpChange={setOtp}
        onVerify={() => void verify()}
        onResend={() => void sendFreshCode()}
        // "verify" took over the whole card above, so a resend is the only thing
        // that can still be in flight by the time this renders.
        busy={busy === "resend" ? "resend" : null}
        notice={notice}
        error={error}
      />
    )
  }

  if (stage === "consent") {
    return (
      <ConsentScreen
        logoUrl={logoUrl}
        onDecide={(given) => void consent(given)}
        busy={Boolean(busy)}
        error={error}
      />
    )
  }

  if (stage === "camera") {
    return (
      <CameraScreen
        logoUrl={logoUrl}
        onStart={() => void beginSitting()}
        busy={Boolean(busy)}
        mediaError={media.error}
        error={error}
      />
    )
  }

  if (!session || !question) return <LoadingScreen logoUrl={logoUrl} />

  // Takes over the whole screen, for the same reason `verify` does: sealing the
  // recording and scoring every answer runs for seconds, and the room behind it
  // is answerable to nothing by then. The room's own card covers the *answer*
  // submits, which are a moment and shouldn't move anything.
  if (busy === "finish") {
    return (
      <SubmittingCard
        logoUrl={logoUrl}
        answered={position}
        total={session.questions.length}
      />
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
        recording={voice.listening}
        onToggleRecording={voice.toggleRecording}
        voiceSupported={voice.supported}
        videoRecording={recording.recording}
        liveTranscript={voice.liveTranscript}
        logoUrl={logoUrl}
        hostSpeaking={voice.hostSpeaking}
        hostMuted={voice.hostMuted}
        onToggleHostMuted={voice.toggleHostMuted}
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
