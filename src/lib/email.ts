import { z } from "zod"

/**
 * Is this a plausible email address?
 *
 * **One rule for the whole app.** It delegates to the same Zod `.email()` check
 * that `schemaFromFields` generates for every `FieldSpec` form, so a screen that
 * validates by hand and a screen whose form was generated can never disagree —
 * which they did: the candidate-intake dialog used `/^\S+@\S+\.\S+$/`, and `\S`
 * matches `@`, so `a@@b.com` passed there and was refused everywhere else.
 *
 * That mattered on intake in particular. `POST /hr/jobs/{id}/candidates` treats a
 * malformed address as a **schema** failure: it answers 422 and creates nothing,
 * which is the exact outcome the dialog's own check exists to prevent. A check
 * loose enough to pass what the server rejects is worse than no check, because it
 * turns a field-level message into an API error.
 *
 * Never a substitute for the server's own validation — only a way to say so
 * early, and to say the same thing everywhere.
 */
const EMAIL_SCHEMA = z.string().trim().email()

export function isValidEmail(value: string): boolean {
  return EMAIL_SCHEMA.safeParse(value).success
}
