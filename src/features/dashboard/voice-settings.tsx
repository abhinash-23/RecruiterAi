import * as React from "react"
import { Combobox } from "@base-ui/react/combobox"
import {
  AudioLines,
  CheckIcon,
  ChevronDownIcon,
  Loader2,
  Pause,
  Play,
  Search,
} from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { cn } from "@/lib/utils"
import { fetchApiAsset } from "@/services/http-client"
import {
  describeVoiceSettings,
  voiceChoiceLabel,
  voicePreviewUrl,
  type VoiceChoice,
  type VoiceField,
  type VoiceOptions,
  type VoiceProfile,
  type VoiceSettings,
} from "@/services/voice"

import type { useVoiceSelection } from "./voice-selection"

/* ========================================================================== */
/*  Samples                                                                   */
/* ========================================================================== */

/**
 * One audio element for the whole panel — every card's sample and the
 * preview — so starting one stops the last: two voices talking over each
 * other is no way to compare them.
 */
function useSamplePlayer() {
  const audio = React.useRef<HTMLAudioElement | null>(null)
  /** Object URLs already fetched, by clip — a second play needs no download. */
  const cache = React.useRef(new Map<string, string>())
  const pending = React.useRef<AbortController | null>(null)
  const [playing, setPlaying] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState<string | null>(null)

  React.useEffect(() => {
    const urls = cache.current
    return () => {
      pending.current?.abort()
      audio.current?.pause()
      audio.current = null
      for (const url of urls.values()) URL.revokeObjectURL(url)
      urls.clear()
    }
  }, [])

  const stop = () => {
    pending.current?.abort()
    pending.current = null
    audio.current?.pause()
    audio.current = null
    setPlaying(null)
    setLoading(null)
  }

  const play = async (clip: Clip, src: string) => {
    const next = new Audio(src)
    audio.current = next
    const finish = () =>
      setPlaying((current) => (current === clip.key ? null : current))
    next.onended = finish
    next.onerror = finish
    setPlaying(clip.key)
    try {
      await next.play()
    } catch (error) {
      finish()
      // Safari only plays inside the click itself, and the first press spent
      // its click on the download. The clip is cached now, so the second
      // press plays straight away.
      if (error instanceof DOMException && error.name === "NotAllowedError") {
        toast.info(`${clip.label} is ready. Press play again.`)
      } else {
        toast.error(`Couldn't play ${clip.label.toLowerCase()}.`)
      }
    }
  }

  /**
   * Plays a sample, or stops the one playing.
   *
   * **Fetched, not given to `<audio src>`.** The API is behind an ngrok tunnel
   * on some deployments, and ngrok answers a request without its opt-out
   * header with an HTML warning page. An `<audio>` element can't send that
   * header, so it was handed HTML, failed to decode it, and the button simply
   * did nothing. `fetchApiAsset` sends the header; the bytes are then played
   * from a local blob URL, which nothing can intercept. On a direct backend
   * the header is ignored and this works the same.
   */
  const toggle = async (clip: Clip) => {
    if (playing === clip.key || loading === clip.key) {
      stop()
      return
    }
    stop()

    const cached = cache.current.get(clip.key)
    if (cached) {
      await play(clip, cached)
      return
    }

    const controller = new AbortController()
    pending.current = controller
    setLoading(clip.key)
    try {
      const blob = await fetchApiAsset(clip.url, controller.signal)
      // A 200 that isn't audio is a proxy's page, not a sample.
      if (!blob.type.startsWith("audio/")) {
        throw new Error(`not audio: ${blob.type || "unknown type"}`)
      }
      const url = URL.createObjectURL(blob)
      cache.current.set(clip.key, url)
      if (controller.signal.aborted) return
      pending.current = null
      setLoading(null)
      await play(clip, url)
    } catch {
      if (controller.signal.aborted) return
      pending.current = null
      setLoading(null)
      toast.error(`Couldn't load ${clip.label.toLowerCase()}. Try again.`)
    }
  }

  return { playing, loading, toggle }
}

type SamplePlayer = ReturnType<typeof useSamplePlayer>

/** Something to play: a voice's sample, or a voice + pace + tone preview. */
interface Clip {
  /** Unique per clip — what "is this one playing" is asked of. */
  key: string
  url: string
  /** "Leo's sample", "This preview" — for the rare toast. */
  label: string
}

/* ========================================================================== */
/*  Pieces                                                                    */
/* ========================================================================== */

/** "Brisk — efficient, never rushed" → name "Brisk", note "efficient, never rushed". */
function splitLabel(label: string) {
  const [name, ...rest] = label.split(" — ")
  return { name: name.trim(), note: rest.join(" — ").trim() }
}

function FieldHeading({
  field,
  htmlFor,
  inherited,
  onReset,
}: {
  field: VoiceField
  htmlFor?: string
  /** Shown when this key comes from the layer below rather than this one. */
  inherited?: string
  onReset?: () => void
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex flex-wrap items-center gap-2">
        <Label htmlFor={htmlFor}>{field.label}</Label>
        {inherited ? (
          <span className="text-xs text-muted-foreground">{inherited}</span>
        ) : onReset ? (
          <button
            type="button"
            onClick={onReset}
            className="text-xs font-medium text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            Reset
          </button>
        ) : null}
      </div>
      {field.help ? (
        <p className="text-xs text-muted-foreground">{field.help}</p>
      ) : null}
    </div>
  )
}

/** The voices as cards: who it is, how it sounds, and a sample to hear. */
function VoicePicker({
  voices,
  value,
  onChange,
  player,
  disabled,
}: {
  voices: VoiceProfile[]
  value: string | undefined
  onChange: (next: string) => void
  player: SamplePlayer
  disabled?: boolean
}) {
  const genders = [
    ...new Set(voices.map((voice) => voice.gender).filter(Boolean)),
  ]
  const [gender, setGender] = React.useState<string>("all")
  const shown =
    gender === "all"
      ? voices
      : voices.filter((voice) => voice.gender === gender)

  return (
    <div className="flex flex-col gap-2">
      {genders.length > 1 ? (
        <div
          className="flex flex-wrap gap-1.5"
          role="group"
          aria-label="Filter voices"
        >
          {["all", ...genders].map((option) => (
            <Button
              key={option}
              type="button"
              size="xs"
              variant={gender === option ? "default" : "outline"}
              aria-pressed={gender === option}
              onClick={() => setGender(option)}
              className="capitalize"
            >
              {option === "all" ? `All ${voices.length}` : option}
            </Button>
          ))}
        </div>
      ) : null}

      {/* A radio group in behaviour — one voice, arrow keys between them — but
          drawn as cards, because a name alone says nothing about a voice. */}
      <div
        role="radiogroup"
        aria-label="Interviewer voice"
        className="grid max-h-72 gap-2 overflow-y-auto overscroll-contain p-0.5 @md:grid-cols-2 @3xl:grid-cols-3"
      >
        {shown.map((voice) => {
          const selected = voice.id === value
          const sampleKey = `sample:${voice.id}`
          const playing = player.playing === sampleKey
          const loading = player.loading === sampleKey
          return (
            <div
              key={voice.id}
              className={cn(
                "flex items-center gap-2 rounded-xl border p-2.5 transition-colors",
                selected
                  ? "border-primary bg-primary/5 ring-1 ring-primary"
                  : "hover:bg-muted/50",
                disabled && "opacity-50"
              )}
            >
              <button
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={disabled}
                onClick={() => onChange(voice.id)}
                className="flex min-w-0 flex-1 items-center gap-2.5 text-left outline-none focus-visible:underline"
              >
                <span
                  className={cn(
                    "grid size-4 shrink-0 place-items-center rounded-full border",
                    selected ? "border-primary bg-primary" : "border-input"
                  )}
                >
                  {selected ? (
                    <span className="size-1.5 rounded-full bg-primary-foreground" />
                  ) : null}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">
                    {voice.persona}
                  </span>
                  <span className="mt-1 flex flex-wrap gap-1">
                    {voice.gender ? (
                      <Badge variant="secondary" className="capitalize">
                        {voice.gender}
                      </Badge>
                    ) : null}
                    {voice.style ? (
                      <Badge variant="outline">{voice.style}</Badge>
                    ) : null}
                  </span>
                </span>
              </button>
              {voice.sampleUrl ? (
                <Button
                  type="button"
                  size="icon-sm"
                  variant={playing ? "default" : "ghost"}
                  aria-label={
                    loading
                      ? `Loading ${voice.persona}'s sample`
                      : playing
                        ? `Stop ${voice.persona}'s sample`
                        : `Play ${voice.persona}'s sample`
                  }
                  onClick={() =>
                    voice.sampleUrl
                      ? void player.toggle({
                          key: sampleKey,
                          url: voice.sampleUrl,
                          label: `${voice.persona}'s sample`,
                        })
                      : undefined
                  }
                >
                  {loading ? (
                    <Loader2 className="animate-spin" />
                  ) : playing ? (
                    <Pause />
                  ) : (
                    <Play />
                  )}
                </Button>
              ) : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/**
 * The language list, searchable: 102 entries is too many to scroll, and the
 * reader usually knows the name they want. Styled to sit beside the app's
 * own Select.
 */
function LanguagePicker({
  id,
  choices,
  value,
  onChange,
  disabled,
}: {
  id: string
  choices: VoiceChoice[]
  value: string | undefined
  onChange: (next: string) => void
  disabled?: boolean
}) {
  const selected = choices.find((choice) => choice.value === value) ?? null

  return (
    <Combobox.Root
      items={choices}
      value={selected}
      onValueChange={(next) => {
        const choice = next as VoiceChoice | null
        if (choice) onChange(choice.value)
      }}
      itemToStringLabel={(item: VoiceChoice) => item.label}
      isItemEqualToValue={(a: VoiceChoice, b: VoiceChoice) =>
        a.value === b.value
      }
      disabled={disabled}
    >
      <Combobox.Trigger
        id={id}
        className="flex h-8 w-full items-center justify-between gap-1.5 rounded-lg border border-input bg-transparent py-2 pr-2 pl-2.5 text-sm whitespace-nowrap transition-colors outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 sm:max-w-xs dark:bg-input/30 dark:hover:bg-input/50"
      >
        <Combobox.Value placeholder="Choose an accent" />
        <ChevronDownIcon className="pointer-events-none size-4 text-muted-foreground" />
      </Combobox.Trigger>
      <Combobox.Portal>
        <Combobox.Positioner
          align="start"
          sideOffset={4}
          className="isolate z-50"
        >
          <Combobox.Popup
            aria-label="Accent"
            className="flex max-h-[min(22rem,var(--available-height))] w-(--anchor-width) min-w-64 origin-(--transform-origin) flex-col overflow-hidden rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95"
          >
            <div className="relative border-b p-1.5">
              <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Combobox.Input
                placeholder="Search accents…"
                className="h-8 w-full rounded-md bg-transparent pr-2 pl-8 text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>
            <Combobox.Empty>
              <p className="px-3 py-4 text-sm text-muted-foreground">
                No accent matches.
              </p>
            </Combobox.Empty>
            <Combobox.List className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1 data-empty:p-0">
              {(choice: VoiceChoice) => (
                <Combobox.Item
                  key={choice.value}
                  value={choice}
                  className="relative flex w-full cursor-default items-center gap-1.5 rounded-md py-1.5 pr-8 pl-2 text-sm outline-hidden select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground"
                >
                  {choice.label}
                  <Combobox.ItemIndicator className="pointer-events-none absolute right-2 flex size-4 items-center justify-center">
                    <CheckIcon className="size-4" />
                  </Combobox.ItemIndicator>
                </Combobox.Item>
              )}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  )
}

/** Pace and tone: a handful of choices, each with what it means. */
function ChoiceRadios({
  field,
  value,
  onChange,
  disabled,
}: {
  field: VoiceField
  value: string | undefined
  onChange: (next: string) => void
  disabled?: boolean
}) {
  return (
    <RadioGroup
      value={value ?? ""}
      onValueChange={(next) => onChange(String(next))}
      disabled={disabled}
      aria-label={field.label}
      className="grid gap-2 @lg:grid-cols-3"
    >
      {field.choices.map((choice) => {
        const { name, note } = splitLabel(choice.label)
        const id = `voice-${field.key}-${choice.value}`
        return (
          <label
            key={choice.value}
            htmlFor={id}
            className={cn(
              "flex cursor-pointer items-start gap-2.5 rounded-xl border p-2.5 transition-colors hover:bg-muted/50 has-data-checked:border-primary has-data-checked:bg-primary/5 has-data-checked:ring-1 has-data-checked:ring-primary",
              disabled && "cursor-not-allowed opacity-50"
            )}
          >
            <RadioGroupItem id={id} value={choice.value} className="mt-0.5" />
            <span className="min-w-0">
              <span className="block text-sm font-medium">{name}</span>
              {note ? (
                <span className="block text-xs text-muted-foreground">
                  {note}
                </span>
              ) : null}
            </span>
          </label>
        )
      })}
    </RadioGroup>
  )
}

/* ========================================================================== */
/*  The editor                                                                */
/* ========================================================================== */

/**
 * Every voice setting the backend offers, rendered from the catalogue — the
 * voice as cards, the language as a search, the rest as radios. Nothing here
 * knows what the settings are; a field the backend adds tomorrow renders as
 * radios without a release.
 *
 * @param base     What each key inherits when this layer doesn't set it. With
 *                 `inheritedFrom`, keys still on it are labelled as inherited;
 *                 without, changed keys get a Reset.
 */
export function VoiceSettingsEditor({
  idPrefix,
  options,
  value,
  onChange,
  onReset,
  base,
  inheritedFrom,
  disabled,
}: {
  idPrefix: string
  options: VoiceOptions
  value: VoiceSettings
  onChange: (key: string, next: string) => void
  onReset?: (key: string) => void
  base?: VoiceSettings | null
  /** "from company defaults" — shown beside a key that isn't overridden here. */
  inheritedFrom?: string
  disabled?: boolean
}) {
  /* A key nobody has set yet reads as the platform default, which is what the
     server falls back to — so a backend that omits one (the documented example
     leaves out `tone`) still shows a selection rather than an empty group. */
  const shown: VoiceSettings = { ...options.defaults, ...value }
  const player = useSamplePlayer()
  const previewUrl = voicePreviewUrl(options, shown)

  const heading = (field: VoiceField, htmlFor?: string) => {
    const overridden = base ? shown[field.key] !== base[field.key] : false
    return (
      <FieldHeading
        field={field}
        htmlFor={htmlFor}
        inherited={
          !overridden && inheritedFrom && base ? inheritedFrom : undefined
        }
        onReset={overridden && onReset ? () => onReset(field.key) : undefined}
      />
    )
  }

  return (
    // A container, so the columns follow the space the editor is given — a
    // narrow dialog and a full-width card want different layouts at the same
    // screen width.
    <div className="@container flex flex-col gap-5">
      {/* The accent first, above the voice cards: it is picked once, and the
          cards are what the reader then browses. */}
      {[
        ...options.fields.filter((field) => field.key === "language"),
        ...options.fields.filter((field) => field.key !== "language"),
      ].map((catalogueField) => {
        /* Named "Accent" here rather than the catalogue's "Language &
           accent": what this deployment offers are English accents, and the
           questions on screen are English whichever is picked. */
        const field: VoiceField =
          catalogueField.key === "language"
            ? {
                ...catalogueField,
                label: "Accent",
                help: "The accent the interviewer speaks with. Questions on screen stay in English.",
              }
            : catalogueField
        const id = `${idPrefix}-voice-${field.key}`
        if (field.key === "voice") {
          return (
            <div key={field.key} className="flex flex-col gap-2">
              {heading(field)}
              <VoicePicker
                voices={options.voices}
                value={shown.voice}
                onChange={(next) => onChange("voice", next)}
                player={player}
                disabled={disabled}
              />
            </div>
          )
        }
        if (field.key === "language") {
          return (
            <div key={field.key} className="flex flex-col gap-2">
              {heading(field, id)}
              <LanguagePicker
                id={id}
                choices={field.choices}
                value={shown.language}
                onChange={(next) => onChange("language", next)}
                disabled={disabled}
              />
            </div>
          )
        }
        return (
          <div key={field.key} className="flex flex-col gap-2">
            {heading(field)}
            <ChoiceRadios
              field={field}
              value={shown[field.key]}
              onChange={(next) => onChange(field.key, next)}
              disabled={disabled}
            />
          </div>
        )
      })}

      {previewUrl ? (
        <PreviewRow
          url={previewUrl}
          summary={[
            voiceChoiceLabel(options, "voice", shown.voice),
            voiceChoiceLabel(options, "pace", shown.pace).split(" — ")[0],
            voiceChoiceLabel(options, "tone", shown.tone).split(" — ")[0],
          ].join(" · ")}
          player={player}
        />
      ) : null}
    </div>
  )
}

/**
 * Hear the choice as a whole: the selected voice at the selected pace and
 * tone, from the backend's pre-recorded clips. Follows every change — the
 * button always plays what is selected right now.
 */
function PreviewRow({
  url,
  summary,
  player,
}: {
  url: string
  summary: string
  player: SamplePlayer
}) {
  const key = `preview:${url}`
  const playing = player.playing === key
  const loading = player.loading === key

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-muted/30 p-3">
      <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent-brand-muted text-accent-brand">
        <AudioLines className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">Preview: {summary}</p>
        <p className="text-xs text-muted-foreground">
          How the interviewer sounds at this pace and tone. Previews are in
          American English; the accent applies in the interview itself.
        </p>
      </div>
      <Button
        type="button"
        size="sm"
        variant={playing ? "default" : "outline"}
        onClick={() => void player.toggle({ key, url, label: "This preview" })}
      >
        {loading ? (
          <Loader2 className="animate-spin" />
        ) : playing ? (
          <Pause />
        ) : (
          <Play />
        )}
        {loading ? "Loading…" : playing ? "Stop" : "Preview"}
      </Button>
    </div>
  )
}

/* ========================================================================== */
/*  Compact field, for forms where the voice is one setting among many        */
/* ========================================================================== */

/**
 * "Elena · English (India) · Normal · Neutral", with Change to open the full
 * editor in place. For the New interview, Schedule and job forms, where the
 * defaults are usually right and the editor would otherwise be the longest
 * thing on the form.
 *
 * Renders nothing until the catalogue has loaded — and nothing at all on a
 * backend without voice settings, which is how this ships ahead of the deploy.
 */
export function VoiceSettingsField({
  idPrefix,
  options,
  selection,
  base,
  scope,
  baseName,
  note,
  disabled,
}: {
  idPrefix: string
  options: VoiceOptions | null | undefined
  selection: ReturnType<typeof useVoiceSelection>
  base: VoiceSettings | null | undefined
  /** What a change applies to — "this interview", "these candidates". */
  scope: string
  /** Where the starting values come from — "Your company's defaults". */
  baseName: string
  /** Replaces the line under the box, for a form with its own story to tell. */
  note?: React.ReactNode
  disabled?: boolean
}) {
  const [open, setOpen] = React.useState(false)
  if (!options || options.fields.length === 0) return null

  const summary = describeVoiceSettings(options, {
    ...options.defaults,
    ...selection.value,
  })
  const changed = selection.changed !== undefined

  return (
    <div className="flex flex-col gap-2">
      <Label>AI interviewer</Label>
      <div className="flex flex-col gap-3 rounded-xl border p-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted">
            <AudioLines className="size-4 text-muted-foreground" />
          </div>
          <p className="min-w-0 flex-1 text-sm font-medium">
            {summary || "Platform defaults"}
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setOpen((current) => !current)}
            aria-expanded={open}
            disabled={disabled}
          >
            {open ? "Done" : "Change"}
          </Button>
        </div>
        {open ? (
          <VoiceSettingsEditor
            idPrefix={idPrefix}
            options={options}
            value={selection.value}
            onChange={selection.set}
            onReset={selection.reset}
            base={base}
            disabled={disabled}
          />
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">
        {note !== undefined ? (
          note
        ) : changed ? (
          <>
            Changed for {scope} only.{" "}
            <button
              type="button"
              onClick={() => selection.reset()}
              className="font-medium text-foreground underline underline-offset-2"
            >
              Reset
            </button>
          </>
        ) : (
          <>
            {baseName}. Change them here for {scope} only.
          </>
        )}{" "}
        The candidate hears this voice; questions on screen stay in English.
      </p>
    </div>
  )
}
