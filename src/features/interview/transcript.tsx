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
 * Running log of the sitting, so a candidate can re-read a question they only
 * half-heard rather than guessing.
 *
 * Auto-scrolls to the newest entry. `scrollbar-none` keeps the column clean —
 * the list still scrolls, the bar just isn't drawn.
 */
export function Transcript({
  entries,
  className,
}: {
  entries: TranscriptEntry[]
  className?: string
}) {
  const endRef = React.useRef<HTMLDivElement | null>(null)

  React.useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })
  }, [entries.length])

  return (
    <div
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
              <div className="rounded-xl rounded-tl-sm bg-emerald-500/10 px-3 py-2 text-sm whitespace-pre-line">
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
              <div className="rounded-xl rounded-tr-sm bg-muted px-3 py-2 text-sm break-words whitespace-pre-line">
                {entry.text}
              </div>
            </div>
          </div>
        )
      )}

      <div ref={endRef} />
    </div>
  )
}
