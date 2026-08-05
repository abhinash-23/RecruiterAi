/**
 * ============================================================================
 * HTTP CLIENT
 * ============================================================================
 * The one place in the app that talks to the real backend. Every service file
 * imports `apiFetch` and nothing else calls `fetch` directly, so the base URL,
 * the auth header and error handling are each defined exactly once.
 *
 * This is separate from `src/server/api.ts`, which is the in-browser mock the
 * dashboards still read their data from.
 */

/**
 * Where the API lives.
 *
 * Set `VITE_API_BASE_URL` (see `.env`) to call the backend directly — the
 * browser then makes a real cross-origin request, so that origin has to be in
 * the backend's CORS allow-list.
 *
 * Leave it unset and requests go to the same-origin path `/api`, which the Vite
 * dev server forwards to the backend (the `server.proxy` block in
 * `vite.config.ts`). Nothing is cross-origin that way, so CORS never applies —
 * useful when the backend host changes or hasn't allow-listed you yet.
 *
 * A trailing slash is trimmed because every path below starts with one, and
 * `".../api/" + "/auth/login"` would request `//auth/login`.
 */
export const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL ?? "/api"
).replace(/\/+$/, "")

/**
 * Absolute URL for a file the API serves, from the path it reports — a logo
 * arrives as `/api/branding/logo?company=acme&v=1785761688`.
 *
 * That path is only correct against the API's own origin. When
 * `VITE_API_BASE_URL` points at another host, dropping it into `src` asks *this*
 * app's origin for the file and 404s.
 */
export function apiAssetUrl(path: string): string {
  if (/^(?:https?:|data:|blob:)/i.test(path)) return path

  // Same-origin "/api" — the dev proxy already forwards it.
  if (API_BASE_URL.startsWith("/")) {
    return path.startsWith("/") ? path : `${API_BASE_URL}/${path}`
  }

  // A rooted path carries its own "/api" prefix; a relative one doesn't.
  if (!path.startsWith("/")) return `${API_BASE_URL}/${path}`
  return `${new URL(API_BASE_URL).origin}${path}`
}

/**
 * How `fetchApiAsset` finds the bearer token.
 *
 * **Registered, not imported.** This module is the bottom of the stack and
 * `auth-service` is built on it; importing the session back down would make the
 * two mutually dependent. `auth-service` registers itself on load.
 *
 * The default returns null, which is right for the case that needs no token: a
 * candidate's screens fetch the *public* branding logo with no session at all.
 */
let readAssetToken: () => string | null = () => null

export function registerAssetToken(read: () => string | null) {
  readAssetToken = read
}

/**
 * Fetches a file the API serves, as a blob.
 *
 * Exists because an `<img src>` can't carry headers, and there are two of them
 * to carry. This backend sits behind a free ngrok tunnel that answers
 * header-less browser requests with an HTML warning page — which renders as a
 * broken image rather than an error anyone can diagnose. And a user's profile
 * picture is **bearer-authenticated**: without the token it is a 401 that, in an
 * `<img>`, would again look like nothing more than a broken picture.
 */
export async function fetchApiAsset(
  path: string,
  signal?: AbortSignal
): Promise<Blob> {
  const url = apiAssetUrl(path)
  const token = readAssetToken()

  let response: Response
  try {
    response = await fetch(url, {
      headers: {
        "ngrok-skip-browser-warning": "true",
        // Harmless on the public endpoints, which ignore it.
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal,
    })
  } catch {
    throw new ApiError(0, `Could not reach ${url}.`)
  }

  if (!response.ok) {
    throw new ApiError(response.status, `Could not load ${url}.`)
  }
  return response.blob()
}

/** Something the API rejected, or a failure to reach it at all. */
export class ApiError extends Error {
  /** HTTP status, or 0 when the request never got a response. */
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = "ApiError"
    this.status = status
  }

  /** Token missing, expired or rejected — the user must sign in again. */
  get isUnauthorized() {
    return this.status === 401
  }
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"
  /**
   * Request body. Plain values are JSON-encoded; a `FormData` is sent as-is for
   * multipart uploads. Omit for GET.
   */
  body?: unknown
  /** Access token, sent as `Authorization: Bearer <token>`. */
  token?: string | null
  signal?: AbortSignal
}

/**
 * Makes one JSON request and returns the parsed body.
 *
 * Always throws `ApiError` on failure — never returns a null-ish value that a
 * caller might mistake for a successful empty response.
 */
export async function apiFetch<T>(
  path: string,
  { method = "GET", body, token, signal }: RequestOptions = {}
): Promise<T> {
  const isMultipart = body instanceof FormData

  const headers: Record<string, string> = {
    Accept: "application/json",
    // Free ngrok tunnels answer plain browser requests with an HTML warning
    // page instead of the API response. This header opts out of it.
    "ngrok-skip-browser-warning": "true",
  }
  // Deliberately no Content-Type for multipart: the browser has to set it
  // itself so it can include the boundary token. Setting it by hand produces a
  // body the server can't parse.
  if (body !== undefined && !isMultipart) {
    headers["Content-Type"] = "application/json"
  }
  if (token) headers.Authorization = `Bearer ${token}`

  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      body:
        body === undefined ? undefined : isMultipart ? body : JSON.stringify(body),
      signal,
    })
  } catch {
    // Offline, DNS failure, tunnel down, or a blocked cross-origin request —
    // `fetch` reports all of them the same way, so say what the user can do
    // rather than guessing which one it was.
    throw new ApiError(
      0,
      "Could not reach the server. Check your connection and try again."
    )
  }

  const data = await readBody(response)

  if (!response.ok) {
    throw new ApiError(response.status, errorMessage(data, response.status))
  }
  return data as T
}

/**
 * Reads the response as JSON. An empty body (204 and friends) becomes `null`;
 * anything that isn't JSON is a misconfiguration worth naming out loud.
 */
async function readBody(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text.trim()) return null

  try {
    return JSON.parse(text) as unknown
  } catch {
    // An ngrok interstitial, a proxy error page, an HTML 502 — anything but
    // the API. A JSON parse error would send the reader down the wrong path.
    throw new ApiError(
      response.status,
      `The server replied with ${response.status} and a non-JSON body. ` +
        `Check that "${API_BASE_URL}" points at the API.`
    )
  }
}

/** Last-resort wording when the server sends a status but no explanation. */
const FALLBACK_MESSAGE: Record<number, string> = {
  400: "That request wasn't valid.",
  401: "Your session has expired. Please sign in again.",
  403: "You don't have access to that.",
  404: "We couldn't find what you asked for.",
  409: "That conflicts with something that already exists.",
  429: "Too many attempts. Wait a moment and try again.",
  500: "The server hit an error. Try again shortly.",
}

/**
 * Pulls a human sentence out of an error body. This backend is FastAPI, which
 * uses `detail` (a string, or an array of validation objects); our own API spec
 * uses `message`. Accept either so neither shape shows up as "[object Object]".
 */
function errorMessage(data: unknown, status: number): string {
  if (typeof data === "string" && data.trim()) return data

  if (data && typeof data === "object") {
    const { message, detail } = data as { message?: unknown; detail?: unknown }

    if (typeof message === "string" && message.trim()) return message
    if (typeof detail === "string" && detail.trim()) return detail

    if (Array.isArray(detail)) {
      const first = detail.find(
        (item): item is { msg: string } =>
          typeof (item as { msg?: unknown })?.msg === "string"
      )
      if (first) return first.msg
    }
  }

  return FALLBACK_MESSAGE[status] ?? `Request failed (${status}).`
}
