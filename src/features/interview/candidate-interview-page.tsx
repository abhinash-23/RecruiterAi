import * as React from "react"

import { ConfirmDialog } from "@/components/shared/confirm-dialog"
import { useThemedLogo } from "@/components/shared/use-themed-logo"
import { usePublicBranding } from "@/services/admin"
import {
  finishInterview,
  fullQuestionText,
  isAlreadyAnswered,
  isTimeUp,
  parseInterviewLink,
  resendOtp,
  submitAnswer,
  submitConsent,
  TIME_UP,
  verifyOtp,
  type CandidateSession,
  type InterviewLinkParams,
} from "@/services/interview"
import { trace } from "@/services/socket-trace"

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
import { useVoiceInterview, type VoiceHandover } from "./use-voice-interview"
import { VoiceRoom } from "./voice-room"

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
 * **Two interviews, one stage machine.** The sitting is either typed or
 * *spoken*: with `voice_mode` on, the candidate talks to Elena over a WebSocket
 * and the backend does the asking, the hearing and the scoring. Everything
 * around it — the code, consent, the camera, the clock, the recording, vitals,
 * finishing — is identical, so only the room differs, and voice can hand over to
 * the typed room at any moment without the sitting restarting. See `spoken` and
 * `handOver`.
 *
 * **What lives where.** This file owns the stage machine, the answer flow and
 * the transcript. Everything with a life of its own has been lifted out:
 *
 *   `screens/`               the cards shown before the room
 *   `interview-room`         the typed room · `voice-room` the spoken one
 *   `use-voice-answers`      the *browser's* host: TTS, dictation, matching
 *   `use-voice-interview`    the spoken interview: Elena, over her own socket
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
  /**
   * Whether the clock ended the sitting rather than the candidate.
   *
   * Only for the closing screen, and it earns its place there: someone whose
   * time ran out mid-question has every reason to think their answers went
   * nowhere, and the difference between "submitted" and "cut off" is the one
   * thing they cannot see for themselves.
   */
  const [endedByClock, setEndedByClock] = React.useState(false)
  /**
   * Whether this sitting is being **talked** through rather than typed.
   *
   * Seeded from `voice_mode` on the session and only ever turned *off* — by a
   * microphone that wouldn't open, a socket that refused, or a connection that
   * dropped. That one-way rule is the feature's whole safety story: the typed
   * interview is the same interview, scored by the same engine, and it always
   * works, so every failure has somewhere to go. Nothing turns voice back on
   * mid-sitting, because a candidate mid-answer is the worst possible moment to
   * change how answering works.
   */
  const [spoken, setSpoken] = React.useState(false)

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
    /* A spoken sitting records **both** voices. Without this the recruiter's
       playback has the candidate's answers and only room echo where Elena's
       questions were — half a conversation, and the half that makes the other
       half mean anything. Decided here because recording starts on the camera
       screen, minutes before Elena exists: see `mixAudio`. */
    mixAudio: spoken,
  })

  const question = session?.questions[position]

  const { faceLost } = useVitalsSampler({
    active: sitting,
    session,
    stream: media.stream,
    videoRef,
    readTabSwitches,
  })

  /**
   * The sitting is held: nobody can see the candidate.
   *
   * The camera being *off* is the same problem arriving sooner — no frames are
   * sent at all, so `face_detected` never turns false and the hold would never
   * engage on its own. Both rooms are given this rather than the bare
   * `faceLost`, and the voice interview mutes the microphone on it: what someone
   * off camera says would otherwise be transcribed, matched and scored like any
   * other answer.
   */
  const held = faceLost || !media.cameraOn

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
      /**
       * The deadline passed while this was in flight.
       *
       * Caught here rather than at each call site because every candidate-side
       * request comes through this function — the typed answer, and the spoken
       * one, which is submitted from inside `useVoiceAnswers` and would otherwise
       * report the refusal as a failure of the microphone.
       *
       * And it is not a failure. The server refused the answer *and* has already
       * finished and scored the sitting, so there is nothing to retry: the only
       * wrong move is to show an error and leave the candidate looking at a
       * question they can no longer answer.
       */
      if (isTimeUp(caught) && session) {
        setEndedByClock(true)
        await finishSitting(session)
        return
      }
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
      /* `time_up` is not a closed session, it is a finished one: the server ended
         the sitting at its deadline and scored what was answered. Sending that to
         the dead-end screen would tell a candidate whose interview counted to go
         and ask their recruiter to reopen it. */
      if (reason === TIME_UP) {
        setEndedByClock(true)
        setStage("done")
        return
      }
      setStage("dead")
      setError(
        "This session was closed by the server. Contact the recruiter to reopen it."
      )
    },
  })

  /**
   * The clock now ends the sitting instead of just sitting at `00:00`.
   *
   * `finishSitting` is declared further down and this only reaches it from an
   * effect, which is the same arrangement — and for the same reason — as the
   * `voice`/`send`/`finishSitting` cycle documented there: a closure captures
   * the binding, not the value, and nothing calls this during the render pass
   * that creates it.
   */
  useCountdown({
    active: sitting,
    paused: faceLost,
    /* The server's deadline where it sends one, and then it — not the local
       counter — is the clock. See `useCountdown`: `paused` applies only to the
       fallback, because the server's deadline does not pause either. */
    expiresAt: session?.expiresAt ?? null,
    secondsLeft,
    setSecondsLeft,
    onElapsed: () => {
      if (!session) return
      setEndedByClock(true)
      void finishSitting(session)
    },
  })

  /* -------------------------------------------------------------- camera - */

  /*
   * There is **no effect here attaching the camera to the `<video>`** any more.
   * `CameraPane` does it with a ref callback, which is the only version that
   * survives a room swap: this effect depended on the stream and the stage, and a
   * voice sitting handing over to the typed room changes neither — it replaces
   * the element. The candidate's picture went black mid-interview, under a REC
   * badge still claiming to record it.
   */

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
      // The one flag that decides which of the two interviews this is. Read
      // here and nowhere else: from this point the *stage* machine is the same
      // either way, and only the room differs.
      setSpoken(next.voiceMode)
      /* Said out loud in the log, because the two interviews are not subtly
         different and "the old voice is reading the questions" is exactly what a
         typed sitting looks like. Whoever is wondering which one they got
         shouldn't have to infer it from the UI. */
      trace(
        "voice",
        next.voiceMode
          ? "voice interview — Elena comes over the socket"
          : "typed interview — voice_mode is off, the browser reads the questions"
      )
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
      const stream = await media.request()

      /* No microphone, no voice interview — and this is the *first* of the
         handover points, before a socket has been opened at all. A voice room
         with no way to answer it is worse than the typed room, which needs
         neither microphone nor camera to submit an answer. */
      if (spoken && !stream) {
        handOver({
          kind: "typed",
          resumeAt: 0,
          detail: "your microphone wasn't available",
        })
      }

      /* A spoken sitting starts on an empty transcript: Elena greets the
         candidate herself and the socket's captions fill this in as she and the
         candidate talk. Writing the typed greeting here as well would put a
         welcome in the transcript that nobody said. */
      if (spoken && stream) {
        setTranscript([])
        setStage("sitting")
        return
      }

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

  /* ------------------------------------------------------ voice handover -- */

  /**
   * Voice is over. Decide what the candidate does instead.
   *
   * **A handover is not a restart.** Every answer the socket confirmed is
   * already captured and scored server-side, so the typed room picks up at the
   * question Elena was on — `resumeAt` — rather than walking someone back
   * through questions they have answered out loud. Re-answering them would
   * overwrite good answers with hurried ones and burn the clock twice.
   *
   * The exception is a socket taken over by a *newer connection*: that is the
   * candidate's own second tab, and carrying on here would have two rooms
   * answering one sitting. It ends this one, which is the same rule
   * `verify-otp` applies to a link opened twice.
   */
  const handOver = (handover: VoiceHandover) => {
    trace("voice", "the voice interview is over", handover)

    /* The clock, not a fault.
     *
     * The server enforces the sitting's deadline on the voice socket itself and
     * ends the session when it passes, having scored what was answered. So this
     * is the same ending the countdown produces in the typed room, and it takes
     * the same path: the closing screen says the time ran out *and that the
     * answers were saved*, which is the one thing the candidate cannot work out
     * for themselves. Handing them the typed room instead would be a lie —
     * there is no time left to carry on into. */
    if (handover.kind === "timeUp") {
      setSpoken(false)
      setEndedByClock(true)
      if (session) void finishSitting(session)
      return
    }

    if (handover.kind === "superseded") {
      setSpoken(false)
      setStage("dead")
      setError(
        "This interview was opened in another tab, and that one is now the live session. You can close this one."
      )
      return
    }

    setSpoken(false)
    if (session) {
      /* `resumeAt` is a *question index*, which is not necessarily a position in
         the list — so it is matched rather than used as one, and only then
         clamped. Falling back to the index itself covers the ordinary case
         where the two agree. */
      const matched = session.questions.findIndex(
        (entry) => entry.questionIndex === handover.resumeAt
      )
      const resumeAt = matched >= 0 ? matched : handover.resumeAt
      const next = Math.min(Math.max(0, resumeAt), session.questions.length - 1)
      setPosition(next)

      /* The conversation so far, then the question they are now on.
       *
       * Carried over rather than replaced: the two rooms keep their transcripts
       * in different places — the spoken one reads the socket's captions, the
       * typed one this state — so seeding only the question threw away
       * everything Elena and the candidate had said. Someone mid-interview was
       * dropped into a room whose transcript claimed the interview had just
       * begun, which reads as though their answers went with it. */
      const question = session.questions[next]
      setTranscript([
        ...elena.captions,
        ...(question ? [makeEntry("host", fullQuestionText(question))] : []),
      ])
    }

    /* The same room either way, and a different sentence above it. Somebody who
       has just pressed "Type instead" being told that the spoken interview
       "couldn't continue" reads as though they broke something — and the two
       cases differ in nothing else, so the wording is the only place to say so. */
    setNotice(
      handover.chosen
        ? `You're typing from here — ${handover.detail}. Everything you answered out loud is saved, and this picks up at the question Elena was on.`
        : `The spoken interview couldn't continue — ${handover.detail}. Carry on by typing; everything you've answered so far is saved.`
    )
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
    /* And the spoken interview's own end of it: this closes Gemini's session
       server-side rather than leaving Elena talking to a page that is being
       submitted. Harmless when the sitting was typed. */
    elena.end()

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
        try {
          // A deadline that passes mid-answer is handled in `run`, which every
          // candidate-side call goes through — including the voice one, which
          // submits from its own hook.
          await submitAnswer(session.candidateToken, {
            sessionId: session.sessionId,
            questionIndex: question.questionIndex,
            answer: value,
          })
        } catch (caught) {
          /* This question already has an answer, which happens on exactly one
             path: a spoken interview handed over to this room and resumed a
             question early, so Elena had already recorded it. Their answer is
             in — it just went in by voice — so this moves on rather than
             showing the candidate a conflict they can do nothing about and
             cannot be talked out of. Anything else is a real failure and
             belongs to `run`. */
          if (!isAlreadyAnswered(caught)) throw caught
          trace("voice", "already answered — moving past it", {
            questionIndex: question.questionIndex,
          })
        }
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

  /**
   * The browser's own host: `speechSynthesis` reading the question, and the Web
   * Speech recogniser hearing the answer.
   *
   * **Off entirely while `spoken` is true.** In a voice interview Elena is a
   * real voice arriving over a socket from the server, and leaving this running
   * beside her would have two hosts reading every question over each other into
   * the same microphone. It comes back on the instant voice hands over, which is
   * exactly what the typed room needs.
   */
  const voice = useVoiceAnswers({
    active: sitting && !spoken,
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

  /**
   * Elena, over the voice socket — the whole of a spoken interview.
   *
   * She reads the questions, hears the answers, and the *backend* submits and
   * scores them: nothing in this page calls `submit-answer` while this is
   * running. What comes back is which question we're on, her voice, captions,
   * and "that one is recorded".
   *
   * `active` is the same `sitting` gate as everything else, plus `spoken`. When
   * the hook hands over, `spoken` goes false, this deactivates, and the typed
   * room above takes the sitting from the question Elena had reached.
   */
  const elena = useVoiceInterview({
    active: sitting && spoken,
    sessionId: session?.sessionId ?? null,
    token: session?.candidateToken ?? null,
    stream: media.stream,
    faceLost: held,
    /* The socket says the interview is finished and the results are persisted.
       This still runs the ordinary closing sequence — seal the recording, send
       the authoritative tab-switch total, show the done screen — because none of
       that is the voice session's business and all of it still has to happen. */
    onComplete: () => {
      if (session) void finishSitting(session)
    },
    onHandover: handOver,
    /* Elena into the recording, the moment she has a voice to record.
     *
     * Her track arrives well after recording started, and again after a
     * reconnect replaces the player — the mix takes it either way, and ignores a
     * track it already holds. */
    onHostTrack: recording.addAudioTrack,
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
    return (
      <DoneScreen
        logoUrl={logoUrl}
        role={link.role}
        timedOut={endedByClock}
      />
    )
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
        // In a spoken sitting the count that means anything is what the server
        // confirmed it recorded; `position` never moves, because nothing in this
        // page was advancing it.
        answered={spoken ? elena.answered : position}
        total={session.questions.length}
      />
    )
  }

  /*
   * The spoken room, in place of the typed one.
   *
   * A whole separate room rather than a mode of the other, because almost
   * nothing about *answering* survives the change: there is no text box, no
   * Send, no dictation button, and an option tapped here is a request to the
   * server rather than an answer held locally until Send. What the two do share
   * — the top bar, the camera pane, the clock, the notes, the way out — is
   * shared as components (`room-chrome`), so a handover between them barely
   * moves anything on screen.
   */
  if (spoken) {
    return (
      <>
        <VoiceRoom
          session={session}
          /* Matched by index rather than taken positionally: `questionIndex` is
             the numbering the socket speaks in, and only *usually* the position
             in the list. */
          question={
            elena.index === null
              ? null
              : (session.questions.find(
                  (entry) => entry.questionIndex === elena.index
                ) ??
                session.questions[elena.index] ??
                null)
          }
          voice={elena}
          secondsLeft={secondsLeft}
          stream={media.stream}
          videoRef={videoRef}
          cameraOn={media.cameraOn}
          videoRecording={recording.recording}
          logoUrl={logoUrl}
          faceLost={held}
          inFullscreen={proctoring.inFullscreen}
          fullscreenSupported={proctoring.supported}
          onToggleFullscreen={() => void proctoring.toggle()}
          onEnd={() => setConfirmEnd(true)}
        />

        <ConfirmDialog
          open={confirmEnd}
          onOpenChange={setConfirmEnd}
          title="End the interview now?"
          description={`Elena has recorded ${elena.answered} of ${session.totalQuestions} answers. Those will be submitted and scored, and the rest will be left blank. This link can't be reopened.`}
          confirmLabel="End and submit"
          onConfirm={() => void endEarly()}
        />
      </>
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
        stream={media.stream}
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
        faceLost={held}
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
