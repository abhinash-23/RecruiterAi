import { AlertTriangle, AtSign, KeyRound, MailCheck } from "lucide-react"

import { CopyButton } from "@/components/shared/copy-button"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

/** A one-time password a create or reset produced. */
export interface IssuedCredentials {
  /** Who or what these belong to — a company name, or a person's name. */
  subject: string
  email: string
  password: string
  /** Whether the server also emailed them. */
  emailSent: boolean
  /** Distinguishes a brand-new account from a reset of an existing one. */
  kind: "created" | "reset"
  /** Names the thing in the heading, e.g. "Admin" or "HR user". */
  noun: string
}

interface CredentialsDialogProps {
  credentials: IssuedCredentials | null
  onClose: () => void
}

/**
 * Shows the temporary password returned by the create and reset-password
 * endpoints, for both tenants (`/platform/admins`) and recruiter seats
 * (`/company/hrs`).
 *
 * A dialog rather than a toast on purpose: the server stores no plaintext copy,
 * so **this is the only time the password can ever be read**. A toast that
 * auto-dismisses would lose it for good — and if the credentials email doesn't
 * arrive, this is the only copy that ever existed.
 */
export function CredentialsDialog({
  credentials,
  onClose,
}: CredentialsDialogProps) {
  const created = credentials?.kind === "created"

  return (
    <Dialog
      open={Boolean(credentials)}
      onOpenChange={(open) => !open && onClose()}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {created ? `${credentials?.noun} created` : "Password reset"}
          </DialogTitle>
          <DialogDescription>
            {credentials?.subject}
            {created
              ? " is ready. Hand these credentials over — they'll be asked to change the password at first sign-in."
              : " must sign in with this password, and will be asked to change it."}
          </DialogDescription>
        </DialogHeader>

        {credentials ? (
          <div className="flex flex-col gap-4">
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <p>
                This password is shown <strong>once</strong>. It isn&rsquo;t
                stored anywhere in readable form, so copy it before closing.
              </p>
            </div>

            <div className="flex items-start gap-2">
              <AtSign className="mt-2 size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="text-xs text-muted-foreground">Sign in with</p>
                <p className="truncate font-mono text-sm">
                  {credentials.email}
                </p>
              </div>
              <CopyButton value={credentials.email} label="email" />
            </div>

            <div className="flex items-start gap-2">
              <KeyRound className="mt-2 size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="text-xs text-muted-foreground">
                  Temporary password
                </p>
                {/* `break-all` because a generated password has no spaces to
                    wrap at and would otherwise overflow the dialog. */}
                <p className="font-mono text-lg font-semibold break-all">
                  {credentials.password}
                </p>
              </div>
              <CopyButton value={credentials.password} label="password" />
            </div>

            {credentials.emailSent ? (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <MailCheck className="size-3.5 text-emerald-600 dark:text-emerald-400" />
                Also emailed to {credentials.email}.
              </p>
            ) : (
              <p className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                <AlertTriangle className="size-3.5" />
                The credentials email could not be sent — pass these on
                yourself.
              </p>
            )}
          </div>
        ) : null}

        <DialogFooter>
          <Button onClick={onClose}>I&rsquo;ve saved it</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
