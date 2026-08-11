import * as React from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import { Camera, LogOut, Pencil, ShieldCheck, Trash2, Upload } from "lucide-react"
import { toast } from "sonner"
import { z } from "zod"

import { PageHeader } from "@/components/shared/page-header"
import { UserAvatar } from "@/components/shared/user-avatar"
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { NAVIGATION } from "@/config/navigation"
import { useAuth, useCurrentUser } from "@/features/auth/auth-context"
import { ROLE_LABEL } from "@/features/auth/types"
import { useSignOut } from "@/features/auth/use-sign-out"
import { MIN_PASSWORD_LENGTH } from "@/services/auth-service"
import {
  canEditOwnProfile,
  PROFILE_PICTURE,
  useOwnProfileMutation,
} from "@/services/profile"

/**
 * The account card: who you are, what you can change, and the way out.
 *
 * One card, not two. The picture and the display name are the only things on
 * this screen the user owns, and they sit *on* the identity they describe —
 * lifting them into a separate "You" card put the same name and picture on
 * screen twice and implied two different saves.
 *
 * The picture saves on pick; the name opens an inline editor. That split is
 * deliberate: nobody chooses a file and then expects to confirm it, and nobody
 * wants a name saved halfway through typing it.
 */
function AccountCard() {
  const user = useCurrentUser()
  const signOut = useSignOut()

  // Every role gets this card; only two have a profile door behind it.
  const editable = canEditOwnProfile(user.role)
  const save = useOwnProfileMutation(user.role)

  const [editing, setEditing] = React.useState(false)
  const [photoOpen, setPhotoOpen] = React.useState(false)
  const [name, setName] = React.useState(user.name)
  const [fileError, setFileError] = React.useState<string | null>(null)
  const [removing, setRemoving] = React.useState(false)
  const fileRef = React.useRef<HTMLInputElement>(null)

  /**
   * Re-seeds the editor when the session's name changes underneath it — a save
   * landing, or another tab editing the same account. Closing on the way is what
   * makes a successful save dismiss the editor without a callback.
   *
   * React's own "adjust state when a prop changes" pattern: compare against a
   * second piece of state during render. A ref would read more naturally and is
   * explicitly disallowed — refs aren't for values the render depends on.
   */
  const [sessionName, setSessionName] = React.useState(user.name)
  if (sessionName !== user.name) {
    setSessionName(user.name)
    setName(user.name)
    setEditing(false)
  }

  const take = (file: File | undefined) => {
    if (!file) return

    // Checked here as well as by the server, which inspects the real file bytes:
    // a 415 on a renamed `.png` is accurate but says nothing actionable.
    if (!PROFILE_PICTURE.accept.split(",").includes(file.type)) {
      setFileError("Pick a PNG, JPEG, WebP or GIF. SVG isn't accepted here.")
      return
    }
    if (file.size > PROFILE_PICTURE.maxBytes) {
      setFileError(
        `${file.name} is over ${PROFILE_PICTURE.maxBytes / 1024 / 1024} MB.`
      )
      return
    }

    setFileError(null)
    save.mutate({ file })
  }

  const trimmed = name.trim()
  const nameChanged = trimmed.length > 0 && trimmed !== user.name

  return (
    <Card>
      <CardHeader>
        <CardTitle>Account</CardTitle>
        <CardDescription>
          {editable
            ? "Your picture and display name are yours to change. Email, role and company are set by whoever created the account."
            : "Managed by whoever created it — a super admin for admins, an admin for HR."}
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-5">
        <div className="flex flex-wrap items-start gap-4">
          {/* The picture is its own control, not a label beside two buttons: it
              is the thing being edited, so clicking it is the obvious way in,
              and the hover state is what says so before anyone tries. */}
          {editable ? (
            <button
              type="button"
              onClick={() => setPhotoOpen(true)}
              aria-label="Change your profile photo"
              className="group relative shrink-0 rounded-full focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none"
            >
              <UserAvatar
                name={user.name || user.email}
                pictureUrl={user.avatarUrl}
                className="size-16"
                textClassName="text-lg"
              />
              {/* Keyboard users get it on focus too — a hover-only affordance
                  is invisible to them and to a touch screen. */}
              <span className="absolute inset-0 grid place-items-center rounded-full bg-black/55 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                <Camera className="size-5" />
              </span>
            </button>
          ) : (
            <UserAvatar
              name={user.name || user.email}
              pictureUrl={user.avatarUrl}
              className="size-16"
              textClassName="text-lg"
            />
          )}

          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            {editing ? (
              <div className="flex flex-wrap items-center gap-2">
                <Label htmlFor="profile-full-name" className="sr-only">
                  Display name
                </Label>
                <Input
                  id="profile-full-name"
                  autoFocus
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  disabled={save.isPending}
                  aria-invalid={trimmed.length === 0}
                  className="max-w-56"
                />
                <Button
                  size="sm"
                  disabled={!nameChanged || save.isPending}
                  onClick={() => save.mutate({ fullName: trimmed })}
                >
                  {save.isPending ? "Saving…" : "Save"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={save.isPending}
                  onClick={() => {
                    setName(user.name)
                    setEditing(false)
                  }}
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <div className="flex min-w-0 items-center gap-1">
                <p className="truncate text-lg font-semibold">
                  {user.name || user.email}
                </p>
                {editable ? (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Edit display name"
                    onClick={() => setEditing(true)}
                    className="shrink-0 text-muted-foreground"
                  >
                    <Pencil />
                  </Button>
                ) : null}
              </div>
            )}

            {trimmed.length === 0 ? (
              <p className="text-xs text-destructive">
                A display name can&rsquo;t be blank.
              </p>
            ) : null}

            <p className="truncate text-sm text-muted-foreground">
              {user.email}
            </p>

            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant="secondary">{ROLE_LABEL[user.role]}</Badge>
              {/* Platform-level accounts belong to no company. */}
              {user.companyName ? (
                <Badge variant="outline">{user.companyName}</Badge>
              ) : null}
            </div>
          </div>

          <input
            ref={fileRef}
            type="file"
            className="hidden"
            accept={PROFILE_PICTURE.accept}
            disabled={save.isPending}
            onChange={(event) => {
              take(event.target.files?.[0])
              // Let the same file be re-picked after a failed attempt.
              event.target.value = ""
            }}
          />
        </div>

        <Separator />

        <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
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

      {/* The photo at the size it's actually judged at, with its two actions
          under it. A 64px avatar in a form row is too small to tell whether the
          crop is right, which is the one thing anyone opens this to check. */}
      <Dialog open={photoOpen} onOpenChange={setPhotoOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Profile photo</DialogTitle>
            <DialogDescription>
              Shown beside your name everywhere in the console.
            </DialogDescription>
          </DialogHeader>

          <div className="grid place-items-center py-2">
            <UserAvatar
              name={user.name || user.email}
              pictureUrl={user.avatarUrl}
              className="size-56"
              textClassName="text-6xl"
            />
          </div>

          {fileError ? (
            <p role="alert" className="text-center text-sm text-destructive">
              {fileError}
            </p>
          ) : (
            <p className="text-center text-xs text-muted-foreground">
              PNG, JPEG, WebP or GIF · up to{" "}
              {PROFILE_PICTURE.maxBytes / 1024 / 1024} MB. Saved as soon as you
              choose a file.
            </p>
          )}

          {/* Delete on the far left, away from the action anyone came here to
              use — the two are one mis-click apart otherwise. */}
          <div className="flex items-center justify-between gap-2 border-t pt-3">
            <Button
              variant="ghost"
              disabled={!user.avatarUrl || save.isPending}
              onClick={() => {
                setRemoving(true)
                save
                  .mutateAsync({ removePicture: true })
                  // Closes only on success: a failure has a message to read, and
                  // it is in this dialog.
                  .then(() => setPhotoOpen(false))
                  // `finally`, not `then`: a failed removal must also let go of
                  // the flag, or the label sticks on "Removing…".
                  .catch(() => undefined)
                  .finally(() => setRemoving(false))
              }}
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 />
              {removing ? "Removing…" : "Delete"}
            </Button>

            <Button
              disabled={save.isPending}
              onClick={() => fileRef.current?.click()}
            >
              <Upload />
              {save.isPending && !removing
                ? "Uploading…"
                : user.avatarUrl
                  ? "Update"
                  : "Upload"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
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
          {/* All three in one grid: a password field the width of the page is
              harder to read than three side by side, and the labels keep the
              current one distinct from the new one. */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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

  const permissions = NAVIGATION[user.role].flatMap((group) =>
    group.items.map((item) => item.label)
  )

  return (
    // Full width, like every other page in the console — the layout's own
    // `max-w-[1400px]` is the only measure. The cards below spread their fields
    // into more columns as the room appears, rather than stretching one input
    // across the whole page.
    <div className="flex w-full flex-col gap-4">
      <PageHeader
        title="Profile"
        description="Your account and what your role can reach."
      />

      <AccountCard />

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
