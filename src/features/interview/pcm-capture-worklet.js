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
 * also the only way to see the samples at all: this is the one node type that
 * gets the actual audio on the audio thread.
 */

/** ~32 ms of audio per frame at 16 kHz. See the note in `voice-audio.ts`. */
const DEFAULT_FRAME_SAMPLES = 512

class PcmCapture extends AudioWorkletProcessor {
  constructor(options) {
    super()
    const settings = (options && options.processorOptions) || {}

    /**
     * Input samples consumed per output sample — 3 at the usual 48 kHz.
     *
     * Kept as a float and never rounded: at 44.1 kHz the ratio is 2.75625, and
     * rounding it to 3 would hand Gemini audio 9% slow for the length of the
     * interview. Slightly-wrong-speed speech is worse than no speech, because it
     * transcribes to plausible wrong words rather than to nothing.
     */
    this.step = (settings.inRate || sampleRate) / (settings.outRate || 16000)

    this.out = new Int16Array(settings.frameSamples || DEFAULT_FRAME_SAMPLES)
    this.filled = 0

    /**
     * Where the next output sample sits inside the *current* input block, as a
     * fraction.
     *
     * Carried across `process` calls, and that is the whole trick: a render
     * quantum is 128 samples, which is not a whole number of output samples at
     * any real rate. Restarting from zero each block — as the naive
     * `for (i = 0; i < n; i += ratio)` does — drops or repeats a fraction of a
     * sample 375 times a second, and the accumulated jitter is audible as a
     * rasp on the transcriber's side.
     */
    this.cursor = 0
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0]
    // No input yet, or a track that has gone away. Returning true keeps the
    // node alive so it picks up again — false would retire the processor for
    // good and silently end the interview's audio.
    if (!channel) return true

    const length = channel.length
    let cursor = this.cursor

    while (cursor < length) {
      const index = cursor | 0
      const fraction = cursor - index
      const current = channel[index]
      // Linear interpolation, except across the block seam: the sample after
      // the last one lives in the *next* quantum, so the final output sample of
      // each block is taken as-is. That is one sample in 128 — inaudible — and
      // the alternative is holding a block back, which adds latency to every
      // frame to fix nothing anybody can hear.
      const next = index + 1 < length ? channel[index + 1] : current
      const sample = current + (next - current) * fraction

      // Clamped before scaling: a gain-staged mic can exceed ±1, and the
      // wrap-around from an out-of-range Int16 is a click on every peak.
      const clamped = sample < -1 ? -1 : sample > 1 ? 1 : sample
      // Asymmetric on purpose — two's complement has one more negative value
      // than positive, and scaling both by 0x8000 clips every full-scale peak.
      this.out[this.filled++] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff

      if (this.filled === this.out.length) {
        // A copy, transferred: the buffer is handed to the main thread with no
        // structured clone, and this processor keeps writing into its own.
        const frame = this.out.slice()
        this.port.postMessage(frame.buffer, [frame.buffer])
        this.filled = 0
      }

      cursor += this.step
    }

    // Keeps the fractional remainder, which is the point of the cursor.
    this.cursor = cursor - length
    return true
  }
}

registerProcessor("pcm-capture", PcmCapture)
