import * as React from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import { ArrowLeft, ArrowRight, Eye, EyeOff, Mail } from "lucide-react"
import { z } from "zod"

import { OtpInput } from "@/components/shared/otp-input"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  confirmPasswordReset,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  requestPasswordReset,
  RESET_CODE_MINUTES,
  RESET_CODE_SENT_MESSAGE,
} from "@/services/auth-service"
import { ApiError } from "@/services/http-client"

/** What `forgot-password/confirm` expects. Also the number of boxes. */
const CODE_LENGTH = 6

/**
 * How long Resend stays shut after a press.
 *
 * The endpoint answers 429 on the fourth request for one address inside ten
 * minutes, and that ceiling is shared with every earlier attempt — so someone
 * pressing this four times can lock themselves out of the only recovery the
 * screen offers. A minute is also roughly how long an email takes to arrive,
 * which is usually what the second press was really for.
 */
const RESEND_COOLDOWN_SECONDS = 60

const emailSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, "Enter your email")
    .email("Enter a valid email"),
})

const resetSchema = z
  .object({
    password: z
      .string()
      // Both ends match the server, which answers 422 outside them. Checked
      // here so the reader is told before spending their single-use code.
      .min(
        MIN_PASSWORD_LENGTH,
        `Use at least ${MIN_PASSWORD_LENGTH} characters`
      )
      .max(
        MAX_PASSWORD_LENGTH,
        `Use at most ${MAX_PASSWORD_LENGTH} characters`
      ),
    confirmPassword: z.string().min(1, "Repeat the new password"),
  })
  .refine((values) => values.password === values.confirmPassword, {
    path: ["confirmPassword"],
    message: "Both passwords must match",
  })

type EmailValues = z.infer<typeof emailSchema>
type ResetValues = z.infer<typeof resetSchema>

/** `59` → `00:59`. */
function countdown(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
}

/**
 * A password field with its own show/hide toggle.
 *
 * The same shape as the one in `change-password-gate`, and deliberately not
 * shared with it: that one is typed to its own form's values, and a generic
 * wrapper over `register` costs more than the twenty lines it saves.
 */
function PasswordField({
  id,
  label,
  hint,
  error,
  registration,
}: {
  id: string
  label: string
  hint?: string
  error?: string
  registration: ReturnType<ReturnType<typeof useForm<ResetValues>>["register"]>
}) {
  const [visible, setVisible] = React.useState(false)

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          type={visible ? "text" : "password"}
          autoComplete="new-password"
          aria-invalid={Boolean(error)}
          className="pr-9"
          {...registration}
        />
        {/* Positioned by this wrapper, never by the button — same trap as the
            login form: a centred `Button` and its own `active:translate-y-px`
            write the same `translate` property in Tailwind v4, so pressing it
            dropped the icon half its height. */}
        <span className="absolute inset-y-0 right-1 grid place-items-center">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={visible ? `Hide ${label}` : `Show ${label}`}
            onClick={() => setVisible((value) => !value)}
          >
            {visible ? <EyeOff /> : <Eye />}
          </Button>
        </span>
      </div>
      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  )
}

/**
 * Self-service password reset for staff — super admin, admin and HR, who share
 * one login. **Not** for candidates: they have no account and no password, and
 * their `verify-otp` code belongs to a different, domain-separated scheme.
 *
 * Two steps, in place of the sign-in form rather than on a route of their own:
 * nothing here is worth linking to or coming back to, and a reset that leaves
 * the page loses the email the reader has already typed.
 *
 * **The first step's reply is deliberately uninformative.** `forgot-password`
 * answers identically for an address with an account, one that is disabled and
 * one that never existed — so that this form can't be used to discover which
 * staff emails are real. This screen therefore advances to the code step every
 * time and never says whether anything was sent; see
 * `RESET_CODE_SENT_MESSAGE`.
 *
 * @param onDone Called with a sentence for the sign-in form to show, once the
 *   password has been set. Every session was revoked server-side, so signing in
 *   again is the only way on from here.
 */
export function ForgotPasswordPanel({
  initialEmail,
  onDone,
  onCancel,
}: {
  /** Whatever they had already typed into the sign-in form. */
  initialEmail: string
  onDone: (message: string, email: string) => void
  onCancel: () => void
}) {
  const [sentTo, setSentTo] = React.useState<string | null>(null)
  const [code, setCode] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [cooldown, setCooldown] = React.useState(0)
  const [resending, setResending] = React.useState(false)

  // A chain of one-second timeouts rather than an interval: the value it reads
  // is the one this render was given, so there is no stale counter to reason
  // about, and it stops itself at zero.
  React.useEffect(() => {
    if (cooldown <= 0) return
    const timer = window.setTimeout(() => setCooldown(cooldown - 1), 1000)
    return () => window.clearTimeout(timer)
  }, [cooldown])

  const emailForm = useForm<EmailValues>({
    resolver: zodResolver(emailSchema),
    defaultValues: { email: initialEmail },
  })

  const resetForm = useForm<ResetValues>({
    resolver: zodResolver(resetSchema),
    defaultValues: { password: "", confirmPassword: "" },
  })

  /* ------------------------------------------------------------- step 1 -- */

  const askForCode = async (email: string) => {
    setError(null)
    try {
      await requestPasswordReset(email)
      setCooldown(RESEND_COOLDOWN_SECONDS)
      setSentTo(email.trim().toLowerCase())
    } catch (caught) {
      // 429 is the one thing this endpoint *will* tell us apart, and it is worth
      // saying plainly: the wait is minutes, and pressing again makes it worse.
      const throttled = caught instanceof ApiError && caught.status === 429
      if (throttled) {
        /* Advance anyway. A 429 means three codes have already been emailed for
           this address, so the reader very likely has a usable one in front of
           them — holding them on the email step would be refusing to accept the
           code we just told them we sent. */
        setSentTo(email.trim().toLowerCase())
      }
      setError(
        throttled
          ? "Too many reset requests. Please wait a few minutes before asking for another — if a code has already arrived, you can still use it below."
          : caught instanceof Error
            ? caught.message
            : "Could not send a reset code."
      )
    }
  }

  const submitEmail = emailForm.handleSubmit((values) =>
    askForCode(values.email)
  )

  const resend = async () => {
    if (!sentTo || cooldown > 0 || resending) return
    setResending(true)
    // Started on the press, not on the reply: a rejected send is exactly the
    // case that must not be retried at once, since a 429 means the ceiling is
    // already reached and hammering it keeps it that way.
    setCooldown(RESEND_COOLDOWN_SECONDS)
    try {
      await askForCode(sentTo)
    } finally {
      setResending(false)
    }
  }

  /* ------------------------------------------------------------- step 2 -- */

  const submitReset = resetForm.handleSubmit(async (values) => {
    if (!sentTo) return
    setError(null)

    if (code.length !== CODE_LENGTH) {
      setError(`Enter the ${CODE_LENGTH}-digit code from the email.`)
      return
    }

    try {
      await confirmPasswordReset({
        email: sentTo,
        code,
        newPassword: values.password,
      })
      onDone("Password reset. Sign in with your new password.", sentTo)
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 400) {
        /* Wrong code, expired code, one already spent, an unknown address, a
           disabled account — the server makes all of these one answer on
           purpose, so there is exactly one thing to say. The code is single-use,
           so a second try with the same digits cannot work either: the way
           forward is a new one. */
        setError("Invalid or expired code. Request a new code and try again.")
        setCode("")
        return
      }
      if (caught instanceof ApiError && caught.status === 429) {
        setError("Too many attempts. Please wait a few minutes and try again.")
        return
      }
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not reset the password."
      )
    }
  })

  /* ------------------------------------------------------------- render -- */

  const back = (
    <Button
      variant="ghost"
      size="sm"
      onClick={onCancel}
      className="-ml-2 self-start text-muted-foreground"
    >
      <ArrowLeft />
      Back to sign in
    </Button>
  )

  const problem = error ? (
    <div
      role="alert"
      className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
    >
      {error}
    </div>
  ) : null

  if (!sentTo) {
    return (
      <>
        {back}

        <h2 className="mt-6 font-heading text-2xl font-semibold tracking-tight">
          Reset your password
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          We&rsquo;ll email you a {CODE_LENGTH}-digit code. It works for any
          staff account — super admin, admin or HR.
        </p>

        <form
          onSubmit={(event) => {
            event.preventDefault()
            void submitEmail()
          }}
          className="mt-6 flex flex-col gap-4"
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="reset-email">Work email</Label>
            <Input
              id="reset-email"
              type="email"
              autoComplete="email"
              placeholder="you@company.com"
              autoFocus
              aria-invalid={Boolean(emailForm.formState.errors.email)}
              {...emailForm.register("email")}
            />
            {emailForm.formState.errors.email ? (
              <p className="text-xs text-destructive">
                {emailForm.formState.errors.email.message}
              </p>
            ) : null}
          </div>

          {problem}

          <Button
            type="submit"
            disabled={emailForm.formState.isSubmitting}
            className="mt-1 h-9"
          >
            {emailForm.formState.isSubmitting ? "Sending…" : "Send reset code"}
            {!emailForm.formState.isSubmitting ? (
              <ArrowRight data-icon="inline-end" />
            ) : null}
          </Button>
        </form>
      </>
    )
  }

  return (
    <>
      {back}

      <h2 className="mt-6 font-heading text-2xl font-semibold tracking-tight">
        Enter the code
      </h2>
      {/* The neutral sentence, verbatim from the service. Anything more specific
          would be this form reporting whether an account exists. */}
      <p className="mt-1 flex items-start gap-2 text-sm text-muted-foreground">
        <Mail className="mt-0.5 size-4 shrink-0" />
        <span>
          {RESET_CODE_SENT_MESSAGE} Check the inbox for{" "}
          <span className="font-medium text-foreground">{sentTo}</span>.
        </span>
      </p>

      <form
        onSubmit={(event) => {
          event.preventDefault()
          void submitReset()
        }}
        className="mt-6 flex flex-col gap-4"
      >
        <div className="flex flex-col gap-2">
          <Label htmlFor="reset-code">Reset code</Label>
          {/* The same component the candidate's interview code uses: paste,
              autofill, backspace and Enter all behave the same way in both
              places. The two *codes* have nothing to do with each other — they
              are separate schemes, and neither works in the other's place. */}
          <OtpInput
            id="reset-code"
            length={CODE_LENGTH}
            value={code}
            onChange={setCode}
            invalid={Boolean(error)}
            autoFocus
          />
        </div>

        <PasswordField
          id="reset-password"
          label="New password"
          hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
          error={resetForm.formState.errors.password?.message}
          registration={resetForm.register("password")}
        />

        <PasswordField
          id="reset-password-confirm"
          label="Repeat new password"
          error={resetForm.formState.errors.confirmPassword?.message}
          registration={resetForm.register("confirmPassword")}
        />

        {problem}

        <Button
          type="submit"
          disabled={resetForm.formState.isSubmitting}
          className="mt-1 h-9"
        >
          {resetForm.formState.isSubmitting ? "Resetting…" : "Reset password"}
        </Button>

        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs">
          <span className="text-muted-foreground">
            {cooldown > 0 ? (
              <>
                Resend available in{" "}
                <span className="font-medium text-foreground tabular-nums">
                  {countdown(cooldown)}
                </span>
              </>
            ) : (
              `The code lasts about ${RESET_CODE_MINUTES} minutes.`
            )}
          </span>

          <span className="flex items-center gap-1 text-muted-foreground">
            Didn&rsquo;t get it?
            <Button
              type="button"
              variant="link"
              onClick={() => void resend()}
              disabled={cooldown > 0 || resending}
              className="h-auto p-0 text-xs"
            >
              {resending ? "Sending…" : "Resend code"}
            </Button>
          </span>
        </div>
      </form>
    </>
  )
}
