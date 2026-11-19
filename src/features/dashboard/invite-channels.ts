/**
 * Whether invitations can go by WhatsApp.
 *
 * Off for now: email is the only channel the server sends. While it is off,
 * the invite dialog shows WhatsApp as "Coming soon" and the Interviews list's
 * WhatsApp button is disabled. The hand-off code (a `wa.me` link with the
 * message written) is kept, so turning this on brings both back unchanged.
 */
export const WHATSAPP_INVITES_ENABLED = false

/** The tooltip and hint wherever WhatsApp is shown switched off. */
export const WHATSAPP_COMING_SOON =
  "WhatsApp invites are coming soon. Email is the only channel for now."
