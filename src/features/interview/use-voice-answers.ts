import * as React from "react"

import {
  fullQuestionText,
  speechToText,
  submitVoiceAnswer,
  type CandidateSession,
  type InterviewQuestion,
} from "@/services/interview"

import { matchSpokenChoice, stripSendCommand } from "./match-spoken-option"
import { useDictation, type HeardWords } from "./use-dictation"
import { useSpeech, useVoiceRecorder } from "./use-speech"

/**
 * An answer on its way out, when the caller can't rely on the `answer` state.
 *
 * The voice paths match an option and submit it in the same tick, and `answer`
 * at that point still holds the value from before the match — so they say what
 * they mean instead. `scored` is the one kind that is *already* answered:
 * `submit-answer-voice` transcribes and scores in a single call, and submitting
 * it again would double-answer the question.
 */
export type Outgoing =
  | { kind: "option"; index: number }
  | { kind: "text"; text: string }
  | { kind: "scored"; text: string }

/**
 * ============================================================================
 * ANSWERING OUT LOUD
 * ============================================================================
 * Owns the host's voice and the candidate's: reading each question aloud, and
 * turning what the microphone hears into an answer.
 *
 * The microphone stays **open across questions**, so what it hears has to be
 * acted on while it is still open — a candidate saying "select option A"
 * expects that option answered and the next question read out, without touching
 * anything.
 *
 * Deafness while the host speaks is not optional. The host reads the question
 * **and every option** aloud, so on a laptop's speakers the recogniser hears
 * "A. Strongly Disagree" and would answer the question itself.
 *
 * Two paths, because browser support is uneven: the Web Speech API where it
 * exists (words appear live, no audio to upload), and record-then-upload
 * everywhere else.
 */
export function useVoiceAnswers({
  active,
  session,
  question,
  faceLost,
  stream,
  answerRef,
  putAnswer,
  send,
  run,
  setError,
  setNotice,
}: {
  active: boolean
  session: CandidateSession | null
  question: InterviewQuestion | undefined
  faceLost: boolean
  stream: MediaStream | null
  /** The answer, readable between renders — see the note at its declaration. */
  answerRef: React.RefObject<string>
  putAnswer: (next: string) => void
  send: (outgoing?: Outgoing) => Promise<void>
  run: (work: () => Promise<void>) => Promise<void>
  setError: (message: string | null) => void
  setNotice: (message: string | null) => void
}) {
  const speech = useSpeech()

  /**
   * Voice control lives in `handleHeard` below — it needs the current question,
   * which doesn't exist when the recogniser is created. This forwards to
   * whichever version of it belongs to the latest render.
   */
  const heardRef = React.useRef<(heard: HeardWords) => void>(() => {})
  const dictation = useDictation(
    "en-IN",
    React.useCallback((heard: HeardWords) => heardRef.current(heard), [])
  )
  // Pulled out here because the callbacks are stable and the effects below
  // depend on them; the `dictation` object itself is rebuilt every render, and
  // depending on that re-runs those effects on every tick of the clock.
  const { setDeaf, deafenFor, consume, reset: resetHeard } = dictation
  const recorder = useVoiceRecorder(stream)

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
    if (!active || !question) return

    // Through `fullQuestionText`, so a situational question is read *with* its
    // situation. A candidate answering by voice may never look at the card, and
    // "What do you do?" read on its own is unanswerable.
    const asked = fullQuestionText(question)

    const spoken = question.options.length
      ? `${asked} Your options are: ${question.options
          .map((option, index) => `${String.fromCharCode(65 + index)}. ${option}`)
          .join(". ")}`
      : asked

    // A new question starts from silence. The mic is open across the whole
    // sitting, so without this the words that answered the last question are
    // still in the buffer and would answer this one too — and the recogniser is
    // still settling the tail of them, which is what the window covers.
    resetHeard()
    deafenFor(1200)
    speak(spoken)
  }, [active, question, speak, resetHeard, deafenFor])

  /* ------------------------------------------------------------ deafness - */

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

  /* ------------------------------------------------- live voice control -- */

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
    if (!active || !session || !question) return
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

  /** Stops the host talking and closes the mic. For finishing the sitting. */
  const silence = React.useCallback(() => {
    speech.cancel()
    void dictation.stop()
    // Same stable-callback reasoning as the effects above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return {
    toggleRecording,
    silence,
    /** Whether the mic is open, by whichever path this browser uses. */
    listening: dictation.supported ? dictation.listening : recorder.recording,
    supported: dictation.supported || (recorder.supported && Boolean(stream)),
    liveTranscript: dictation.listening ? dictation.text : null,
    hostSpeaking: speech.speaking,
    hostMuted: speech.muted,
    toggleHostMuted: speech.toggleMuted,
  }
}
