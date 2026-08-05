import * as React from "react"
import { List } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

/**
 * The escape hatch's own value. Only ever seen by this component — picking it
 * switches to the text box rather than becoming the answer.
 */
const OTHER = "__other__"

/**
 * A dropdown of common answers that can still take an uncommon one.
 *
 * Used where the values cluster hard but the set is genuinely open — job titles,
 * where nine hirings in ten are one of thirty names and the tenth is
 * "Developer Advocate, Platform". A plain text box makes everyone type a title
 * that was already known; a closed dropdown makes the tenth job impossible to
 * create. So: pick from the list, or say it's something else and type it.
 *
 * The value handed out is always a plain string, whichever way it was produced —
 * nothing downstream can tell, and the field's own validation applies to both.
 */
export function SelectOrText({
  id,
  value,
  onChange,
  onBlur,
  options,
  placeholder,
  invalid,
}: {
  id: string
  value: string
  onChange: (next: string) => void
  onBlur?: () => void
  options: Array<{ value: string; label: string }>
  placeholder?: string
  invalid?: boolean
}) {
  const listed = options.some((option) => option.value === value)

  /**
   * Whether we're on the text box. Seeded from the value, so opening the edit
   * form for a job whose title was typed in — not picked — lands on the box with
   * the title already in it rather than a dropdown that can't represent it.
   *
   * Mount-time only, which is right because the dialog's portal unmounts when it
   * closes: every open is a fresh mount. Should that ever gain `keepMounted`,
   * this has to be reset alongside the form.
   */
  const [typing, setTyping] = React.useState(() => value !== "" && !listed)

  if (typing) {
    return (
      <div className="flex gap-2">
        <Input
          id={id}
          // Only when they just switched — on an edit form the value is already
          // there, and stealing focus scrolls the dialog to this field.
          autoFocus={value === ""}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onBlur}
          placeholder={placeholder}
          aria-invalid={invalid}
        />
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            setTyping(false)
            onChange("")
          }}
          className="shrink-0 text-muted-foreground"
        >
          <List />
          List
        </Button>
      </div>
    )
  }

  return (
    <Select
      value={value}
      onValueChange={(next) => {
        const picked = String(next)
        if (picked === OTHER) {
          setTyping(true)
          // Cleared rather than left as the sentinel: "Other" is not an answer,
          // so a `required` field must still be empty until they type one.
          onChange("")
          return
        }
        onChange(picked)
      }}
    >
      <SelectTrigger id={id} aria-invalid={invalid} className="w-full">
        {/* Options are portalled, so map value → label here rather than letting
            the raw value show. */}
        <SelectValue>
          {(current) => {
            const selected = String(current ?? "")
            if (!selected) return placeholder ?? "Select…"
            return (
              options.find((option) => option.value === selected)?.label ??
              selected
            )
          }}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
        {/* Last, and worded as an action: it's the way out of the list, not one
            more thing on it. */}
        <SelectItem value={OTHER}>Other — type it in</SelectItem>
      </SelectContent>
    </Select>
  )
}
