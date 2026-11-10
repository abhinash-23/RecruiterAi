import { describe, expect, it } from "vitest"

import { ApiError } from "@/services/http-client"

import {
  buildInterviewLink,
  isAlreadyAnswered,
  isTimeUp,
  parseInterviewLink,
  toIntegrityReport,
  toMultipleFaces,
} from "./session"

describe("parseInterviewLink", () => {
  it("reads a path-form link", () => {
    expect(
      parseInterviewLink(
        "https://host/otp?interview_id=42&email=a%40b.com&name=Ann&role=Dev"
      )
    ).toEqual({ interviewId: "42", email: "a@b.com", name: "Ann", role: "Dev" })
  })

  it("reads the hash-form link the backend emails", () => {
    expect(
      parseInterviewLink("https://host//#/otp?interview_id=42&email=a%40b.com")
    ).toEqual({ interviewId: "42", email: "a@b.com", name: "", role: "" })
  })

  it("returns null without an interview id", () => {
    expect(parseInterviewLink("https://host/otp?email=a%40b.com")).toBeNull()
  })

  it("reads back what buildInterviewLink writes", () => {
    const link = buildInterviewLink(
      { interviewId: "7", email: "x+y@z.com", name: "Zoë", role: "QA & Ops" },
      "https://host/"
    )
    expect(link.startsWith("https://host/otp?")).toBe(true)
    expect(parseInterviewLink(link)).toEqual({
      interviewId: "7",
      email: "x+y@z.com",
      name: "Zoë",
      role: "QA & Ops",
    })
  })
})

describe("isTimeUp / isAlreadyAnswered", () => {
  it("match on the code, not the status", () => {
    expect(isTimeUp(new ApiError(409, "late", "time_up"))).toBe(true)
    expect(isTimeUp(new ApiError(409, "conflict"))).toBe(false)
    expect(isAlreadyAnswered(new ApiError(409, "dup", "already_answered"))).toBe(
      true
    )
    expect(isAlreadyAnswered(new Error("already_answered"))).toBe(false)
  })
})

describe("toIntegrityReport", () => {
  it("is null for a payload with no integrity data at all", () => {
    expect(toIntegrityReport({ heart_rate: 70 })).toBeNull()
    expect(toIntegrityReport(null)).toBeNull()
  })

  it("keeps an absent tab-switch count as null, never zero", () => {
    const report = toIntegrityReport({ camera_off_count: 0 })
    expect(report?.tabSwitchCount).toBeNull()
    expect(report?.cameraOffSeconds).toBeNull()
  })

  it("renders a payload that carries only a tab-switch count", () => {
    const report = toIntegrityReport({ tab_switch_count: 3 })
    expect(report).not.toBeNull()
    expect(report?.tabSwitchCount).toBe(3)
    expect(report?.cameraOffCount).toBe(0)
  })

  it("accepts counts sent as strings, but not blank ones", () => {
    const report = toIntegrityReport({
      camera_off_count: "5",
      face_absent_count: " ",
      tab_switch_count: "2",
    })
    expect(report?.cameraOffCount).toBe(5)
    expect(report?.faceAbsentCount).toBe(0)
    expect(report?.tabSwitchCount).toBe(2)
  })

  it("drops malformed events and sorts the rest", () => {
    const report = toIntegrityReport({
      camera_off_count: 2,
      absence_events: [
        { type: "camera_off", started_at_ms: 2000, seconds: 3 },
        { type: "not_a_type", started_at_ms: 500, seconds: 1 },
        { type: "face_absent", started_at_ms: "soon", seconds: 1 },
        { type: "face_absent", started_at_ms: 1000, seconds: 4 },
      ],
    })
    expect(report?.events).toEqual([
      { type: "face_absent", startedAtMs: 1000, seconds: 4 },
      { type: "camera_off", startedAtMs: 2000, seconds: 3 },
    ])
  })

  it("folds multiple-face episodes in only when the timeline lacks them", () => {
    const block = {
      count: 1,
      seconds: 4,
      events: [{ started_at_ms: 3000, seconds: 4 }],
    }

    const fromBlock = toIntegrityReport({ camera_off_count: 0, multiple_faces: block })
    expect(fromBlock?.events).toEqual([
      { type: "multiple_faces", startedAtMs: 3000, seconds: 4 },
    ])

    const alreadyListed = toIntegrityReport({
      camera_off_count: 0,
      multiple_faces: block,
      absence_events: [{ type: "multiple_faces", started_at_ms: 3000, seconds: 4 }],
    })
    expect(alreadyListed?.events).toHaveLength(1)
  })

  it("falls back to the bare counter after a backend restart", () => {
    expect(
      toIntegrityReport({ multiple_faces_count: 2 })?.multipleFaces
    ).toEqual({ count: 2, seconds: null, events: [] })
  })

  it("passes an explicit null block through as not measured", () => {
    const report = toIntegrityReport(
      { camera_off_count: 0, multiple_faces_count: 2 },
      null
    )
    expect(report?.multipleFaces).toBeNull()
  })
})

describe("toMultipleFaces", () => {
  it("is null for null — the server saying not measured", () => {
    expect(toMultipleFaces(null)).toBeNull()
    expect(toMultipleFaces({ seconds: 3 })).toBeNull()
  })

  it("derives a missing end from start plus duration", () => {
    expect(
      toMultipleFaces({ count: 1, events: [{ started_at_ms: 1000, seconds: 2.5 }] })
        ?.events
    ).toEqual([{ startedAtMs: 1000, endedAtMs: 3500, seconds: 2.5 }])
  })
})
