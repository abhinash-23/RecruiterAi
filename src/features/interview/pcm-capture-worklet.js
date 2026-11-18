/**
 * ============================================================================
 * MICROPHONE → 16 kHz 16-bit PCM  (AudioWorkletProcessor)
 * ============================================================================
 * Runs on the browser's audio thread and turns the microphone into exactly what
 * the voice socket carries: **mono, 16-bit little-endian PCM at 16 kHz**, posted
 * back as `ArrayBuffer`s the hook forwards as binary frames.
 *
 * Loaded by URL rather than imported — `voice-audio.ts` does the
 * `addModule(…?url&no-inline)`, because an `AudioWorklet` module is fetched by
 * the audio thread and cannot go through the app's bundle graph. `?url` alone
 * would let Vite inline a file this small as a `data:` URI in the production
 * build, which `addModule` refuses.
 *
 * ⚠️ **Plain JavaScript, and not part of the app's module graph.** No imports,
 * no TypeScript, no `@/` alias: this text is evaluated in `AudioWorkletGlobalScope`,
 * which has none of them. `sampleRate` and `registerProcessor` are globals of
 * that scope. It is also outside ESLint's net, which covers `.ts` and `.tsx`
 * only, so nothing here is linted — keep it small enough to read in one go.
 *
 * **Why a worklet at all, and not `MediaRecorder`?** Every `MediaRecorder`
 * output is a *container* — WebM/Opus, or MP4/AAC — and Gemini is handed these
 * bytes as raw samples. A compressed frame read as PCM is noise. A worklet is
 * also the only way to see the samples at all, and — unlike a timer or a
 * `ScriptProcessorNode` — it is not throttled in a background tab, so frames
 * leave at an even rate.
 *
 * **The resampler.** The context runs at the device's own rate (usually 48 or
 * 44.1 kHz): forcing a 16 kHz context is reported to bypass Firefox's echo
 * canceller. So this has to get to 16 kHz itself, and it must do it with a real
 * low-pass filter in front — dropping or interpolating samples folds everything
 * above 8 kHz back into the band as speech-shaped noise, which a transcriber
 * turns into confident wrong words (on 2026-08-27, a confident wrong language).
 *
 * Each output sample is a windowed-sinc (Blackman) band-limited interpolation of
 * the input around its exact fractional position: filtering and resampling in
 * one step, cut off at 45% of the output rate (7.2 kHz), eight zero crossings
 * each side. About 0.6 ms of added latency and ~55 multiply-adds per output
 * sample at 48 kHz.
 */

/** ~32 ms of audio per frame at 16 kHz. See the note in `voice-audio.ts`. */
const DEFAULT_FRAME_SAMPLES = 512

/** Kernel width, in zero crossings of the sinc on each side. */
const ZERO_CROSSINGS = 8

/** Kernel table resolution: entries per input sample. */
const TABLE_RES = 128

class PcmCapture extends AudioWorkletProcessor {
  constructor(options) {
    super()
    const settings = (options && options.processorOptions) || {}
    const inRate = settings.inRate || sampleRate
    const outRate = settings.outRate || 16000

    /**
     * Input samples consumed per output sample — 3 at 48 kHz, 2.75625 at 44.1.
     * Kept as a float and never rounded: rounding 2.75625 to 3 would hand
     * Gemini audio 9% slow for the length of the interview.
     */
    this.step = inRate / outRate

    /* Cut-off in cycles per *input* sample, below the output's Nyquist with
       room for the filter's transition band. */
    const cutoff = (0.45 * Math.min(inRate, outRate)) / inRate
    /** Half the kernel's width, in input samples. */
    this.half = Math.ceil(ZERO_CROSSINGS / (2 * cutoff))

    /* h(x) for x in [0, half], tabulated so the audio thread never calls
       Math.sin. Windowed with Blackman, which keeps the stop band ~70 dB down. */
    const size = this.half * TABLE_RES + 2
    this.table = new Float32Array(size)
    for (let i = 0; i < size; i += 1) {
      const x = i / TABLE_RES
      if (x >= this.half) continue
      const t = 2 * cutoff * x
      const sinc = t === 0 ? 1 : Math.sin(Math.PI * t) / (Math.PI * t)
      const phase = (Math.PI * x) / this.half
      const window = 0.42 + 0.5 * Math.cos(phase) + 0.08 * Math.cos(2 * phase)
      this.table[i] = sinc * window
    }

    /*
     * The input history the kernel reads from, indexed absolutely: `buf[0]` is
     * input sample `base`. Primed with `half` zeros so the very first output
     * sample has a full window behind it.
     */
    this.buf = new Float32Array(4096)
    this.len = this.half
    this.base = -this.half
    /** Absolute, fractional input position of the next output sample. */
    this.pos = 0

    this.out = new Int16Array(settings.frameSamples || DEFAULT_FRAME_SAMPLES)
    this.filled = 0
  }

  kernel(x) {
    const at = (x < 0 ? -x : x) * TABLE_RES
    const index = at | 0
    if (index >= this.table.length - 1) return 0
    const low = this.table[index]
    return low + (this.table[index + 1] - low) * (at - index)
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0]
    // No input yet, or a track that has gone away. Returning true keeps the
    // node alive so it picks up again — false would retire the processor for
    // good and silently end the interview's audio.
    if (!channel) return true

    // Append this render quantum to the history.
    if (this.len + channel.length > this.buf.length) {
      const grown = new Float32Array(
        Math.max(this.buf.length * 2, this.len + channel.length)
      )
      grown.set(this.buf.subarray(0, this.len))
      this.buf = grown
    }
    this.buf.set(channel, this.len)
    this.len += channel.length

    const end = this.base + this.len
    const half = this.half

    // Emit every output sample whose whole window is now available.
    while (this.pos + half + 1 < end) {
      const center = Math.floor(this.pos)
      let acc = 0
      let weights = 0
      for (let k = center - half + 1; k <= center + half; k += 1) {
        const weight = this.kernel(this.pos - k)
        acc += this.buf[k - this.base] * weight
        weights += weight
      }
      // Normalised by the weights actually used, so the gain is exactly 1 at
      // every fractional position rather than rippling with it.
      const sample = weights ? acc / weights : 0

      // Clamped before scaling: a gain-staged mic can exceed ±1, and the
      // wrap-around from an out-of-range Int16 is a click on every peak.
      const clamped = sample < -1 ? -1 : sample > 1 ? 1 : sample
      // Asymmetric on purpose — two's complement has one more negative value
      // than positive, and scaling both by 0x8000 clips every full-scale peak.
      this.out[this.filled++] =
        clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff

      if (this.filled === this.out.length) {
        // A copy, transferred: the buffer is handed to the main thread with no
        // structured clone, and this processor keeps writing into its own.
        // Posted the moment it is full — no batching, so frames leave at the
        // capture's own even cadence.
        const frame = this.out.slice()
        this.port.postMessage(frame.buffer, [frame.buffer])
        this.filled = 0
      }

      this.pos += this.step
    }

    // Keep only what the next window can still reach.
    const drop = Math.floor(this.pos) - half - this.base
    if (drop > 0) {
      this.buf.copyWithin(0, drop, this.len)
      this.len -= drop
      this.base += drop
    }
    return true
  }
}

registerProcessor("pcm-capture", PcmCapture)
