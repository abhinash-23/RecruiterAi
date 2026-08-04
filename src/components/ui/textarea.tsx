import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * `field-sizing-content` grows the box to fit what's typed, which is pleasant
 * for a sentence and catastrophic for a pasted résumé: it has no upper bound, so
 * the field grew past the viewport and took its dialog with it.
 *
 * `max-h-64` is that bound. Past it the textarea scrolls its own content, which
 * is what a textarea is for. Callers that want a different ceiling pass their
 * own `max-h-*`.
 */
function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content max-h-64 min-h-16 w-full overflow-y-auto rounded-lg border border-input bg-transparent px-2.5 py-2 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
