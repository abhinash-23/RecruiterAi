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
 * spoken**, so a candidate can see it working, and there is no audio format to
 * negotiate. Chrome, Edge and Safari have it behind the `webkit` prefix.
 *
 * Where it doesn't exist, the caller falls back to the upload path.
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

export function useDictation(language = "en-IN") {
  const [listening, setListening] = React.useState(false)
  /** Everything heard this turn: settled words plus the in-flight guess. */
  const [text, setText] = React.useState("")

  const recognitionRef = React.useRef<Recognition | null>(null)
  /** Only the finalised words, so interim guesses can be replaced not appended. */
  const finalRef = React.useRef("")
  const supported = constructor() !== null

  const start = React.useCallback(() => {
    const Ctor = constructor()
    if (!Ctor || recognitionRef.current) return false

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

    finalRef.current = ""
    setText("")

    recognition.onresult = (event) => {
      let interim = ""
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index]
        const words = result[0]?.transcript ?? ""
        if (result.isFinal) finalRef.current += words
        else interim += words
      }
      setText((finalRef.current + interim).trim())
    }

    recognition.onerror = () => {
      // "no-speech", "aborted", "not-allowed" — all end the same way for the
      // caller: whatever was heard so far, and `listening` false.
      setListening(false)
    }

    recognition.onend = () => setListening(false)

    try {
      recognition.start()
    } catch {
      return false
    }

    recognitionRef.current = recognition
    setListening(true)
    return true
  }, [language])

  /** Stops and resolves with everything heard, once the recogniser has settled. */
  const stop = React.useCallback((): Promise<string> => {
    const recognition = recognitionRef.current
    recognitionRef.current = null
    setListening(false)

    if (!recognition) return Promise.resolve("")

    return new Promise((resolve) => {
      // A final result often arrives *after* `stop()`, so wait for `onend`
      // rather than reading the transcript immediately.
      const settle = () => resolve(finalRef.current.trim())
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

  React.useEffect(
    () => () => {
      // Abort rather than stop on unmount: nobody is waiting for the words, and
      // the mic indicator should go out immediately.
      recognitionRef.current?.abort()
      recognitionRef.current = null
    },
    []
  )

  return { supported, listening, text, start, stop }
}
