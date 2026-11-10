import { describe, expect, it, vi } from "vitest"

import { ApiError, apiFetch, registerUnauthorizedHandler } from "./http-client"

function respond(status: number, body: unknown) {
  const text = typeof body === "string" ? body : JSON.stringify(body)
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response(text, { status }))
  )
}

async function failure(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise
  } catch (error) {
    if (error instanceof ApiError) return error
    throw error
  }
  throw new Error("expected the request to fail")
}

describe("apiFetch", () => {
  it("returns the parsed body", async () => {
    respond(200, { ok: true })
    await expect(apiFetch("/x")).resolves.toEqual({ ok: true })
  })

  it("returns null for an empty body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    )
    await expect(apiFetch("/x")).resolves.toBeNull()
  })

  it("sends JSON with the bearer token", async () => {
    respond(200, {})
    await apiFetch("/x", { method: "POST", body: { a: 1 }, token: "t" })

    const [, init] = vi.mocked(fetch).mock.calls[0]
    const headers = init?.headers as Record<string, string>
    expect(headers.Authorization).toBe("Bearer t")
    expect(headers["Content-Type"]).toBe("application/json")
    expect(init?.body).toBe('{"a":1}')
  })

  it("leaves Content-Type to the browser for multipart", async () => {
    respond(200, {})
    await apiFetch("/x", { method: "POST", body: new FormData() })

    const headers = vi.mocked(fetch).mock.calls[0][1]?.headers as Record<
      string,
      string
    >
    expect(headers["Content-Type"]).toBeUndefined()
  })

  it("reports an unreachable server as status 0", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("Failed to fetch"))
    )
    const error = await failure(apiFetch("/x"))
    expect(error.status).toBe(0)
  })

  it.each([
    ["FastAPI detail string", { detail: "Bad email" }, "Bad email"],
    ["our own message", { message: "Nope" }, "Nope"],
    [
      "FastAPI validation list",
      { detail: [{ msg: "field required" }] },
      "field required",
    ],
    ["no explanation", {}, "That request wasn't valid."],
  ])("words a 400 from %s", async (_, body, message) => {
    respond(400, body)
    expect((await failure(apiFetch("/x"))).message).toBe(message)
  })

  it("carries the server's code", async () => {
    respond(409, { detail: "late", code: "time_up" })
    const error = await failure(apiFetch("/x"))
    expect(error.status).toBe(409)
    expect(error.code).toBe("time_up")
  })

  it("names a non-JSON body instead of failing to parse it", async () => {
    respond(200, "<html>ngrok</html>")
    expect((await failure(apiFetch("/x"))).message).toMatch(/non-JSON body/)
  })

  it.each([
    [429, "Rate exceeded.", "Too many attempts. Wait a moment and try again."],
    [
      502,
      "<html>Bad Gateway</html>",
      "The server is unavailable right now. Try again shortly.",
    ],
    [503, "Rate exceeded.", "The server is busy right now. Try again shortly."],
    [
      504,
      "<html>Gateway Time-out</html>",
      "The server took too long to respond. Try again shortly.",
    ],
  ])(
    "words a non-JSON %i from the platform for the user",
    async (status, body, message) => {
      respond(status, body)
      const error = await failure(apiFetch("/x"))
      expect(error.status).toBe(status)
      expect(error.message).toBe(message)
    }
  )

  it("tells the unauthorized handler about a 401 only when a token was sent", async () => {
    const handler = vi.fn()
    registerUnauthorizedHandler(handler)

    respond(401, "")
    await failure(apiFetch("/anon"))
    expect(handler).not.toHaveBeenCalled()

    respond(401, "not json")
    await failure(apiFetch("/me", { token: "t" }))
    expect(handler).toHaveBeenCalledWith("t", "/me")
  })
})
