import { describe, expect, it, vi } from "vitest"

import { ApiError, apiFetch } from "@/services/http-client"

import { creditShortfall, formatAmounts, formatMoney } from "./billing"

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

describe("formatMoney", () => {
  it("formats cents as dollars with two decimals", () => {
    expect(formatMoney(3500, "usd")).toBe("$35.00")
    expect(formatMoney(700000, "usd")).toBe("$7,000.00")
  })

  it("keeps old Razorpay rows in rupees, with Indian grouping", () => {
    expect(formatMoney(59000, "inr")).toBe("₹590.00")
    expect(formatMoney(11800000, "inr")).toBe("₹1,18,000.00")
  })
})

describe("formatAmounts", () => {
  it("lists dollars first and skips empty currencies", () => {
    expect(formatAmounts({ inr: 5900, usd: 70000, eur: 0 })).toBe(
      "$700.00 · ₹59.00"
    )
  })

  it("shows nothing paid as zero dollars", () => {
    expect(formatAmounts({})).toBe("$0.00")
  })
})
