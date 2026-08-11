import { ArrowRight, Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

import { Shell } from "./shell"

/**
 * The one-time code, and the way to ask for another.
 *
 * The verifying state is *not* handled here — it replaces this whole card with
 * `PreparingCard`, because verification is a minute of question generation
 * rather than a round trip. That is also why Start has no pending label of its
 * own: it would be unreachable.
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
  /** Which action is in flight, so the spinner lands on the button pressed. */
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
  return (
    <Shell
      logoUrl={logoUrl}
      title={`Hello${name ? `, ${name}` : ""}`}
      description={`Enter the 6-digit code from your invitation email to start your ${role || "interview"}.`}
      footer={
        <>
          <Button variant="ghost" onClick={onResend} disabled={Boolean(busy)}>
            {busy === "resend" ? (
              <>
                <Loader2 className="animate-spin" />
                Sending…
              </>
            ) : (
              "Re-Send OTP"
            )}
          </Button>
          <Button
            onClick={onVerify}
            disabled={Boolean(busy) || otp.trim().length < 4}
          >
            Start
            <ArrowRight data-icon="inline-end" />
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="otp">Access code</Label>
          <Input
            id="otp"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={otp}
            onChange={(event) => onOtpChange(event.target.value)}
            placeholder="123456"
            className="font-mono text-lg tracking-[0.3em]"
          />
        </div>

        {notice ? (
          <p className="text-sm text-emerald-700 dark:text-emerald-400">
            {notice}
          </p>
        ) : null}
        {error ? (
          <p
            role="alert"
            className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {error}
          </p>
        ) : null}
      </div>
    </Shell>
  )
}
