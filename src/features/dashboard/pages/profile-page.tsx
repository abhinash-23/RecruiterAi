import * as React from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import { LogOut, ShieldCheck } from "lucide-react"
import { toast } from "sonner"
import { z } from "zod"

import { PageHeader } from "@/components/shared/page-header"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { NAVIGATION } from "@/config/navigation"
import { useAuth, useCurrentUser } from "@/features/auth/auth-context"
import { ROLE_LABEL } from "@/features/auth/types"
import { useSignOut } from "@/features/auth/use-sign-out"
import { MIN_PASSWORD_LENGTH } from "@/services/auth-service"

function initials(name: string) {
  return (
    name
      .split(/[\s@.]+/)
      .filter(Boolean)
      .map((part) => part[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?"
  )
}

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password"),
    newPassword: z
      .string()
      .min(MIN_PASSWORD_LENGTH, `Use at least ${MIN_PASSWORD_LENGTH} characters`),
    confirmPassword: z.string().min(1, "Repeat the new password"),
  })
  .refine((values) => values.newPassword === values.confirmPassword, {
    path: ["confirmPassword"],
    message: "Both passwords must match",
  })

type PasswordValues = z.infer<typeof passwordSchema>

/**
 * Change your own password via `POST /api/auth/change-password`.
 *
 * The same endpoint the first-login gate uses; the token survives the change,
 * so there's no forced sign-out afterwards.
 */
function ChangePasswordCard() {
  const { changePassword } = useAuth()
  const [formError, setFormError] = React.useState<string | null>(null)

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<PasswordValues>({
    resolver: zodResolver(passwordSchema),
    defaultValues: {
      currentPassword: "",
      newPassword: "",
      confirmPassword: "",
    },
  })

  const submit = handleSubmit(async (values) => {
    setFormError(null)
    try {
      await changePassword({
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      })
      toast.success("Password updated.")
      reset()
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : "Could not change your password."
      )
    }
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>Change password</CardTitle>
        <CardDescription>
          You&rsquo;ll stay signed in on this device.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          id="change-password"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
          className="flex flex-col gap-4"
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="current-password">Current password</Label>
            <Input
              id="current-password"
              type="password"
              autoComplete="current-password"
              aria-invalid={Boolean(errors.currentPassword)}
              {...register("currentPassword")}
            />
            {errors.currentPassword ? (
              <p className="text-xs text-destructive">
                {errors.currentPassword.message}
              </p>
            ) : null}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-password">New password</Label>
              <Input
                id="new-password"
                type="password"
                autoComplete="new-password"
                aria-invalid={Boolean(errors.newPassword)}
                {...register("newPassword")}
              />
              {errors.newPassword ? (
                <p className="text-xs text-destructive">
                  {errors.newPassword.message}
                </p>
              ) : null}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="confirm-password">Confirm</Label>
              <Input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                aria-invalid={Boolean(errors.confirmPassword)}
                {...register("confirmPassword")}
              />
              {errors.confirmPassword ? (
                <p className="text-xs text-destructive">
                  {errors.confirmPassword.message}
                </p>
              ) : null}
            </div>
          </div>

          {formError ? (
            <p
              role="alert"
              className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {formError}
            </p>
          ) : null}
        </form>
      </CardContent>
      <CardFooter className="justify-end">
        <Button type="submit" form="change-password" disabled={isSubmitting}>
          {isSubmitting ? "Saving…" : "Change password"}
        </Button>
      </CardFooter>
    </Card>
  )
}

/** The signed-in account, what the role can reach, and session controls. */
export function ProfilePage() {
  const user = useCurrentUser()
  const signOut = useSignOut()

  const permissions = NAVIGATION[user.role].flatMap((group) =>
    group.items.map((item) => item.label)
  )

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <PageHeader
        title="Profile"
        description="Your account and what your role can reach."
      />

      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
          <CardDescription>
            Managed by whoever created it — a super admin for admins, an admin
            for HR.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="flex items-center gap-3">
            <Avatar className="size-12">
              <AvatarFallback>{initials(user.name || user.email)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <p className="truncate text-lg font-semibold">
                {user.name || user.email}
              </p>
              <p className="truncate text-sm text-muted-foreground">
                {user.email}
              </p>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <Badge variant="secondary">{ROLE_LABEL[user.role]}</Badge>
                {/* Platform-level accounts belong to no company. */}
                {user.companyName ? (
                  <Badge variant="outline">{user.companyName}</Badge>
                ) : null}
              </div>
            </div>
          </div>

          <Separator />

          <dl className="grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-xs text-muted-foreground">Company</dt>
              <dd className="text-sm">{user.companyName || "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Role</dt>
              <dd className="text-sm">{ROLE_LABEL[user.role]}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Phone</dt>
              <dd className="text-sm">{user.phone || "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">User id</dt>
              <dd className="font-mono text-sm break-all">{user.id}</dd>
            </div>
          </dl>
        </CardContent>
        <CardFooter className="justify-end">
          <Button variant="destructive" onClick={() => void signOut()}>
            <LogOut />
            Log out
          </Button>
        </CardFooter>
      </Card>

      <ChangePasswordCard />

      <Card>
        <CardHeader>
          <CardTitle>What you can reach</CardTitle>
          <CardDescription>
            Shown for orientation only — the server enforces this on every
            request, whatever the UI displays.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {permissions.map((label) => (
            <Badge key={label} variant="outline" className="gap-1.5 font-normal">
              <ShieldCheck className="size-3 text-brand-blue" />
              {label}
            </Badge>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
