import * as React from "react"

/**
 * Reads questions aloud, so the sitting feels like an interview rather than a
 * form.
 *
 * `speechSynthesis` is best-effort: not every browser has a usable voice, and
 * autoplay policy can refuse to start it before the first user gesture. Nothing
 * here blocks the interview — a candidate who hears nothing can still read and
 * answer, so failures are swallowed rather than surfaced.
 */
export function useSpeech() {
  const [speaking, setSpeaking] = React.useState(false)
  const [muted, setMuted] = React.useState(false)

  const supported =
    typeof window !== "undefined" && "speechSynthesis" in window

  /**
   * Chrome stops a long utterance dead after ~15 seconds unless it is nudged.
   * A question plus five options easily runs past that, so the voice would cut
   * out mid-sentence on exactly the questions that need reading most.
   */
  const keepAliveRef = React.useRef<number | null>(null)

  const stopKeepAlive = React.useCallback(() => {
    if (keepAliveRef.current !== null) {
      window.clearInterval(keepAliveRef.current)
      keepAliveRef.current = null
    }
  }, [])

  const cancel = React.useCallback(() => {
    if (!supported) return
    window.speechSynthesis.cancel()
    stopKeepAlive()
    setSpeaking(false)
  }, [supported, stopKeepAlive])

  const speak = React.useCallback(
    (text: string) => {
      if (!supported || muted || !text.trim()) return

      // Always cancel first: queuing means a candidate who advances quickly
      // hears the previous question finish over the new one.
      window.speechSynthesis.cancel()
      stopKeepAlive()

      const utterance = new SpeechSynthesisUtterance(text)
      utterance.rate = 1
      utterance.pitch = 1
      utterance.onstart = () => setSpeaking(true)
      utterance.onend = () => {
        setSpeaking(false)
        stopKeepAlive()
      }
      utterance.onerror = () => {
        setSpeaking(false)
        stopKeepAlive()
      }

      const start = () => {
        window.speechSynthesis.speak(utterance)
        keepAliveRef.current = window.setInterval(() => {
          if (!window.speechSynthesis.speaking) {
            stopKeepAlive()
            return
          }
          window.speechSynthesis.resume()
        }, 10_000)
      }

      // The voice list loads asynchronously. Speaking before it arrives is
      // silently dropped in Chrome, which is every first question on a cold
      // page — wait one `voiceschanged` before giving up on it.
      if (window.speechSynthesis.getVoices().length === 0) {
        window.speechSynthesis.addEventListener("voiceschanged", start, {
          once: true,
        })
        // Some builds never fire the event when voices are already cached.
        window.setTimeout(() => {
          if (!window.speechSynthesis.speaking) start()
        }, 250)
        return
      }

      start()
    },
    [supported, muted, stopKeepAlive]
  )

  const toggleMuted = React.useCallback(() => {
    setMuted((current) => {
      if (!current) cancel()
      return !current
    })
  }, [cancel])

  // Stop mid-sentence on unmount, or the voice keeps talking after the page has
  // gone — `speechSynthesis` is global to the tab, not owned by the component.
  React.useEffect(() => cancel, [cancel])

  return { speak, cancel, speaking, muted, toggleMuted, supported }
}

/**
 * Records a spoken answer and hands back base64 audio for
 * `POST /api/submit-answer-voice`.
 *
 * `MediaRecorder` is fed the existing interview stream rather than opening its
 * own, so the candidate isn't prompted for the microphone twice and the browser
 * shows one in-use indicator.
 */
/**
 * The first container this browser can actually encode, or `undefined` to let
 * it choose. Chrome and Firefox take Opus in WebM; Safari takes MP4/AAC and
 * throws on anything else.
 */
function pickAudioType(): { mimeType: string } | undefined {
  if (typeof MediaRecorder === "undefined") return undefined

  for (const mimeType of [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ]) {
    if (MediaRecorder.isTypeSupported?.(mimeType)) return { mimeType }
  }
  return undefined
}

export function useVoiceRecorder(stream: MediaStream | null) {
  const [recording, setRecording] = React.useState(false)
  const recorderRef = React.useRef<MediaRecorder | null>(null)
  const chunksRef = React.useRef<Blob[]>([])

  const supported =
    typeof window !== "undefined" && typeof MediaRecorder !== "undefined"

  const start = React.useCallback(() => {
    if (!stream || !supported || recorderRef.current) return false

    const tracks = stream.getAudioTracks()
    // A camera-only grant, or a mic the OS has taken away mid-sitting.
    if (tracks.length === 0 || !tracks.some((track) => track.readyState === "live")) {
      return false
    }

    const audio = new MediaStream(tracks)

    let recorder: MediaRecorder
    try {
      // Let the browser pick unless it needs telling: Safari has no Opus
      // encoder and throws on the webm type Chrome defaults to, and an
      // exception here used to escape the click handler, so the button simply
      // did nothing.
      recorder = new MediaRecorder(audio, pickAudioType())
    } catch {
      return false
    }

    chunksRef.current = []
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data)
    }
    recorder.start()

    recorderRef.current = recorder
    setRecording(true)
    return true
  }, [stream, supported])

  /** Resolves with base64 audio, or null when nothing was captured. */
  const stop = React.useCallback((): Promise<string | null> => {
    const recorder = recorderRef.current
    if (!recorder) return Promise.resolve(null)

    return new Promise((resolve) => {
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        })
        recorderRef.current = null
        setRecording(false)

        if (blob.size === 0) {
          resolve(null)
          return
        }

        const reader = new FileReader()
        reader.onloadend = () => {
          const result = String(reader.result ?? "")
          // Strip the `data:audio/webm;base64,` prefix the API doesn't want.
          resolve(result.split(",")[1] ?? null)
        }
        reader.onerror = () => resolve(null)
        reader.readAsDataURL(blob)
      }
      recorder.stop()
    })
  }, [])

  React.useEffect(
    () => () => {
      // Stop without resolving — the component is going away and nobody is
      // waiting for the audio.
      recorderRef.current?.stop()
      recorderRef.current = null
    },
    []
  )

  return { start, stop, recording, supported }
}
