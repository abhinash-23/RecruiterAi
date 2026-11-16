import * as React from "react"
import { BadgePlus, Loader2 } from "lucide-react"

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
import { Textarea } from "@/components/ui/textarea"
import { formatCredits, useGrantCredits } from "@/services/billing"
import { cn } from "@/lib/utils"

/** The API's limits. */
const MAX_CREDITS = 1_000_000
const NOTE_MAX = 300
const DEFAULT_NOTE = "Added by Recruiter AI"

/** Quick picks, in interviews: priced from the current cost per interview. */
const QUICK_INTERVIEWS = [1, 5, 10, 25]

type Unit = "interviews" | "credits"

export interface GrantTarget {
  adminId: string
  adminName: string
  balance: number
}

/**
 * The super admin adds credits to one admin's wallet, without a payment.
 *
 * Two steps, because it can't be undone from here: choose, then confirm the
 * exact number against the name. The admin sees a row in their credit log
 * reading "Added by Recruiter AI" with the note — never who added it; the
 * platform audit log keeps that.
 */
export function GrantCreditsDialog({
  target,
  interviewCost,
  onClose,
}: {
  target: GrantTarget | null
  interviewCost: number
  onClose: () => void
}) {
  const grant = useGrantCredits()
  const [unit, setUnit] = React.useState<Unit>("interviews")
  const [amount, setAmount] = React.useState("10")
  const [note, setNote] = React.useState("")
  const [confirming, setConfirming] = React.useState(false)

  const cost = Math.max(1, interviewCost)
  const number = Number(amount)
  const credits =
    Number.isInteger(number) && number > 0
      ? unit === "interviews"
        ? number * cost
        : number
      : 0
  const valid = credits >= 1 && credits <= MAX_CREDITS
  const noteTooLong = note.trim().length > NOTE_MAX

  const close = () => {
    if (grant.isPending) return
    onClose()
    setUnit("interviews")
    setAmount("10")
    setNote("")
    setConfirming(false)
  }

  const submit = () => {
    if (!target || !valid || noteTooLong) return
    grant.mutate(
      { adminId: target.adminId, credits, note },
      { onSuccess: close }
    )
  }

  const switchUnit = (next: Unit) => {
    if (next === unit) return
    // Carry the amount across, so switching never silently changes it.
    if (valid) {
      setAmount(
        String(
          next === "credits" ? credits : Math.max(1, Math.round(credits / cost))
        )
      )
    }
    setUnit(next)
  }

  return (
    <Dialog
      open={target !== null}
      onOpenChange={(next) => (next ? null : close())}
    >
      <DialogContent className="sm:max-w-md" showCloseButton={!grant.isPending}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg font-bold">
            <BadgePlus className="size-5 text-accent-brand" />
            Add credits
          </DialogTitle>
          <DialogDescription>
            {target ? (
              <>
                To{" "}
                <span className="font-medium text-foreground">
                  {target.adminName}
                </span>
                , who has {formatCredits(target.balance)} credits now. No
                payment is taken.
              </>
            ) : null}
          </DialogDescription>
        </DialogHeader>

        {confirming && target ? (
          <div className="flex flex-col gap-3 rounded-xl border bg-muted/40 p-4 text-sm">
            <p>
              Add{" "}
              <span className="font-semibold tabular-nums">
                {formatCredits(credits)} credits
              </span>{" "}
              (enough for {Math.floor(credits / cost)} interviews) to{" "}
              <span className="font-semibold">{target.adminName}</span>?
            </p>
            <p className="text-muted-foreground">
              Their balance becomes{" "}
              <span className="font-medium text-foreground tabular-nums">
                {formatCredits(target.balance + credits)}
              </span>
              . They&rsquo;ll see &ldquo;{note.trim() || DEFAULT_NOTE}&rdquo; in
              their credit log.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="grant-amount">Amount</Label>
                <div
                  role="group"
                  aria-label="Count in"
                  className="inline-flex rounded-lg border p-0.5"
                >
                  {(["interviews", "credits"] as const).map((option) => (
                    <button
                      key={option}
                      type="button"
                      aria-pressed={unit === option}
                      onClick={() => switchUnit(option)}
                      className={cn(
                        "rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-colors",
                        unit === option
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              </div>
              {unit === "interviews" ? (
                <div className="grid grid-cols-4 gap-2">
                  {QUICK_INTERVIEWS.map((count) => (
                    <Button
                      key={count}
                      type="button"
                      size="sm"
                      variant={number === count ? "default" : "outline"}
                      onClick={() => setAmount(String(count))}
                    >
                      {count}
                    </Button>
                  ))}
                </div>
              ) : null}
              <Input
                id="grant-amount"
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                aria-invalid={amount !== "" && !valid}
              />
              <p
                className={cn(
                  "text-xs",
                  amount !== "" && !valid
                    ? "text-destructive"
                    : "text-muted-foreground"
                )}
              >
                {amount !== "" && !valid
                  ? `Enter a whole number, up to ${formatCredits(MAX_CREDITS)} credits.`
                  : unit === "interviews"
                    ? `${formatCredits(credits)} credits at ${formatCredits(cost)} per interview.`
                    : `Enough for ${Math.floor(credits / cost)} interviews.`}
              </p>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="grant-note">Note for the admin</Label>
              <Textarea
                id="grant-note"
                rows={2}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder={`${DEFAULT_NOTE} (default)`}
                aria-invalid={noteTooLong}
              />
              <p
                className={cn(
                  "text-xs",
                  noteTooLong ? "text-destructive" : "text-muted-foreground"
                )}
              >
                Shown in their credit log, like &ldquo;Pilot bonus&rdquo;.{" "}
                {note.trim().length}/{NOTE_MAX}
              </p>
            </div>
          </div>
        )}

        <DialogFooter>
          {confirming ? (
            <>
              <Button
                variant="outline"
                onClick={() => setConfirming(false)}
                disabled={grant.isPending}
              >
                Back
              </Button>
              <Button onClick={submit} disabled={grant.isPending}>
                {grant.isPending ? (
                  <>
                    <Loader2 className="animate-spin" />
                    Adding…
                  </>
                ) : (
                  `Add ${formatCredits(credits)} credits`
                )}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={close}>
                Cancel
              </Button>
              <Button
                onClick={() => setConfirming(true)}
                disabled={!valid || noteTooLong}
              >
                Continue
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
