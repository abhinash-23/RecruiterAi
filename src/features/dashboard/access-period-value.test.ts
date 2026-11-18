import { describe, expect, it } from "vitest"

import { accessBody } from "@/services/super-admin"

import { toAccessPeriod } from "./access-period-value"

const body = (choice: Parameters<typeof toAccessPeriod>[0]) => {
  const period = toAccessPeriod(choice)
  if (period === null || period === "keep") return period
  return accessBody(period)
}

describe("access period → request body", () => {
  it("sends exactly one choice, as the API requires", () => {
    expect(body({ choice: "none", until: "" })).toEqual({ no_limit: true })
    expect(body({ choice: "2d", until: "" })).toEqual({ days: 2 })
    expect(body({ choice: "5d", until: "" })).toEqual({ days: 5 })
    expect(body({ choice: "1m", until: "" })).toEqual({ months: 1 })
    expect(body({ choice: "6m", until: "" })).toEqual({ months: 6 })
  })

  it("sends a date with the viewer's time zone for Until", () => {
    const sent = body({ choice: "until", until: "2026-12-31" })
    expect(sent).toMatchObject({ until: "2026-12-31" })
    expect(typeof (sent as Record<string, unknown>).tz_offset_minutes).toBe(
      "number"
    )
  })

  it("has nothing to send for Until without a date", () => {
    expect(body({ choice: "until", until: "" })).toBeNull()
  })

  it("sends no period to keep a running one", () => {
    expect(body({ choice: "keep", until: "" })).toBe("keep")
  })
})
