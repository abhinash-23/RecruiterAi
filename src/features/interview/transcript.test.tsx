import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { Transcript, type TranscriptEntry } from "./transcript"

/* jsdom lays nothing out, so the panel is given a height to scroll through
   and the observer is driven by hand. */
let resize: (() => void) | null = null

class FakeResizeObserver {
  callback: () => void
  constructor(callback: () => void) {
    this.callback = callback
    resize = () => this.callback()
  }
  observe() {}
  disconnect() {}
}

function fakeLayout(view: HTMLElement) {
  const box = { height: 1000, top: 0 }
  Object.defineProperty(view, "scrollHeight", { get: () => box.height })
  Object.defineProperty(view, "clientHeight", { get: () => 300 })
  Object.defineProperty(view, "scrollTop", {
    get: () => box.top,
    set: (value: number) => {
      box.top = Math.max(0, Math.min(value, box.height - 300))
    },
  })
  return box
}

const line = (
  id: string,
  speaker: TranscriptEntry["speaker"],
  text: string
): TranscriptEntry => ({ id, speaker, text, at: 0 })

const entries = [
  line("t1", "host", "Tell me about yourself."),
  line("t2", "candidate", "I am"),
  line("t3", "host", "Great, and what did you build?"),
]

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", FakeResizeObserver)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  resize = null
})

describe("Transcript auto-scroll", () => {
  it("follows when an earlier bubble grows, not only the last one", () => {
    render(<Transcript entries={entries} />)
    const view = screen.getByLabelText("Interview transcript")
    const box = fakeLayout(view)

    // The candidate's line (not the last) fills in and the content grows.
    box.height = 1400
    act(() => resize?.())

    expect(box.top).toBe(1100) // 1400 - 300: the bottom is in view
  })

  it("keeps following when text lands between its scroll and the scroll event", () => {
    render(<Transcript entries={entries} />)
    const view = screen.getByLabelText("Interview transcript")
    const box = fakeLayout(view)

    act(() => resize?.()) // scrolled to 700
    box.height = 1500 // more text before the scroll event is delivered
    fireEvent.scroll(view)

    box.height = 1600
    act(() => resize?.())
    expect(box.top).toBe(1300)
  })

  it("stops following once the reader scrolls up, and resumes at the bottom", () => {
    render(<Transcript entries={entries} />)
    const view = screen.getByLabelText("Interview transcript")
    const box = fakeLayout(view)

    act(() => resize?.()) // at the bottom: 700
    box.top = 200 // the reader scrolls up to re-read
    fireEvent.scroll(view)

    box.height = 1400
    act(() => resize?.())
    expect(box.top).toBe(200) // left where they are reading

    box.top = 1100 // back to the bottom
    fireEvent.scroll(view)
    box.height = 1500
    act(() => resize?.())
    expect(box.top).toBe(1200)
  })
})
