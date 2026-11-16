import * as React from "react"
import {
  AlertTriangle,
  ArrowRight,
  Coins,
  ExternalLink,
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
import {
  formatCredits,
  formatMoney,
  useStartCheckout,
  type Wallet,
} from "@/services/billing"
import { cn } from "@/lib/utils"

import { checkoutReturnUrls, rememberPendingCheckout } from "./stripe-checkout"

/** The API's limits, in interviews. */
const MIN_INTERVIEWS = 1
const MAX_INTERVIEWS = 10_000

/** Packs, in interviews: priced from the wallet, so a price change follows. */
const PACK_INTERVIEWS = [1, 5, 10, 25]
const POPULAR_PACK = 10

/** "plus tax for your region, calculated at checkout" — when Stripe adds it. */
export function TaxNote({ wallet }: { wallet: Wallet }) {
  return wallet.taxAddedAtCheckout ? (
    <>plus tax for your region, calculated at checkout</>
  ) : null
}

/**
 * Buys credits through **Stripe Checkout**. Admin only.
 *
 * The admin picks a number of interviews; the server opens a Stripe page for
 * the exact amount, and the browser goes there. Nothing priced here is ever
 * sent — the preview is only a preview, and Stripe charges the server's
 * amount, adding any tax for the buyer's region on its own page.
 *
 * The rest of the purchase happens after the admin comes back: see
 * `CheckoutReturn` on the Billing page.
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
  const checkout = useStartCheckout()
  const [interviews, setInterviews] = React.useState(String(POPULAR_PACK))
  const [failure, setFailure] = React.useState<string | null>(null)
  /** Set once the browser is on its way to Stripe; the dialog stays locked. */
  const [leaving, setLeaving] = React.useState(false)

  const price = wallet.interviewPriceMinor
  const count = Number(interviews)
  const valid =
    Number.isInteger(count) &&
    count >= MIN_INTERVIEWS &&
    count <= MAX_INTERVIEWS
  const credits = valid ? count * wallet.interviewCost : 0
  const subtotal = valid && price !== null ? count * price : 0
  const busy = checkout.isPending || leaving

  const close = () => {
    if (busy) return
    onOpenChange(false)
    setFailure(null)
    setInterviews(String(POPULAR_PACK))
  }

  const pay = async () => {
    if (!valid || busy) return
    setFailure(null)
    try {
      const session = await checkout.mutateAsync({
        credits,
        ...checkoutReturnUrls(),
      })
      rememberPendingCheckout(session.sessionId)
      setLeaving(true)
      // Out of the app: Stripe's page takes the payment and sends us back.
      window.location.assign(session.checkoutUrl)
    } catch (error) {
      setFailure(
        error instanceof Error
          ? error.message
          : "Could not start the payment. Please try again."
      )
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? null : close())}>
      <DialogContent className="sm:max-w-lg" showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg font-bold">
            <Coins className="size-5 text-accent-brand" />
            Buy credits
          </DialogTitle>
          <DialogDescription>
            {price !== null ? (
              <>
                {formatMoney(price, wallet.currency)} per interview (
                {formatCredits(wallet.interviewCost)} credits),{" "}
                <TaxNote wallet={wallet} />. Credits go into your
                company&rsquo;s wallet, shared with your HR team.
              </>
            ) : (
              "Credits go into your company's wallet, shared with your HR team."
            )}
          </DialogDescription>
        </DialogHeader>

        {price === null ? (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            Buying credits isn&rsquo;t available on this server yet. It will be
            after the next backend release.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              {PACK_INTERVIEWS.map((pack) => {
                const selected = count === pack
                return (
                  <button
                    key={pack}
                    type="button"
                    onClick={() => setInterviews(String(pack))}
                    disabled={busy}
                    className={cn(
                      "relative flex flex-col items-center gap-0.5 rounded-xl border px-2 pt-4 pb-3 text-center transition-all hover:-translate-y-0.5 hover:border-accent-brand/50 hover:shadow-brand",
                      selected
                        ? "border-accent-brand bg-accent-brand-muted ring-2 ring-accent-brand/25"
                        : "bg-background"
                    )}
                  >
                    {pack === POPULAR_PACK ? (
                      <span className="absolute -top-2 left-1/2 -translate-x-1/2 rounded-full border border-accent-brand/25 bg-background px-2 py-px text-[0.625rem] font-medium whitespace-nowrap text-accent-brand">
                        Popular
                      </span>
                    ) : null}
                    <span className="text-lg font-bold tabular-nums">
                      {pack}
                    </span>
                    <span className="text-[0.6875rem] text-muted-foreground">
                      {pack === 1 ? "interview" : "interviews"}
                    </span>
                    <span className="mt-1 text-xs font-medium tabular-nums">
                      {formatMoney(pack * price, wallet.currency)}
                    </span>
                  </button>
                )
              })}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="buy-credits-interviews">
                Or enter a number of interviews
              </Label>
              <Input
                id="buy-credits-interviews"
                type="number"
                inputMode="numeric"
                min={MIN_INTERVIEWS}
                max={MAX_INTERVIEWS}
                step={1}
                value={interviews}
                disabled={busy}
                onChange={(event) => setInterviews(event.target.value)}
                aria-invalid={interviews !== "" && !valid}
              />
              {interviews !== "" && !valid ? (
                <p className="text-xs text-destructive">
                  Enter a whole number from {MIN_INTERVIEWS} to{" "}
                  {formatCredits(MAX_INTERVIEWS)}.
                </p>
              ) : null}
            </div>

            <dl className="flex flex-col gap-1.5 rounded-xl bg-muted/50 px-4 py-3 text-sm tabular-nums">
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">
                  {valid ? count : 0} {count === 1 ? "interview" : "interviews"}{" "}
                  · {formatCredits(credits)} credits
                </dt>
                <dd>{formatMoney(subtotal, wallet.currency)}</dd>
              </div>
              {wallet.taxAddedAtCheckout ? (
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Tax</dt>
                  <dd className="text-muted-foreground">
                    Calculated at checkout
                  </dd>
                </div>
              ) : null}
              <div className="mt-1 flex justify-between gap-4 border-t pt-2 text-base font-semibold">
                <dt>{wallet.taxAddedAtCheckout ? "Subtotal" : "Total"}</dt>
                <dd>{formatMoney(subtotal, wallet.currency)}</dd>
              </div>
            </dl>
          </>
        )}

        {failure ? (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-400"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            {failure}
          </p>
        ) : null}

        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <ShieldCheck className="mt-px size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <span>
            You&rsquo;ll pay on Stripe&rsquo;s secure page: cards, Apple Pay and
            Google Pay. Your bank statement shows{" "}
            <span className="font-medium text-foreground">BRAINFX AI INC</span>.
            You come back here once it&rsquo;s done.
          </span>
        </p>

        <DialogFooter>
          <Button variant="outline" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button
            onClick={() => void pay()}
            disabled={!valid || busy || price === null}
          >
            {busy ? (
              <>
                <Loader2 className="animate-spin" />
                {leaving ? "Opening Stripe…" : "Starting payment…"}
              </>
            ) : (
              <>
                Continue to payment
                {price !== null ? <ArrowRight data-icon="inline-end" /> : null}
              </>
            )}
          </Button>
        </DialogFooter>
        {leaving ? (
          <p className="flex items-center justify-end gap-1 text-xs text-muted-foreground">
            <ExternalLink className="size-3" />
            Taking you to Stripe…
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
