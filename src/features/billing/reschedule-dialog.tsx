import * as React from "react"
import { format } from "date-fns"
import {
  AlertTriangle,
  CalendarSync,
  CheckCircle2,
  Link2,
  Loader2,
} from "lucide-react"

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
import {
  useRescheduleInterview,
  type RescheduleResult,
} from "@/services/billing"

import { creditsText, type HeldCreditsTarget } from "./held-target"

/**
 * A new interview for the same candidate, paid for by the old one's held
 * credits. One optional knob, the link's window; everything else is copied.
 */
export function RescheduleDialog({
  target,
  onClose,
}: {
  target: HeldCreditsTarget | null
  onClose: () => void
}) {
  const reschedule = useRescheduleInterview()
  const [hours, setHours] = React.useState("")
  const [result, setResult] = React.useState<RescheduleResult | null>(null)

  const close = () => {
    onClose()
    setHours("")
    setResult(null)
    reschedule.reset()
  }

  const submit = async () => {
    if (!target) return
    try {
      setResult(
        await reschedule.mutateAsync({
          interviewId: target.interviewId,
          ...(hours ? { linkExpiryHours: Number(hours) } : {}),
        })
      )
    } catch {
      // Reported by the mutation (409: someone already chose). Close, since
      // the refreshed list now shows the choice as made.
      close()
    }
  }

  return (
    <Dialog open={target !== null} onOpenChange={(next) => !next && close()}>
      <DialogContent className="sm:max-w-md">
        {result ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {result.emailSent ? (
                  <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400" />
                ) : (
                  <AlertTriangle className="size-4 text-amber-600 dark:text-amber-400" />
                )}
                {result.emailSent
                  ? "Interview rescheduled"
                  : "Rescheduled, but the email didn't go"}
              </DialogTitle>
              <DialogDescription>
                {result.emailSent
                  ? `A new invitation is on its way to ${target?.candidateName}. No new credits were used.`
                  : `The new interview is ready, but the mail to ${target?.candidateName} failed. Send them the link and code below. No new credits were used.`}
              </DialogDescription>
            </DialogHeader>

            {result.linkExpiresAt ? (
              <p className="text-sm text-muted-foreground">
                The new link works until{" "}
                <span className="font-medium text-foreground">
                  {format(new Date(result.linkExpiresAt), "EEE d MMM, HH:mm")}
                </span>
                .
              </p>
            ) : null}

            {!result.emailSent ? (
              <div className="flex flex-col gap-1.5 rounded-lg border p-3 text-sm">
                <div className="flex items-center gap-2">
                  <Link2 className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate font-mono text-xs">
                    {result.interviewLink}
                  </span>
                  <CopyButton value={result.interviewLink} label="link" />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Code</span>
                  <span className="font-mono text-base font-semibold tracking-[0.2em]">
                    {result.otpCode}
                  </span>
                  <CopyButton value={result.otpCode} label="code" />
                </div>
              </div>
            ) : null}

            <DialogFooter>
              <Button onClick={close}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <CalendarSync className="size-4" />
                Reschedule for {target?.candidateName}
              </DialogTitle>
              <DialogDescription>
                Creates a new interview with the same settings and emails the
                candidate a new link and code. It uses the{" "}
                {target ? creditsText(target) : "credits"} already held, so
                nothing new is charged. The old link stays closed.
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="reschedule-expiry">Link valid for (hours)</Label>
              <Input
                id="reschedule-expiry"
                type="number"
                min={1}
                max={720}
                value={hours}
                onChange={(event) => setHours(event.target.value)}
                placeholder="Same as the old interview"
              />
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={close}
                disabled={reschedule.isPending}
              >
                Cancel
              </Button>
              <Button
                onClick={() => void submit()}
                disabled={reschedule.isPending}
              >
                {reschedule.isPending ? (
                  <>
                    <Loader2 className="animate-spin" />
                    Rescheduling…
                  </>
                ) : (
                  <>
                    <CalendarSync />
                    Reschedule
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
