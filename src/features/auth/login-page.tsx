import * as React from "react"
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom"
import { zodResolver } from "@hookform/resolvers/zod"
import { motion } from "framer-motion"
import { useForm } from "react-hook-form"
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Eye,
  EyeOff,
  ShieldCheck,
} from "lucide-react"
import { z } from "zod"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

import { useAuth } from "./auth-context"
import { ForgotPasswordPanel } from "./forgot-password-panel"
import { ROLE_HOME, ROLE_LABEL, type Role } from "./types"

const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, "Enter your email")
    .email("Enter a valid email"),
  password: z.string().min(1, "Enter your password"),
})

type LoginValues = z.infer<typeof loginSchema>

const ROLE_BLURB: Record<Role, string> = {
  super_admin:
    "Platform-wide control: tenants, subscriptions, global settings.",
  admin: "Your company: HR seats, candidates, branding, reports.",
  hr: "Day-to-day hiring: invitations, interviews, AI results.",
}

export function LoginPage() {
  const { user, signIn, initializing } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [showPassword, setShowPassword] = React.useState(false)
  const [formError, setFormError] = React.useState<string | null>(null)
  /** The reset flow takes over this panel rather than a route of its own. */
  const [resetting, setResetting] = React.useState(false)
  /** What the reset flow left behind: "sign in with your new password." */
  const [notice, setNotice] = React.useState<string | null>(null)

  const {
    register,
    handleSubmit,
    setValue,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  })

  // Already signed in? Go straight to the right dashboard.
  if (!initializing && user) {
    return <Navigate to={ROLE_HOME[user.role]} replace />
  }

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null)
    try {
      // Calls POST /api/auth/login through `services/auth-service`. What comes
      // back carries the role, and the role picks the dashboard:
      //   super_admin -> /super-admin    admin -> /admin    hr -> /hr
      const signedIn = await signIn(values)

      // A `from` is only honoured when it sits inside this role's own subtree,
      // so a link saved as an Admin can't drop an HR user onto an Admin page.
      const from = (location.state as { from?: string } | null)?.from
      const home = ROLE_HOME[signedIn.role]
      navigate(from?.startsWith(home) ? from : home, { replace: true })
    } catch (error) {
      // `ApiError` messages are already written for the end user.
      setFormError(
        error instanceof Error ? error.message : "Could not sign you in."
      )
    }
  })

  return (
    <div className="grid min-h-svh lg:grid-cols-[1.1fr_1fr]">
      {/* Brand panel */}
      <div className="relative hidden flex-col justify-between overflow-hidden bg-surface-dark p-10 text-white lg:flex">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(0,82,255,0.35),transparent_55%),radial-gradient(circle_at_80%_70%,rgba(255,0,128,0.28),transparent_55%)]" />

        {/* Wordmark only — the lettered square was removed everywhere it
            appeared: here, the console's sidebar, and the interview room. */}
        <Link
          to="/"
          className="relative z-10 text-lg font-extrabold tracking-tight"
        >
          Recruiter<span className="text-brand-pink">AI</span>
        </Link>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="relative z-10 max-w-md"
        >
          <h1 className="font-heading text-4xl leading-tight font-extrabold tracking-tight">
            Talent intelligence,{" "}
            <span className="text-brand-pink">one workspace.</span>
          </h1>
          <p className="mt-4 text-white/70">
            Interviews, resume analysis and hiring decisions in a single audited
            trail — scoped to exactly what your role should see.
          </p>

          <div className="mt-8 flex flex-col gap-3">
            {(Object.keys(ROLE_BLURB) as Role[]).map((role) => (
              <div key={role} className="flex items-start gap-3">
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-brand-pink" />
                <div>
                  <p className="text-sm font-semibold">{ROLE_LABEL[role]}</p>
                  <p className="text-sm text-white/60">{ROLE_BLURB[role]}</p>
                </div>
              </div>
            ))}
          </div>
        </motion.div>

        <p className="relative z-10 text-xs text-white/40">
          © 2026 RecruiterAI. Decisions stay with your team.
        </p>
      </div>

      {/* Form panel */}
      <div className="flex flex-col justify-center bg-background p-6 sm:p-10">
        <div className="mx-auto w-full max-w-sm">
          {/* Only while signing in. The reset panel brings its own way back —
              to this form, which is the step behind it — and two back arrows
              side by side make the reader choose between them before they can
              tell which one leaves the flow. */}
          {!resetting ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate("/")}
              className="mb-6 -ml-2 text-muted-foreground"
            >
              <ArrowLeft />
              Back to site
            </Button>
          ) : null}

          {/* The reset flow replaces this panel — the brand half of the page
              stays put, and the email already typed comes with it. */}
          {resetting ? (
            <ForgotPasswordPanel
              initialEmail={getValues("email")}
              onCancel={() => setResetting(false)}
              onDone={(message, email) => {
                setResetting(false)
                setFormError(null)
                setNotice(message)
                // Their password is new, so only the address is worth keeping;
                // every session was revoked server-side anyway.
                setValue("email", email)
                setValue("password", "")
              }}
            />
          ) : (
            <>
              <h2 className="font-heading text-2xl font-semibold tracking-tight">
                Sign in
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                We&rsquo;ll take you to the workspace for your role.
              </p>

              {notice ? (
                <div
                  role="status"
                  className="mt-4 flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm"
                >
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                  {notice}
                </div>
              ) : null}

              <form
                onSubmit={(event) => {
                  event.preventDefault()
                  void onSubmit()
                }}
                className="mt-6 flex flex-col gap-4"
              >
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="login-email">Work email</Label>
                  <Input
                    id="login-email"
                    type="email"
                    autoComplete="email"
                    placeholder="you@company.com"
                    aria-invalid={Boolean(errors.email)}
                    {...register("email")}
                  />
                  {errors.email ? (
                    <p className="text-xs text-destructive">
                      {errors.email.message}
                    </p>
                  ) : null}
                </div>

                <div className="flex flex-col gap-1.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <Label htmlFor="login-password">Password</Label>
                    {/* Beside the field it is about, which is where someone looks
                    when the one they typed didn't work. */}
                    <Button
                      type="button"
                      variant="link"
                      onClick={() => {
                        setNotice(null)
                        setFormError(null)
                        setResetting(true)
                      }}
                      className="h-auto p-0 text-xs"
                    >
                      Forgot password?
                    </Button>
                  </div>
                  <div className="relative">
                    <Input
                      id="login-password"
                      type={showPassword ? "text" : "password"}
                      autoComplete="current-password"
                      placeholder="••••••••"
                      aria-invalid={Boolean(errors.password)}
                      className="pr-9"
                      {...register("password")}
                    />
                    {/* The positioning lives on this wrapper, and the button carries
                    none of it. `Button` presses with `active:translate-y-px`,
                    and in Tailwind v4 both that and `-translate-y-1/2` compile
                    to the same `translate` property — so a centred button
                    *replaced* its own centring on mousedown and the eye jumped
                    half its height and back. Centred here by `inset-y-0` and a
                    grid instead of a translate, so the two can never collide
                    again. Same trap as the landing page's Live Preview tab. */}
                    <span className="absolute inset-y-0 right-1 grid place-items-center">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={
                          showPassword ? "Hide password" : "Show password"
                        }
                        onClick={() => setShowPassword((value) => !value)}
                      >
                        {showPassword ? <EyeOff /> : <Eye />}
                      </Button>
                    </span>
                  </div>
                  {errors.password ? (
                    <p className="text-xs text-destructive">
                      {errors.password.message}
                    </p>
                  ) : null}
                </div>

                {formError ? (
                  <div
                    role="alert"
                    className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                  >
                    {formError}
                  </div>
                ) : null}

                <Button
                  type="submit"
                  disabled={isSubmitting}
                  className="mt-1 h-9"
                >
                  {isSubmitting ? "Signing in…" : "Sign in"}
                  {!isSubmitting ? <ArrowRight data-icon="inline-end" /> : null}
                </Button>
              </form>

              {/* Quick fill for the shared dev backend. `import.meta.env.DEV` is
              replaced with `false` at build time, so this whole block — and the
              credentials in it — is dropped from the production bundle. */}
              {/* {import.meta.env.DEV ? (
            <Card className="mt-8 gap-3 bg-muted/40 p-4 py-4">
              <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                Development accounts
              </p>
              <div className="flex flex-col gap-2">
                {DEV_ACCOUNTS.map((account) => (
                  <button
                    key={account.email}
                    type="button"
                    onClick={() => applyDemo(account.email, account.password)}
                    className={cn(
                      "flex items-center justify-between gap-3 rounded-lg bg-background px-3 py-2 text-left text-sm ring-1 ring-foreground/10 transition-colors",
                      "hover:bg-brand-blue/5 hover:ring-brand-blue/30"
                    )}
                  >
                    <span className="min-w-0">
                      <span className="block font-medium">{account.label}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {account.email}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs text-brand-blue">Use</span>
                  </button>
                ))}
              </div>
            </Card>
          ) : null} */}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
