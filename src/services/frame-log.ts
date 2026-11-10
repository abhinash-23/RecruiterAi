/**
 * ============================================================================
 * FRAME LOG
 * ============================================================================
 * An always-on record of the candidate's sitting — the voice socket's frames in
 * and out, and the trace lines of the voice and recording channels — kept so a
 * tester can export it after something goes wrong.
 *
 * `socket-trace` already says all of this, but only to the console and only
 * when switched on, which is never on a real candidate's machine. The
 * 2026-10-13 incident could not be answered from this side for exactly that
 * reason, and the backend's fixes note made a log that always exists one of its
 * asks.
 *
 * **What it never holds:** anything anyone said. Captions are logged as a
 * speaker and a length, answers as an index, and the question text, options and
 * transcripts are left out. A tester can attach this to a ticket without it
 * becoming a copy of a candidate's interview.
 *
 * Kept for the last ten minutes, in memory and in `sessionStorage` — so it
 * survives a reload of the tab, including the reload a crash screen offers, and
 * goes with the tab. Exported as JSON by `raExportFrameLog()` in the console or
 * Ctrl+Shift+Alt+L.
 */

const WINDOW_MS = 10 * 60_000
/** A ceiling under the window, so a runaway loop can't fill storage. */
const MAX_ENTRIES = 4000
const STORAGE_KEY = "ra:frame-log"
/** Writes to storage are batched; a frame every few ms is common. */
const PERSIST_EVERY_MS = 2000

/** Only the sitting's own channels — the recruiter's live view is not this. */
const LOGGED_CHANNELS = new Set(["voice", "recording"])

export type FrameLogEntry = {
  /** Epoch milliseconds. */
  t: number
  channel: string
  /** `in` and `out` are socket frames; `note` is a trace line. */
  dir: "in" | "out" | "note"
  /** The frame's type, or the trace line itself. */
  what: string
  detail?: Record<string, unknown>
}

let entries: FrameLogEntry[] = restore()
let persistTimer: number | null = null

function restore(): FrameLogEntry[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? (parsed as FrameLogEntry[]) : []
  } catch {
    return []
  }
}

function persist() {
  persistTimer = null
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
  } catch {
    // Storage full or blocked: the in-memory copy still exports.
  }
}

function prune(now: number) {
  const cutoff = now - WINDOW_MS
  let start = 0
  while (start < entries.length && entries[start].t < cutoff) start += 1
  if (entries.length - start > MAX_ENTRIES) start = entries.length - MAX_ENTRIES
  if (start > 0) entries = entries.slice(start)
}

/** Appends one entry. Cheap enough to call per frame. */
export function logFrame(
  channel: string,
  dir: FrameLogEntry["dir"],
  what: string,
  detail?: Record<string, unknown>
) {
  const now = Date.now()
  entries.push(detail ? { t: now, channel, dir, what, detail } : { t: now, channel, dir, what })
  prune(now)
  if (persistTimer === null) {
    persistTimer = window.setTimeout(persist, PERSIST_EVERY_MS)
  }
}

/** A trace line, for the channels this log keeps. Called by `trace` itself. */
export function logNote(channel: string, event: string) {
  if (LOGGED_CHANNELS.has(channel)) logFrame(channel, "note", event)
}

/**
 * Downloads the log as JSON.
 *
 * The page address goes in **without its query string**, except for the
 * interview id: an invitation link can carry the candidate's name and email,
 * and the id is all the backend needs to find the sitting in its own log.
 */
export function exportFrameLog() {
  if (persistTimer !== null) {
    window.clearTimeout(persistTimer)
    persist()
  }

  const params = new URLSearchParams(window.location.search)
  const body = {
    exportedAt: new Date().toISOString(),
    page: window.location.pathname,
    interviewId: params.get("interview_id"),
    userAgent: navigator.userAgent,
    windowMinutes: WINDOW_MS / 60_000,
    entries: entries.map((entry) => ({
      at: new Date(entry.t).toISOString(),
      ...entry,
    })),
  }

  const url = URL.createObjectURL(
    new Blob([JSON.stringify(body, null, 2)], { type: "application/json" })
  )
  const link = document.createElement("a")
  link.href = url
  link.download = `recruiterai-frame-log-${body.exportedAt.replace(/[:.]/g, "-")}.json`
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

/**
 * The tester's two ways in. Neither is visible: a button would put "download
 * log" in front of every real candidate.
 */
export function installFrameLogExport() {
  ;(window as unknown as { raExportFrameLog: () => void }).raExportFrameLog =
    exportFrameLog

  window.addEventListener("keydown", (event) => {
    if (
      event.ctrlKey &&
      event.shiftKey &&
      event.altKey &&
      event.key.toLowerCase() === "l"
    ) {
      event.preventDefault()
      exportFrameLog()
    }
  })

  // The last batch, when the tab is closed or reloaded.
  window.addEventListener("pagehide", () => {
    if (persistTimer !== null) {
      window.clearTimeout(persistTimer)
      persist()
    }
  })
}
