import { z, type ZodTypeAny } from "zod"

export type FieldKind =
  | "text"
  | "email"
  /** Plain tel input. Prefer `phone` for anything a person will dial. */
  | "tel"
  /** International number with a country-code picker. */
  | "phone"
  | "number"
  | "date"
  | "time"
  | "textarea"
  | "select"
  | "switch"
  | "color"

export interface FieldSpec {
  name: string
  label: string
  kind: FieldKind
  placeholder?: string
  description?: string
  options?: Array<{ value: string; label: string }>
  required?: boolean
  /** Numeric bounds — `number` fields only. */
  min?: number
  max?: number
  /**
   * Character bounds for text-like fields. Use these to mirror a server-side
   * rule so the reader is told before the request goes out.
   */
  minLength?: number
  maxLength?: number
  /** Span both columns in the two-column grid. */
  full?: boolean
}

export type FieldValue = string | number | boolean

export type FormValues = Record<string, FieldValue>

/**
 * Derives a Zod schema from a field list, so validation and the rendered form
 * always come from the same single source.
 */
export function schemaFromFields(fields: FieldSpec[]) {
  const shape: Record<string, ZodTypeAny> = {}

  for (const field of fields) {
    switch (field.kind) {
      case "email": {
        shape[field.name] = field.required
          ? z.string().trim().min(1, "Required").email("Enter a valid email")
          : z.string().trim().email("Enter a valid email").or(z.literal(""))
        break
      }
      case "number": {
        let numeric = z.coerce.number({ error: "Enter a number" })
        if (field.min !== undefined) {
          numeric = numeric.min(field.min, `Minimum is ${field.min}`)
        }
        if (field.max !== undefined) {
          numeric = numeric.max(field.max, `Maximum is ${field.max}`)
        }
        shape[field.name] = numeric
        break
      }
      case "switch": {
        shape[field.name] = z.boolean()
        break
      }
      case "tel": {
        shape[field.name] = field.required
          ? z.string().trim().min(7, "Enter a valid phone number")
          : z.string().trim()
        break
      }
      case "phone": {
        // The picker emits E.164 (`+14155550142`), so validate that shape
        // rather than counting characters.
        const e164 = z
          .string()
          .trim()
          .regex(/^\+[1-9]\d{6,14}$/, "Enter a valid phone number")
        shape[field.name] = field.required ? e164 : e164.or(z.literal(""))
        break
      }
      default: {
        let text = z.string().trim()

        if (field.required) text = text.min(1, "Required")
        if (field.minLength !== undefined) {
          // `.trim()` runs first, so "  a  " is measured as one character —
          // matching a server that trims before checking.
          text = text.min(
            field.minLength,
            `Use at least ${field.minLength} characters`
          )
        }
        if (field.maxLength !== undefined) {
          text = text.max(
            field.maxLength,
            `Use at most ${field.maxLength} characters`
          )
        }

        shape[field.name] = text
      }
    }
  }

  return z.object(shape)
}

/** Blank values for each field, used when opening a create form. */
export function emptyValues(fields: FieldSpec[]): FormValues {
  const values: FormValues = {}
  for (const field of fields) {
    values[field.name] =
      field.kind === "switch" ? false : field.kind === "number" ? 0 : ""
  }
  return values
}
