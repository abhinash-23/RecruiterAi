import * as React from "react"
import { Bot } from "lucide-react"

import { cn } from "@/lib/utils"

export interface TranscriptEntry {
  id: string
  speaker: "host" | "candidate"
  text: string
  /** Epoch millis. */
  at: number
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
}: {
  entries: TranscriptEntry[]
  className?: string
}) {
  const viewRef = React.useRef<HTMLDivElement | null>(null)
  /** Is the reader at the bottom? Recorded on their scrolls, not derived. */
  const pinnedRef = React.useRef(true)

  /*
   * The **last entry's text** is a dependency, and that is the whole fix.
   *
   * This used to key on `entries.length`, which is only half of how this list
   * changes. Elena's captions arrive several a second and `addCaption` *merges*
   * them into the entry already on screen — so a bubble grows from one line to
   * twelve without the array ever getting longer. The scroll fired for the new
   * bubble and then never again, and the rest of her question wrote itself off
   * the bottom of the panel: auto-scroll "working" and the text still not
   * readable, which is exactly how it was reported.
   */
  const last = entries[entries.length - 1]

  React.useEffect(() => {
    const view = viewRef.current
    if (!view) return
    if (!pinnedRef.current) return
    /* `scrollTop`, not `scrollIntoView`. This panel sits inside another
       scrollable container on small screens, and `scrollIntoView` walks up the
       ancestor chain — it will happily scroll the page to bring this into view.
       Setting `scrollTop` moves this element and nothing else.

       No smooth behaviour either: at several captions a second each animation
       is interrupted by the next, so the view lags permanently behind the text
       it is meant to be showing. */
    view.scrollTop = view.scrollHeight
  }, [entries.length, last?.id, last?.text])

  /*
   * Whether to keep following, decided from the reader's own scrolling rather
   * than measured at update time.
   *
   * Measuring inside the effect cannot work: by then the DOM already holds the
   * new text, so a bubble that grew by two hundred pixels reads as "scrolled a
   * long way from the bottom" and the panel would stop following precisely when
   * there is most to follow.
   */
  const onScroll = () => {
    const view = viewRef.current
    if (!view) return
    const fromBottom = view.scrollHeight - view.scrollTop - view.clientHeight
    pinnedRef.current = fromBottom <= NEAR_BOTTOM_PX
  }

  return (
    <div
      ref={viewRef}
      onScroll={onScroll}
      className={cn(
        "flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto scrollbar-none p-4",
        className
      )}
      aria-live="polite"
      aria-label="Interview transcript"
    >
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
              <p className="mb-1 text-[11px] text-muted-foreground">
                Elena AI · {clockTime(entry.at)}
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
            <div className="min-w-0 max-w-[85%]">
              <p className="mb-1 text-right text-[11px] text-muted-foreground">
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
  )
}
