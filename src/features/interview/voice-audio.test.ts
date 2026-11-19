import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { createHostPlayer } from "./voice-audio"

/* ---- a Web Audio graph, faked: jsdom has no AudioContext ------------------ */

interface FakeSource {
  buffer: { duration: number } | null
  onended: (() => void) | null
  connect: ReturnType<typeof vi.fn>
  disconnect: ReturnType<typeof vi.fn>
  start: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
}

let sources: FakeSource[] = []
let context: FakeContext

class FakeContext {
  currentTime = 0
  state = "running"
  sampleRate = 48_000
  destination = {}
  suspend = vi.fn(async () => {})
  resume = vi.fn(async () => {})
  close = vi.fn(async () => {})
  constructor() {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    context = this
  }
  createGain() {
    return { connect() {}, disconnect() {}, gain: { value: 1 } }
  }
  createMediaStreamDestination(): never {
    throw new Error("not in jsdom")
  }
  createBuffer(_channels: number, length: number, rate: number) {
    return {
      duration: length / rate,
      getChannelData: () => new Float32Array(length),
    }
  }
  createBufferSource() {
    const source: FakeSource = {
      buffer: null,
      onended: null,
      connect: vi.fn(),
      disconnect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    }
    sources.push(source)
    return source
  }
}

/** 0.1 s of her voice: 2400 samples at 24 kHz, 16-bit. */
const chunk = () => new ArrayBuffer(2400 * 2)

beforeEach(() => {
  sources = []
  vi.useFakeTimers()
  vi.stubGlobal("AudioContext", FakeContext)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe("host player flush (the candidate interrupted)", () => {
  it("stops what is playing and everything queued, and says how much", () => {
    const speaking: boolean[] = []
    const player = createHostPlayer({
      onSpeakingChange: (on) => speaking.push(on),
    })!
    player.play(chunk())
    player.play(chunk())
    player.play(chunk())
    // 80 ms lead, then three 0.1 s chunks back to back.
    expect(player.queuedSeconds()).toBeCloseTo(0.38, 5)

    const report = player.flush()

    expect(report.droppedChunks).toBe(3)
    expect(report.droppedSeconds).toBeCloseTo(0.38, 5)
    expect(report.activeSources).toBe(0)
    for (const source of sources) {
      expect(source.stop).toHaveBeenCalledTimes(1)
      expect(source.disconnect).toHaveBeenCalled()
    }
    expect(player.queuedSeconds()).toBe(0)
    expect(speaking.at(-1)).toBe(false)
    // Never closed or suspended: her next reply must not wait on a resume.
    expect(context.close).not.toHaveBeenCalled()
    expect(context.suspend).not.toHaveBeenCalled()
  })

  it("plays her next reply straight away, from a reset clock", () => {
    const player = createHostPlayer({ onSpeakingChange: () => {} })!
    for (let i = 0; i < 20; i += 1) player.play(chunk()) // 2 s queued ahead
    context.currentTime = 0.5 // half a second into it, they cut in
    player.flush()

    player.play(chunk())
    const next = sources.at(-1)!
    // Starts at now + the 80 ms lead, not after the 1.5 s that was dropped.
    expect(next.start).toHaveBeenCalledWith(0.58)
    expect(next.stop).not.toHaveBeenCalled()
    expect(player.queuedSeconds()).toBeCloseTo(0.18, 5)
  })

  it("survives a chunk that had already finished", () => {
    const player = createHostPlayer({ onSpeakingChange: () => {} })!
    player.play(chunk())
    sources[0]!.stop.mockImplementation(() => {
      throw new Error("InvalidStateError")
    })
    expect(() => player.flush()).not.toThrow()
    expect(player.flush().activeSources).toBe(0)
  })

  it("with nothing queued, drops nothing", () => {
    const player = createHostPlayer({ onSpeakingChange: () => {} })!
    expect(player.flush()).toEqual({
      droppedChunks: 0,
      droppedSeconds: 0,
      activeSources: 0,
    })
  })
})
