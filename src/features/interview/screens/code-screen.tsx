import * as React from "react"
import { Loader2 } from "lucide-react"

import { OtpInput } from "@/components/shared/otp-input"
import { Button } from "@/components/ui/button"

import { Shell } from "./shell"

/** What `verify-otp` expects. Also the number of boxes. */
const OTP_LENGTH = 6

/**
 * How long the Resend link stays shut after a press.
 *
 * `resend-otp` answers 429 after three sends in ten minutes, and that ceiling is
 * shared with every earlier attempt on the same interview — so a candidate who
 * taps a live link four times can lock themselves out of the one recovery this
 * screen offers. A minute between presses is also roughly how long an email
 * takes to arrive, which is usually what the second press was really for.
 */
const RESEND_COOLDOWN_SECONDS = 60

/** `59` → `00:59`. */
function countdown(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
}

/**
 * The one-time code, and the way to ask for another.
 *
 * The verifying state is *not* handled here — it replaces this whole card with
 * `PreparingCard`, because verification is a minute of question generation
 * rather than a round trip. That is also why Verify has no pending label of its
 * own: it would be unreachable.
 *
 * **The code is never submitted automatically**, though the last box knows when
 * it has been filled. `verify-otp` is one-shot and rate-limited, and it spends
 * the better part of a minute writing the question set — so a mistyped digit is
 * expensive in a way that a normal OTP form's is not. The candidate gets the
 * beat before pressing Verify in which to read back what they typed.
 */
export function CodeScreen({
  logoUrl,
  name,
  role,
  otp,
  onOtpChange,
  onVerify,
  onResend,
  busy,
  notice,
  error,
}: {
  logoUrl: string | null
  name: string
  role: string
  otp: string
  onOtpChange: (next: string) => void
  onVerify: () => void
  onResend: () => void
  /**
   * Which of this screen's own two actions is in flight — the only ones that can
   * be, since it is the first screen. Typed as its own pair rather than sharing
   * the page's wider action union: everything past the code is a stage this
   * screen is no longer on, and a `disabled` driven by one of those would be a
   * bug wearing a valid type.
   */
  busy: "verify" | "resend" | null
  notice: string | null
  error: string | null
}) {
  const [cooldown, setCooldown] = React.useState(0)

  // A chain of one-second timeouts rather than an interval: the value it reads
  // is the one this render was given, so there is no stale-closure counter to
  // reason about, and it stops itself at zero.
  React.useEffect(() => {
    if (cooldown <= 0) return
    const timer = window.setTimeout(() => setCooldown(cooldown - 1), 1000)
    return () => window.clearTimeout(timer)
  }, [cooldown])

  const resend = () => {
    // Started on the press, not on the reply. A rejected send is exactly the
    // case that must not be retried immediately — a 429 means the ceiling is
    // already reached, and hammering it keeps it that way.
    setCooldown(RESEND_COOLDOWN_SECONDS)
    onResend()
  }

  const waiting = cooldown > 0
  const complete = otp.length === OTP_LENGTH

  return (
    <Shell
      logoUrl={logoUrl}
      title="OTP verification"
      description={`${name ? `Hi ${name}, please enter` : "Please enter"} the ${OTP_LENGTH}-digit code (one-time password) sent to your email to start your ${role || "interview"}.`}
      footer={
        <Button
          className="w-full"
          onClick={onVerify}
          disabled={!complete || Boolean(busy)}
        >
          Verify
        </Button>
      }
    >
      {/* A form so Enter submits from any box — the code is typed, and the hand
          is already on the keyboard. */}
      <form
        onSubmit={(event) => {
          event.preventDefault()
          if (complete && !busy) onVerify()
        }}
        className="flex flex-col gap-3"
      >
        <OtpInput
          id="otp"
          length={OTP_LENGTH}
          value={otp}
          onChange={onOtpChange}
          // Deliberately typeable through a resend — the only thing `busy` can
          // be here. Freezing the boxes because a fresh code is on its way would
          // interrupt a candidate part-way through typing the one they already
          // have, which is often the one that works.
          //
          // Red only once the server has rejected something: marking the boxes
          // for a half-typed code would be telling the candidate they are wrong
          // while they are still right.
          invalid={Boolean(error)}
          autoFocus
          aria-describedby={error ? "otp-error" : undefined}
        />

        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs">
          {/* Left slot only while it is counting: an empty "Remaining time"
              would be a timer that had run out of something, when nothing here
              expires — the link's own window is hours long and lives on the
              server. */}
          <span className="text-muted-foreground">
            {waiting ? (
              <>
                Resend available in{" "}
                <span className="font-medium tabular-nums text-foreground">
                  {countdown(cooldown)}
                </span>
              </>
            ) : null}
          </span>

          <span className="flex items-center gap-1 text-muted-foreground">
            Didn&rsquo;t get the code?
            <Button
              type="button"
              variant="link"
              onClick={resend}
              disabled={waiting || Boolean(busy)}
              className="h-auto p-0 text-xs"
            >
              {busy === "resend" ? (
                <>
                  <Loader2 className="animate-spin" />
                  Sending…
                </>
              ) : (
                "Resend"
              )}
            </Button>
          </span>
        </div>

        {notice ? (
          <p className="text-sm text-emerald-700 dark:text-emerald-400">
            {notice}
          </p>
        ) : null}
        {error ? (
          <p
            id="otp-error"
            role="alert"
            className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {error}
          </p>
        ) : null}
      </form>
    </Shell>
  )
}
