import * as React from "react"
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Coins,
  Loader2,
  ShieldCheck,
} from "lucide-react"

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
import {
  formatCredits,
  formatPaise,
  useCreditPurchase,
  type VerifiedPayment,
  type Wallet,
} from "@/services/billing"
import { ApiError } from "@/services/http-client"
import { cn } from "@/lib/utils"

import { loadRazorpay } from "./razorpay"

/** The most one order may buy, per the API. */
const MAX_CREDITS = 500_000

/** Packs, in interviews: priced from the wallet, so a price change follows. */
const PACK_INTERVIEWS = [2, 10, 20, 50]
const POPULAR_PACK = 10

type Stage =
  /** Picking an amount. */
  | "choose"
  /** Creating the order on the server. */
  | "ordering"
  /** Razorpay's own window is open; this dialog steps aside. */
  | "checkout"
  /** Paid; the server is confirming it. */
  | "verifying"
  | "done"
  /** Paid, but the confirmation didn't come back. The webhook will add it. */
  | "pending"

/**
 * Buys credits through Razorpay Checkout. Admin only.
 *
 * The admin picks a number of credits; the server creates an order for the
 * exact amount (GST included), Checkout takes the payment, and the server
 * verifies it and adds the credits. Nothing priced here is ever sent: the
 * preview is only a preview, and Checkout charges the order's total.
 */
export function BuyCreditsDialog({
  open,
  onOpenChange,
  wallet,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  wallet: Wallet
}) {
  const user = useCurrentUser()
  const purchase = useCreditPurchase()

  const packs = PACK_INTERVIEWS.map((n) => n * wallet.interviewCost)
  const [credits, setCredits] = React.useState(
    String(POPULAR_PACK * wallet.interviewCost)
  )
  const [stage, setStage] = React.useState<Stage>("choose")
  const stageRef = React.useRef<Stage>("choose")
  const [failure, setFailure] = React.useState<string | null>(null)
  const [result, setResult] = React.useState<VerifiedPayment | null>(null)

  const go = (next: Stage) => {
    stageRef.current = next
    setStage(next)
  }

  const amount = Number(credits)
  const valid =
    Number.isInteger(amount) &&
    amount >= wallet.interviewCost &&
    amount <= MAX_CREDITS

  // A preview only. The order's `total_paise` is what Checkout charges.
  const basePaise = valid ? amount * 100 : 0
  const gstPaise = Math.round((basePaise * wallet.gstPercent) / 100)
  const totalPaise = basePaise + gstPaise

  const reset = () => {
    go("choose")
    setFailure(null)
    setResult(null)
    setCredits(String(POPULAR_PACK * wallet.interviewCost))
  }

  const close = () => {
    onOpenChange(false)
    reset()
  }

  const confirm = async (payment: {
    razorpay_order_id: string
    razorpay_payment_id: string
    razorpay_signature: string
  }) => {
    go("verifying")
    try {
      setResult(await purchase.verify.mutateAsync(payment))
      go("done")
    } catch (error) {
      // No answer, or a gateway failure: the money may well have been taken,
      // and Razorpay's webhook credits it without us.
      if (
        !(error instanceof ApiError) ||
        error.status === 0 ||
        error.status >= 500
      ) {
        go("pending")
        return
      }
      setFailure(error.message)
      go("choose")
    }
  }

  const pay = async () => {
    if (!valid) return
    setFailure(null)
    go("ordering")

    try {
      const [Razorpay, order] = await Promise.all([
        loadRazorpay(),
        purchase.order.mutateAsync(amount),
      ])

      const checkout = new Razorpay({
        key: order.keyId,
        order_id: order.orderId,
        amount: order.totalPaise,
        currency: order.currency,
        name: "RecruiterAI",
        description: `${formatCredits(order.credits)} credits`,
        prefill: { name: user.name, email: user.email },
        theme: { color: "#0052ff" },
        handler: (response) => void confirm(response),
        modal: {
          // Closing Checkout without paying is not an error. Ignored once
          // payment went through, when Checkout closes itself.
          ondismiss: () => {
            if (stageRef.current === "checkout") go("choose")
          },
        },
      })
      // Checkout stays open on a failed attempt so the admin can retry there;
      // the reason waits here for when they close it.
      checkout.on("payment.failed", (response) => {
        setFailure(
          response.error.description ??
            "The payment didn't go through. No credits were added."
        )
      })
      go("checkout")
      checkout.open()
    } catch (error) {
      setFailure(
        error instanceof Error
          ? error.message
          : "Could not start the payment. Please try again."
      )
      go("choose")
    }
  }

  const busy = stage === "ordering" || stage === "verifying"

  return (
    <Dialog
      // Steps aside while Checkout is up: Checkout is its own window, and a
      // modal dialog under it would hold on to keyboard focus.
      open={open && stage !== "checkout"}
      onOpenChange={(next) => {
        if (!next && !busy) close()
      }}
    >
      <DialogContent className="sm:max-w-lg" showCloseButton={!busy}>
        {stage === "done" && result ? (
          <>
            <div className="flex flex-col items-center gap-3 pt-2 text-center">
              <span className="flex size-14 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="size-7" />
              </span>
              <DialogTitle className="text-lg font-bold">
                {formatCredits(result.creditsAdded)} credits added
              </DialogTitle>
              <DialogDescription>
                Your new balance is{" "}
                <span className="font-semibold text-foreground tabular-nums">
                  {formatCredits(result.balance)}
                </span>{" "}
                credits, enough for{" "}
                {Math.floor(result.balance / wallet.interviewCost)} interviews.
              </DialogDescription>
            </div>
            <DialogFooter>
              <Button onClick={close}>Done</Button>
            </DialogFooter>
          </>
        ) : stage === "pending" ? (
          <>
            <div className="flex flex-col items-center gap-3 pt-2 text-center">
              <span className="flex size-14 items-center justify-center rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400">
                <Clock className="size-7" />
              </span>
              <DialogTitle className="text-lg font-bold">
                Confirming your payment
              </DialogTitle>
              <DialogDescription>
                We couldn&rsquo;t confirm it just now. If you were charged, your
                credits will appear within a few minutes. There&rsquo;s no need
                to pay again. Check Payments below to see it arrive.
              </DialogDescription>
            </div>
            <DialogFooter>
              <Button onClick={close}>Close</Button>
            </DialogFooter>
          </>
        ) : stage === "verifying" ? (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <Loader2 className="size-8 animate-spin text-accent-brand" />
            <DialogTitle>Confirming your payment…</DialogTitle>
            <DialogDescription>
              Don&rsquo;t close this window.
            </DialogDescription>
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-lg font-bold">
                <Coins className="size-5 text-accent-brand" />
                Buy credits
              </DialogTitle>
              <DialogDescription>
                1 credit = ₹1. One interview uses{" "}
                {formatCredits(wallet.interviewCost)} credits. Credits go into
                your company&rsquo;s wallet, shared with your HR team.
              </DialogDescription>
            </DialogHeader>

            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              {packs.map((pack, index) => {
                const selected = Number(credits) === pack
                const popular = PACK_INTERVIEWS[index] === POPULAR_PACK
                return (
                  <button
                    key={pack}
                    type="button"
                    onClick={() => setCredits(String(pack))}
                    disabled={busy}
                    className={cn(
                      "relative flex flex-col items-center gap-0.5 rounded-xl border px-2 pt-4 pb-3 text-center transition-all hover:-translate-y-0.5 hover:border-accent-brand/50 hover:shadow-brand",
                      selected
                        ? "border-accent-brand bg-accent-brand-muted ring-2 ring-accent-brand/25"
                        : "bg-background"
                    )}
                  >
                    {popular ? (
                      <span className="absolute -top-2 left-1/2 -translate-x-1/2 rounded-full border border-accent-brand/25 bg-background px-2 py-px text-[0.625rem] font-medium whitespace-nowrap text-accent-brand">
                        Popular
                      </span>
                    ) : null}
                    <span className="text-lg font-bold tabular-nums">
                      {formatCredits(pack)}
                    </span>
                    <span className="text-[0.6875rem] text-muted-foreground">
                      {PACK_INTERVIEWS[index]} interviews
                    </span>
                  </button>
                )
              })}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="buy-credits-amount">Or enter credits</Label>
              <Input
                id="buy-credits-amount"
                type="number"
                inputMode="numeric"
                min={wallet.interviewCost}
                max={MAX_CREDITS}
                step={1}
                value={credits}
                disabled={busy}
                onChange={(event) => setCredits(event.target.value)}
                aria-invalid={credits !== "" && !valid}
              />
              {credits !== "" && !valid ? (
                <p className="text-xs text-destructive">
                  Enter a whole number from{" "}
                  {formatCredits(wallet.interviewCost)} to{" "}
                  {formatCredits(MAX_CREDITS)}.
                </p>
              ) : valid ? (
                <p className="text-xs text-muted-foreground">
                  Enough for {Math.floor(amount / wallet.interviewCost)}{" "}
                  interviews.
                </p>
              ) : null}
            </div>

            <dl className="flex flex-col gap-1.5 rounded-xl bg-muted/50 px-4 py-3 text-sm tabular-nums">
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">
                  {valid ? formatCredits(amount) : 0} credits
                </dt>
                <dd>{formatPaise(basePaise)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">
                  GST ({wallet.gstPercent}%)
                </dt>
                <dd>{formatPaise(gstPaise)}</dd>
              </div>
              <div className="mt-1 flex justify-between gap-4 border-t pt-2 text-base font-semibold">
                <dt>Total</dt>
                <dd>{formatPaise(totalPaise)}</dd>
              </div>
            </dl>

            {failure ? (
              <p
                role="alert"
                className="flex items-start gap-2 rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-400"
              >
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                {failure}
              </p>
            ) : null}

            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <ShieldCheck className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
              Secure payment by Razorpay: UPI, cards and netbanking.
            </p>

            <DialogFooter>
              <Button variant="outline" onClick={close} disabled={busy}>
                Cancel
              </Button>
              <Button onClick={() => void pay()} disabled={!valid || busy}>
                {stage === "ordering" ? (
                  <>
                    <Loader2 className="animate-spin" />
                    Starting payment…
                  </>
                ) : (
                  <>Pay {formatPaise(totalPaise)}</>
                )}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
