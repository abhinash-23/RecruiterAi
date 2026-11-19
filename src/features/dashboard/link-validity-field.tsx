import * as React from "react"

import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

/** The usual choices, in hours. */
const PRESETS = [24, 48, 72]
const CUSTOM = "custom"
const DEFAULT = "default"

const hours = (value: number) => `${value} ${value === 1 ? "hour" : "hours"}`

/**
 * How long an interview link stays open: 24, 48 or 72 hours, the company
 * default, or a number of hours typed in.
 *
 * `value` is what the form sends: `""` follows the company default (nothing is
 * sent and the server applies it), anything else is a number of hours. Picking
 * the preset that *is* the company default sends nothing too, so the interview
 * keeps following the company setting rather than pinning today's value.
 */
export function LinkValidityField({
  id,
  value,
  onChange,
  defaultHours,
  min = 1,
  max = 720,
  step = 1,
  disabled,
}: {
  id: string
  value: string
  onChange: (value: string) => void
  /** The company default, once loaded. */
  defaultHours?: number
  min?: number
  max?: number
  step?: number
  disabled?: boolean
}) {
  // Typed hours that aren't a preset open on Custom, with the number shown.
  const [custom, setCustom] = React.useState(
    () => value !== "" && !PRESETS.includes(Number(value))
  )
  const defaultIsPreset =
    defaultHours !== undefined && PRESETS.includes(defaultHours)

  const selected = custom
    ? CUSTOM
    : value === ""
      ? defaultIsPreset
        ? String(defaultHours)
        : DEFAULT
      : value

  const label = (option: string) => {
    if (option === CUSTOM) return "Custom…"
    if (option === DEFAULT) {
      return defaultHours !== undefined
        ? `${hours(defaultHours)} (company default)`
        : "Company default"
    }
    const n = Number(option)
    return n === defaultHours ? `${hours(n)} (company default)` : hours(n)
  }

  return (
    <div className="flex flex-col gap-2">
      <Select
        value={selected}
        disabled={disabled}
        onValueChange={(next) => {
          const option = String(next)
          if (option === CUSTOM) {
            setCustom(true)
            return
          }
          setCustom(false)
          // The default itself, by either name: follow it, send nothing.
          onChange(
            option === DEFAULT || Number(option) === defaultHours ? "" : option
          )
        }}
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue>{(option) => label(String(option))}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {defaultIsPreset ? null : (
            <SelectItem value={DEFAULT}>{label(DEFAULT)}</SelectItem>
          )}
          {PRESETS.map((preset) => (
            <SelectItem key={preset} value={String(preset)}>
              {label(String(preset))}
            </SelectItem>
          ))}
          <SelectItem value={CUSTOM}>{label(CUSTOM)}</SelectItem>
        </SelectContent>
      </Select>
      {custom ? (
        <Input
          type="number"
          aria-label="Custom link validity in hours"
          min={min}
          max={max}
          step={step}
          autoFocus
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          placeholder={`Enter hours (${min}–${max})`}
        />
      ) : null}
    </div>
  )
}
