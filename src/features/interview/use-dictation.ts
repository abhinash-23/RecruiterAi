import * as React from "react"

/**
 * ============================================================================
 * LIVE DICTATION — the browser's own recogniser
 * ============================================================================
 * Answering out loud used to mean: record audio → upload it → wait for the
 * server to transcribe → hope it understood. Four things to go wrong, none of
 * them visible while the candidate is talking, and a single unsupported audio
 * container turns the whole feature into a button that does nothing.
 *
 * The Web Speech API does it in the browser instead: words appear **as they are
 * spoken**, so the caller can act on them mid-sentence and there is no audio
 * format to negotiate. Chrome, Edge and Safari have it behind the `webkit`
 * prefix. Where it doesn't exist, the caller falls back to the upload path.
 *
 * ----------------------------------------------------------------------------
 * One microphone, many questions
 * ----------------------------------------------------------------------------
 * The mic is opened once and stays open until the candidate closes it, across
 * every question. That makes the words a **stream to be consumed**, not a value
 * to be read at the end:
 *
 *  - `interim`  — the recogniser's current guess, still changing.
 *  - `settled`  — words it has committed to, and the caller hasn't taken yet.
 *  - `consume()` — take the settled words and leave the mic running.
 *
 * ----------------------------------------------------------------------------
 * The lifetime is the hard part
 * ----------------------------------------------------------------------------
 * A `continuous` recogniser is not a session that lasts until you stop it.
 * Chrome ends one on its own after a few seconds of silence, and fires `error`
 * for a pause it will happily recover from. Three separate things therefore
 * need to stay in step, and conflating any two of them breaks the mic button:
 *
 *  - `wantRef`         — does the *candidate* still want to be heard?
 *  - `recognitionRef`  — the browser session that happens to be running now.
 *  - `settledRef`      — the words nobody has consumed yet.
 *
 * Whenever the browser ends a session the candidate hasn't finished, a new one
 * is spawned underneath them. And a session we've let go of is always stripped
 * of its handlers, so it can never write words into the turn that follows.
 */

/** The slice of the API this needs. TypeScript's DOM lib doesn't declare it. */
interface RecognitionAlternative {
  transcript: string
}
interface RecognitionResult {
  readonly length: number
  isFinal: boolean
  [index: number]: RecognitionAlternative
}
interface RecognitionResultList {
  readonly length: number
  [index: number]: RecognitionResult
}
interface RecognitionEvent {
  resultIndex: number
  results: RecognitionResultList
}
interface Recognition {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  start: () => void
  stop: () => void
  abort: () => void
  onresult: ((event: RecognitionEvent) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
}
type RecognitionConstructor = new () => Recognition

function constructor(): RecognitionConstructor | null {
  if (typeof window === "undefined") return null
  const scope = window as unknown as {
    SpeechRecognition?: RecognitionConstructor
    webkitSpeechRecognition?: RecognitionConstructor
  }
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null
}

/**
 * Errors that mean "there will be no microphone today". Everything else
 * ("no-speech", "aborted", "network", "audio-capture") is a hiccup mid-answer,
 * and giving up on those is what made the mic stop halfway through a sentence.
 */
const FATAL = new Set(["not-allowed", "service-not-allowed"])

/**
 * Ceiling on silent restarts, so a browser that ends a session instantly can't
 * spin forever. Generous, because one open mic now spans a whole 30-question
 * sitting and Chrome ends a session at every pause. Reset whenever real words
 * come through, since that proves the restarts are working.
 */
const MAX_RESTARTS = 250

const tidy = (value: string) => value.replace(/\s+/g, " ").trim()

/** One update from the recogniser, handed to the caller as it happens. */
export interface HeardWords {
  /** Words it has committed to and the caller hasn't consumed. Safe to act on. */
  settled: string
  /** Those plus the guess still in flight. Only for spotting an explicit cue. */
  live: string
}

/**
 * @param onHeard Called from the recogniser's own event, every time the words
 *   change. This is a **push**, deliberately: watching the transcript from an
 *   effect and answering from there is a state update reacting to a state
 *   update, and React re-runs it on every unrelated render — including the
 *   once-a-second clock tick.
 */
export function useDictation(
  language = "en-IN",
  onHeard?: (heard: HeardWords) => void
) {
  const [listening, setListening] = React.useState(false)
  /** Words the recogniser has committed to, and the caller hasn't taken. */
  const [settled, setSettled] = React.useState("")
  /** Its current guess at what is being said right now. */
  const [interim, setInterim] = React.useState("")

  const recognitionRef = React.useRef<Recognition | null>(null)
  const settledRef = React.useRef("")
  /** The candidate's intent, which outlives any one browser session. */
  const wantRef = React.useRef(false)
  const restartsRef = React.useRef(0)
  /**
   * Set while the host is reading the question aloud. On a laptop's speakers the
   * mic hears every word of it — including "A. Strongly Disagree" — and with the
   * mic open continuously the host would answer its own questions.
   */
  const deafRef = React.useRef(false)
  /**
   * Deaf until this moment regardless, for the gaps a flag can't cover:
   * `speechSynthesis` reports itself started a beat *after* it makes a sound,
   * and the recogniser is still settling the words that answered the last
   * question when the next one arrives.
   */
  const deafUntilRef = React.useRef(0)
  /** Lets `onend` respawn without `spawn` having to reference itself. */
  const spawnRef = React.useRef<(() => boolean) | null>(null)
  /** Latest handler, so a session started ten questions ago still calls it. */
  const onHeardRef = React.useRef(onHeard)

  const supported = constructor() !== null

  React.useEffect(() => {
    onHeardRef.current = onHeard
  })

  /**
   * Cuts a session loose. Detaching the handlers is the point: a discarded
   * recogniser goes on delivering results for a while, and one that can still
   * reach `settledRef` leaks the previous answer into the next question — which
   * is how "select A" arrived at the scorer with the host's spoken question
   * stitched onto the end of it.
   */
  const release = (recognition: Recognition | null) => {
    if (!recognition) return
    recognition.onresult = null
    recognition.onerror = null
    recognition.onend = null
  }

  const clear = React.useCallback(() => {
    settledRef.current = ""
    setSettled("")
    setInterim("")
  }, [])

  const spawn = React.useCallback((): boolean => {
    const Ctor = constructor()
    if (!Ctor) return false

    // Never refuse because an old session is still referenced. Bailing here is
    // what left the mic button permanently dead — Chrome ends a session by
    // itself, `listening` went false, the stale reference stayed, and every
    // press after that reported "your browser wouldn't start the microphone".
    const previous = recognitionRef.current
    recognitionRef.current = null
    release(previous)
    try {
      previous?.abort()
    } catch {
      /* already gone */
    }

    let recognition: Recognition
    try {
      recognition = new Ctor()
    } catch {
      return false
    }

    recognition.lang = language
    // Continuous, because an answer to an open question is several sentences and
    // the default stops at the first pause.
    recognition.continuous = true
    recognition.interimResults = true
    recognition.maxAlternatives = 1

    recognition.onresult = (event) => {
      // Dropped outright rather than filtered later: an interim guess at the
      // host's own voice would otherwise be enough to pick an option.
      if (deafRef.current || Date.now() < deafUntilRef.current) return

      let heard = ""
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index]
        const words = result[0]?.transcript ?? ""
        if (result.isFinal) settledRef.current += `${words} `
        else heard += words
      }

      restartsRef.current = 0
      const settledNow = tidy(settledRef.current)
      setSettled(settledNow)
      setInterim(tidy(heard))

      // Read off before the handler runs: it is free to `consume()`, which
      // empties the buffer these two were taken from.
      onHeardRef.current?.({
        settled: settledNow,
        live: tidy(`${settledNow} ${heard}`),
      })
    }

    recognition.onerror = (event) => {
      // Note only: `onend` always follows, and it is the one place that decides
      // whether to carry on. Setting `listening` false here as well used to
      // desynchronise the button from the session still running behind it.
      if (FATAL.has(event.error)) wantRef.current = false
    }

    recognition.onend = () => {
      if (recognitionRef.current !== recognition) return
      recognitionRef.current = null
      release(recognition)

      // Silence ended the session, not the candidate. Pauses are normal — while
      // reading a question, while thinking — so pick the mic back up and keep
      // whatever words are already banked.
      if (wantRef.current && restartsRef.current < MAX_RESTARTS) {
        restartsRef.current += 1
        setInterim("")
        if (spawnRef.current?.()) return
      }

      wantRef.current = false
      setInterim("")
      setListening(false)
    }

    try {
      recognition.start()
    } catch {
      // Typically "already started" — the previous session hadn't finished
      // tearing down. Leave nothing attached rather than a half-live session.
      release(recognition)
      return false
    }

    recognitionRef.current = recognition
    return true
  }, [language])

  // `onend` reaches for the spawner through the ref rather than closing over
  // it, so a respawn always uses the current language rather than whichever one
  // was in scope when that session started.
  React.useEffect(() => {
    spawnRef.current = spawn
  }, [spawn])

  const start = React.useCallback(() => {
    clear()
    restartsRef.current = 0

    wantRef.current = true
    if (!spawn()) {
      wantRef.current = false
      setListening(false)
      return false
    }

    setListening(true)
    return true
  }, [clear, spawn])

  /**
   * Takes the settled words and leaves the microphone running.
   *
   * This is how one open mic serves a whole sitting: the caller acts on a
   * finished phrase, consumes it, and the next question starts from empty
   * without the candidate touching anything.
   */
  const consume = React.useCallback(() => {
    const heard = tidy(settledRef.current)
    settledRef.current = ""
    setSettled("")
    return heard
  }, [])

  /** Throws away everything heard but not consumed. */
  const reset = React.useCallback(() => clear(), [clear])

  /**
   * Stops listening entirely and resolves with whatever was left unconsumed.
   */
  const stop = React.useCallback((): Promise<string> => {
    // First, so the teardown below can't be mistaken for a pause and respawn.
    wantRef.current = false

    const recognition = recognitionRef.current
    recognitionRef.current = null
    setListening(false)

    /** Hands the words over and leaves the buffer clean for the next sitting. */
    const flush = () => {
      const heard = tidy(settledRef.current)
      settledRef.current = ""
      setSettled("")
      setInterim("")
      return heard
    }

    if (!recognition) return Promise.resolve(flush())

    return new Promise((resolve) => {
      let done = false
      // A final result often arrives *after* `stop()`, so wait for `onend`
      // rather than reading the transcript immediately.
      const settle = () => {
        if (done) return
        done = true
        release(recognition)
        resolve(flush())
      }

      recognition.onend = settle
      try {
        recognition.stop()
      } catch {
        settle()
      }
      // Belt and braces: some builds never fire `onend` after an error.
      window.setTimeout(settle, 1500)
    })
  }, [])

  /**
   * Ignore everything heard while `on` — used while the host is speaking.
   *
   * Both edges throw the buffer away: going deaf discards the guess in flight
   * (the host's opening words), and coming back discards the tail the recogniser
   * settled a moment late.
   */
  const setDeaf = React.useCallback(
    (on: boolean) => {
      if (deafRef.current === on) return
      deafRef.current = on
      clear()
    },
    [clear]
  )

  /**
   * Ignore everything heard for the next `ms`, on top of whatever `setDeaf` says.
   *
   * Covers the two moments a flag can't: the beat between the host making a
   * sound and `speechSynthesis` admitting it started, and the beat after an
   * answer where the recogniser is still settling the words that gave it.
   * Only ever extends the window — a shorter request never shortens it.
   */
  const deafenFor = React.useCallback(
    (ms: number) => {
      const until = Date.now() + ms
      if (until <= deafUntilRef.current) return
      deafUntilRef.current = until
      clear()
    },
    [clear]
  )

  React.useEffect(
    () => () => {
      // Abort rather than stop on unmount: nobody is waiting for the words, and
      // the mic indicator should go out immediately.
      wantRef.current = false
      const recognition = recognitionRef.current
      recognitionRef.current = null
      release(recognition)
      try {
        recognition?.abort()
      } catch {
        /* already gone */
      }
    },
    []
  )

  return {
    supported,
    listening,
    /** Settled words awaiting `consume()` — safe to act on. */
    settled,
    /** Everything heard right now, settled plus guess. For display. */
    text: tidy(`${settled} ${interim}`),
    start,
    stop,
    consume,
    reset,
    setDeaf,
    deafenFor,
  }
}
