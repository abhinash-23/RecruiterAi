import * as React from "react"
import { Check, FileText, Info } from "lucide-react"

import { Card, CardContent } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"

/** Debounce before the "Saved" tick appears, so it doesn't flicker per keypress. */
const SAVE_DELAY_MS = 600

/**
 * The candidate's own scratchpad during the sitting.
 *
 * Kept in `sessionStorage` and **never sent anywhere**: it is a place to jot
 * down a thought before answering, not an answer. It survives an accidental
 * reload and disappears when the tab closes, which matches what a candidate
 * would expect of a scratchpad.
 */
export function NotesCard({ sessionId }: { sessionId: string }) {
  const storageKey = `interview-notes:${sessionId}`

  const [value, setValue] = React.useState(() => {
    try {
      return sessionStorage.getItem(storageKey) ?? ""
    } catch {
      return ""
    }
  })
  const [saved, setSaved] = React.useState(true)

  // Debounced write. The effect body only *schedules* — the state change happens
  // in the timer callback, and "unsaved" is set by the change handler, so
  // nothing is set synchronously during render.
  React.useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        sessionStorage.setItem(storageKey, value)
      } catch {
        // Private mode or a full quota — the notes just won't survive a reload.
      }
      setSaved(true)
    }, SAVE_DELAY_MS)

    return () => window.clearTimeout(timer)
  }, [value, storageKey])

  const edit = (next: string) => {
    setValue(next)
    setSaved(false)
  }

  return (
    <Card className="gap-0 py-0">
      <CardContent className="flex flex-col gap-2 p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 text-sm font-medium">
            <FileText className="size-4 text-emerald-600 dark:text-emerald-400" />
            Interview Notes
          </p>
          {saved ? (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Check className="size-3.5 text-emerald-600 dark:text-emerald-400" />
              Saved
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">Saving…</span>
          )}
        </div>

        <Textarea
          rows={4}
          value={value}
          onChange={(event) => edit(event.target.value)}
          placeholder="Add your notes here… (kept on this device only)"
          className="resize-none"
        />

        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <span className="tracking-wide uppercase">Notes autosave: enabled</span>
          <span className="flex items-center gap-1">
            <Info className="size-3" />
            Stored on this device, not submitted
          </span>
        </div>
      </CardContent>
    </Card>
  )
}
