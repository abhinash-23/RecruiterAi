import * as React from "react"
import { AlertTriangle, CalendarPlus, Link2, MailCheck } from "lucide-react"

import { CopyButton } from "@/components/shared/copy-button"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useCurrentUser } from "@/features/auth/auth-context"
import { useInterviewDefaults } from "@/services/admin"
import {
  SCHEDULE_LIMITS,
  type Candidate,
  type ScheduleInput,
  type ScheduleResult,
} from "@/services/hr"

interface ScheduleDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  candidates: Candidate[]
  onSchedule: (input: ScheduleInput) => Promise<ScheduleResult>
  pending?: boolean
  onDone?: () => void
}

/**
 * Invites the selected candidates.
 *
 * **There is no calendar and no slot picker** — that's deliberate on this API.
 * The candidate receives a link valid for a window and sits whenever they like
 * inside it, so the only knobs are how long the sitting may run and how long
 * the link stays alive.
 */
export function ScheduleDialog({
  open,
  onOpenChange,
  candidates,
  onSchedule,
  pending,
  onDone,
}: ScheduleDialogProps) {
  const user = useCurrentUser()

  // Admin-only endpoint, and this dialog is mostly used by HR. They get the
  // generic placeholder instead of the number; leaving the fields blank applies
  // the very same defaults server-side, so nothing about scheduling changes.
  const defaults = useInterviewDefaults(user.role === "admin")

  const [timeMinutes, setTimeMinutes] = React.useState("")
  const [linkExpiryHours, setLinkExpiryHours] = React.useState("")
  const [result, setResult] = React.useState<ScheduleResult | null>(null)

  // Blank means "use the company default", which the server applies for us —
  // so the placeholders show what that default currently is.
  const defaultTime = defaults.data?.timeMinutes
  const defaultExpiry = defaults.data?.linkExpiryHours

  const tooMany = candidates.length > SCHEDULE_LIMITS.maxCandidates

  const submit = async () => {
    const outcome = await onSchedule({
      candidateIds: candidates.map((c) => c.candidateId),
      ...(timeMinutes ? { timeMinutes: Number(timeMinutes) } : {}),
      ...(linkExpiryHours ? { linkExpiryHours: Number(linkExpiryHours) } : {}),
    })
    setResult(outcome)
    onDone?.()
  }

  const close = () => {
    onOpenChange(false)
    setResult(null)
    setTimeMinutes("")
    setLinkExpiryHours("")
  }

  // Any invitation the server couldn't email has to be delivered by hand, so
  // those rows keep their link and code on screen.
  const undelivered = result?.scheduled.filter((row) => !row.emailSent) ?? []

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? null : close())}>
      <DialogContent className="sm:max-w-lg">
        {result ? (
          <>
            <DialogHeader>
              <DialogTitle>
                {result.scheduled.length} interview
                {result.scheduled.length === 1 ? "" : "s"} scheduled
              </DialogTitle>
              <DialogDescription>{result.message}</DialogDescription>
            </DialogHeader>

            {undelivered.length === 0 && result.scheduled.length > 0 ? (
              <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <MailCheck className="size-4 text-emerald-600 dark:text-emerald-400" />
                Invitations were emailed with the link and one-time code.
              </p>
            ) : null}

            {undelivered.length > 0 ? (
              <div className="flex flex-col gap-3">
                <p className="flex items-start gap-1.5 text-sm text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  These couldn&rsquo;t be emailed — send them yourself.
                </p>
                {undelivered.map((row) => (
                  <div
                    key={row.interviewId}
                    className="flex flex-col gap-1.5 rounded-lg border p-3 text-sm"
                  >
                    <div className="flex items-center gap-2">
                      <Link2 className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate font-mono text-xs">
                        {row.interviewLink}
                      </span>
                      <CopyButton value={row.interviewLink} label="link" />
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">
                        Code
                      </span>
                      <span className="font-mono text-base font-semibold tracking-[0.2em]">
                        {row.otpCode}
                      </span>
                      <CopyButton value={row.otpCode} label="code" />
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            {result.errors.length > 0 ? (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm">
                <p className="font-medium">Rejected:</p>
                <ul className="mt-1 list-inside list-disc text-xs">
                  {result.errors.map((error, index) => (
                    <li key={error.email ?? index}>{error.error}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            <DialogFooter>
              <Button onClick={close}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>
                Schedule {candidates.length} candidate
                {candidates.length === 1 ? "" : "s"}
              </DialogTitle>
              <DialogDescription>
                Each gets a link and a one-time code by email. There&rsquo;s no
                fixed appointment — they sit whenever they like before the link
                expires.
              </DialogDescription>
            </DialogHeader>

            <ul className="max-h-40 overflow-y-auto rounded-lg border text-sm">
              {candidates.map((candidate) => (
                <li
                  key={candidate.candidateId}
                  className="flex items-center justify-between gap-2 border-b px-3 py-1.5 last:border-b-0"
                >
                  <span className="min-w-0 truncate">
                    {candidate.name || candidate.email}
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {candidate.fitScore ?? "—"}
                  </span>
                </li>
              ))}
            </ul>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="schedule-minutes">Sitting length</Label>
                <Input
                  id="schedule-minutes"
                  type="number"
                  min={5}
                  max={180}
                  value={timeMinutes}
                  onChange={(event) => setTimeMinutes(event.target.value)}
                  placeholder={
                    defaultTime ? `${defaultTime} (default)` : "Company default"
                  }
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="schedule-expiry">Link valid for (hours)</Label>
                <Input
                  id="schedule-expiry"
                  type="number"
                  min={1}
                  max={720}
                  value={linkExpiryHours}
                  onChange={(event) => setLinkExpiryHours(event.target.value)}
                  placeholder={
                    defaultExpiry
                      ? `${defaultExpiry} (default)`
                      : "Company default"
                  }
                />
              </div>
            </div>

            {tooMany ? (
              <p className="text-sm text-destructive">
                Select at most {SCHEDULE_LIMITS.maxCandidates} candidates per
                batch.
              </p>
            ) : null}

            <DialogFooter>
              <Button variant="outline" onClick={close} disabled={pending}>
                Cancel
              </Button>
              <Button
                onClick={() => void submit()}
                disabled={pending || tooMany || candidates.length === 0}
              >
                {pending ? (
                  "Scheduling…"
                ) : (
                  <>
                    <CalendarPlus />
                    Send invitations
                  </>
                )}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
