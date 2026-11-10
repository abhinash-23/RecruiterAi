import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { useProctoring } from "./use-proctoring"

function setHidden(hidden: boolean) {
  Object.defineProperty(document, "hidden", { configurable: true, value: hidden })
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"))
  })
}

/** Leaves the tab for `ms`, then comes back. */
function leaveFor(ms: number) {
  setHidden(true)
  vi.advanceTimersByTime(ms)
  setHidden(false)
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  Object.defineProperty(document, "hidden", { configurable: true, value: false })
})

describe("useProctoring tab switching", () => {
  it("counts nothing before the sitting starts", () => {
    const { result } = renderHook(() => useProctoring(false))
    leaveFor(5000)
    expect(result.current.readTabSwitches()).toBe(0)
  })

  it("ignores an absence shorter than 1.5 s", () => {
    const { result } = renderHook(() => useProctoring(true))
    leaveFor(1499)
    expect(result.current.tabSwitchCount).toBe(0)
  })

  it("counts each real absence", () => {
    const { result } = renderHook(() => useProctoring(true))
    leaveFor(1500)
    leaveFor(10_000)
    expect(result.current.tabSwitchCount).toBe(2)
    expect(result.current.readTabSwitches()).toBe(2)
  })

  it("treats repeated hidden events as one absence, timed from the first", () => {
    const { result } = renderHook(() => useProctoring(true))
    setHidden(true)
    vi.advanceTimersByTime(1000)
    setHidden(true)
    vi.advanceTimersByTime(1000)
    setHidden(false)
    expect(result.current.tabSwitchCount).toBe(1)
  })

  it("stops counting once the sitting ends", () => {
    const { result, rerender } = renderHook(({ active }) => useProctoring(active), {
      initialProps: { active: true },
    })
    leaveFor(2000)
    rerender({ active: false })
    leaveFor(2000)
    expect(result.current.readTabSwitches()).toBe(1)
  })
})
