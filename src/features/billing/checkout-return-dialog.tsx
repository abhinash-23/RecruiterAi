import * as React from "react"
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
  RefreshCw,
  XCircle,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  formatCredits,
  useVerifyCheckout,
  type VerifiedPayment,
} from "@/services/billing"
import { ApiError } from "@/services/http-client"

import { clearPendingCheckout } from "./stripe-checkout"

type Outcome =
  | { kind: "verifying" }
  | { kind: "done"; result: VerifiedPayment }
  /** 402: not paid yet — back without paying, or the bank is still confirming. */
  | { kind: "unpaid"; message: string }
  /** 402: Stripe's page expired after 24 h. Only a new purchase helps. */
  | { kind: "expired"; message: string }
  /** No answer, or Stripe couldn't be reached: worth asking again. */
  | { kind: "retry"; message: string }
  /** Anything else: said as the server said it. */
  | { kind: "failed"; message: string }

function outcomeOf(error: unknown): Outcome {
  if (!(error instanceof ApiError)) {
    return {
      kind: "retry",
      message: "We couldn't confirm the payment just now.",
    }
  }
  if (error.status === 402) {
    return /expired/i.test(error.message)
      ? { kind: "expired", message: error.message }
      : { kind: "unpaid", message: error.message }
  }
  if (error.status === 0 || error.status >= 500) {
    return { kind: "retry", message: error.message }
  }
  return { kind: "failed", message: error.message }
}

/**
 * Where the admin lands after paying on Stripe's page: confirms the checkout
 * with the server, which adds the credits.
 *
 * **Until the backend's Stripe webhook is set up, this call is the only thing
 * that adds the credits**, so it runs as soon as the page opens — and it is
 * safe to repeat: a refresh, or "Check again", credits the payment once.
 */
export function CheckoutReturnDialog({
  sessionId,
  interviewCost,
  onClose,
  onStartAgain,
}: {
  sessionId: string
  interviewCost: number
  onClose: () => void
  /** For an expired checkout: open Buy credits again. */
  onStartAgain: () => void
}) {
  const verify = useVerifyCheckout()
  const [outcome, setOutcome] = React.useState<Outcome>({ kind: "verifying" })
  const started = React.useRef(false)

  const check = React.useCallback(async () => {
    setOutcome({ kind: "verifying" })
    try {
      const result = await verify.mutateAsync(sessionId)
      clearPendingCheckout()
      setOutcome({ kind: "done", result })
    } catch (error) {
      const next = outcomeOf(error)
      if (next.kind === "expired" || next.kind === "failed") {
        clearPendingCheckout()
      }
      setOutcome(next)
    }
    // `verify` is a stable mutation object for this purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  // Once, as the page opens — guarded, so a double-mount doesn't ask twice.
  React.useEffect(() => {
    if (started.current) return
    started.current = true
    void check()
  }, [check])

  const busy = outcome.kind === "verifying"

  return (
    <Dialog open onOpenChange={(next) => (!next && !busy ? onClose() : null)}>
      <DialogContent className="sm:max-w-md" showCloseButton={!busy}>
        {outcome.kind === "verifying" ? (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <Loader2 className="size-8 animate-spin text-accent-brand" />
            <DialogTitle>Confirming your payment…</DialogTitle>
            <DialogDescription>
              Checking with Stripe. This takes a moment.
            </DialogDescription>
          </div>
        ) : outcome.kind === "done" ? (
          <>
            <div className="flex flex-col items-center gap-3 pt-2 text-center">
              <span className="flex size-14 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="size-7" />
              </span>
              <DialogTitle className="text-lg font-bold">
                {formatCredits(outcome.result.creditsAdded)} credits added
              </DialogTitle>
              <DialogDescription>
                Your balance is now{" "}
                <span className="font-semibold text-foreground tabular-nums">
                  {formatCredits(outcome.result.balance)}
                </span>{" "}
                credits, enough for{" "}
                {Math.floor(
                  outcome.result.balance / Math.max(1, interviewCost)
                )}{" "}
                interviews. Stripe emails your receipt.
              </DialogDescription>
            </div>
            <DialogFooter>
              <Button onClick={onClose}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <div className="flex flex-col items-center gap-3 pt-2 text-center">
              <span
                className={
                  outcome.kind === "failed"
                    ? "flex size-14 items-center justify-center rounded-full bg-red-500/10 text-red-600 dark:text-red-400"
                    : "flex size-14 items-center justify-center rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400"
                }
              >
                {outcome.kind === "failed" ? (
                  <XCircle className="size-7" />
                ) : outcome.kind === "expired" ? (
                  <AlertTriangle className="size-7" />
                ) : (
                  <Clock className="size-7" />
                )}
              </span>
              <DialogTitle className="text-lg font-bold">
                {outcome.kind === "unpaid"
                  ? "Payment not complete yet"
                  : outcome.kind === "expired"
                    ? "This checkout expired"
                    : outcome.kind === "retry"
                      ? "Still confirming"
                      : "Payment couldn't be confirmed"}
              </DialogTitle>
              <DialogDescription>
                {outcome.message}{" "}
                {outcome.kind === "unpaid"
                  ? "If you just paid, your bank may still be confirming it. Check again in a moment."
                  : outcome.kind === "retry"
                    ? "If you were charged, there's no need to pay again. Check again in a minute."
                    : outcome.kind === "expired"
                      ? "Nothing was charged. Start a new purchase to buy credits."
                      : ""}
              </DialogDescription>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>
                Close
              </Button>
              {outcome.kind === "unpaid" || outcome.kind === "retry" ? (
                <Button onClick={() => void check()}>
                  <RefreshCw />
                  Check again
                </Button>
              ) : outcome.kind === "expired" ? (
                <Button onClick={onStartAgain}>Buy credits</Button>
              ) : null}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
