import { afterEach, describe, expect, it, vi } from "vitest"

import { getVoiceProvider, setVoiceProvider } from "./voice-provider"

function respond(status: number, body: unknown) {
  const fetch = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify(body), { status }))
  vi.stubGlobal("fetch", fetch)
  return fetch
}

afterEach(() => {
  vi.unstubAllGlobals()
})

const page = {
  current: "daisy",
  currentName: "Daisy",
  currentReady: true,
  chosenBy: "server_default",
  changedAt: null,
  changedByEmail: null,
  voiceInterviewsEnabled: true,
  providers: [
    { id: "daisy", name: "Daisy", ready: true, missing: [], current: true },
    {
      id: "gemini",
      name: "Gemini Live",
      ready: false,
      missing: ["GEMINI_API_KEYS"],
      current: false,
    },
  ],
}

describe("voice provider", () => {
  it("reads the page, providers in the server's order", async () => {
    respond(200, { status: "ok", voiceProvider: page })
    const state = await getVoiceProvider()
    expect(state.current).toBe("daisy")
    expect(state.chosenBy).toBe("server_default")
    expect(state.changedAt).toBeNull()
    expect(state.providers.map((option) => option.id)).toEqual([
      "daisy",
      "gemini",
    ])
    expect(state.providers[1]).toMatchObject({
      ready: false,
      missing: ["GEMINI_API_KEYS"],
    })
  })

  it("sends the id and reads the updated page back", async () => {
    const fetch = respond(200, {
      status: "ok",
      changed: true,
      voiceProvider: {
        ...page,
        current: "gemini",
        currentName: "Gemini Live",
        chosenBy: "super_admin",
        changedAt: "2026-11-19T10:14:25Z",
        changedByEmail: "root@example.com",
      },
    })
    const result = await setVoiceProvider("gemini")
    const [url, init] = fetch.mock.calls[0]!
    expect(String(url)).toContain("/platform/voice-provider")
    expect(init.method).toBe("PUT")
    expect(JSON.parse(init.body)).toEqual({ provider: "gemini" })
    expect(result.changed).toBe(true)
    expect(result.state).toMatchObject({
      current: "gemini",
      chosenBy: "super_admin",
      changedByEmail: "root@example.com",
    })
  })

  it("reports no change when it already was the provider", async () => {
    respond(200, { status: "ok", changed: false, voiceProvider: page })
    expect((await setVoiceProvider("daisy")).changed).toBe(false)
  })

  it("surfaces the server's 422 sentence as is", async () => {
    const detail =
      "Gemini Live is not set up on this server yet (missing: GEMINI_API_KEYS)."
    respond(422, { detail })
    await expect(setVoiceProvider("gemini")).rejects.toThrow(detail)
  })
})
