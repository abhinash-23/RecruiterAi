import * as React from "react"
import {
  CameraOff,
  ChevronDown,
  Info,
  ShieldCheck,
  SquareArrowOutUpRight,
  UserRoundX,
  UsersRound,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  toIntegrityReport,
  type AbsenceEvent,
  type MultipleFaces,
} from "@/services/interview"
import { cn } from "@/lib/utils"

/**
 * ============================================================================
 * INTERVIEW INTEGRITY
 * ============================================================================
 * How much of the sitting the camera actually saw: how often it went dark, how
 * often the candidate left the frame, how often someone else's face was in
 * shot, and for how long.
 *
 * **This is context, not a verdict.** The counters play no part in
 * `overall_score` or the SELECTED / NOT SELECTED outcome, and this panel is
 * built so it cannot be read as though they do:
 *
 *  - It never scores, grades or ranks — no percentage, no pass mark, no traffic
 *    light. Amber marks the *presence* of an interruption so a reader can find
 *    it, and stops there.
 *  - It says so in words, at the bottom, where someone reading the numbers will
 *    still be looking.
 *  - A clean sitting renders as a stated "No interruptions" rather than
 *    vanishing. An absent panel is ambiguous — it could mean nothing happened
 *    or that nothing was measured — and on a page that decides whether someone
 *    gets hired, that difference matters.
 *
 * The server has already removed the noise: counts are episodes rather than
 * frames, and drops under ~1.5s never arrive. So everything here renders the
 * payload as given.
 */

/** `47.5` → `47.5s`; `95` → `1m 35s`. */
function duration(totalSeconds: number): string {
  if (totalSeconds < 60) {
    // One decimal below a minute, none above: the difference between 47.5s and
    // 47s is meaningful for a blip, and meaningless inside "1m 35s".
    return `${Math.round(totalSeconds * 10) / 10}s`
  }
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = Math.round(totalSeconds % 60)
  return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`
}

/**
 * `36` → `36 sec`; `95` → `1 min 35 sec`.
 *
 * Spelt out, unlike `duration`, because the counter tiles read as a sentence
 * rather than as entries in a column. Squeezed together as `2× 36s total` the
 * two figures ran into one number — the count looked like a multiplier on the
 * duration, which is the one reading it must not have.
 */
function longDuration(totalSeconds: number): string {
  if (totalSeconds < 60) {
    return `${Math.round(totalSeconds * 10) / 10} sec`
  }
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = Math.round(totalSeconds % 60)
  return seconds === 0 ? `${minutes} min` : `${minutes} min ${seconds} sec`
}

/** `1` → `1 time`; `2` → `2 times`. */
function occurrences(count: number): string {
  return `${count} ${count === 1 ? "time" : "times"}`
}

/** Wall-clock time of an episode, in the reader's own timezone. */
function clockTime(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
}

const EVENT_LABEL: Record<AbsenceEvent["type"], string> = {
  camera_off: "Camera off",
  face_absent: "Out of frame",
  multiple_faces: "Multiple faces",
}

const EVENT_ICON: Record<AbsenceEvent["type"], typeof CameraOff> = {
  camera_off: CameraOff,
  face_absent: UserRoundX,
  multiple_faces: UsersRound,
}

const BROWSER_REPORTED =
  "Reported by the candidate's browser, so less reliable than the camera measurements"

/**
 * One counter: what happened, how many times, and for how long in total.
 *
 * Three states, not two. `count === null` renders as `missing` — "Not tracked",
 * "Not measured" — never as 0 and never as blank: an interview nobody watched
 * must not read as one that came back clean. And `seconds === null` drops the
 * duration rather than printing "0 sec": the live report read back from the
 * database carries counts without durations, and an unmeasured duration is not
 * "no time at all".
 */
function Tile({
  Icon,
  label,
  count,
  seconds = null,
  missing,
  reportedByBrowser,
}: {
  Icon: typeof CameraOff
  label: string
  count: number | null
  seconds?: number | null
  /** What `count === null` means for this figure. */
  missing: string
  /** Marks the softer evidence — see `BROWSER_REPORTED`. */
  reportedByBrowser?: boolean
}) {
  const untracked = count === null
  const clean = count === 0

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-lg border px-3 py-2.5",
        // Tinted only when there is something to find. A zero row in amber
        // would read as a warning about an interview that had none.
        untracked
          ? "border-dashed bg-transparent"
          : clean
            ? "bg-muted/30"
            : "border-amber-500/25 bg-amber-500/5"
      )}
    >
      <Icon
        className={cn(
          "size-4 shrink-0",
          untracked || clean
            ? "text-muted-foreground"
            : "text-amber-600 dark:text-amber-500"
        )}
      />
      <div className="flex min-w-0 flex-col">
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          {label}
          {/* Only where it changes how the number should be read — and only
              when there is a number to read. */}
          {reportedByBrowser && !untracked && !clean ? (
            <span title={BROWSER_REPORTED}>
              <Info className="size-2.5" aria-label="browser-reported" />
            </span>
          ) : null}
        </span>
        <span
          className={cn(
            "text-sm font-medium",
            untracked && "text-muted-foreground italic"
          )}
        >
          {untracked ? (
            missing
          ) : clean ? (
            "None"
          ) : (
            <>
              <span className="tabular-nums">{occurrences(count)}</span>
              {seconds !== null ? (
                <span className="ml-1.5 font-normal text-muted-foreground tabular-nums">
                  · total time {longDuration(seconds)}
                </span>
              ) : null}
            </>
          )}
        </span>
      </div>
    </div>
  )
}

/**
 * The integrity block for one sitting.
 *
 * Takes the raw `vitals_report` — the same payload the vitals panel gets, or the
 * live `GET /api/vitals/report` body, which carries the same counters — and
 * renders nothing at all when the deployment predates them, so an older backend
 * doesn't show a block of zeroes it never measured.
 *
 * `multipleFaces` is the top-level block from get-results, where the server
 * lifts it; see {@link toIntegrityReport}. Leave it out to read it off `report`.
 */
export function IntegrityPanel({
  report,
  multipleFaces,
}: {
  report: unknown
  multipleFaces?: MultipleFaces | null
}) {
  const integrity = toIntegrityReport(report, multipleFaces)
  const [open, setOpen] = React.useState(false)

  if (!integrity) return null

  const { cameraOffCount, faceAbsentCount, tabSwitchCount, events } = integrity
  const faces = integrity.multipleFaces
  /* "No interruptions" has to mean *nothing happened*, not *nothing was
     reported* — so an untracked tab count or unmeasured faces can't satisfy it.
     A sitting with the camera clean and the rest unknown is unknown, not
     spotless. */
  const clean =
    cameraOffCount === 0 &&
    faceAbsentCount === 0 &&
    tabSwitchCount === 0 &&
    faces?.count === 0

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-medium">
          <ShieldCheck className="size-4 text-muted-foreground" />
          Interview integrity
        </p>
        {clean ? (
          <Badge
            variant="outline"
            className="h-auto border-emerald-500/25 bg-emerald-500/10 px-1.5 py-0 text-[10px] font-normal text-emerald-700 dark:text-emerald-400"
          >
            No interruptions
          </Badge>
        ) : null}
      </div>

      {/* Two by two, then one row of four once the card is wide enough — never
          three and one, where the fourth tile drops to a row of its own and
          reads as a separate, lesser thing when all four answer the same
          question and are weighed together.

          Camera-measured first, browser-reported last. That order is the point
          too: the harder evidence leads. */}
      <div className="grid gap-2 @md:grid-cols-2 @4xl:grid-cols-4">
        <Tile
          Icon={CameraOff}
          label="Camera off"
          count={cameraOffCount}
          seconds={integrity.cameraOffSeconds}
          missing="Not measured"
        />
        <Tile
          Icon={UserRoundX}
          label="Out of frame"
          count={faceAbsentCount}
          seconds={integrity.faceAbsentSeconds}
          missing="Not measured"
        />
        <Tile
          Icon={UsersRound}
          label="Multiple faces"
          count={faces?.count ?? null}
          seconds={faces?.seconds ?? null}
          missing="Not measured"
        />
        <Tile
          Icon={SquareArrowOutUpRight}
          label="Left the tab"
          count={tabSwitchCount}
          missing="Not tracked"
          reportedByBrowser
        />
      </div>

      {/* Collapsed by default: on a clean or near-clean sitting the timeline is
          detail nobody needs, and the counters above already answer the
          question most readers came with. */}
      {events.length > 0 ? (
        <div className="flex flex-col gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            className="h-auto w-fit gap-1.5 px-2 py-1 text-xs text-muted-foreground"
          >
            <ChevronDown
              className={cn(
                "size-3.5 transition-transform",
                open && "rotate-180"
              )}
            />
            {open ? "Hide" : "Show"} timeline ({events.length}{" "}
            {events.length === 1 ? "episode" : "episodes"})
          </Button>

          {open ? (
            <ol className="flex flex-col gap-1.5">
              {events.map((event, index) => {
                const Icon = EVENT_ICON[event.type]
                return (
                  <li
                    key={`${event.type}-${event.startedAtMs}-${index}`}
                    className="flex items-center gap-2.5 rounded-lg bg-muted/40 px-3 py-2 text-xs motion-safe:animate-in motion-safe:fade-in"
                    style={{
                      animationDelay: `${index * 30}ms`,
                      animationFillMode: "backwards",
                    }}
                  >
                    <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="font-medium">
                      {EVENT_LABEL[event.type]}
                    </span>
                    {/* Start and end, so a reader can find the stretch in the
                        recording without doing the arithmetic. */}
                    <span className="text-muted-foreground tabular-nums">
                      {clockTime(event.startedAtMs)} –{" "}
                      {clockTime(event.startedAtMs + event.seconds * 1000)}
                    </span>
                    <span className="ml-auto shrink-0 font-medium tabular-nums">
                      {duration(event.seconds)}
                    </span>
                  </li>
                )
              })}
            </ol>
          ) : null}
        </div>
      ) : null}

      {/* Stated outright, and placed under the numbers rather than above them:
          a reader who has just seen "Camera off — 2 times" is the one who needs
          to know it didn't cost the candidate anything. */}
      <div className="flex flex-col gap-1 text-xs text-muted-foreground">
        <p>
          Recorded for context only — these do not affect the score or the
          outcome.
        </p>
        {/* Only once there is a count to qualify. Each clause is a way the
            number misleads: a photo, poster, TV or mirror is a face; a
            bystander out of shot is not; and frames are sampled, so short
            visits can fall between them. The duration is usually the tell —
            a face there for the whole sitting is a picture on the wall. */}
        {faces && faces.count > 0 ? (
          <p>
            Multiple faces is a count, not a conclusion. It sees faces, not
            people — a photo, poster, TV or mirror counts, and someone whose face
            is out of shot doesn&rsquo;t — and frames are sampled, so durations
            are approximate. A face present for the whole sitting is usually a
            picture; the recording settles it.
          </p>
        ) : null}
        {/* Stated rather than left to the icon: a recruiter weighing "left the
            tab 4×" against "camera off 1×" is comparing two different strengths
            of evidence, and nothing else on the page says so. A second device or
            another monitor never trips the tab count at all. */}
        {tabSwitchCount !== null && tabSwitchCount > 0 ? (
          <p>
            The tab count is self-reported by the candidate&rsquo;s browser and
            can be suppressed; the camera measurements cannot.
          </p>
        ) : null}
      </div>
    </div>
  )
}
