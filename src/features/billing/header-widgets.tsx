import * as React from "react"
import { Link } from "react-router-dom"
import { formatDistanceToNow } from "date-fns"
import { Popover } from "@base-ui/react/popover"
import { Bell, CalendarSync, Coins, RotateCcw } from "lucide-react"

import { Button } from "@/components/ui/button"
import { useCurrentUser } from "@/features/auth/auth-context"
import {
  HOLD_REASON_LABEL,
  formatCredits,
  useMarkNotificationRead,
  useNotifications,
  useWallet,
  type BillingNotification,
} from "@/services/billing"
import { cn } from "@/lib/utils"

import { BILLING_PATH } from "./credit-notices"
import { useHeldCreditsChoice } from "./held-credits"

/** Admins and HRs have a wallet and a bell; the super admin has neither. */
function useHasWallet() {
  const user = useCurrentUser()
  return user.role === "admin" || user.role === "hr"
}

/**
 * The balance in the top bar, on every console page.
 *
 * Amber below two interviews' worth, red at none — the point at which sending
 * starts to fail. An admin's chip opens Billing; an HR's explains where credits
 * come from, since they can't buy any.
 *
 * Hidden until the wallet loads, and for good on a deployment without billing.
 */
export function WalletChip() {
  const user = useCurrentUser()
  const wallet = useWallet(useHasWallet())
  if (!wallet.data) return null

  const { balance, interviewsLeft } = wallet.data
  const tone =
    interviewsLeft === 0
      ? "border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-400"
      : interviewsLeft < 2
        ? "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-400"
        : "border-accent-brand/20 bg-accent-brand-muted text-accent-brand"

  const content = (
    <>
      <Coins className="size-3.5 shrink-0" />
      <span className="font-semibold tabular-nums">
        {formatCredits(balance)}
      </span>
      <span className="hidden sm:inline">credits</span>
      <span className="hidden opacity-75 md:inline">
        · {interviewsLeft} {interviewsLeft === 1 ? "interview" : "interviews"}{" "}
        left
      </span>
    </>
  )
  const className = cn(
    "mr-1 inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium whitespace-nowrap transition-colors",
    tone
  )

  if (user.role === "admin") {
    return (
      <Link
        to={BILLING_PATH}
        title="Credits: open Billing to buy more"
        className={cn(className, "hover:brightness-95")}
      >
        {content}
      </Link>
    )
  }
  return (
    <span
      className={className}
      title="Your company's shared credits. Ask your admin to buy more."
    >
      {content}
    </span>
  )
}

/** One notice: what happened, when, and the choice while it is open. */
function NotificationItem({
  notification,
  onRefund,
  onReschedule,
}: {
  notification: BillingNotification
  onRefund: () => void
  onReschedule: () => void
}) {
  const unread = !notification.readAt
  const open = !notification.resolved && notification.interviewId !== null

  return (
    <li
      className={cn(
        "relative flex flex-col gap-2 rounded-xl px-3 py-2.5",
        unread ? "bg-accent-brand-muted/50" : "hover:bg-muted/50"
      )}
    >
      <div className="flex items-center gap-2">
        {notification.reason ? (
          <span className="rounded-full border border-amber-500/25 bg-amber-500/10 px-2 py-px text-[0.6875rem] font-medium text-amber-700 dark:text-amber-400">
            {HOLD_REASON_LABEL[notification.reason]}
          </span>
        ) : null}
        <span className="text-[0.6875rem] text-muted-foreground">
          {formatDistanceToNow(new Date(notification.createdAt), {
            addSuffix: true,
          })}
        </span>
        {unread ? (
          <span
            className="ml-auto size-2 shrink-0 rounded-full bg-brand-pink"
            aria-label="Unread"
          />
        ) : null}
      </div>

      <p className="text-sm leading-snug">{notification.message}</p>

      {open ? (
        <>
          <p className="text-xs text-muted-foreground">
            Its credits are on hold. Do you want a refund, or a new interview
            for the same candidate?
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={onRefund}>
              <RotateCcw />
              Refund credits
            </Button>
            <Button size="sm" onClick={onReschedule}>
              <CalendarSync />
              Reschedule
            </Button>
          </div>
        </>
      ) : notification.resolved ? (
        <p className="text-xs text-muted-foreground">Settled.</p>
      ) : null}
    </li>
  )
}

/**
 * The bell: interviews whose credits went on hold, with the Refund-or-Reschedule
 * choice right in the list. Polls once a minute, since nothing in this browser
 * causes a hold.
 *
 * Opening it marks what it shows as read. Hidden until the first read succeeds,
 * so a deployment without notifications shows no bell rather than a broken one.
 */
export function NotificationsMenu() {
  const feed = useNotifications(useHasWallet())
  const markRead = useMarkNotificationRead()
  const held = useHeldCreditsChoice()
  const [open, setOpen] = React.useState(false)

  if (!feed.data) return null

  const { unread, notifications } = feed.data

  const onOpenChange = (next: boolean) => {
    setOpen(next)
    if (!next) return
    for (const notification of notifications) {
      if (!notification.readAt) markRead.mutate(notification.id)
    }
  }

  // Close first: a dialog opening over a live popover fights it for focus.
  const choose = (pick: "refund" | "reschedule", n: BillingNotification) => {
    setOpen(false)
    const target = {
      interviewId: n.interviewId!,
      candidateName: n.candidateName ?? "the candidate",
    }
    if (pick === "refund") held.refund(target)
    else held.reschedule(target)
  }

  return (
    <>
      <Popover.Root open={open} onOpenChange={onOpenChange}>
        <Popover.Trigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={
                unread > 0 ? `Notifications, ${unread} unread` : "Notifications"
              }
            />
          }
        >
          <span className="relative">
            <Bell />
            {unread > 0 ? (
              <span className="absolute -top-1.5 -right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-pink px-1 text-[0.5625rem] font-bold text-white">
                {unread > 9 ? "9+" : unread}
              </span>
            ) : null}
          </span>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner
            side="bottom"
            align="end"
            sideOffset={6}
            className="isolate z-50 outline-none"
          >
            <Popover.Popup className="flex max-h-[min(32rem,var(--available-height))] w-[min(24rem,calc(100vw-1.5rem))] origin-(--transform-origin) flex-col overflow-hidden rounded-2xl bg-popover text-popover-foreground shadow-brand-lg ring-1 ring-foreground/10 duration-100 outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95">
              <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
                <Popover.Title className="font-heading text-sm font-semibold">
                  Notifications
                </Popover.Title>
                {unread > 0 ? (
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {unread} new
                  </span>
                ) : null}
              </div>

              {notifications.length === 0 ? (
                <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
                  <span className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
                    <Bell className="size-5" />
                  </span>
                  <p className="text-sm font-medium">
                    You&rsquo;re all caught up
                  </p>
                  <p className="text-xs text-muted-foreground">
                    When an interview ends before the candidate starts it, it
                    shows up here.
                  </p>
                </div>
              ) : (
                <ul className="flex flex-col gap-1 overflow-y-auto p-2">
                  {notifications.map((notification) => (
                    <NotificationItem
                      key={notification.id}
                      notification={notification}
                      onRefund={() => choose("refund", notification)}
                      onReschedule={() => choose("reschedule", notification)}
                    />
                  ))}
                </ul>
              )}
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>

      {held.dialogs}
    </>
  )
}
