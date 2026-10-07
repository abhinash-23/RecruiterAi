/**
 * An E.164 number: `+`, a country code that doesn't start with 0, then 7–15
 * digits in all — the shape `PhoneInput` emits (`+14155550142`).
 *
 * **One rule for the whole app**, like `isValidEmail`: the generated `FieldSpec`
 * forms and the screens that validate by hand both use this, so a number one
 * form accepts can't be refused by another.
 */
export const E164_PATTERN = /^\+[1-9]\d{6,14}$/

export function isValidPhone(value: string): boolean {
  return E164_PATTERN.test(value.trim())
}
