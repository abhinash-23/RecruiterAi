/**
 * The AI interviewer's voice settings — the catalogue, and the shapes every
 * layer that carries settings shares.
 *
 *   platform defaults → company defaults → job → this interview / batch
 *
 * Each layer stores only the keys it overrides, and **every form is built from
 * `GET /api/voice/options`**: the voices, the 102 languages, the choices and
 * their labels all come from there and none of them is written down here. Keys
 * are typed as plain strings for the same reason — a fifth setting the backend
 * adds tomorrow should render without a frontend release.
 *
 * Settings only mean anything for a **voice** interview; a typed one stores
 * none. And they are frozen when an interview is created, so a later job or
 * company edit never reaches an invitation already sent.
 */

import { currentAccessToken } from "@/services/auth-service"
import { ApiError, apiAssetUrl, apiFetch } from "@/services/http-client"

/** Resolved settings: every key filled, as an interview runs with them. */
export type VoiceSettings = Record<string, string>

/**
 * A change to send: only the keys being changed. `null` clears a key back to
 * whatever the layer below says (company and job only).
 */
export type VoiceSettingsPatch = Record<string, string | null>

export interface VoiceChoice {
  value: string
  label: string
}

export interface VoiceField {
  key: string
  label: string
  help: string
  default: string
  choices: VoiceChoice[]
}

export interface VoiceProfile {
  /** What is sent and stored — `Kore`. */
  id: string
  /** What the candidate hears it called — `Elena`. Fixed per voice. */
  persona: string
  gender: string
  style: string
  /** Absolute and ready for `<audio src>`, or null when there's no sample. */
  sampleUrl: string | null
}

export interface VoiceOptions {
  fields: VoiceField[]
  voices: VoiceProfile[]
  /** Platform defaults — not what a form starts from (that's the company's). */
  defaults: VoiceSettings
  /**
   * A complete URL with `{voice}`, `{pace}` and `{tone}` to fill in — a short
   * clip of that exact combination. Null on a backend without previews.
   */
  previewUrlTemplate: string | null
}

/**
 * Who the candidate is speaking with, from `verify-otp` and the results.
 * Null for a typed interview.
 */
export interface VoiceHost {
  name: string
  voice: string
  language: string
  languageLabel: string
}

/** The persona every interview had before voices were choosable. */
export const DEFAULT_HOST_NAME = "Elena"

/* -------------------------------------------------------------------------- */

interface OptionsEnvelope {
  status: string
  fields?: Array<{
    key: string
    label?: string
    help?: string | null
    default?: string
    choices?: Array<{ value: string; label?: string }>
  }>
  voices?: Array<{
    id: string
    persona?: string
    gender?: string
    style?: string
    sampleUrl?: string | null
    sample_url?: string | null
  }>
  defaults?: Record<string, string>
  previewUrlTemplate?: string | null
  preview_url_template?: string | null
}

/**
 * The catalogue, or **null when this backend doesn't have voice settings
 * yet** — a 404 here is the release gate. Every voice panel in the app hides
 * itself on null, so the frontend can ship ahead of the backend deploy without
 * offering a choice the server would refuse.
 */
export async function getVoiceOptions(): Promise<VoiceOptions | null> {
  let response: OptionsEnvelope
  try {
    response = await apiFetch<OptionsEnvelope>("/voice/options", {
      token: currentAccessToken(),
    })
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null
    throw error
  }

  return {
    fields: (response.fields ?? []).map((field) => ({
      key: field.key,
      label: field.label ?? field.key,
      help: field.help ?? "",
      default: field.default ?? "",
      choices: (field.choices ?? []).map((choice) => ({
        value: choice.value,
        label: choice.label ?? choice.value,
      })),
    })),
    voices: (response.voices ?? []).map((voice) => {
      const sample = voice.sampleUrl ?? voice.sample_url ?? null
      return {
        id: voice.id,
        persona: voice.persona ?? voice.id,
        gender: voice.gender ?? "",
        style: voice.style ?? "",
        sampleUrl: sample ? apiAssetUrl(sample) : null,
      }
    }),
    defaults: response.defaults ?? {},
    previewUrlTemplate:
      response.previewUrlTemplate ?? response.preview_url_template ?? null,
  }
}

/**
 * The clip for one voice + pace + tone, or null when this backend has no
 * previews or the combination is incomplete. Previews are always in American
 * English: the accent setting changes only what's spoken in the interview.
 */
export function voicePreviewUrl(
  options: VoiceOptions | null | undefined,
  settings: VoiceSettings
): string | null {
  const template = options?.previewUrlTemplate
  const { voice, pace, tone } = settings
  if (!template || !voice || !pace || !tone) return null
  return apiAssetUrl(
    template
      .replace("{voice}", encodeURIComponent(voice))
      .replace("{pace}", encodeURIComponent(pace))
      .replace("{tone}", encodeURIComponent(tone))
  )
}

/* --------------------------------------------------------------- reading -- */

/**
 * Settings as the server sent them, with anything that isn't a string-valued
 * key dropped. Null for "no settings" in every spelling — absent, null, `{}`.
 */
export function toVoiceSettings(value: unknown): VoiceSettings | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const entries = Object.entries(value as Record<string, unknown>).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string"
  )
  return entries.length > 0 ? Object.fromEntries(entries) : null
}

export function toVoiceHost(value: unknown): VoiceHost | null {
  if (!value || typeof value !== "object") return null
  const raw = value as Record<string, unknown>
  const text = (key: string) =>
    typeof raw[key] === "string" ? (raw[key] as string) : ""
  const name = text("name")
  if (!name) return null
  return {
    name,
    voice: text("voice"),
    language: text("language"),
    languageLabel: text("languageLabel") || text("language_label"),
  }
}

/* --------------------------------------------------------------- writing -- */

/**
 * What changed between where a form started and where it is now — the only
 * keys a request should carry, because anything sent is pinned at this layer
 * and stops inheriting from the one below.
 */
export function changedVoiceSettings(
  start: VoiceSettings,
  now: VoiceSettings
): VoiceSettingsPatch | undefined {
  const patch: VoiceSettingsPatch = {}
  for (const [key, value] of Object.entries(now)) {
    if (start[key] !== value) patch[key] = value
  }
  return Object.keys(patch).length > 0 ? patch : undefined
}

/* ------------------------------------------------------------- describing -- */

/** A choice's label for a stored value, falling back to the value itself. */
export function voiceChoiceLabel(
  options: VoiceOptions | null | undefined,
  key: string,
  value: string | undefined
): string {
  if (!value) return ""
  if (key === "voice") {
    return options?.voices.find((voice) => voice.id === value)?.persona ?? value
  }
  const field = options?.fields.find((entry) => entry.key === key)
  return field?.choices.find((choice) => choice.value === value)?.label ?? value
}

/**
 * "Leo · Hindi · Brisk · Warm" — one line for a summary or a table cell. Pace
 * and tone use only the part of their label before the dash: "Brisk — efficient,
 * never rushed" is a description, not a name.
 */
export function describeVoiceSettings(
  options: VoiceOptions | null | undefined,
  settings: VoiceSettings
): string {
  const order =
    options?.fields.map((field) => field.key) ?? Object.keys(settings)
  return order
    .filter((key) => settings[key])
    .map((key) =>
      voiceChoiceLabel(options, key, settings[key]).split(" — ")[0].trim()
    )
    .join(" · ")
}
