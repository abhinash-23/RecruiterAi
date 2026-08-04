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

  const request = React.useCallback(async () => {
    if (streamRef.current) return streamRef.current

    setState((current) => ({ ...current, requesting: true, error: null }))
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: true,
      })
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
      setState({
        stream: null,
        granted: false,
        // `NotAllowedError` is a decision, not a fault — word it accordingly.
        error:
          error instanceof DOMException && error.name === "NotAllowedError"
            ? "Camera and microphone access was blocked. Allow them in your browser to continue."
            : "No camera or microphone was found.",
        cameraOn: false,
        requesting: false,
      })
      return null
    }
  }, [])

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

  return { ...state, request, toggleCamera, stop }
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
