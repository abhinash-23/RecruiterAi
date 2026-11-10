import * as Sentry from "@sentry/react"
import { describe, expect, it, vi } from "vitest"

import { reportError, withoutQuery } from "./report-error"

vi.mock("@sentry/react", () => ({ captureException: vi.fn(), init: vi.fn() }))

describe("reportError", () => {
  it("logs and forwards to Sentry, tagged with the source", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    const error = new Error("boom")

    reportError(error, "boundary:room", "at <VoiceRoom>")

    expect(log).toHaveBeenCalledWith("[boundary:room]", error, "at <VoiceRoom>")
    expect(Sentry.captureException).toHaveBeenCalledWith(error, {
      tags: { source: "boundary:room" },
      extra: { detail: "at <VoiceRoom>" },
    })
  })
})

describe("withoutQuery", () => {
  it("strips the candidate's details from an interview link", () => {
    expect(withoutQuery("https://host/otp?interview_id=1&email=a%40b.com")).toBe(
      "https://host/otp"
    )
    expect(withoutQuery("https://host/#/otp?email=a%40b.com")).toBe("https://host/")
    expect(withoutQuery("/api/hr/jobs")).toBe("/api/hr/jobs")
  })
})
