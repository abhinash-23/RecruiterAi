import * as React from "react"
import { AlertTriangle, ArrowRight, CheckCircle2, Loader2 } from "lucide-react"

import { ApiImage } from "@/components/shared/api-image"
import { ConfirmDialog } from "@/components/shared/confirm-dialog"
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

import { InterviewRoom } from "./interview-room"
import { matchSpokenOption } from "./match-spoken-option"
import type { TranscriptEntry } from "./transcript"
import { useDictation } from "./use-dictation"
import { captureFrame, useMediaStream } from "./use-media-stream"
import { useRecording } from "./use-recording"
import { useSpeech, useVoiceRecorder } from "./use-speech"

type Stage = "code" | "consent" | "camera" | "sitting" | "done" | "dead"

/** The in-flight action, so each button can show its own spinner. */
type Action = "verify" | "resend" | "submit"

/** The API expects a keep-alive about twice a minute. */
const HEARTBEAT_MS = 30_000
/** Vitals need a steady trickle of frames, not a flood. */
const VITALS_FRAME_MS = 3000

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
  const [transcript, setTranscript] = React.useState<TranscriptEntry[]>([])
  const [secondsLeft, setSecondsLeft] = React.useState(0)
  const [confirmEnd, setConfirmEnd] = React.useState(false)

  // Public branding, resolved from the interview id in the link — no token and
  // no company slug, which is the only way a candidate page can know whose
  // interview this is. Failure just means the product's own mark.
  const branding = usePublicBranding(
    { interview: link?.interviewId },
    Boolean(link?.interviewId)
  )
  const logoUrl = branding.data?.logoUrl ?? null

  const media = useMediaStream()
  const speech = useSpeech()
  const dictation = useDictation()
  const recorder = useVoiceRecorder(media.stream)
  const videoRef = React.useRef<HTMLVideoElement | null>(null)

  const recording = useRecording({
    stream: media.stream,
    token: session?.candidateToken ?? null,
    interviewId: session?.interviewId ?? null,
  })

  const question = session?.questions[position]

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
    if (stage !== "sitting") return

    const timer = window.setInterval(() => {
      setSecondsLeft((current) => (current > 0 ? current - 1 : 0))
    }, 1000)

    return () => window.clearInterval(timer)
  }, [stage])

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
      }).catch(() => undefined)
    }, VITALS_FRAME_MS)

    return () => window.clearInterval(timer)
  }, [stage, session, media.stream])

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

    speak(spoken)
  }, [stage, question, speak])

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

  const beginSitting = () =>
    run(async () => {
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
      await finishInterview(current.candidateToken, current.sessionId)
    } catch {
      /* already submitted answer by answer; nothing more to do here */
    }

    media.stop()
    setStage("done")
  }

  /**
   * Records the answer, logs it, and moves on — or finishes.
   *
   * Three ways in, and they differ in *who scored it*:
   *  - clicked option or typed text → submitted here,
   *  - `optionIndex` → a spoken choice already matched to an option, submitted
   *    here as an index like any click,
   *  - `text` alone → `submit-answer-voice` transcribed *and* scored it, so
   *    submitting again would double-answer the question.
   */
  const send = (spoken?: { text: string; optionIndex?: number }) =>
    run(async () => {
      if (!session || !question) return

      const chosen = spoken?.optionIndex
      const letter = (index: number) => String.fromCharCode(65 + index)

      const shown =
        chosen !== undefined
          ? `${letter(chosen)}. ${question.options[chosen]}`
          : spoken
            ? spoken.text
            : question.options.length > 0
              ? `${letter(Number(answer))}. ${question.options[Number(answer)]}`
              : answer.trim()

      setTranscript((current) => [...current, makeEntry("candidate", shown)])

      if (chosen !== undefined) {
        await submitAnswer(session.candidateToken, {
          sessionId: session.sessionId,
          questionIndex: question.questionIndex,
          answer: chosen,
        })
      } else if (!spoken) {
        // MCQ and Likert answers are the option *index*; open questions send
        // text. Sending the wrong kind scores zero without erroring.
        const value =
          question.options.length > 0 ? Number(answer) : answer.trim()

        await submitAnswer(session.candidateToken, {
          sessionId: session.sessionId,
          questionIndex: question.questionIndex,
          answer: value,
        })
      }

      setAnswer("")

      if (position + 1 < session.questions.length) {
        const next = session.questions[position + 1]
        setPosition((current) => current + 1)
        say("Got it, thank you.")
        if (next) say(next.question)
        return
      }

      await finishSitting(session)
    })

  /**
   * Applies a spoken answer.
   *
   * A multiple-choice question is submitted straight away — there's one right
   * shape for the answer and matching it is unambiguous. An open answer is
   * dropped into the box **without** submitting, because a transcript of three
   * technical sentences usually needs a word fixed before it's sent, and the
   * candidate can't fix it after it's gone.
   */
  const applySpoken = async (heard: string) => {
    if (!session || !question) return

    if (question.options.length === 0) {
      setAnswer(heard)
      setNotice("Transcribed — check it reads right, then send your answer.")
      return
    }

    const index = matchSpokenOption(heard, question.options)
    if (index === null) {
      setError(
        `I heard “${heard}”, which doesn't match an option. Try saying the letter — “option A” — or tap your choice.`
      )
      return
    }

    setAnswer(String(index))
    await send({ text: heard, optionIndex: index })
  }

  /** Start listening, or stop and apply what was heard. */
  const toggleRecording = () => {
    if (!session || !question) return

    /* ---- the browser's own recogniser, when it has one ----------------- */
    if (dictation.supported) {
      if (!dictation.listening) {
        speech.cancel()
        if (!dictation.start()) {
          setError(
            "Your browser wouldn't start the microphone. Check its permission, or type your answer instead."
          )
        }
        return
      }

      void run(async () => {
        const heard = await dictation.stop()
        if (!heard) {
          setError(
            "Nothing was heard. Check your microphone, or answer by tapping instead."
          )
          return
        }
        await applySpoken(heard)
      })
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

        await applySpoken(heard)
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

      await send({ text: result.transcription })
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
        description={`Your answers for ${link.role || "this role"} have been submitted.`}
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
                "Send me a fresh code"
              )}
            </Button>
            <Button
              onClick={() => void verify()}
              disabled={Boolean(busy) || otp.trim().length < 4}
            >
              {busy === "verify" ? "Checking…" : "Start"}
              {!busy ? <ArrowRight data-icon="inline-end" /> : null}
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
        onAnswerChange={setAnswer}
        onSubmit={() => void send()}
        busy={Boolean(busy)}
        error={error}
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
