import * as React from "react"
import PhoneInputBase, { getCountryCallingCode } from "react-phone-number-input"
import type { Country } from "react-phone-number-input"
import "react-phone-number-input/style.css"

import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"

/** Sentinel the library uses for the "no country chosen" entry. */
const NO_COUNTRY = "ZZ"

function callingCode(country: string | undefined) {
  if (!country || country === NO_COUNTRY) return null
  try {
    return `+${getCountryCallingCode(country as Country)}`
  } catch {
    // Not a dialable region (the library includes a few).
    return null
  }
}

interface CountryOption {
  value?: string
  label: string
  divider?: boolean
}

interface CountrySelectProps {
  value?: string
  onChange: (value: string | undefined) => void
  options: CountryOption[]
  disabled?: boolean
  readOnly?: boolean
  iconComponent?: React.ComponentType<{ country?: string; label?: string }>
}

/**
 * Country picker for the phone field. Replaces the library's bare `<select>`,
 * whose native option list ignores the app's theme and renders unreadably in
 * dark mode.
 */
function CountrySelect({
  value,
  onChange,
  options,
  disabled,
  readOnly,
  iconComponent: Flag,
}: CountrySelectProps) {
  const selectable = options.filter((option) => !option.divider)
  const selected = value ?? NO_COUNTRY
  const code = callingCode(selected)

  return (
    <Select
      value={selected}
      disabled={disabled || readOnly}
      onValueChange={(next) =>
        onChange(next === NO_COUNTRY ? undefined : String(next))
      }
    >
      <SelectTrigger
        aria-label="Country calling code"
        className="w-auto shrink-0 gap-1.5 tabular-nums"
      >
        <span className="flex items-center gap-1.5">
          {Flag ? (
            <span className="flex w-5 shrink-0 overflow-hidden rounded-sm [&_img]:w-full">
              <Flag country={value} />
            </span>
          ) : null}
          <span className="text-sm">{code ?? "Intl"}</span>
        </span>
      </SelectTrigger>

      {/* Wider than the trigger: the popup inherits the anchor width by
          default, which clips long country names and their codes. */}
      <SelectContent className="max-h-72 w-72 min-w-72">
        {selectable.map((option) => {
          const itemValue = option.value ?? NO_COUNTRY
          const itemCode = callingCode(itemValue)
          return (
            <SelectItem key={itemValue} value={itemValue}>
              <span className="flex w-full items-center gap-2">
                {Flag ? (
                  <span className="flex w-5 shrink-0 overflow-hidden rounded-sm [&_img]:w-full">
                    <Flag country={option.value} label={option.label} />
                  </span>
                ) : null}
                <span className="flex-1 truncate">{option.label}</span>
                {itemCode ? (
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {itemCode}
                  </span>
                ) : null}
              </span>
            </SelectItem>
          )
        })}
      </SelectContent>
    </Select>
  )
}

interface PhoneInputProps {
  id?: string
  /** E.164 value, e.g. `+14155550142`. */
  value: string
  onChange: (value: string) => void
  onBlur?: () => void
  placeholder?: string
  invalid?: boolean
  /** Country selected before the user types a `+` prefix themselves. */
  defaultCountry?: Country
  className?: string
  /**
   * Styles the number field itself, for surfaces with their own input
   * treatment (the marketing page). The library merges this with its own
   * `PhoneInputInput` class rather than replacing it.
   */
  inputClassName?: string
}

/**
 * International phone entry: a country-code picker beside the number, always
 * emitting E.164 so every stored number is comparable and diallable.
 */
export function PhoneInput({
  id,
  value,
  onChange,
  onBlur,
  placeholder = "Phone number",
  invalid,
  defaultCountry = "IN",
  className,
  inputClassName,
}: PhoneInputProps) {
  return (
    <PhoneInputBase
      id={id}
      // Deliberately NOT `international`: the text field holds the national
      // number while the dropdown supplies the calling code, so clearing the
      // field can't wipe the prefix. `value` is still full E.164.
      defaultCountry={defaultCountry}
      countryCallingCodeEditable={false}
      value={value || undefined}
      // The library hands back `undefined` when the field is cleared.
      onChange={(next) => onChange(next ?? "")}
      onBlur={onBlur}
      placeholder={placeholder}
      inputComponent={Input}
      countrySelectComponent={CountrySelect}
      numberInputProps={{ "aria-invalid": invalid, className: inputClassName }}
      className={cn("flex items-center gap-2", className)}
    />
  )
}
