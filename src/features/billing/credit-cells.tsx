import { format, formatDistanceToNow } from "date-fns"
import {
  BadgePlus,
  Gift,
  RotateCcw,
  Send,
  ShoppingCart,
  type LucideIcon,
} from "lucide-react"

import {
  amountEntries,
  currencyName,
  formatAmounts,
  formatMoney,
  TRANSACTION_LABEL,
  type TransactionType,
} from "@/services/billing"
import { cn } from "@/lib/utils"

const TYPE_STYLE: Record<TransactionType, { Icon: LucideIcon; tone: string }> =
  {
    signup_bonus: {
      Icon: Gift,
      tone: "bg-accent-brand-muted text-accent-brand",
    },
    purchase: {
      Icon: ShoppingCart,
      tone: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    },
    interview_charge: {
      Icon: Send,
      tone: "bg-muted text-muted-foreground",
    },
    refund: {
      Icon: RotateCcw,
      tone: "bg-sky-500/10 text-sky-700 dark:text-sky-400",
    },
    grant: {
      Icon: BadgePlus,
      tone: "bg-violet-500/10 text-violet-700 dark:text-violet-400",
    },
  }

export function TypePill({ type }: { type: TransactionType }) {
  const { Icon, tone } = TYPE_STYLE[type] ?? TYPE_STYLE.interview_charge
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
        tone
      )}
    >
      <Icon className="size-3.5" />
      {TRANSACTION_LABEL[type] ?? type}
    </span>
  )
}

/** Date over "3 hours ago", in the viewer's own time zone. */
export function When({ iso }: { iso: string }) {
  const date = new Date(iso)
  return (
    <div className="flex flex-col gap-0.5">
      <span className="whitespace-nowrap">
        {format(date, "d MMM yyyy · HH:mm")}
      </span>
      <span className="text-xs whitespace-nowrap text-muted-foreground">
        {formatDistanceToNow(date, { addSuffix: true })}
      </span>
    </div>
  )
}

/**
 * Money paid in more than one currency, one line each with the currency named:
 * "$1.00 US dollars" over "₹59.00 Indian rupees". The totals are never added
 * together — there is no exchange rate to do it with — and two amounts joined
 * by a dot read as one sum nobody could work out. A single currency is just
 * the amount, as before.
 *
 * Spans throughout, so it can sit inside a `<p>` such as `StatCard`'s value.
 */
export function AmountsByCurrency({
  amounts,
}: {
  amounts: Record<string, number>
}) {
  const entries = amountEntries(amounts)
  if (entries.length <= 1) return <>{formatAmounts(amounts)}</>

  return (
    <span className="flex flex-col gap-0.5">
      {entries.map(([code, minor]) => (
        <span key={code} className="flex items-baseline gap-2">
          <span className="text-2xl">{formatMoney(minor, code)}</span>
          <span className="truncate text-xs font-medium tracking-normal text-muted-foreground">
            {currencyName(code)}
          </span>
        </span>
      ))}
    </span>
  )
}
