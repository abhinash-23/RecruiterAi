import * as React from "react"

export interface MediaStreamState {
  stream: MediaStream | null
  /** Null until the user has been asked. */
  granted: boolean | null
  error: string | null
  cameraOn: boolean
  requesting: boolean
}

/**
 * Camera + microphone for the interview.
 *
 * The stream is requested once and kept for the whole sitting — re-requesting on
 * every question would make the browser flash its permission indicator and give
 * the vitals sampler a new track to attach to each time.
 *
 * Toggling the camera disables the video *track* rather than dropping the
 * stream, so the microphone keeps working and turning the picture back on
 * doesn't need a second permission round-trip.
 */
export function useMediaStream() {
  const [state, setState] = React.useState<MediaStreamState>({
    stream: null,
    granted: null,
    error: null,
    cameraOn: true,
    requesting: false,
  })

  const streamRef = React.useRef<MediaStream | null>(null)

  /**
   * The camera and microphone the candidate picked on the device check, or
   * undefined for the browser's default. Kept so that re-opening the devices
   * (see `request`) opens the same ones that passed the check.
   */
  const chosenRef = React.useRef<{ video?: string; audio?: string }>({})

  const request = React.useCallback(async (): Promise<MediaStream | null> => {
    /* Reused only while every track is still live. The device check opens the
       stream minutes before the interview starts, and in between the candidate
       is in their inbox fetching the code — on a phone that backgrounds the tab,
       and the browser may end the tracks. A dead stream handed to the room is a
       black picture and a silent microphone, so it is re-opened instead. */
    const current = streamRef.current
    if (
      current &&
      current.getTracks().every((track) => track.readyState === "live")
    ) {
      return current
    }
    for (const track of current?.getTracks() ?? []) track.stop()
    streamRef.current = null

    if (!navigator.mediaDevices?.getUserMedia) {
      setState((prev) => ({
        ...prev,
        stream: null,
        granted: false,
        error:
          "This browser can't use a camera. Open the link in the latest Chrome, Edge, Firefox or Safari.",
        cameraOn: false,
        requesting: false,
      }))
      return null
    }

    setState((current) => ({ ...current, requesting: true, error: null }))

    const open = (chosen: { video?: string; audio?: string }) =>
      navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          ...(chosen.video ? { deviceId: { exact: chosen.video } } : {}),
        },
        /*
         * The three audio filters, asked for **explicitly**.
         *
         * They are on by default in every browser that matters, so this changes
         * nothing today — and it is written down because a voice interview
         * depends on the first of them for its basic sanity. Elena is played
         * through the speakers and the microphone is open at the same time, so
         * without echo cancellation she hears herself read the options,
         * transcribes it as the candidate's answer, and answers her own
         * question. A future constraint block that dropped these by accident
         * would look like a change to the recording and break the conversation.
         */
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          ...(chosen.audio ? { deviceId: { exact: chosen.audio } } : {}),
        },
      })

    try {
      let stream: MediaStream
      try {
        stream = await open(chosenRef.current)
      } catch (error) {
        /* A device picked on the check that has since been unplugged. Falling
           back to the default is better than failing outright — the check
           screen shows which one is in use, and the room runs on whatever
           works. */
        const name = error instanceof DOMException ? error.name : ""
        const picked = chosenRef.current.video || chosenRef.current.audio
        if (
          !picked ||
          (name !== "OverconstrainedError" && name !== "NotFoundError")
        ) {
          throw error
        }
        chosenRef.current = {}
        stream = await open({})
      }
      streamRef.current = stream
      setState({
        stream,
        granted: true,
        error: null,
        cameraOn: true,
        requesting: false,
      })
      return stream
    } catch (error) {
      const name = error instanceof DOMException ? error.name : ""
      setState({
        stream: null,
        granted: false,
        error: mediaErrorMessage(name),
        cameraOn: false,
        requesting: false,
      })
      return null
    }
  }, [])

  /**
   * Re-opens the devices with a different camera or microphone.
   *
   * The old tracks are stopped first: two open cameras is more than most
   * laptops allow, and the second `getUserMedia` would fail with the device
   * "in use" — by this very page.
   */
  const switchDevices = React.useCallback(
    async (next: { video?: string; audio?: string }) => {
      chosenRef.current = { ...chosenRef.current, ...next }
      for (const track of streamRef.current?.getTracks() ?? []) track.stop()
      streamRef.current = null
      return request()
    },
    [request]
  )

  const toggleCamera = React.useCallback(() => {
    const stream = streamRef.current
    if (!stream) return

    setState((current) => {
      const next = !current.cameraOn
      for (const track of stream.getVideoTracks()) track.enabled = next
      return { ...current, cameraOn: next }
    })
  }, [])

  const stop = React.useCallback(() => {
    for (const track of streamRef.current?.getTracks() ?? []) track.stop()
    streamRef.current = null
    setState((current) => ({ ...current, stream: null, cameraOn: false }))
  }, [])

  // Release the devices when the page goes away, so the browser's in-use
  // indicator doesn't linger after the interview finishes.
  React.useEffect(
    () => () => {
      for (const track of streamRef.current?.getTracks() ?? []) track.stop()
      streamRef.current = null
    },
    []
  )

  return { ...state, request, switchDevices, toggleCamera, stop }
}

/**
 * What went wrong, in the candidate's terms. Each `getUserMedia` failure has
 * its own fix, so each gets its own sentence rather than one "not found".
 */
function mediaErrorMessage(name: string): string {
  switch (name) {
    // A decision, not a fault — worded accordingly.
    case "NotAllowedError":
    case "SecurityError":
      return "Camera and microphone access was blocked. Click the camera or lock icon in the address bar, allow both, then try again."
    case "NotReadableError":
    case "AbortError":
      return "Your camera or microphone is being used by another app (Zoom, Teams, Meet…). Close it, then try again."
    case "NotFoundError":
    case "OverconstrainedError":
      return "No camera or microphone was found. Connect one, then try again."
    default:
      return "Your camera or microphone couldn't be started. Check they're connected, then try again."
  }
}

/**
 * Grabs a still frame from a live video element as a base64 JPEG.
 *
 * Used for vitals sampling. Returns null when the video has no dimensions yet —
 * the first frames after `play()` are empty and would post a blank image.
 */
export function captureFrame(
  video: HTMLVideoElement | null,
  quality = 0.6
): string | null {
  if (!video || !video.videoWidth || !video.videoHeight) return null

  const canvas = document.createElement("canvas")
  canvas.width = video.videoWidth
  canvas.height = video.videoHeight

  const context = canvas.getContext("2d")
  if (!context) return null

  context.drawImage(video, 0, 0, canvas.width, canvas.height)
  // The API wants the payload without the `data:image/jpeg;base64,` prefix.
  return canvas.toDataURL("image/jpeg", quality).split(",")[1] ?? null
}
