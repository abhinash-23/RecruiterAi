import * as React from "react"

/**
 * ============================================================================
 * PROCTORING — fullscreen and tab switching
 * ============================================================================
 * Two things, with very different standing.
 *
 * **Fullscreen** is a convenience. The room is entered fullscreen from the Start
 * click and there is a control to go back in, but leaving is not blocked and not
 * held — Escape and F11 are untrappable in every browser by design, and freezing
 * an interview over an accidental keypress punished the accident far more than
 * it deterred the misuse. The API has no field for fullscreen exits, so they are
 * not reported anywhere.
 *
 * **Tab switching** is counted, and the count is ours alone to keep: a tab
 * switch is only observable inside the candidate's browser, so the server never
 * sees one. It carries our running total and keeps the highest value it was
 * given, but it does not verify or adjust it.
 *
 * ## What the count is worth
 *
 * It is self-reported by the candidate's own browser. Anyone with devtools can
 * suppress the listener, and a second phone beside the laptop never trips it at
 * all. Good context, not proof — and the recruiter-facing panel says so, because
 * a number on a hiring page reads as evidence unless it explicitly isn't.
 */

/**
 * Minimum length before an absence counts as a switch.
 *
 * Our rule, not the server's — it takes whatever number we give it. Matched to
 * the backend's own threshold for camera-off episodes so a recruiter reading the
 * integrity block isn't comparing figures filtered two different ways. Without
 * it, every notification that steals focus for 200ms would score a switch.
 */
const MIN_AWAY_MS = 1500

export interface ProctoringState {
  /** True while the document is genuinely fullscreen. */
  inFullscreen: boolean
  /** Whether this browser supports the Fullscreen API on a normal element. */
  supported: boolean
  /**
   * Cumulative switches this sitting. For display only — anything *sending* the
   * number must use `readTabSwitches`.
   */
  tabSwitchCount: number
  /**
   * The live total, read straight from the ref.
   *
   * State is a render behind: the vitals sampler runs on an interval whose
   * closure captures whatever `tabSwitchCount` was when the effect last ran, so
   * reading the state there would ship a stale figure — and the finish call,
   * which is authoritative, would ship the worst one of all.
   */
  readTabSwitches: () => number
  /** Enter fullscreen. **Must be called inside a user gesture.** */
  enter: () => Promise<void>
  /** Enter or leave, for the room's own control. */
  toggle: () => Promise<void>
}

interface FullscreenCapableElement extends HTMLElement {
  webkitRequestFullscreen?: () => Promise<void>
}

interface FullscreenCapableDocument extends Document {
  webkitFullscreenElement?: Element | null
}

/**
 * The Keyboard Lock API, absent from TypeScript's DOM lib because it is
 * Chromium-only. Optional throughout — every call site treats it as something
 * that probably isn't there.
 */
declare global {
  interface Navigator {
    keyboard?: {
      lock?: (keys?: string[]) => Promise<void>
      unlock?: () => void
    }
  }
}

function fullscreenElement(): Element | null {
  const scope = document as FullscreenCapableDocument
  return document.fullscreenElement ?? scope.webkitFullscreenElement ?? null
}

/**
 * Captures Escape while fullscreen, so a single tap no longer drops the
 * candidate out mid-answer — they have to *hold* it for ~2s instead.
 *
 * Escape alone, deliberately: `lock()` with no argument takes the whole
 * keyboard, including Tab, which would break keyboard navigation of the answer
 * controls for anyone who relies on it. Chromium desktop only, and nothing
 * depends on it.
 */
async function lockEscape(): Promise<void> {
  try {
    await navigator.keyboard?.lock?.(["Escape"])
  } catch {
    // Refused, unsupported, or not fullscreen. None of them matter.
  }
}

/** Releases the capture. Safe to call when nothing was ever locked. */
function unlockKeyboard(): void {
  try {
    navigator.keyboard?.unlock?.()
  } catch {
    /* empty */
  }
}

/**
 * Watches fullscreen and tab visibility for the duration of a sitting.
 *
 * @param active Only `true` while the candidate is actually sitting. Nothing is
 *   counted before then — waiting-room time in a background tab is not a tab
 *   switch, the same way the backend doesn't count camera-off time before the
 *   camera has ever worked.
 */
export function useProctoring(active: boolean): ProctoringState {
  const [inFullscreen, setInFullscreen] = React.useState(false)
  const [tabSwitchCount, setTabSwitchCount] = React.useState(0)

  /** The authoritative total. State mirrors it for rendering; this is the truth. */
  const countRef = React.useRef(0)
  /** When the current absence began; null while the tab is visible. */
  const awaySinceRef = React.useRef<number | null>(null)
  /**
   * Whether fullscreen was ever entered.
   *
   * `fullscreenchange` also fires on browsers that silently refuse the request,
   * and without this a refusal would look like an exit.
   */
  const everEnteredRef = React.useRef(false)

  const supported = React.useMemo(() => {
    if (typeof document === "undefined") return false
    const root = document.documentElement as FullscreenCapableElement
    return Boolean(root.requestFullscreen ?? root.webkitRequestFullscreen)
  }, [])

  const enter = React.useCallback(async () => {
    const root = document.documentElement as FullscreenCapableElement
    const request = root.requestFullscreen ?? root.webkitRequestFullscreen
    if (!request) return

    // Never rejects outward: a browser that refuses fullscreen must not stop
    // someone sitting their interview.
    try {
      await request.call(root)
      everEnteredRef.current = true
      // After the request resolves, not before: Chrome only captures Escape
      // once the document is actually fullscreen.
      await lockEscape()
    } catch {
      // Includes iOS Safari, which has no Fullscreen API outside <video>.
    }
  }, [])

  const toggle = React.useCallback(async () => {
    if (fullscreenElement() === null) {
      await enter()
      return
    }
    // Released first, so the control is never the thing that has to be held
    // down to work — pressing it must leave immediately.
    unlockKeyboard()
    try {
      await document.exitFullscreen?.()
    } catch {
      /* empty */
    }
  }, [enter])

  /* ------------------------------------------------------------ fullscreen */

  React.useEffect(() => {
    if (!active) return

    const onChange = () => {
      const isFull = fullscreenElement() !== null
      setInFullscreen(isFull)
      // However they left — held Escape, F11, window controls — the capture
      // goes with it. The spec releases it on exit anyway; doing it here too
      // means the browser and this hook can never disagree.
      if (!isFull) unlockKeyboard()
    }

    document.addEventListener("fullscreenchange", onChange)
    document.addEventListener("webkitfullscreenchange", onChange)
    return () => {
      document.removeEventListener("fullscreenchange", onChange)
      document.removeEventListener("webkitfullscreenchange", onChange)
      // The sitting is over — never leave a candidate's Escape key captured on
      // whatever page they land on next.
      unlockKeyboard()
    }
  }, [active])

  /* --------------------------------------------------------- tab switching */

  React.useEffect(() => {
    if (!active) return

    const onVisibility = () => {
      if (document.hidden) {
        // Only the first of a run: `visibilitychange` can fire repeatedly while
        // hidden on some platforms, and each would otherwise restart the clock
        // and turn one long absence into several short ones.
        awaySinceRef.current ??= Date.now()
        return
      }
      const since = awaySinceRef.current
      awaySinceRef.current = null
      if (since === null || Date.now() - since < MIN_AWAY_MS) return

      countRef.current += 1
      setTabSwitchCount(countRef.current)
    }

    document.addEventListener("visibilitychange", onVisibility)
    return () => document.removeEventListener("visibilitychange", onVisibility)
  }, [active])

  const readTabSwitches = React.useCallback(() => countRef.current, [])

  return {
    inFullscreen,
    supported,
    tabSwitchCount,
    readTabSwitches,
    enter,
    toggle,
  }
}
