import * as React from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import { ArrowRight, Eye, EyeOff, KeyRound } from "lucide-react"
import { z } from "zod"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { MIN_PASSWORD_LENGTH } from "@/services/auth-service"

import { useAuth } from "./auth-context"

const schema = z
  .object({
    currentPassword: z.string().min(1, "Enter the password you signed in with"),
    newPassword: z
      .string()
      // Matches the server, which returns 422 below this length.
      .min(
        MIN_PASSWORD_LENGTH,
        `Use at least ${MIN_PASSWORD_LENGTH} characters`
      ),
    confirmPassword: z.string().min(1, "Repeat the new password"),
  })
  .refine((values) => values.newPassword === values.confirmPassword, {
    path: ["confirmPassword"],
    message: "Both passwords must match",
  })

type Values = z.infer<typeof schema>

/** A password field with its own show/hide toggle. */
function PasswordField({
  id,
  label,
  autoComplete,
  error,
  registration,
}: {
  id: string
  label: string
  autoComplete: string
  error?: string
  registration: ReturnType<ReturnType<typeof useForm<Values>>["register"]>
}) {
  const [visible, setVisible] = React.useState(false)

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          aria-invalid={Boolean(error)}
          className="pr-9"
          {...registration}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={visible ? `Hide ${label}` : `Show ${label}`}
          onClick={() => setVisible((value) => !value)}
          className="absolute top-1/2 right-1 -translate-y-1/2"
        >
          {visible ? <EyeOff /> : <Eye />}
        </Button>
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  )
}

/**
 * Shown in place of the dashboard while `user.mustChangePassword` is true.
 *
 * This is a hard gate, not a nudge, because the server makes it one: until the
 * password is replaced it answers **403 to every endpoint except `/auth/me`**.
 * Letting someone through would show them a dashboard where every panel failed
 * to load, with no explanation.
 *
 * Every newly created admin and HR user lands here on their first sign-in.
 */
export function ChangePasswordGate() {
  const { user, changePassword, signOut } = useAuth()
  const [formError, setFormError] = React.useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      currentPassword: "",
      newPassword: "",
      confirmPassword: "",
    },
  })

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null)
    try {
      await changePassword({
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      })
      // No redirect needed: clearing the flag re-renders the real dashboard.
    } catch (error) {
      setFormError(
        error instanceof Error
          ? error.message
          : "Could not change your password."
      )
    }
  })

  return (
    <div className="flex min-h-svh items-center justify-center bg-muted/30 p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <span className="flex size-9 items-center justify-center rounded-lg bg-brand-blue/10 text-brand-blue">
            <KeyRound className="size-4" />
          </span>
          <CardTitle>Choose a new password</CardTitle>
          <CardDescription>
            {user?.email} was set up with a temporary password. Replace it to
            reach your workspace.
          </CardDescription>
        </CardHeader>

        <CardContent>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              void onSubmit()
            }}
            className="flex flex-col gap-4"
          >
            <PasswordField
              id="current-password"
              label="Temporary password"
              autoComplete="current-password"
              error={errors.currentPassword?.message}
              registration={register("currentPassword")}
            />
            <PasswordField
              id="new-password"
              label="New password"
              autoComplete="new-password"
              error={errors.newPassword?.message}
              registration={register("newPassword")}
            />
            <PasswordField
              id="confirm-password"
              label="Confirm new password"
              autoComplete="new-password"
              error={errors.confirmPassword?.message}
              registration={register("confirmPassword")}
            />

            {formError ? (
              <div
                role="alert"
                className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              >
                {formError}
              </div>
            ) : null}

            <Button type="submit" disabled={isSubmitting} className="mt-1 h-9">
              {isSubmitting ? "Saving…" : "Set password and continue"}
              {!isSubmitting ? <ArrowRight data-icon="inline-end" /> : null}
            </Button>

            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={() => void signOut()}
            >
              Sign out instead
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
