import * as React from "react"
import { Bot } from "lucide-react"

import { cn } from "@/lib/utils"
import { DEFAULT_HOST_NAME } from "@/services/voice"

export interface TranscriptEntry {
  id: string
  speaker: "host" | "candidate"
  text: string
  /** Epoch millis. */
  at: number
  /**
   * Where the line sorts, on a rev-7 voice sitting: the server's line `id`, or
   * a fraction after the last one for a line written locally (a tap). Lines are
   * ordered by this, never by arrival. Absent everywhere else.
   */
  order?: number
}

function clockTime(at: number) {
  return new Date(at).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  })
}

/**
 * How close to the bottom still counts as "following the conversation".
 *
 * Anything within this stays pinned; scroll further up than it and the log stops
 * chasing, because at that point the reader is doing the one thing this panel
 * exists for — re-reading something they half-heard — and yanking them back to
 * the bottom every time Elena says another word makes that impossible.
 */
const NEAR_BOTTOM_PX = 64

/**
 * Running log of the sitting, so a candidate can re-read a question they only
 * half-heard rather than guessing.
 *
 * Follows the newest text. `scrollbar-none` keeps the column clean — the list
 * still scrolls, the bar just isn't drawn.
 */
export function Transcript({
  entries,
  className,
  hostName = DEFAULT_HOST_NAME,
}: {
  entries: TranscriptEntry[]
  className?: string
  /** Who the host lines are attributed to. */
  hostName?: string
}) {
  const viewRef = React.useRef<HTMLDivElement | null>(null)
  const contentRef = React.useRef<HTMLDivElement | null>(null)
  /** Is the reader following the conversation? Changed only by their scrolling. */
  const pinnedRef = React.useRef(true)
  /** Where the last automatic scroll left the view, to tell it from the reader's. */
  const autoTopRef = React.useRef(0)

  const toBottom = React.useCallback(() => {
    const view = viewRef.current
    if (!view || !pinnedRef.current) return
    /* `scrollTop`, not `scrollIntoView`. This panel sits inside another
       scrollable container on small screens, and `scrollIntoView` walks up the
       ancestor chain — it will happily scroll the page to bring this into view.
       Setting `scrollTop` moves this element and nothing else.

       No smooth behaviour either: at several captions a second each animation
       is interrupted by the next, so the view lags permanently behind the text
       it is meant to be showing. */
    view.scrollTop = view.scrollHeight
    autoTopRef.current = view.scrollTop
  }, [])

  /*
   * **Follows the transcript's height, not its last entry.**
   *
   * Keying on the last entry missed half of how this list grows. On a rev-7
   * sitting a candidate's line often gets its final, longer text *after* Elena's
   * next line has appeared below it — the bubble that grows is not the last
   * one, the last one never changes, and her question slid off the bottom. Any
   * bubble growing, appearing or being replaced changes the content's height,
   * so watching that height covers every case at once.
   */
  React.useEffect(() => {
    const content = contentRef.current
    if (!content || typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(() => toBottom())
    observer.observe(content)
    return () => observer.disconnect()
  }, [toBottom])

  // Also on every change of the list, for a browser without ResizeObserver.
  React.useEffect(() => {
    toBottom()
  }, [entries, toBottom])

  /*
   * Whether to keep following, decided from the **reader's** scrolling.
   *
   * A scroll event arrives a frame after the scroll that caused it, and by then
   * more text may have landed: measured naively, the automatic scroll looked
   * like the reader moving away from the bottom, and the panel stopped
   * following for the rest of the sitting. So only a move *above* where the
   * last automatic scroll put the view counts as leaving, and reaching the
   * bottom again — by any means — resumes following.
   */
  const onScroll = () => {
    const view = viewRef.current
    if (!view) return
    const fromBottom = view.scrollHeight - view.scrollTop - view.clientHeight
    if (fromBottom <= NEAR_BOTTOM_PX) {
      pinnedRef.current = true
    } else if (view.scrollTop < autoTopRef.current - 2) {
      pinnedRef.current = false
    }
  }

  return (
    <div
      ref={viewRef}
      onScroll={onScroll}
      className={cn(
        "scrollbar-none min-h-0 flex-1 overflow-y-auto p-4",
        className
      )}
      aria-live="polite"
      aria-label="Interview transcript"
    >
      {/* Measured, not styled: its height is what the follow above watches. */}
      <div ref={contentRef} className="flex flex-col gap-4">
        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            The conversation will appear here.
          </p>
        ) : null}

        {entries.map((entry) =>
          entry.speaker === "host" ? (
            <div key={entry.id} className="flex items-start gap-2">
              <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-md bg-muted">
                <Bot className="size-3.5 text-muted-foreground" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="mb-1 text-[0.6875rem] text-muted-foreground">
                  {hostName} AI · {clockTime(entry.at)}
                </p>
                {/* `wrap-break-word` to match the candidate's bubble, which has
                  always had it. Elena's captions carry option text and the odd
                  URL-ish run with no spaces in it, and without this such a run
                  pushes the bubble past the column instead of wrapping — text
                  that is on screen and still unreadable. */}
                <div className="rounded-xl rounded-tl-sm bg-emerald-500/10 px-3 py-2 text-sm wrap-break-word whitespace-pre-line">
                  {entry.text}
                </div>
              </div>
            </div>
          ) : (
            <div key={entry.id} className="flex items-start justify-end gap-2">
              <div className="max-w-[85%] min-w-0">
                <p className="mb-1 text-right text-[0.6875rem] text-muted-foreground">
                  You · {clockTime(entry.at)}
                </p>
                <div className="rounded-xl rounded-tr-sm bg-muted px-3 py-2 text-sm wrap-break-word whitespace-pre-line">
                  {entry.text}
                </div>
              </div>
            </div>
          )
        )}

        {/* A trailing spacer, not a scroll target any more — the container
          scrolls itself now. It keeps the last bubble clear of the very bottom
          edge, which is what made a finished line still look clipped. */}
        <div className="h-1 shrink-0" />
      </div>
    </div>
  )
}
