/**
 * ============================================================================
 * SOCKET TRACING
 * ============================================================================
 * The two WebSocket protocols — live viewing and recording — fail *silently by
 * design*: both are best-effort, so every error path ends in a state rather than
 * an exception, and neither the candidate nor the recruiter is shown a stack
 * trace. That is right for them and useless for us. A sitting that produced no
 * recording left nothing behind explaining which frame went wrong.
 *
 * These lines are that explanation. They are the difference between "recording
 * didn't work" and "the server's `ready` frame named the session
 * `recording_session_id`, so the client never started sending".
 *
 * **On in development, opt-in anywhere else** — including the deployed site,
 * which is the only place a real candidate sits an interview:
 *
 *     localStorage.setItem("ra:trace", "1")   // then reload
 *     localStorage.removeItem("ra:trace")
 *
 * Read once at module load rather than per frame: a trace that changes mid-socket
 * would leave half a conversation logged.
 *
 * The switch is for the console only. The headline of every line also goes to
 * `frame-log.ts`, which is always on and is what a tester exports.
 */

import { logNote } from "./frame-log"

const TRACE_KEY = "ra:trace"

const enabled = (() => {
  if (import.meta.env.DEV) return true
  try {
    return window.localStorage.getItem(TRACE_KEY) === "1"
  } catch {
    // Private mode, or storage blocked by policy. Not a reason to fail.
    return false
  }
})()

/**
 * Logs one step of a socket conversation, prefixed with which one it is.
 *
 * `console.info`, not `debug`: Chrome hides `debug` behind a verbosity filter
 * that is off by default, which is exactly the wrong default for a line someone
 * has deliberately switched on.
 */
export function trace(channel: string, event: string, detail?: unknown): void {
  // Always, whatever the switch says — the headline only, never `detail`,
  // which carries whole frames. See `frame-log.ts`.
  logNote(channel, event)
  if (!enabled) return
  if (detail === undefined) console.info(`[${channel}] ${event}`)
  else console.info(`[${channel}] ${event}`, detail)
}

/** True when tracing is on, for callers that would otherwise build a payload. */
export const tracing = enabled
