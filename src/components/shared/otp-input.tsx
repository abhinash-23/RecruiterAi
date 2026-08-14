import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * A one-time code as one box per digit.
 *
 * Held as a **left-packed string** — `"123"` means three digits typed and the
 * rest empty — rather than as an array with holes. That is what lets the value
 * go straight to `verify-otp` with no assembly step, and it rules out the state
 * a gapped array allows: `["1", "", "3"]`, which looks like `13` on the wire and
 * like `1_3` on screen. The cost is that only one box is editable at a time, so
 * a click on box 5 while three digits are typed lands on box 4 instead.
 *
 * Everything else here exists because a row of `maxLength={1}` inputs is not, on
 * its own, a code field:
 *
 *  - **Typing over a filled box.** A box already at its max length silently
 *    ignores the keystroke, so focus selects its contents and the digit replaces
 *    what was there.
 *  - **Paste, and browser autofill.** Both arrive as one long string in one box.
 *    They are spread across the boxes from that point rather than truncated to
 *    the first character, which is the whole point of `one-time-code` autofill.
 *  - **Backspace at an empty box** steps back and clears the previous one,
 *    because that is the key everyone reaches for after a mistyped digit.
 */
export function OtpInput({
  id,
  length = 6,
  value,
  onChange,
  disabled,
  invalid,
  autoFocus,
  "aria-describedby": describedBy,
}: {
  /** Ids the first box, so a `<Label htmlFor>` focuses where typing starts. */
  id?: string
  length?: number
  /** Digits only, left-packed, never longer than `length`. */
  value: string
  onChange: (next: string) => void
  disabled?: boolean
  invalid?: boolean
  autoFocus?: boolean
  "aria-describedby"?: string
}) {
  const refs = React.useRef<Array<HTMLInputElement | null>>([])

  const focusAt = (index: number) => {
    const target = refs.current[Math.max(0, Math.min(index, length - 1))]
    target?.focus()
    // Selected rather than just focused: see the note about filled boxes above.
    target?.select()
  }

  /** The one box that accepts typing — the first empty one, or the last. */
  const editIndex = Math.min(value.length, length - 1)

  const write = (from: number, digits: string) => {
    // Truncated at `from` rather than spliced: retyping a digit mid-code means
    // the ones after it were part of a code that was wrong, so re-entering them
    // is the intent. It also keeps the value left-packed for free.
    const next = (value.slice(0, from) + digits).slice(0, length)
    onChange(next)
    focusAt(next.length)
  }

  return (
    <div
      role="group"
      aria-label={`${length}-digit code`}
      aria-describedby={describedBy}
      className="flex items-center gap-2 sm:gap-3"
    >
      {Array.from({ length }, (_, index) => (
        <input
          key={index}
          ref={(node) => {
            refs.current[index] = node
          }}
          id={index === 0 ? id : undefined}
          // `text`, not `number`: a number input brings spinners, accepts `e`
          // and `-`, and reports a non-numeric value as an empty string, which
          // would swallow the digit that caused it.
          type="text"
          inputMode="numeric"
          autoComplete={index === 0 ? "one-time-code" : "off"}
          // Only the first box, and only when asked: this is the sole thing to
          // do on the screen that uses it.
          autoFocus={autoFocus && index === 0}
          maxLength={1}
          disabled={disabled}
          aria-invalid={invalid}
          aria-label={`Digit ${index + 1} of ${length}`}
          value={value[index] ?? ""}
          onFocus={(event) => {
            if (index > value.length) {
              focusAt(editIndex)
              return
            }
            event.currentTarget.select()
          }}
          onChange={(event) => {
            const digits = event.target.value.replace(/\D/g, "")
            if (digits) write(index, digits)
          }}
          onKeyDown={(event) => {
            if (event.key === "Backspace") {
              // Handled here rather than left to the browser, which would only
              // clear the box the caret is in — and at an empty box, nothing.
              event.preventDefault()
              const target = value[index] ? index : index - 1
              if (target < 0) return
              onChange(value.slice(0, target))
              focusAt(target)
              return
            }
            if (event.key === "Delete") {
              event.preventDefault()
              onChange(value.slice(0, index))
              return
            }
            if (event.key === "ArrowLeft") {
              event.preventDefault()
              focusAt(index - 1)
              return
            }
            if (event.key === "ArrowRight") {
              event.preventDefault()
              // Never past the first empty box: the boxes beyond it aren't
              // typeable, so landing there would be a caret that does nothing.
              focusAt(Math.min(index + 1, editIndex))
            }
          }}
          className={cn(
            "size-11 rounded-lg border border-input bg-transparent text-center text-lg font-medium tabular-nums transition-colors outline-none",
            "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
            "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
            "aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20",
            "dark:bg-input/30 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40"
          )}
        />
      ))}
    </div>
  )
}
