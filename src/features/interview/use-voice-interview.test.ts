import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/* ---- the audio ends, faked: no AudioContext in jsdom ---------------------- */

const audio = vi.hoisted(() => ({
  player: null as null | {
    played: number
    flushes: number
    held: boolean[]
    queued: number
    speaking: (on: boolean) => void
  },
  capture: null as null | {
    modes: string[]
    level: (value: number) => void
  },
}))

vi.mock("./voice-audio", () => ({
  MIC_SPEECH_LEVEL: 0.02,
  MIC_BARGE_LEVEL: 0.06,
  createHostPlayer: ({
    onSpeakingChange,
  }: {
    onSpeakingChange: (on: boolean) => void
  }) => {
    const state = {
      played: 0,
      flushes: 0,
      held: [] as boolean[],
      queued: 0,
      speaking: onSpeakingChange,
    }
    audio.player = state
    return {
      play: () => {
        state.played += 1
      },
      setMuted: () => {},
      setHeld: (held: boolean) => state.held.push(held),
      flush: () => {
        state.flushes += 1
        return { droppedChunks: 0, droppedSeconds: 0, activeSources: 0 }
      },
      queuedSeconds: () => state.queued,
      recordingTrack: null,
      info: () => ({ contextSampleRate: 48000 }),
      close: async () => {},
    }
  },
  openMicCapture: async ({ onLevel }: { onLevel: (level: number) => void }) => {
    const state = { modes: [] as string[], level: onLevel }
    audio.capture = state
    return {
      setMode: (mode: string) => state.modes.push(mode),
      info: () => ({ capture: { chunkMs: 32 } }),
      close: async () => {},
    }
  },
}))

import { useVoiceInterview } from "./use-voice-interview"

/* ---- a WebSocket the test drives ----------------------------------------- */

class FakeSocket {
  static OPEN = 1
  static CONNECTING = 0
  static last: FakeSocket | null = null
  readyState = 0
  binaryType = "blob"
  sent: unknown[] = []
  onopen: (() => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null
  onclose: ((event: { code: number; reason: string }) => void) | null = null
  onerror: (() => void) | null = null
  url: string
  constructor(url: string) {
    this.url = url
    FakeSocket.last = this
  }
  send(data: unknown) {
    this.sent.push(data)
  }
  close() {
    this.readyState = 3
  }
  open() {
    this.readyState = 1
    this.onopen?.()
  }
  frame(message: Record<string, unknown>) {
    this.onmessage?.({ data: JSON.stringify(message) })
  }
  /** The JSON frames sent, parsed; binary ones skipped. */
  json(): Array<Record<string, unknown>> {
    return this.sent
      .filter((item): item is string => typeof item === "string")
      .map((item) => JSON.parse(item) as Record<string, unknown>)
  }
}

const stream = { getAudioTracks: () => [{}] } as unknown as MediaStream

async function start(rev: number) {
  const hook = renderHook(
    ({ faceLost }) =>
      useVoiceInterview({
        active: true,
        sessionId: "s1",
        token: "t1",
        stream,
        faceLost,
        onComplete: () => {},
        onHandover: () => {},
      }),
    { initialProps: { faceLost: false } }
  )
  // The open is deferred a beat — see CONNECT_SETTLE_MS.
  act(() => {
    vi.advanceTimersByTime(150)
  })
  const socket = FakeSocket.last!
  act(() => socket.open())
  await act(async () => {
    socket.frame({ type: "ready", rev, totalQuestions: 3 })
    // openMicCapture resolves across an await.
    await Promise.resolve()
    await Promise.resolve()
  })
  return { hook, socket }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal("WebSocket", FakeSocket)
  FakeSocket.last = null
  audio.player = null
  audio.capture = null
})

afterEach(() => {
  vi.useRealTimers()
})

describe("useVoiceInterview on a rev-7 backend", () => {
  it("authenticates first and reports its audio settings once", async () => {
    const { socket } = await start(7)
    const frames = socket.json()
    expect(frames[0]).toMatchObject({ type: "auth", token: "t1" })
    const info = frames.filter((frame) => frame.type === "client_info")
    expect(info).toHaveLength(1)
    expect(info[0]).toMatchObject({ revSeen: 7, micMode: "continuous" })
  })

  it("never gates the microphone while the interviewer speaks", async () => {
    await start(7)
    act(() => audio.player!.speaking(true))
    expect(audio.capture!.modes).not.toContain("gated")
    expect(audio.capture!.modes.at(-1)).toBe("open")
  })

  it("builds the transcript from transcript frames: one bubble per id, sorted by id", async () => {
    const { hook, socket } = await start(7)
    act(() => {
      socket.frame({ type: "question", index: 0, of: 3, kind: "text" })
      socket.frame({
        type: "transcript",
        id: 2,
        who: "assistant",
        text: "Tell me",
        final: false,
        at: 1,
        index: 0,
      })
      socket.frame({
        type: "transcript",
        id: 2,
        who: "assistant",
        text: "Tell me about yourself.",
        final: true,
        at: 1,
        index: 0,
      })
      socket.frame({
        type: "transcript",
        id: 3,
        who: "candidate",
        text: "I am",
        final: false,
        at: 2,
        index: 0,
      })
    })
    expect(hook.result.current.liveCaption).toBe("I am")

    act(() => {
      // Her reply lands before the candidate's line is final…
      socket.frame({
        type: "transcript",
        id: 4,
        who: "assistant",
        text: "Great, and",
        final: false,
        at: 3,
        index: 0,
      })
      socket.frame({
        type: "transcript",
        id: 3,
        who: "candidate",
        text: "I am a developer.",
        final: true,
        at: 2,
        index: 0,
      })
      // …and raw caption fragments are not rendered.
      socket.frame({ type: "caption", who: "assistant", text: "fragment" })
    })

    const lines = hook.result.current.captions
    expect(lines.map((line) => line.text)).toEqual([
      "Tell me about yourself.",
      "I am a developer.",
      "Great, and",
    ])
    expect(lines.map((line) => line.speaker)).toEqual([
      "host",
      "candidate",
      "host",
    ])
    expect(hook.result.current.liveCaption).toBeNull()
  })

  it("stops playback on interrupted and replaces the cut line by id", async () => {
    const { hook, socket } = await start(7)
    act(() => {
      socket.frame({
        type: "transcript",
        id: 5,
        who: "assistant",
        text: "The options are A, B and C.",
        final: true,
        at: 1,
        index: 0,
      })
      socket.frame({ type: "interrupted" })
      socket.frame({ type: "interrupted" }) // twice, close together: harmless
      socket.frame({
        type: "transcript",
        id: 5,
        who: "assistant",
        text: "The options are—",
        final: true,
        at: 1,
        index: 0,
      })
    })
    expect(audio.player!.flushes).toBe(2)
    expect(hook.result.current.captions.map((line) => line.text)).toEqual([
      "The options are—",
    ])
  })

  it("plays her next reply after an interruption, and never flushes on turn_complete", async () => {
    const { socket } = await start(7)
    act(() => {
      socket.frame({ type: "question", index: 0, of: 3, kind: "text" })
      socket.onmessage?.({ data: new ArrayBuffer(960) })
      socket.onmessage?.({ data: new ArrayBuffer(960) })
    })
    const modesBefore = audio.capture!.modes.length
    act(() => {
      socket.frame({ type: "interrupted" })
    })
    expect(audio.player!.flushes).toBe(1)
    // The candidate is talking: the microphone is never shut by this.
    expect(audio.capture!.modes.slice(modesBefore)).not.toContain("silent")
    expect(audio.capture!.modes.slice(modesBefore)).not.toContain("gated")

    // Her reply to what they said: played, not dropped.
    const played = audio.player!.played
    act(() => {
      socket.onmessage?.({ data: new ArrayBuffer(960) })
      socket.onmessage?.({ data: new ArrayBuffer(960) })
    })
    expect(audio.player!.played).toBe(played + 2)

    // Finished generating is not finished playing: the end must be heard.
    act(() => {
      socket.frame({ type: "turn_complete" })
    })
    expect(audio.player!.flushes).toBe(1)
  })

  it("does not stop the interviewer on loud microphone input — the server decides", async () => {
    await start(7)
    act(() => audio.player!.speaking(true))
    act(() => {
      for (let i = 0; i < 40; i += 1) audio.capture!.level(0.2)
    })
    expect(audio.player!.flushes).toBe(0)
  })

  it("sends next only when Done is pressed, never after silence", async () => {
    const { hook, socket } = await start(7)
    act(() => {
      socket.frame({ type: "question", index: 0, of: 3, kind: "text" })
      socket.onmessage?.({ data: new ArrayBuffer(960) }) // her audio: heard
      socket.frame({ type: "turn_complete" })
    })
    act(() => {
      for (let i = 0; i < 20; i += 1) audio.capture!.level(0.2)
    })
    act(() => {
      vi.advanceTimersByTime(60_000)
    })
    expect(socket.json().filter((frame) => frame.type === "next")).toHaveLength(
      0
    )

    act(() => hook.result.current.next())
    expect(socket.json().filter((frame) => frame.type === "next")).toEqual([
      { type: "next", index: 0 },
    ])
  })

  it("keeps playing her audio when the camera loses the candidate; only the mic goes silent", async () => {
    const { hook } = await start(7)
    hook.rerender({ faceLost: true })
    expect(audio.player!.held.at(-1)).toBe(false)
    expect(audio.capture!.modes.at(-1)).toBe("silent")
  })

  it("takes the speaker and time from the frame when an id comes again", async () => {
    const { hook, socket } = await start(7)
    act(() => {
      socket.frame({
        type: "transcript",
        id: 9,
        who: "assistant",
        text: "What did you build?",
        final: true,
        at: 1000,
        index: 0,
      })
      // The same id again, now the candidate's — a backend that reused it.
      socket.frame({
        type: "transcript",
        id: 9,
        who: "candidate",
        text: "A dashboard.",
        final: true,
        at: 5000,
        index: 0,
      })
    })
    const lines = hook.result.current.captions
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({
      speaker: "candidate",
      text: "A dashboard.",
      at: 5000,
    })
  })

  it("closes an open candidate line on a reconnect's ready, keeping every bubble", async () => {
    const { hook, socket } = await start(7)
    act(() => {
      socket.frame({
        type: "transcript",
        id: 4,
        who: "assistant",
        text: "Tell me about yourself.",
        final: true,
        at: 1,
        index: 0,
      })
      socket.frame({
        type: "transcript",
        id: 5,
        who: "candidate",
        text: "I have worked on",
        final: false,
        at: 2,
        index: 0,
      })
    })
    expect(hook.result.current.liveCaption).toBe("I have worked on")

    // The connection drops and comes back: a new `ready`.
    await act(async () => {
      socket.frame({ type: "ready", rev: 7, totalQuestions: 3 })
      await Promise.resolve()
    })

    expect(hook.result.current.liveCaption).toBeNull()
    expect(hook.result.current.captions.map((line) => line.text)).toEqual([
      "Tell me about yourself.",
      "I have worked on",
    ])
  })

  it("does not drop queued audio when a new question arrives", async () => {
    const { socket } = await start(7)
    audio.player!.queued = 10
    act(() =>
      socket.frame({
        type: "question",
        index: 1,
        of: 3,
        kind: "mcq",
        options: ["a", "b"],
      })
    )
    expect(audio.player!.flushes).toBe(0)
  })
})

describe("useVoiceInterview on an older backend (rev 6)", () => {
  it("keeps the mic gate while the interviewer speaks", async () => {
    await start(6)
    act(() => audio.player!.speaking(true))
    expect(audio.capture!.modes.at(-1)).toBe("gated")
  })

  it("still renders caption frames", async () => {
    const { hook, socket } = await start(6)
    act(() =>
      socket.frame({ type: "caption", who: "assistant", text: "Hello there." })
    )
    expect(hook.result.current.captions.map((line) => line.text)).toEqual([
      "Hello there.",
    ])
  })

  it("still holds her audio while the camera can't see the candidate", async () => {
    const { hook } = await start(6)
    hook.rerender({ faceLost: true })
    expect(audio.player!.held.at(-1)).toBe(true)
  })
})
