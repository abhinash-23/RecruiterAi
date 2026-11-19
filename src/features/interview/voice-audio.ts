import { HOST_SAMPLE_RATE, MIC_SAMPLE_RATE } from "@/services/interview"
import { trace } from "@/services/socket-trace"

import { describeMicTrack, micAudioConstraints } from "./mic-constraints"

/*
 * `?url&no-inline`, and both halves matter.
 *
 * `?url` because an AudioWorklet module is fetched and evaluated by the *audio
 * thread* from a URL — it cannot be an import in the app's bundle, and it must
 * not be transformed into one. `&no-inline` because Vite inlines assets under
 * ~4 kB as `data:` URIs in a production build, and `addModule` rejects a data
 * URI: the microphone would work in `vite dev` and silently fail to open in
 * every deployment, which is the worst possible place for this to differ.
 */
import captureWorkletUrl from "./pcm-capture-worklet.js?url&no-inline"

/**
 * ============================================================================
 * THE AUDIO ENDS OF THE VOICE SOCKET
 * ============================================================================
 * Two objects with nothing in common but a sample rate: the microphone on its
 * way out (48 kHz Float32 from the browser → 16 kHz Int16 for Gemini) and
 * Elena's voice on its way in (24 kHz Int16 → the speakers, gapless).
 *
 * Kept out of the hook deliberately. Neither of these is React: they own an
 * `AudioContext` apiece, they run on the audio thread, and their whole job is to
 * *not* re-render anything at 31 frames a second. The hook opens them, forwards
 * bytes, and closes them.
 *
 * Everything here fails soft and returns null rather than throwing: a browser
 * with no `AudioWorklet`, a blocked context, a stream with no audio track. The
 * caller reads that as "no voice interview" and runs the typed one.
 */

/* ========================================================================== */
/*  Microphone → socket                                                       */
/* ========================================================================== */

/**
 * What the microphone does with what it hears.
 *
 * `"open"` — send it. The candidate's turn.
 *
 * `"gated"` — send it **only if it is loud enough to be a person in the room**,
 * and silence otherwise. This is the state while Elena is speaking, and it is
 * what makes barge-in possible without her hearing herself: her voice leaking
 * back through the speakers arrives quiet (the browser's echo canceller has
 * already had a go at it), while someone actually interrupting arrives loud.
 * A hard mute here would suppress the echo *and* the interruption, and being
 * able to cut in is the difference between a conversation and a form.
 *
 * `"silent"` — send silence whatever happens: the candidate muted themselves, or
 * the camera can't see them, and nothing they say may become an answer.
 *
 * Every mode keeps *sending*. See the note on the port handler.
 */
export type MicMode = "open" | "gated" | "silent"

/**
 * Loud enough to be the candidate talking, on a 0–1 RMS scale.
 *
 * Room noise and a laptop fan sit well below this; conversational speech at a
 * normal distance sits above it. Used to decide when an answer has *ended*, so
 * erring low is right: a threshold that misses a quiet talker would keep cutting
 * them off mid-answer.
 */
export const MIC_SPEECH_LEVEL = 0.02

/**
 * Loud enough to be interrupting Elena rather than being Elena.
 *
 * Three times the speech threshold, because what it has to beat is her own voice
 * coming back off the speakers. Too low and she stops mid-question every time she
 * says something emphatic; too high and a softly-spoken "option B" can't get a
 * word in. This is the number to move first if barge-in misbehaves in a real
 * room.
 */
export const MIC_BARGE_LEVEL = 0.06

export interface MicCapture {
  setMode(mode: MicMode): void
  /**
   * What is actually running — the track's applied settings, the capture
   * context's rate and the frame length — for the log and `client_info`.
   */
  info(): Record<string, unknown>
  close(): Promise<void>
}

/**
 * How much audio goes in one binary frame: 512 samples at 16 kHz, so ~32 ms and
 * 1 kB.
 *
 * A worklet is called once per 128-sample render quantum, which at 48 kHz is a
 * frame every 2.7 ms — around 85 bytes of payload each, 375 WebSocket frames a
 * second, and per-frame overhead several times the size of the audio. Batching
 * to ~32 ms costs latency nobody can perceive in a conversation and cuts that to
 * about 31 frames a second.
 */
const FRAME_SAMPLES = 512

/**
 * How much of a *quiet* answer to hold back while Elena is speaking, so that
 * cutting in doesn't cost the candidate the start of their sentence.
 *
 * The gate only lets frames past once they are loud enough to be an
 * interruption, but the hook's other door onto barge-in is **persistence** —
 * ordinary speech sustained for around half a second. Those frames are ordinary
 * by definition, so under a plain gate every one of them went out as silence
 * and Elena received "…ption B" rather than "Option B", on a question that
 * cannot be revisited.
 *
 * So they are held instead, and replayed the instant the gate opens. 24 frames
 * is ~768 ms — comfortably more than the sixteen the sustained door needs, and
 * the buffer cannot in practice reach it, because the same silent frame that
 * resets the hook's counter empties this.
 *
 * The cost is the one thing this file otherwise refuses to do: for as long as
 * the hold lasts, nothing goes up the socket. That is deliberate and it is
 * *bounded* — under a second, and only ever while somebody is audibly talking.
 * The stall the "always send silence" rule exists to prevent is the twenty
 * seconds Elena spends reading five options, and every one of those frames is
 * below the speech threshold and still sent as silence exactly as before.
 */
const PREROLL_FRAMES = 24

/**
 * Opens the microphone as a stream of 16 kHz PCM frames.
 *
 * The `stream` is the sitting's existing camera-and-microphone stream, not a
 * second `getUserMedia` — the candidate granted it on the camera screen, it is
 * already feeding the recording and the vitals sampler, and asking twice makes
 * the browser flash its permission indicator mid-interview.
 *
 * Returns null when this browser can't do it, which the caller treats as "run
 * the typed interview".
 */
export async function openMicCapture({
  stream,
  onFrame,
  onLevel,
}: {
  stream: MediaStream
  /** One frame of 16-bit LE mono PCM. Send it as a binary WebSocket frame. */
  onFrame: (frame: ArrayBuffer) => void
  /**
   * How loud that frame was, 0–1 RMS — about thirty times a second.
   *
   * This is the **end-of-speech signal**, and it is the frontend's job: the
   * backend never advances on silence, it advances when we say the answer is
   * finished. Measured from the outgoing samples rather than from captions,
   * because captions are a transcription — they arrive a second late, they stop
   * arriving if the transcriber has trouble, and a pause is exactly the moment
   * they say nothing at all.
   *
   * Deliberately not React state: at thirty a second it would re-render the room
   * thirty times a second. The caller keeps it in refs and lets a slow timer read
   * them.
   */
  onLevel: (level: number) => void
}): Promise<MicCapture | null> {
  if (stream.getAudioTracks().length === 0) {
    trace("voice", "the stream has no audio track — no microphone to send")
    return null
  }

  /*
   * **The device's own rate, resampled in the worklet.**
   *
   * This used to ask for a 16 kHz context so the browser would do the
   * resampling — because the worklet then only interpolated, which aliases
   * everything above 8 kHz into speech-shaped noise (on 2026-08-27 it turned
   * English into Telugu). The backend's 2026-11-16 guide reverses the first
   * half of that: forcing a 16 or 24 kHz context is reported to **bypass
   * Firefox's echo canceller**, and echo is what makes the interviewer cut
   * herself off. The second half is fixed in the worklet instead, which now
   * resamples through a real windowed-sinc low-pass — see
   * `pcm-capture-worklet.js`.
   */
  let context: AudioContext
  try {
    context = new AudioContext()
  } catch {
    return null
  }

  // Missing on anything without AudioWorklet (an insecure origin, or a browser
  // old enough that this whole feature isn't for it).
  if (!context.audioWorklet) {
    trace("voice", "this browser has no AudioWorklet — falling back to typed")
    void context.close()
    return null
  }

  try {
    await context.audioWorklet.addModule(captureWorkletUrl)
  } catch (error) {
    trace("voice", "the capture worklet wouldn't load", error)
    void context.close()
    return null
  }

  // Autoplay policy: a context created outside a gesture starts suspended, and
  // a suspended context never calls `process`, so the microphone would appear to
  // work and send nothing. The candidate pressed a button to get here, so this
  // normally resolves immediately.
  if (context.state === "suspended") {
    try {
      await context.resume()
    } catch {
      /* Reported by the silence, not by an exception. Carry on: the room offers
         nothing to press that would help, and a later gesture may resume it. */
    }
  }

  let mode: MicMode = "open"

  /* The opening of an answer given over the top of Elena — see PREROLL_FRAMES.
     Held here rather than sent, and replayed in order the moment the gate
     opens, so that cutting in costs the candidate nothing. */
  const preroll: ArrayBuffer[] = []

  const dropPreroll = () => {
    preroll.length = 0
  }

  const flushPreroll = () => {
    if (preroll.length === 0) return
    trace("voice", `sending ${preroll.length} held frames — the answer's start`)
    for (const held of preroll) onFrame(held)
    preroll.length = 0
  }

  let track = stream.getAudioTracks()[0]
  let source = context.createMediaStreamSource(stream)
  /** A microphone this capture opened itself, after the sitting's one ended. */
  let ownStream: MediaStream | null = null
  let closed = false

  const node = new AudioWorkletNode(context, "pcm-capture", {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [1],
    processorOptions: {
      inRate: context.sampleRate,
      outRate: MIC_SAMPLE_RATE,
      frameSamples: FRAME_SAMPLES,
    },
  })

  node.port.onmessage = (event) => {
    const frame = event.data as ArrayBuffer
    const pcm = new Int16Array(frame)

    // RMS of the frame, on the same 0–1 scale as the thresholds above. ~500
    // multiplications thirty times a second; it does not register.
    let sum = 0
    for (let index = 0; index < pcm.length; index += 1) {
      const sample = pcm[index] / 0x8000
      sum += sample * sample
    }
    const level = pcm.length ? Math.sqrt(sum / pcm.length) : 0
    onLevel(level)

    /*
     * Suppressed frames are sent as **silence**, not dropped — and the
     * difference is the whole interview.
     *
     * The far end is a live model with a continuous audio stream, not a
     * request/response API. Frames arriving every ~32 ms are also the only proof
     * it has that this session is alive, so a client that simply stops sending
     * while the host reads a question and its five options is a client that has
     * gone quiet for twenty seconds — and a stalled stream gets the session torn
     * down and restarted. What that looks like from the candidate's chair is
     * Elena greeting them again and re-asking the question they were part way
     * through answering.
     *
     * A zero-filled buffer is digital silence: the same bytes, the same cadence,
     * nothing for the transcriber to hear. It costs a kilobyte a frame to keep
     * the stream unbroken, which is the cheapest thing in this file.
     *
     * The **one** exception is the pre-roll below, which holds frames rather
     * than blanking them for well under a second, and only ever while somebody
     * is audibly speaking. See PREROLL_FRAMES for why that trade is the right
     * way round.
     */
    if (mode === "silent") {
      // Their decision or the camera's. Nothing they say may become an answer,
      // so there is nothing worth holding either.
      dropPreroll()
      onFrame(new ArrayBuffer(frame.byteLength))
      return
    }

    if (mode === "gated" && level < MIC_BARGE_LEVEL) {
      if (level >= MIC_SPEECH_LEVEL) {
        /* Too quiet to be an interruption on its own, too loud to be nothing.
           This is the shape of somebody beginning to answer at ordinary volume
           while she is still talking — and, before this buffer, the half-second
           of it that the sustained barge-in door needs to make up its mind was
           replaced with silence and lost. Held; see PREROLL_FRAMES. */
        if (preroll.length >= PREROLL_FRAMES) preroll.shift()
        preroll.push(frame)
        return
      }

      // Quiet: her own voice off the speakers, or an empty room. Whatever was
      // being held was not the start of an answer after all.
      dropPreroll()
      onFrame(new ArrayBuffer(frame.byteLength))
      return
    }

    // Open, or loud enough to be cutting in. Either way what was held is the
    // beginning of this same sentence and goes first.
    flushPreroll()
    onFrame(frame)
  }

  /*
   * The silent sink is load-bearing, not tidiness.
   *
   * A graph is pulled from the destination: a node whose output goes nowhere is
   * not rendered, and its `process` is never called. So the capture node has to
   * reach `destination` — but it must not be *heard*, or the candidate listens
   * to themselves a fraction of a second late, which is the single most
   * distracting thing a voice interface can do. Zero gain gives the graph its
   * pull and the room its silence.
   */
  const sink = context.createGain()
  sink.gain.value = 0

  source.connect(node)
  node.connect(sink)
  sink.connect(context.destination)

  /*
   * **Re-acquire the microphone if it goes away**, on the same socket.
   *
   * A Bluetooth headset switched off, a USB mic pulled out, or the OS handing
   * the device to another app ends the track. The worklet then receives nothing
   * — and nothing is not silence: the server stops seeing the quiet that ends
   * the candidate's turn, and the interviewer never replies. So a new
   * microphone is opened with the same constraints and wired into the same
   * worklet; the socket never notices.
   */
  const reacquire = async () => {
    if (closed) return
    trace("voice", "the microphone track ended — opening it again")
    try {
      const fresh = await navigator.mediaDevices.getUserMedia({
        audio: micAudioConstraints(),
      })
      if (closed) {
        fresh.getTracks().forEach((t) => t.stop())
        return
      }
      try {
        source.disconnect()
      } catch {
        /* already gone */
      }
      ownStream?.getTracks().forEach((t) => t.stop())
      ownStream = fresh
      track = fresh.getAudioTracks()[0]
      track?.addEventListener("ended", onEnded)
      source = context.createMediaStreamSource(fresh)
      source.connect(node)
      trace("voice", "microphone re-acquired", describeMicTrack(track))
    } catch (error) {
      trace("voice", "the microphone could not be re-acquired", error)
    }
  }
  function onEnded() {
    void reacquire()
  }
  track?.addEventListener("ended", onEnded)

  const info = () => ({
    mic: describeMicTrack(track),
    capture: {
      contextSampleRate: context.sampleRate,
      sendRate: MIC_SAMPLE_RATE,
      chunkMs: Math.round((FRAME_SAMPLES / MIC_SAMPLE_RATE) * 1000),
      chunkBytes: FRAME_SAMPLES * 2,
      resampler:
        "worklet windowed-sinc (Blackman, 8 zero crossings, 7.2 kHz cut-off)",
    },
  })

  trace("voice", "microphone open", info())

  return {
    info,
    setMode(next: MicMode) {
      if (next === mode) return
      /* Opening because the candidate cut in: the half-second of ordinary
         speech that convinced the hook of it is the start of their answer, and
         it goes up ahead of whatever the microphone hears next. */
      if (next === "open") flushPreroll()
      else if (next === "silent") dropPreroll()
      mode = next
    },
    async close() {
      closed = true
      track?.removeEventListener("ended", onEnded)
      // Only the microphone this capture opened itself; the sitting's own
      // stream belongs to the page (see below).
      ownStream?.getTracks().forEach((t) => t.stop())
      node.port.onmessage = null
      dropPreroll()
      try {
        source.disconnect()
        node.disconnect()
        sink.disconnect()
      } catch {
        /* already torn down */
      }
      // The stream's tracks are deliberately *not* stopped: they belong to the
      // sitting, and stopping them here would kill the recording and the vitals
      // sampler along with the microphone.
      try {
        await context.close()
      } catch {
        /* already closed */
      }
    },
  }
}

/* ========================================================================== */
/*  Both voices → the recording                                               */
/* ========================================================================== */

export interface AudioMixer {
  /**
   * The stream to record: the camera's video, and one audio track carrying
   * everything mixed into it.
   */
  readonly stream: MediaStream
  /** Adds another voice to the mix — Elena, when her player exists. */
  add(track: MediaStreamTrack): void
  close(): void
}

/**
 * Mixes several audio tracks into the one stream the recorder is given.
 *
 * **Why this can't be done by handing `MediaRecorder` two audio tracks:** it
 * records the first of each kind and ignores the rest. And it can't be done by
 * adding Elena's track once she exists either, because a recorder ignores tracks
 * added to a stream after `start()`.
 *
 * So the mix has to exist *before* recording starts, with a track whose identity
 * never changes and whose content gains voices as they turn up. That is exactly
 * what a `MediaStreamDestination` fed by a growing set of sources is: the
 * recorder holds one track from the first moment on the camera screen, and Elena
 * joins it a minute later without the recording noticing.
 *
 * Returns null if the browser can't do it, and the caller then records the raw
 * camera stream as before — a recording missing Elena is worth far more than no
 * recording.
 */
export function createAudioMixer(camera: MediaStream): AudioMixer | null {
  let context: AudioContext
  try {
    context = new AudioContext()
  } catch {
    return null
  }

  let destination: MediaStreamAudioDestinationNode
  try {
    destination = context.createMediaStreamDestination()
  } catch {
    void context.close()
    return null
  }

  const sources: MediaStreamAudioSourceNode[] = []
  const added = new Set<string>()

  const add = (track: MediaStreamTrack) => {
    // Tracks can be offered twice — a reconnect builds a new player, and the
    // effect that hands it over runs again.
    if (added.has(track.id)) return
    try {
      const source = context.createMediaStreamSource(new MediaStream([track]))
      source.connect(destination)
      sources.push(source)
      added.add(track.id)
    } catch {
      /* One voice missing from the recording. Not fatal to anything. */
    }
  }

  for (const track of camera.getAudioTracks()) add(track)

  const mixedAudio = destination.stream.getAudioTracks()[0]
  if (!mixedAudio) {
    void context.close()
    return null
  }

  trace("voice", "recording both voices", {
    inputs: added.size,
  })

  return {
    // The camera's video track untouched — only the audio is rebuilt.
    stream: new MediaStream([...camera.getVideoTracks(), mixedAudio]),
    add,
    close() {
      for (const source of sources) {
        try {
          source.disconnect()
        } catch {
          /* already gone */
        }
      }
      sources.length = 0
      destination.disconnect()
      // The mixed track is stopped with the context; the camera's own tracks are
      // untouched, because they belong to the sitting and not to this mixer.
      void context.close()
    },
  }
}

/* ========================================================================== */
/*  Socket → speakers                                                         */
/* ========================================================================== */

/** What one {@link HostPlayer.flush} threw away. */
export interface FlushReport {
  /** Chunks stopped: the one playing plus every one scheduled after it. */
  droppedChunks: number
  /** Seconds of her that were queued and will now never be heard. */
  droppedSeconds: number
  /** Sources still live after the flush. Always 0; logged to prove it. */
  activeSources: number
}

export interface HostPlayer {
  /** Queues one binary frame of Elena's voice, back-to-back with the last. */
  play(frame: ArrayBuffer): void
  setMuted(muted: boolean): void
  /**
   * **Stops the clock her audio is scheduled against, without losing any of it.**
   *
   * Distinct from {@link setMuted}, and the difference is the whole point. Mute
   * turns the speakers down while the schedule keeps running underneath, so
   * unmuting lands the candidate wherever Elena has got to by then — several
   * sentences on, with the ones in between simply gone. A hold suspends the
   * `AudioContext`: `currentTime` freezes, everything already scheduled stays
   * scheduled, and frames arriving during the hold queue up behind the cursor
   * exactly as they would have. Resuming plays the lot, from where it stopped.
   *
   * Which is what "don't ask a question the candidate cannot answer" needs. The
   * camera losing their face mutes the microphone — so anything Elena says
   * during it is a question read into an empty room, and the answer recorded
   * for it is silence. Held instead, she waits, and the candidate hears the
   * question when they are back in frame and able to answer it.
   *
   * ⚠️ **It cannot stop the *server* advancing**, and nothing in this client
   * can: the protocol has four frames from us — `auth`, `select`, `next`, `end`
   * — and none of them means "wait". The backend's 75 s safety net is a timer
   * measured from the end of *her* audio, so a face lost for longer than that
   * still burns the question. This closes the common case (a few seconds out of
   * frame) completely and the long case not at all. See
   * `BACKEND-REQUEST-voice-camera-hold.md`.
   */
  setHeld(held: boolean): void
  /**
   * Drops what hasn't been heard yet — an interruption, ending the sitting, or
   * a hold. Stops the chunk playing now too, and resets the clock so her next
   * reply starts at once. Says what it dropped, for the dev log.
   */
  flush(): FlushReport
  /**
   * How many seconds of Elena are queued here and **not yet heard**.
   *
   * The single most useful number on this socket, because it is the size of the
   * gap between the server's clock and the candidate's ears. Her audio is
   * generated far faster than it plays, so the backend can believe it has been
   * waiting through fifteen seconds of silence while the candidate is still
   * hearing the middle of the question — and anything the server does on a
   * silence timer then fires into someone who has not been given a chance to
   * speak yet.
   *
   * Traced at `question` and `turn_complete`, which are the two moments the
   * divergence decides something.
   */
  queuedSeconds(): number
  /**
   * Elena's voice as a track, for the sitting's **recording**.
   *
   * The proctoring recorder stores what `MediaRecorder` is given, which is the
   * camera and the microphone — and Elena is neither. Without this the recruiter's
   * playback of a voice interview has the candidate's answers and only room echo
   * where the questions were: half a conversation, and the half that makes the
   * other half mean anything.
   *
   * Null on a browser that won't give us a stream destination; the recording then
   * carries on exactly as it does today, one voice short.
   */
  readonly recordingTrack: MediaStreamTrack | null
  /** What the player is doing, for the log and `client_info`. */
  info(): Record<string, unknown>
  close(): Promise<void>
}

/**
 * How far ahead of "now" the next chunk is scheduled when the queue has run dry.
 *
 * Audio scheduled at `currentTime` is already late by the time the audio thread
 * reaches it, and lateness is a click. 80 ms is inaudible in conversation and
 * absorbs an ordinary network hiccup between two chunks of the same sentence.
 */
const SCHEDULE_LEAD_S = 0.08

/**
 * Elena's voice: 24 kHz Int16 chunks in, one continuous utterance out.
 *
 * The queue is a **clock, not a list**. Each chunk is scheduled to start exactly
 * where the previous one ends, so consecutive chunks meet sample-accurately and
 * the speech has no seams in it. Playing each chunk on arrival instead — the
 * obvious implementation — leaves a gap the length of the network jitter between
 * every pair, which sounds like a stutter and makes her hard to follow.
 *
 * `onSpeakingChange` drives the orb and the "answer when she finishes" line, and
 * it is derived from that same clock: she is speaking exactly while the schedule
 * runs ahead of the context's own time.
 */
export function createHostPlayer({
  onSpeakingChange,
}: {
  onSpeakingChange: (speaking: boolean) => void
}): HostPlayer | null {
  let context: AudioContext
  try {
    /* The device's own rate, not the wire's 24 kHz. Forcing a 24 kHz context
       is reported to bypass Firefox's echo canceller (2026-11-16 guide) — and
       this is the context whose output the canceller has to subtract from the
       microphone. The `AudioBuffer`s below are created at 24 kHz and the
       browser resamples them on playback, so nothing plays at the wrong speed. */
    context = new AudioContext()
  } catch {
    return null
  }

  /*
   * Two gains, and the split between them is load-bearing.
   *
   * `bus` is everything Elena says. `speakers` is the part of it the candidate
   * hears, and it is the only one `setMuted` touches — so muting her silences
   * the room *without* silencing her in the recording.
   *
   * This is the reverse of how it was first built, where the tap hung off the
   * muted gain on the reasoning that a recording should be what happened. The
   * recording is not evidence of what the candidate heard; it is how a recruiter
   * reviews the interview, and half a conversation is exactly the thing §12.7's
   * mixer was added to stop. A muted stretch under the old graph came back as
   * the candidate answering questions that are not on the tape, with nothing to
   * say why — which is worse than useless, because it reads as a fault.
   */
  const bus = context.createGain()
  const speakers = context.createGain()
  bus.connect(speakers)
  speakers.connect(context.destination)

  /*
   * A second, silent destination: the same audio, as a track the recorder can
   * take. Fed from `bus`, before the mute.
   */
  let recordingTrack: MediaStreamTrack | null = null
  try {
    const tap = context.createMediaStreamDestination()
    bus.connect(tap)
    recordingTrack = tap.stream.getAudioTracks()[0] ?? null
  } catch {
    // No stream destination on this browser. The recording is one voice short,
    // which is not a reason to fail the interview.
  }

  /** Where the next chunk starts, on the context's clock. */
  let cursor = 0
  /** Live sources, so a flush can actually stop what is already scheduled. */
  const playing = new Set<AudioBufferSourceNode>()
  let speaking = false
  let settle: number | null = null

  const setSpeaking = (next: boolean) => {
    if (speaking === next) return
    speaking = next
    onSpeakingChange(next)
  }

  /**
   * Re-arms the "she has stopped" check for the end of the current queue.
   *
   * A timer rather than an `onended` handler on each source: chunks arrive in a
   * continuous stream, so every chunk's `ended` fires while the next is already
   * playing, and driving the flag from that would flicker it dozens of times a
   * sentence. The extra 90 ms is what distinguishes "the sentence is over" from
   * "the next chunk is a moment late".
   */
  const armSettle = () => {
    if (settle !== null) window.clearTimeout(settle)
    const remaining = Math.max(0, cursor - context.currentTime)
    settle = window.setTimeout(
      () => {
        settle = null
        if (cursor - context.currentTime <= 0.02) setSpeaking(false)
      },
      remaining * 1000 + 90
    )
  }

  /** Named rather than inlined into `flush` below, because `close` needs it too. */
  const dropQueued = (): FlushReport => {
    const droppedChunks = playing.size
    const droppedSeconds = Math.max(0, cursor - context.currentTime)
    for (const source of playing) {
      try {
        source.stop()
      } catch {
        /* never started, or already finished */
      }
      source.disconnect()
    }
    playing.clear()
    cursor = 0
    if (settle !== null) {
      window.clearTimeout(settle)
      settle = null
    }
    setSpeaking(false)
    return { droppedChunks, droppedSeconds, activeSources: playing.size }
  }

  /**
   * The room is holding her — see `setHeld`.
   *
   * A flag rather than reading `context.state`, because a suspended context has
   * two possible causes and they need opposite handling: the browser suspending
   * a backgrounded tab must be resumed from under us, and a hold we asked for
   * must not be.
   */
  let held = false

  return {
    play(frame: ArrayBuffer) {
      /* A tab that was backgrounded can have its context suspended out from
         under it; without this Elena is simply silent from then on. Never while
         held — that is our own suspend, and resuming it here would undo the
         hold the moment her next frame arrived, which is continuously. */
      if (!held && context.state === "suspended") void context.resume()

      const pcm = new Int16Array(frame)
      if (pcm.length === 0) return

      // Int16 → Float32 in the range the Web Audio graph works in. Divided by
      // 0x8000 for both signs: that is the inverse of the encoder's negative
      // scale, and it is the only divisor that cannot produce a value outside
      // ±1 (0x7fff / 0x8000 is just short of 1).
      const samples = new Float32Array(pcm.length)
      for (let index = 0; index < pcm.length; index += 1) {
        samples[index] = pcm[index] / 0x8000
      }

      const buffer = context.createBuffer(1, samples.length, HOST_SAMPLE_RATE)
      buffer.getChannelData(0).set(samples)

      const source = context.createBufferSource()
      source.buffer = buffer
      source.connect(bus)

      const start = Math.max(cursor, context.currentTime + SCHEDULE_LEAD_S)
      source.start(start)
      cursor = start + buffer.duration

      playing.add(source)
      source.onended = () => {
        playing.delete(source)
        source.disconnect()
      }

      setSpeaking(true)
      armSettle()
    },

    setMuted(muted: boolean) {
      // The gain, not a disconnect: muting has to be instant and reversible
      // mid-sentence, and the schedule must keep running underneath it so
      // unmuting lands the candidate where Elena actually is rather than
      // replaying what they missed.
      //
      // `speakers`, not `bus` — the recording tap is upstream of this, and she
      // stays on the tape whether or not the candidate is listening.
      speakers.gain.value = muted ? 0 : 1
    },

    setHeld(next: boolean) {
      if (held === next) return
      held = next

      if (next) {
        void context.suspend()
        /* The settle timer runs on the wall clock, not the audio clock. While
           suspended `cursor - currentTime` stays put, so it would never decide
           she had stopped — but it would keep re-arming pointlessly, and on
           resume the remaining time it was measured against is wrong. Cleared
           here and re-armed below against the real remainder. */
        if (settle !== null) {
          window.clearTimeout(settle)
          settle = null
        }
        /* Deliberately **not** `setSpeaking(false)`. She has unheard audio and
           is mid-turn; saying otherwise would open the microphone gate and let
           the answer clock run on a question nobody has heard yet. */
        return
      }

      void context.resume()
      // Whatever is left plays from here, so the "she has stopped" check is
      // measured from now rather than from before the hold.
      if (cursor > context.currentTime) armSettle()
      else setSpeaking(false)
    },

    flush: dropQueued,

    queuedSeconds() {
      return Math.max(0, cursor - context.currentTime)
    },

    recordingTrack,

    info() {
      return {
        contextSampleRate: context.sampleRate,
        contextState: context.state,
        wireRate: HOST_SAMPLE_RATE,
        scheduling:
          "startAt = max(cursor, currentTime + lead); cursor = startAt + duration",
        startLeadMs: SCHEDULE_LEAD_S * 1000,
        output: "page output (AudioContext.destination)",
      }
    },

    async close() {
      dropQueued()
      bus.disconnect()
      speakers.disconnect()
      try {
        await context.close()
      } catch {
        /* already closed */
      }
    },
  }
}
