import { afterEach, describe, expect, it, vi } from "vitest"

import {
  currentAccessToken,
  login,
  logout,
  onSessionRejected,
  persistSession,
  readStoredSession,
} from "./auth-service"
import { apiFetch } from "./http-client"
import type { Session } from "@/features/auth/types"

const SESSION_KEY = "recruiterai.session.v2"

function loginResponse(role = "hr") {
  return {
    status: "success",
    token: "tok",
    expires_at: 1_800_000_000,
    user: {
      userId: "u1",
      email: "ann@acme.com",
      fullName: "Ann",
      role,
      phone: null,
      companyName: null,
      mustChangePassword: false,
    },
  }
}

function respond(status: number, body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }))
  )
}

afterEach(() => localStorage.clear())

describe("login", () => {
  it("normalises the email, maps the user and stores the session", async () => {
    respond(200, loginResponse())
    const session = await login({ email: "  Ann@ACME.com ", password: "pw" })

    const body = vi.mocked(fetch).mock.calls[0][1]?.body as string
    expect(JSON.parse(body)).toEqual({ email: "ann@acme.com", password: "pw" })

    expect(session.user).toMatchObject({ id: "u1", role: "hr", companyName: "" })
    // Epoch seconds on the wire, milliseconds in the app.
    expect(session.expiresAt).toBe(1_800_000_000_000)
    expect(currentAccessToken()).toBe("tok")
  })

  it("refuses a role this app doesn't know, and stores nothing", async () => {
    respond(200, loginResponse("owner"))
    await expect(login({ email: "a@b.com", password: "pw" })).rejects.toThrow(
      /role this app doesn't know/
    )
    expect(readStoredSession()).toBeNull()
  })
})

describe("readStoredSession", () => {
  it("ignores a corrupt or partial value", () => {
    localStorage.setItem(SESSION_KEY, "{not json")
    expect(readStoredSession()).toBeNull()

    localStorage.setItem(SESSION_KEY, JSON.stringify({ accessToken: "t" }))
    expect(readStoredSession()).toBeNull()
  })
})

describe("logout", () => {
  it("clears the session even when the server call fails", async () => {
    persistSession({ accessToken: "tok", user: { role: "hr" } } as Session)
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")))

    const result = await logout("tok")
    expect(result.revoked).toBe(false)
    expect(readStoredSession()).toBeNull()
  })
})

describe("a 401 on the signed-in session", () => {
  function signIn() {
    persistSession({ accessToken: "tok", user: { role: "hr" } } as Session)
  }

  it("clears the session and tells listeners", async () => {
    signIn()
    const listener = vi.fn()
    const stop = onSessionRejected(listener)

    respond(401, { detail: "revoked" })
    await apiFetch("/hr/jobs", { token: "tok" }).catch(() => {})

    expect(readStoredSession()).toBeNull()
    expect(listener).toHaveBeenCalledOnce()
    stop()
  })

  it("leaves it alone for a wrong password on change-password", async () => {
    signIn()
    respond(401, { detail: "wrong password" })
    await apiFetch("/auth/change-password", { token: "tok" }).catch(() => {})
    expect(currentAccessToken()).toBe("tok")
  })

  it("leaves it alone for someone else's token — a candidate's", async () => {
    signIn()
    respond(401, { detail: "expired" })
    await apiFetch("/interview/answer", { token: "candidate" }).catch(() => {})
    expect(currentAccessToken()).toBe("tok")
  })
})
