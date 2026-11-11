import { describe, expect, it, vi } from "vitest"

import { ApiError, apiFetch } from "@/services/http-client"

import { creditShortfall, formatPaise } from "./billing"

function respond(status: number, body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }))
  )
}

async function failure(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error("expected the request to fail")
}

describe("creditShortfall", () => {
  it("reads the numbers from a 402 insufficient_credits", async () => {
    respond(402, {
      detail: "Not enough credits",
      code: "insufficient_credits",
      balance: 30,
      required: 100,
    })
    const error = await failure(apiFetch("/hr/jobs/j/schedule"))
    expect(creditShortfall(error)).toEqual({ balance: 30, required: 100 })
  })

  it("reads them from inside an object detail too", async () => {
    respond(402, {
      detail: { code: "insufficient_credits", balance: 0, required: 50 },
    })
    const error = await failure(apiFetch("/interviews/i/invite"))
    expect(creditShortfall(error)).toEqual({ balance: 0, required: 50 })
  })

  it("ignores verify's 402, which carries no code", async () => {
    respond(402, { detail: "The payment is not complete (status: failed)." })
    const error = await failure(apiFetch("/billing/verify"))
    expect(creditShortfall(error)).toBeNull()
  })

  it("ignores anything that isn't a 402", () => {
    expect(creditShortfall(new ApiError(409, "Already chosen"))).toBeNull()
    expect(creditShortfall(new Error("boom"))).toBeNull()
  })
})

describe("formatPaise", () => {
  it("formats paise as rupees with two decimals", () => {
    expect(formatPaise(59000)).toBe("₹590.00")
    expect(formatPaise(11800000)).toBe("₹1,18,000.00")
  })
})
