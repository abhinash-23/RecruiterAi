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
 *  - **Paste.** `maxLength={1}` makes the browser truncate pasted text to one
 *    character before any change event fires, so pasting a copied code would
 *    otherwise fill one box and drop the rest. `onPaste` reads the clipboard
 *    itself and spreads the digits, which is how most people enter a code they
 *    were emailed.
 *  - **Browser and OS autofill**, which sets the value programmatically and so
 *    arrives as one long string through `onChange` instead — spread the same way.
 *    That is the whole point of `one-time-code`.
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

  /**
   * The value as of the last **write**, not as of the last render — and the
   * whole reason this field works.
   *
   * `write` hands the new value up and then moves the caret, both synchronously,
   * so the box it focuses still holds the *previous* render's props. Its
   * `onFocus` read `value` from that stale closure, decided the box was past the
   * end of a code that had already grown, and threw focus back to the box it
   * came from. The digit landed; the caret did not move. Every keystroke after
   * that re-entered box one, and `write` truncates at the index it is given — so
   * a six-digit code could never be more than one digit long, in this component,
   * everywhere it is used.
   *
   * Kept in a ref because focus moves between a state update and the render that
   * would have told the DOM about it. Nothing reads it during render.
   */
  const latest = React.useRef(value)
  React.useEffect(() => {
    latest.current = value
  }, [value])

  /** The one box that accepts typing — the first empty one, or the last. */
  const editIndexOf = (current: string) => Math.min(current.length, length - 1)

  const focusAt = (index: number) => {
    const target = refs.current[Math.max(0, Math.min(index, length - 1))]
    target?.focus()
    // Selected rather than just focused: see the note about filled boxes above.
    target?.select()
  }

  const write = (from: number, digits: string) => {
    // Truncated at `from` rather than spliced: retyping a digit mid-code means
    // the ones after it were part of a code that was wrong, so re-entering them
    // is the intent. It also keeps the value left-packed for free.
    const next = (value.slice(0, from) + digits).slice(0, length)
    // Before the focus move, so the box receiving it judges itself against the
    // code as it is now rather than as it was a moment ago.
    latest.current = next
    onChange(next)
    focusAt(next.length)
  }

  return (
    <div
      role="group"
      aria-label={`${length}-digit code`}
      aria-describedby={describedBy}
      className="flex items-center justify-center gap-2 sm:gap-3"
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
            // Against `latest`, never this render's `value` — see the ref above.
            if (index > latest.current.length) {
              focusAt(editIndexOf(latest.current))
              return
            }
            event.currentTarget.select()
          }}
          onChange={(event) => {
            const digits = event.target.value.replace(/\D/g, "")
            if (digits) write(index, digits)
          }}
          onPaste={(event) => {
            // Always prevented, even when there is nothing usable in there: the
            // default would drop a stray character into a box whose value this
            // component owns.
            event.preventDefault()
            const pasted = event.clipboardData
              .getData("text")
              .replace(/\D/g, "")
            if (!pasted) return
            // A paste of the full length is the whole code, wherever the caret
            // happens to be — so it replaces, rather than being appended to
            // whatever was half-typed and then truncated back to six.
            write(pasted.length >= length ? 0 : index, pasted)
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              /**
               * Submitted from here, because the browser will not do it.
               *
               * *Implicit* submission — Enter in a text field submitting the
               * form around it — is skipped entirely when a form has no submit
               * button of its own **and** more than one field that blocks it.
               * A code field is six such fields, and the Verify button lives in
               * the card's footer, outside the form. So Enter did nothing at all
               * on a screen whose only content is typed.
               *
               * `requestSubmit` fires the form's `submit` event exactly as the
               * button would, so there is one path to verification rather than
               * a keyboard copy of it that can drift.
               */
              event.preventDefault()
              event.currentTarget.form?.requestSubmit()
              return
            }
            if (event.key === "Backspace") {
              // Handled here rather than left to the browser, which would only
              // clear the box the caret is in — and at an empty box, nothing.
              event.preventDefault()
              const target = value[index] ? index : index - 1
              if (target < 0) return
              const next = value.slice(0, target)
              latest.current = next
              onChange(next)
              focusAt(target)
              return
            }
            if (event.key === "Delete") {
              event.preventDefault()
              const next = value.slice(0, index)
              latest.current = next
              onChange(next)
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
              focusAt(Math.min(index + 1, editIndexOf(latest.current)))
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
