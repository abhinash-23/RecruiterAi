import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"

import { cn } from "@/lib/utils"

/**
 * A text field.
 *
 * **`type="number"` arrives with two behaviours nobody asked for, and both are
 * turned off here rather than in each of the dozen places a number is typed.**
 *
 *  - **The spinner.** A pair of arrows the browser draws inside the field,
 *    which on this scale is a 10px hit target that nudges by one — nobody
 *    reaches for it to type 80, and it sits on top of the value while they do.
 *  - **The wheel.** A `number` input that has focus treats a scroll as a
 *    change, so scrolling the page with the cursor resting over the field
 *    silently rewrites what was typed — and on a form that is submitted
 *    straight afterwards, the reader has no reason to look again.
 */
function Input({
  className,
  type,
  onWheel,
  ...props
}: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      onWheel={(event) => {
        onWheel?.(event)
        /* Only while focused, which is the only state where the browser would
           act on it — an unfocused field ignores the wheel already, and
           blocking it there would stop the *page* scrolling over an input. The
           page still scrolls in the focused case too: `blur()` hands the wheel
           back rather than swallowing it, which `preventDefault` would not. */
        if (type === "number" && event.currentTarget === document.activeElement) {
          event.currentTarget.blur()
        }
      }}
      className={cn(
        "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        // Chromium and Safari draw the stepper as two pseudo-elements; Firefox
        // needs the field told it is a text field. Both spellings, so the arrows
        // are gone everywhere rather than on most browsers — and the Firefox one
        // is scoped to `type=number`, since `appearance` on a file or colour
        // input is how those get their button in the first place.
        "[[type=number]]:[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
        className
      )}
      {...props}
    />
  )
}

export { Input }
