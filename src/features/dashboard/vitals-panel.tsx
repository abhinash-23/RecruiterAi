import { Activity, HeartPulse, Info } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { toVitalsReport } from "@/services/interview"
import { cn } from "@/lib/utils"

interface Reading {
  /** The wire key, so `estimated_only` can be matched against it. */
  key: string
  label: string
  value: string
}

function round(value: number, places = 0) {
  const factor = 10 ** places
  return Math.round(value * factor) / factor
}

/**
 * One vitals reading. The "estimated" chip is not decoration: the API flags
 * which of these are derived from the signal rather than optically measured,
 * and an unlabelled SpO₂ reads as a medical measurement when it isn't one.
 */
function ReadingTile({
  reading,
  estimated,
}: {
  reading: Reading
  estimated: boolean
}) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border p-3">
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
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
      <span className="text-xl font-semibold tabular-nums">
        {reading.value}
      </span>
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
  const add = (key: string, label: string, value: string | null) => {
    if (value !== null) readings.push({ key, label, value })
  }

  add(
    "heart_rate",
    "Heart rate",
    vitals.heartRate === null ? null : `${round(vitals.heartRate)} bpm`
  )
  add(
    "blood_pressure",
    "Blood pressure",
    vitals.bloodPressure?.systolic != null &&
      vitals.bloodPressure.diastolic != null
      ? `${round(vitals.bloodPressure.systolic)}/${round(vitals.bloodPressure.diastolic)}`
      : null
  )
  add("spo2", "SpO₂", vitals.spo2 === null ? null : `${round(vitals.spo2)}%`)
  add(
    "respiratory_rate",
    "Respiratory rate",
    vitals.respiratoryRate === null
      ? null
      : `${round(vitals.respiratoryRate)} /min`
  )
  add(
    "stress_index",
    "Stress index",
    vitals.stressIndex === null ? null : String(round(vitals.stressIndex, 2))
  )
  add(
    "glucose",
    "Glucose",
    vitals.glucose === null ? null : `${round(vitals.glucose)} mg/dL`
  )

  const estimated = new Set(vitals.estimatedOnly)
  const markers = Object.entries(vitals.bloodMarkers ?? {})

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {readings.map((reading) => (
          <ReadingTile
            key={reading.key}
            reading={reading}
            estimated={estimated.has(reading.key)}
          />
        ))}
      </div>

      {markers.length > 0 ? (
        <div className="flex flex-col gap-2">
          <p className="flex items-center gap-1.5 text-sm font-medium">
            <Activity className="size-4 text-muted-foreground" />
            Blood markers
          </p>
          <dl className="grid gap-2 sm:grid-cols-2">
            {markers.map(([key, value]) => (
              <div
                key={key}
                className="flex items-baseline justify-between gap-2 rounded-lg bg-muted/40 px-3 py-1.5"
              >
                <dt className="text-xs text-muted-foreground">
                  {key.replace(/_/g, " ")}
                </dt>
                <dd className="text-sm tabular-nums">
                  {typeof value === "object"
                    ? JSON.stringify(value)
                    : String(value)}
                </dd>
              </div>
            ))}
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
