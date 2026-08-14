import { Controller, type Control, type FieldErrors } from "react-hook-form"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

import type { FieldSpec, FormValues } from "./field-schema"
import { PhoneInput } from "./phone-input"
import { SelectOrText } from "./select-or-text"

interface FormFieldsProps {
  fields: FieldSpec[]
  control: Control<FormValues>
  errors: FieldErrors<FormValues>
  className?: string
}

/**
 * Renders a field list into controls, so a new field kind only needs adding in
 * one place.
 *
 * One field per row, deliberately. Pairing them two-up fit more on screen but
 * read as a grid to be scanned rather than a form to be filled: the eye has to
 * pick a direction at every row, and the fields that are themselves two
 * controls — a phone, a colour — were the ones squeezed to make it fit.
 */
export function FormFields({
  fields,
  control,
  errors,
  className,
}: FormFieldsProps) {
  return (
    <div className={cn("grid gap-4", className)}>
      {fields.map((field) => {
        const error = errors[field.name]
        const message =
          typeof error?.message === "string" ? error.message : null
        const id = `field-${field.name}`

        return (
          <div key={field.name} className="flex flex-col gap-1.5">
            {field.kind === "switch" ? (
              <Controller
                control={control}
                name={field.name}
                render={({ field: bound }) => (
                  <div className="flex items-start justify-between gap-4 rounded-lg p-3 ring-1 ring-foreground/10">
                    <div className="min-w-0">
                      <Label htmlFor={id}>{field.label}</Label>
                      {field.description ? (
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {field.description}
                        </p>
                      ) : null}
                    </div>
                    <Switch
                      id={id}
                      checked={Boolean(bound.value)}
                      onCheckedChange={(checked) => bound.onChange(checked)}
                    />
                  </div>
                )}
              />
            ) : (
              <>
                <Label htmlFor={id}>
                  {field.label}
                  {field.required ? (
                    <span className="text-destructive">*</span>
                  ) : null}
                </Label>

                <Controller
                  control={control}
                  name={field.name}
                  render={({ field: bound }) => {
                    if (field.kind === "select") {
                      return (
                        <Select
                          value={String(bound.value ?? "")}
                          onValueChange={(value) =>
                            bound.onChange(String(value))
                          }
                        >
                          <SelectTrigger
                            id={id}
                            aria-invalid={Boolean(message)}
                            className="w-full"
                          >
                            {/* Options are portalled, so map value → label here
                                rather than letting the raw value show. */}
                            <SelectValue>
                              {(value) => {
                                const selected = String(value ?? "")
                                if (!selected) {
                                  return field.placeholder ?? "Select…"
                                }
                                return (
                                  field.options?.find(
                                    (o) => o.value === selected
                                  )?.label ?? selected
                                )
                              }}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            {(field.options ?? []).map((option) => (
                              <SelectItem
                                key={option.value}
                                value={option.value}
                              >
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )
                    }

                    if (field.kind === "select-or-text") {
                      return (
                        <SelectOrText
                          id={id}
                          value={String(bound.value ?? "")}
                          onChange={bound.onChange}
                          onBlur={bound.onBlur}
                          options={field.options ?? []}
                          placeholder={field.placeholder}
                          invalid={Boolean(message)}
                        />
                      )
                    }

                    if (field.kind === "textarea") {
                      return (
                        <Textarea
                          id={id}
                          value={String(bound.value ?? "")}
                          onChange={bound.onChange}
                          onBlur={bound.onBlur}
                          placeholder={field.placeholder}
                          aria-invalid={Boolean(message)}
                          className="min-h-24"
                        />
                      )
                    }

                    if (field.kind === "phone") {
                      return (
                        <PhoneInput
                          id={id}
                          value={String(bound.value ?? "")}
                          onChange={bound.onChange}
                          onBlur={bound.onBlur}
                          placeholder={field.placeholder}
                          invalid={Boolean(message)}
                        />
                      )
                    }

                    if (field.kind === "color") {
                      return (
                        <div className="flex items-center gap-2">
                          <input
                            id={id}
                            type="color"
                            value={String(bound.value || "#000000")}
                            onChange={bound.onChange}
                            className="size-9 shrink-0 cursor-pointer rounded-lg border border-input bg-transparent p-1"
                          />
                          <Input
                            value={String(bound.value ?? "")}
                            onChange={bound.onChange}
                            placeholder="#0052FF"
                            aria-label={`${field.label} hex value`}
                          />
                        </div>
                      )
                    }

                    return (
                      <Input
                        id={id}
                        type={
                          field.kind === "number"
                            ? "number"
                            : field.kind === "date"
                              ? "date"
                              : field.kind === "time"
                                ? "time"
                                : field.kind === "email"
                                  ? "email"
                                  : field.kind === "tel"
                                    ? "tel"
                                    : "text"
                        }
                        min={field.min}
                        max={field.max}
                        value={String(bound.value ?? "")}
                        onChange={bound.onChange}
                        onBlur={bound.onBlur}
                        placeholder={field.placeholder}
                        aria-invalid={Boolean(message)}
                      />
                    )
                  }}
                />

                {field.description ? (
                  <p className="text-xs text-muted-foreground">
                    {field.description}
                  </p>
                ) : null}
              </>
            )}

            {message ? (
              <p className="text-xs text-destructive">{message}</p>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
