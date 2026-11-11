import { Link } from "react-router-dom"
import { AlertTriangle, Coins, ShoppingCart } from "lucide-react"

import { Button } from "@/components/ui/button"
import { useCurrentUser } from "@/features/auth/auth-context"
import { ROLE_HOME } from "@/features/auth/types"
import {
  formatCredits,
  useWallet,
  type CreditShortfall,
} from "@/services/billing"
import { cn } from "@/lib/utils"

/** Where an admin buys credits. */
export const BILLING_PATH = `${ROLE_HOME.admin}/billing`

/** What to do about too few credits, which depends on who is asking. */
function TopUpHint() {
  const user = useCurrentUser()

  if (user.role === "admin") {
    return (
      <Button
        size="sm"
        nativeButton={false}
        render={<Link to={BILLING_PATH} />}
        className="mt-2"
      >
        <ShoppingCart />
        Buy credits
      </Button>
    )
  }
  return <p className="mt-1 text-xs">Ask your admin to buy more credits.</p>
}

/**
 * What an action will cost, against the balance it comes out of — shown in the
 * schedule and send dialogs before anything is spent.
 *
 * Advisory only: the wallet is shared, so another HR can spend it between this
 * read and the click, and the server's 402 is the real check. Too few credits
 * turns the line amber and says so, but blocks nothing.
 *
 * Renders nothing while the wallet is loading, or on a deployment without
 * billing, so the dialogs read exactly as they did before it.
 */
export function CreditCostLine({
  count,
  enabled = true,
  className,
}: {
  /** Interviews this action sends. 0 renders the "no charge" form. */
  count: number
  enabled?: boolean
  className?: string
}) {
  const wallet = useWallet(enabled)
  if (!wallet.data) return null

  const { balance, interviewCost } = wallet.data
  const cost = count * interviewCost
  const short = cost > balance

  return (
    <div
      className={cn(
        "flex flex-col gap-1 rounded-xl border px-3 py-2.5 text-sm",
        short
          ? "border-amber-500/30 bg-amber-500/10"
          : "border-accent-brand/20 bg-accent-brand-muted/60",
        className
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <span className="flex items-center gap-2 font-medium">
          <Coins
            className={cn(
              "size-4 shrink-0",
              short ? "text-amber-600 dark:text-amber-400" : "text-accent-brand"
            )}
          />
          {count === 0 ? (
            "No credits used"
          ) : (
            <span className="tabular-nums">
              {count} {count === 1 ? "interview" : "interviews"} ×{" "}
              {interviewCost} = {formatCredits(cost)} credits
            </span>
          )}
        </span>
        <span className="text-xs text-muted-foreground tabular-nums">
          Balance{" "}
          <span className="font-semibold text-foreground">
            {formatCredits(balance)}
          </span>
          {count > 0 && !short ? (
            <> · {formatCredits(balance - cost)} after</>
          ) : null}
        </span>
      </div>
      {short ? (
        <div className="text-amber-700 dark:text-amber-400">
          <p className="text-xs">
            Not enough credits for this. You need {formatCredits(cost)}.
          </p>
          <TopUpHint />
        </div>
      ) : null}
    </div>
  )
}

/**
 * The server's "not enough credits" refusal: nothing was created or sent. Shows
 * both numbers from the 402, and the way out for this role.
 */
export function ShortfallAlert({ shortfall }: { shortfall: CreditShortfall }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2.5 rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2.5 text-sm text-red-700 dark:text-red-400"
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0">
        <p className="font-medium">Not enough credits. Nothing was sent.</p>
        {shortfall.required !== null && shortfall.balance !== null ? (
          <p className="text-xs tabular-nums">
            This needs {formatCredits(shortfall.required)} credits and the
            wallet has {formatCredits(shortfall.balance)}.
          </p>
        ) : null}
        <TopUpHint />
      </div>
    </div>
  )
}
