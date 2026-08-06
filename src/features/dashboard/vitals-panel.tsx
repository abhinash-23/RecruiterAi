import {
  Activity,
  Brain,
  Droplets,
  FlaskConical,
  Gauge,
  Heart,
  HeartPulse,
  Info,
  Wind,
  type LucideIcon,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { toVitalsReport } from "@/services/interview"
import { cn } from "@/lib/utils"

/**
 * ============================================================================
 * THE SHAPE OF A READING
 * ============================================================================
 * These are **stat tiles**, not charts: each is one current value, and a
 * six-series bar chart of quantities measured in bpm, %, /min and mg/dL would
 * be six incomparable bars on one axis.
 *
 * What a bare number *can't* say is whether 73 bpm is unremarkable. So where a
 * reading has a reference range that is genuinely standard, the tile carries a
 * track: the typical band behind, the reading's position drawn over it. Where
 * one doesn't, the tile says nothing rather than inventing a range — see
 * `SCALE` below, which is deliberately short.
 */
interface Reading {
  /** The wire key, so `estimated_only` can be matched against it. */
  key: string
  label: string
  /** The number alone. Set large; the unit rides beside it, small. */
  value: string
  unit?: string
  Icon: LucideIcon
  /** True for the one tile whose icon is allowed to beat. */
  live?: boolean
  /** For the track. Absent when this reading has no standard range. */
  scale?: Scale
  /** Where on that scale the reading landed. */
  at?: number
}

/**
 * A reading's scale, and the band on it that is unremarkable.
 *
 * Only for readings whose reference range is textbook and unambiguous. Notably
 * absent:
 *
 *  - **Glucose**, whose reference depends entirely on time since the last meal —
 *    and a sitting is not a fasting test.
 *  - **Blood pressure**, which is two numbers; one track can't hold both, and
 *    the pair is quoted as a pair.
 *
 * `stress_index` has a `min`/`max` but no `band`: it is a vendor index on its own
 * 0–100 scale, so the track can honestly show *where* without claiming what is
 * normal.
 */
interface Scale {
  min: number
  max: number
  band?: { low: number; high: number }
}

const SCALE: Record<string, Scale> = {
  heart_rate: { min: 40, max: 140, band: { low: 60, high: 100 } },
  spo2: { min: 85, max: 100, band: { low: 95, high: 100 } },
  respiratory_rate: { min: 6, max: 30, band: { low: 12, high: 20 } },
  stress_index: { min: 0, max: 100 },
}

/**
 * ============================================================================
 * THE CARD GRAPHIC
 * ============================================================================
 * The organ or vessel a reading comes from, drawn large and faint at the card's
 * right edge — filling the space a tile with no range track would otherwise
 * leave empty.
 *
 * **Only the heart moves.** It earned it: a cardiac trace running into a heart
 * is a graphic everyone reads instantly, and the pulse is the one reading whose
 * whole nature is a rhythm. Six waveforms looping at six tempos turned the panel
 * into a screen of movement competing with the numbers on it — which is the
 * opposite of what a results page is for.
 *
 * **Shape carries the identity — not hue.** Six coloured cards would spend six
 * categorical hues on something the icon and the label already say, and on a
 * panel of health readings a red card reads as an *alarm* — a verdict this panel
 * does not have and must not imply. So every glyph wears the one brand gradient.
 *
 * All of it is decorative: low opacity, behind the numbers, `aria-hidden`, and
 * `motion-safe:` throughout. It repeats what the value already says.
 */
interface CardGraphic {
  /**
   * Defaults to the card's own icon, which already names the organ for most
   * readings. `heart_rate` overrides it: its icon has a waveform baked in, and
   * two waveforms in one graphic is just noise.
   */
  Glyph?: LucideIcon
  /**
   * The cardiac trace, drawn in a `0 0 120 40` box. Heart rate only — see above.
   */
  wave?: { path: string; seconds: number }
}

const GRAPHIC: Record<string, CardGraphic> = {
  heart_rate: {
    Glyph: Heart,
    // Baseline and QRS spikes: the shape everyone reads as a heartbeat.
    wave: {
      path: "M0 20 H16 l4 -13 l5 26 l5 -13 H50 l4 -13 l5 26 l5 -13 H86 l4 -13 l5 26 l5 -13 H120",
      seconds: 2.4,
    },
  },
  blood_pressure: {},
  spo2: {},
  respiratory_rate: {},
  stress_index: {},
  glucose: {},
}

/** The cardiac line, drawn twice: once written, once being written. */
function Wave({ path, seconds }: { path: string; seconds: number }) {
  const stroke = (
    <path
      d={path}
      fill="none"
      stroke="url(#vitals-trace)"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      // Held at 2px however the viewBox is stretched — without it the
      // non-uniform scale would thin the verticals and fatten the horizontals.
      vectorEffect="non-scaling-stroke"
    />
  )

  return (
    // Faded out towards the left so it never crowds the value, and clipped so
    // the sweep has an edge to arrive from.
    <div className="absolute inset-y-0 right-8 left-0 overflow-hidden opacity-45 mask-[linear-gradient(to_right,transparent,black_45%)]">
      <svg
        viewBox="0 0 120 40"
        preserveAspectRatio="none"
        className="h-full w-full"
      >
        {/* What the stylus has already written, held faint — a bare travelling
            dash on an empty card reads as a glitch, not a monitor. */}
        <g className="opacity-25">{stroke}</g>
        <g
          className="motion-safe:animate-trace-sweep"
          style={{
            // 48 lit, 400 dark: one period is the 448 the keyframe travels, so
            // exactly one segment crosses per cycle.
            strokeDasharray: "48 400",
            animationDuration: `${seconds}s`,
          }}
        >
          {stroke}
        </g>
      </svg>
    </div>
  )
}

/**
 * One card's graphic. `delay` fades it in just after the card has arrived.
 */
function Graphic({
  graphic,
  fallbackGlyph,
  delay,
}: {
  graphic: CardGraphic
  /** Used when the metric's own icon already names the organ. */
  fallbackGlyph: LucideIcon
  delay: number
}) {
  const Glyph = graphic.Glyph ?? fallbackGlyph
  const wave = graphic.wave

  return (
    <div
      aria-hidden="true"
      // Half the card, capped — never a fixed width. These cards are two-up at
      // `sm` and three-up at `lg`, so they are narrowest at the *breakpoints*,
      // not on the smallest screen; a fixed 176px reached the value text at
      // several sizes and not at others.
      className="pointer-events-none absolute inset-y-0 right-0 flex w-1/2 max-w-44 items-center justify-end overflow-hidden pr-3 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-700"
      style={{ animationDelay: `${delay}ms`, animationFillMode: "backwards" }}
    >
      {/* Behind the trace and larger than it, so the line reads as arriving at
          the organ rather than sitting beside a second picture. */}
      <Glyph
        className={cn(
          "size-14 shrink-0 opacity-20",
          wave && "motion-safe:animate-heartbeat"
        )}
        stroke="url(#vitals-organ)"
        strokeWidth={1}
        style={wave ? { animationDuration: `${wave.seconds}s` } : undefined}
      />

      {wave ? <Wave path={wave.path} seconds={wave.seconds} /> : null}
    </div>
  )
}

function round(value: number, places = 0) {
  const factor = 10 ** places
  return Math.round(value * factor) / factor
}

/** One blood marker, flattened out of the object the API nests it in. */
interface Marker {
  key: string
  label: string
  value: string
  /** `normal`, `high`, … — absent when the deployment doesn't classify it. */
  status: string | null
}

/**
 * Colour for a marker's classification.
 *
 * Only an explicit "normal" reads as reassuring; everything else is flagged,
 * because an unrecognised classification is far more likely to be a variant of
 * *abnormal* ("borderline high", "elevated") than a new way of saying fine.
 *
 * These are status tokens, and they always ship with the classification spelt
 * out beside them — colour never carries the meaning on its own.
 */
function markerTone(status: string): string {
  const normalised = status.trim().toLowerCase()
  if (normalised === "normal" || normalised === "optimal") {
    return "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
  }
  if (normalised.includes("critical") || normalised.includes("very high")) {
    return "border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-400"
  }
  return "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-400"
}

/**
 * Flattens one entry of `blood_markers`.
 *
 * Each arrives as `{value, label, unit, status}` rather than a bare number, so
 * the panel used to stringify the whole object into the cell — a wall of JSON
 * where a reading belonged. The payload's own `label` is preferred over the key
 * because it is already written for people ("Total Cholesterol", not
 * "chol_total").
 */
function toMarker(key: string, raw: unknown): Marker {
  const fallbackLabel = key.replace(/_/g, " ")

  if (raw === null || typeof raw !== "object") {
    return {
      key,
      label: fallbackLabel,
      value: typeof raw === "number" ? String(round(raw, 2)) : String(raw ?? "—"),
      status: null,
    }
  }

  const entry = raw as Record<string, unknown>
  const unit = typeof entry.unit === "string" ? entry.unit.trim() : ""
  const value = entry.value

  const rendered =
    typeof value === "number"
      ? `${round(value, 2)}${unit ? ` ${unit}` : ""}`
      : typeof value === "string" || typeof value === "boolean"
        ? String(value)
        : // Neither a number nor a scalar: show the key's absence honestly
          // rather than printing "[object Object]" or an empty cell.
          "—"

  return {
    key,
    label:
      typeof entry.label === "string" && entry.label.trim()
        ? entry.label
        : fallbackLabel,
    value: rendered,
    status: typeof entry.status === "string" && entry.status.trim() ? entry.status : null,
  }
}

/**
 * Where the reading sits on its scale.
 *
 * One hue, not a traffic light. The reader can see the mark relative to the
 * band and draw their own conclusion; painting it amber would be this panel
 * asserting a clinical verdict the API never sent — on a number the API itself
 * often flags as *estimated from a webcam*.
 */
function RangeTrack({ scale, at, unit }: { scale: Scale; at: number; unit?: string }) {
  const span = scale.max - scale.min
  const place = (value: number) =>
    Math.max(0, Math.min(100, ((value - scale.min) / span) * 100))

  const position = place(at)
  const band = scale.band

  return (
    <div className="relative mt-auto flex flex-col gap-1 pt-1">
      <div className="relative h-1.5 w-full rounded-full bg-muted">
        {band ? (
          <span
            aria-hidden="true"
            className="absolute inset-y-0 rounded-full bg-foreground/12"
            style={{
              left: `${place(band.low)}%`,
              width: `${place(band.high) - place(band.low)}%`,
            }}
          />
        ) : null}

        {/* Translucent so the band reads *through* the fill — the two together
            are the whole point, and an opaque fill would hide the half of the
            band it covers. `origin-left` + scaleX is what makes it draw in. */}
        <span
          aria-hidden="true"
          className="absolute inset-y-0 left-0 origin-left rounded-full bg-primary/45 motion-safe:animate-grow-track"
          style={{ width: `${position}%` }}
        />
        {/* The reading itself: solid, ringed in the card colour so it stays
            legible wherever on the track it lands. */}
        <span
          aria-hidden="true"
          className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary ring-2 ring-card motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-50 motion-safe:duration-500"
          style={{ left: `${position}%` }}
        />
      </div>

      <span className="text-[10px] leading-none text-muted-foreground">
        {band
          ? `Typical ${band.low}–${band.high}${unit ? ` ${unit}` : ""}`
          : `Scale ${scale.min}–${scale.max}`}
      </span>
    </div>
  )
}

/**
 * One vitals reading. The "estimated" chip is not decoration: the API flags
 * which of these are derived from the signal rather than optically measured,
 * and an unlabelled SpO₂ reads as a medical measurement when it isn't one.
 */
function ReadingTile({
  reading,
  estimated,
  index,
}: {
  reading: Reading
  estimated: boolean
  /** Its place in the row, which is all the stagger needs. */
  index: number
}) {
  const { Icon } = reading

  return (
    <div
      className="relative flex flex-col gap-2.5 overflow-hidden rounded-xl border p-3 transition-colors hover:bg-muted/40 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2"
      // `backwards` matters: without it a tile is painted in its final position
      // for one frame before its delay elapses, so the whole row flashes.
      style={{ animationDelay: `${index * 60}ms`, animationFillMode: "backwards" }}
    >
      {/* First, so everything below paints over it. */}
      {GRAPHIC[reading.key] ? (
        <Graphic
          graphic={GRAPHIC[reading.key]}
          fallbackGlyph={Icon}
          delay={index * 60 + 120}
        />
      ) : null}

      <div className="relative flex items-center gap-2">
        {/* The chip is tinted with the same two brand stops the traces are
            stroked from, so the whole panel reads as one colour rather than six
            metrics each claiming their own. */}
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-linear-to-br from-brand-blue/15 to-brand-pink/15">
          <Icon
            className={cn(
              "size-4",
              // Only the pulse gets a pulse. Every icon beating would be a
              // screen of movement with nothing to say.
              reading.live && "motion-safe:animate-heartbeat"
            )}
            // Same gradient as its organ and its waveform — one identity, three
            // sizes. Lucide spreads props onto the root `<svg>` and its paths
            // inherit `stroke`, so this reaches the whole glyph.
            stroke="url(#vitals-organ)"
          />
        </span>

        <span className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          {reading.label}
          {estimated ? (
            <Badge
              variant="outline"
              className="h-auto gap-1 px-1.5 py-0 text-[10px] font-normal"
            >
              <Info className="size-2.5" />
              estimated
            </Badge>
          ) : null}
        </span>
      </div>

      <div className="relative flex items-baseline gap-1">
        {/* Proportional figures, deliberately: `tabular-nums` gives every digit
            the width of a zero, which makes a value like 120/80 read loose at
            this size. The marker rows below are a column, and keep it. */}
        <span className="text-2xl leading-none font-semibold">
          {reading.value}
        </span>
        {reading.unit ? (
          <span className="text-xs text-muted-foreground">{reading.unit}</span>
        ) : null}
      </div>

      {reading.scale && reading.at !== undefined ? (
        <RangeTrack
          scale={reading.scale}
          at={reading.at}
          unit={reading.unit}
        />
      ) : null}
    </div>
  )
}

/**
 * The vitals a sitting produced, from sampled webcam frames.
 *
 * Which readings exist depends on the deployment — heart rate and the frame
 * count always, the clinical biomarkers only where they're enabled — so this
 * renders what came back rather than a fixed grid with gaps in it.
 */
export function VitalsPanel({ report }: { report: unknown }) {
  const vitals = toVitalsReport(report)

  if (!vitals) {
    return (
      <p className="text-sm text-muted-foreground">
        No vitals were captured for this sitting. Readings need the candidate&rsquo;s
        camera to stay on long enough for frames to be processed.
      </p>
    )
  }

  const readings: Reading[] = []

  /** Adds a tile, skipping the reading entirely when the API didn't send it. */
  const add = (
    key: string,
    label: string,
    Icon: LucideIcon,
    raw: number | null,
    options: { value?: string; unit?: string; live?: boolean } = {}
  ) => {
    if (raw === null && options.value === undefined) return
    readings.push({
      key,
      label,
      Icon,
      value: options.value ?? String(round(raw ?? 0)),
      unit: options.unit,
      live: options.live,
      scale: SCALE[key],
      at: raw ?? undefined,
    })
  }

  add("heart_rate", "Heart rate", HeartPulse, vitals.heartRate, {
    unit: "bpm",
    live: true,
  })

  const pressure = vitals.bloodPressure
  if (pressure?.systolic != null && pressure.diastolic != null) {
    readings.push({
      key: "blood_pressure",
      label: "Blood pressure",
      Icon: Gauge,
      value: `${round(pressure.systolic)}/${round(pressure.diastolic)}`,
      unit: "mmHg",
    })
  }

  add("spo2", "SpO₂", Droplets, vitals.spo2, { unit: "%" })
  add("respiratory_rate", "Respiratory rate", Wind, vitals.respiratoryRate, {
    unit: "/min",
  })
  add("stress_index", "Stress index", Brain, vitals.stressIndex, {
    value:
      vitals.stressIndex === null ? undefined : String(round(vitals.stressIndex, 1)),
  })
  add("glucose", "Glucose", FlaskConical, vitals.glucose, { unit: "mg/dL" })

  const estimated = new Set(vitals.estimatedOnly)
  const markers = Object.entries(vitals.bloodMarkers ?? {})

  return (
    /* A **container**, so the grids below answer to the width of the card this
       sits in rather than the width of the window. It appears in a full-width
       report and in one column of a three-column live view, and viewport
       breakpoints can't tell those apart — on a wide screen they laid three
       tiles into a 500px column and truncated every label to "T..". */
    <div className="@container flex flex-col gap-4">
      {/* One gradient for every trace on the page. SVG paint servers resolve
          document-wide, so each card's `url(#vitals-trace)` finds this — and one
          shared definition is what keeps the traces a single identity rather
          than six competing colours. */}
      <svg aria-hidden="true" className="absolute size-0">
        <defs>
          <linearGradient id="vitals-trace" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--color-brand-blue)" />
            <stop offset="100%" stopColor="var(--color-brand-pink)" />
          </linearGradient>
          {/* A second one in user space, sized to Lucide's 24×24 box. The
              default (`objectBoundingBox`) restarts the ramp inside every
              sub-path, so a multi-path icon comes out as several small
              rainbows instead of one diagonal sweep across the whole glyph. */}
          <linearGradient
            id="vitals-organ"
            gradientUnits="userSpaceOnUse"
            x1="0"
            y1="0"
            x2="24"
            y2="24"
          >
            <stop offset="0%" stopColor="var(--color-brand-blue)" />
            <stop offset="100%" stopColor="var(--color-brand-pink)" />
          </linearGradient>
        </defs>
      </svg>

      {/* `items-stretch` is the grid default and wanted here: the tiles with a
          track are taller, and `mt-auto` on the track pins every value row to
          the same baseline across the row. */}
      <div className="grid gap-3 @md:grid-cols-2 @3xl:grid-cols-3">
        {readings.map((reading, index) => (
          <ReadingTile
            key={reading.key}
            reading={reading}
            estimated={estimated.has(reading.key)}
            index={index}
          />
        ))}
      </div>

      {markers.length > 0 ? (
        <div className="flex flex-col gap-2">
          <p className="flex items-center gap-1.5 text-sm font-medium">
            <Activity className="size-4 text-muted-foreground" />
            Blood markers
          </p>
          <dl className="grid gap-2 @md:grid-cols-2 @3xl:grid-cols-3">
            {markers.map(([key, value], index) => {
              const marker = toMarker(key, value)
              return (
                <div
                  key={marker.key}
                  className="flex items-center justify-between gap-2 rounded-lg bg-muted/40 px-3 py-2 transition-colors hover:bg-muted/70 motion-safe:animate-in motion-safe:fade-in"
                  style={{
                    // Picked up where the tiles leave off, so the panel resolves
                    // top-to-bottom in one movement rather than two.
                    animationDelay: `${240 + index * 35}ms`,
                    animationFillMode: "backwards",
                  }}
                >
                  <dt className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
                    <span className="truncate">{marker.label}</span>
                    {/* Same rule as the tiles above: anything the server names
                        in `estimated_only` has to say so wherever it appears. */}
                    {estimated.has(marker.key) ? (
                      <Info className="size-2.5 shrink-0" aria-label="estimated" />
                    ) : null}
                  </dt>
                  <dd className="flex shrink-0 items-center gap-1.5">
                    <span className="text-sm font-medium tabular-nums">
                      {marker.value}
                    </span>
                    {marker.status ? (
                      <Badge
                        variant="outline"
                        className={cn(
                          "h-auto border px-1.5 py-0 text-[10px] font-normal capitalize",
                          markerTone(marker.status)
                        )}
                      >
                        {marker.status}
                      </Badge>
                    ) : null}
                  </dd>
                </div>
              )
            })}
          </dl>
        </div>
      ) : null}

      <p
        className={cn(
          "flex items-center gap-1.5 text-xs text-muted-foreground",
          readings.length === 0 && "text-destructive"
        )}
      >
        <HeartPulse className="size-3.5" />
        {vitals.framesProcessed.toLocaleString()} webcam frames processed.
        {estimated.size > 0
          ? " Readings marked estimated are derived from the signal, not measured."
          : ""}
      </p>
    </div>
  )
}
