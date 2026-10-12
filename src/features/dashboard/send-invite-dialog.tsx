import * as React from "react"
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Mail,
  MessageCircle,
  Rocket,
} from "lucide-react"
import { toast } from "sonner"

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
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import {
  useInviteInterview,
  type InterviewRow,
  type SentInvitation,
} from "@/services/hr"
import { buildInterviewLink } from "@/services/interview"
import { cn } from "@/lib/utils"

type Channel = "both" | "email" | "whatsapp"

const CHANNELS: Array<{
  value: Channel
  label: string
  Icon: React.ComponentType<{ className?: string }>
  hint: string
}> = [
  {
    value: "both",
    label: "Both Email & WhatsApp",
    Icon: Mail,
    hint: "Emails the invitation, then opens WhatsApp with the same message.",
  },
  {
    value: "email",
    label: "Email Only",
    Icon: Mail,
    hint: "Sent by the server to the candidate's address, with a fresh one-time code.",
  },
  {
    value: "whatsapp",
    label: "WhatsApp Only",
    Icon: MessageCircle,
    hint: "Opens WhatsApp with the link ready — you pick the contact and press send. No new code is emailed.",
  },
]

/** What the recruiter sends over WhatsApp. */
function inviteMessage(row: InterviewRow, link: string) {
  return [
    `Hi ${row.candidateName},`,
    "",
    `Here is your interview link for the ${row.role} role:`,
    link,
    "",
    "You'll need the 6-digit code emailed to you to start. The link expires soon, so please sit it before then.",
  ].join("\n")
}

/**
 * Sends one candidate their interview invitation — or re-sends it.
 *
 * **Email goes through `POST /api/interviews/{id}/invite`**, which mints a fresh
 * code, restarts the validity window and mails the candidate at the details
 * saved on the interview. WhatsApp is a hand-off rather than a send: it opens
 * with the message composed and the recruiter picks the contact, since an
 * interview row carries no phone number.
 *
 * **A draft can't go by WhatsApp alone.** Its link does nothing until the
 * invitation is sent, and the code the candidate needs only ever travels by
 * email — so for a draft the option isn't offered.
 */
export function SendInviteDialog({
  row,
  open,
  onOpenChange,
  initialChannel,
}: {
  row: InterviewRow | null
  open: boolean
  onOpenChange: (open: boolean) => void
  /**
   * Which channel is pre-selected. The caller decides — the row has one button
   * per channel — and remounts this dialog (via `key`) so a second opening
   * doesn't inherit the first one's choice.
   */
  initialChannel?: Channel
}) {
  const invite = useInviteInterview()
  const draft = row?.isDraft ?? false
  const [channel, setChannel] = React.useState<Channel>(
    initialChannel ?? (draft ? "email" : "both")
  )
  const [sent, setSent] = React.useState<SentInvitation | "whatsapp" | null>(
    null
  )

  if (!row) return null

  const channels = draft
    ? CHANNELS.filter((option) => option.value !== "whatsapp")
    : CHANNELS

  const link = buildInterviewLink({
    interviewId: row.interviewId,
    email: row.candidateEmail,
    name: row.candidateName,
    role: row.role,
  })

  const openWhatsApp = () => {
    // No recipient in the URL: nothing on an interview row is a phone number,
    // so this opens the contact picker with the text already written.
    window.open(
      `https://wa.me/?text=${encodeURIComponent(inviteMessage(row, link))}`,
      "_blank",
      "noopener,noreferrer"
    )
  }

  const submit = async () => {
    if (channel === "whatsapp") {
      openWhatsApp()
      setSent("whatsapp")
      return
    }

    let result: SentInvitation
    try {
      result = await invite.mutateAsync(row.interviewId)
    } catch {
      // Already reported by the mutation. Stop here rather than opening
      // WhatsApp as if the whole send had worked.
      return
    }

    if (result.emailSent) toast.success(result.message)
    if (channel === "both") openWhatsApp()

    // Deliberately not closing: a confirmation the recruiter has to dismiss is
    // how they know the send happened, rather than the dialog simply vanishing.
    setSent(result)
  }

  if (sent) {
    const mailFailed = sent !== "whatsapp" && !sent.emailSent
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {mailFailed ? (
                <AlertTriangle className="size-4 text-amber-600 dark:text-amber-400" />
              ) : (
                <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400" />
              )}
              {mailFailed ? "Invited, but the email didn't go" : "Invitation sent"}
            </DialogTitle>
            <DialogDescription>
              {sent === "whatsapp"
                ? "WhatsApp is open with the message ready to send."
                : mailFailed
                  ? "The interview is live, but the mail to the candidate failed. Share the link below with them — they can ask for their one-time code from the link itself."
                  : `Emailed to ${row.candidateEmail} with a fresh one-time code.`}
            </DialogDescription>
          </DialogHeader>

          {mailFailed ? (
            <div className="flex items-center gap-2 rounded-xl bg-muted/50 px-3 py-2 text-sm">
              <span className="min-w-0 flex-1 truncate font-mono text-xs">
                {sent.interviewLink ?? link}
              </span>
              <CopyButton value={sent.interviewLink ?? link} label="link" />
            </div>
          ) : null}

          <DialogFooter>
            <Button onClick={() => onOpenChange(false)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="size-4" />
            {draft ? "Send interview invite" : "Re-send interview invite"}
          </DialogTitle>
          <DialogDescription>
            {draft
              ? "Nothing has reached the candidate yet. Sending emails them the link and a one-time code, and starts the link's validity window."
              : "Re-sending by email replaces the candidate's one-time code and restarts the link's validity window."}
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-xl bg-muted/50 px-3 py-2.5 text-sm">
          <p>
            <span className="text-muted-foreground">Interview: </span>
            <span className="font-medium">{row.role}</span>
          </p>
          <p className="mt-0.5 min-w-0 truncate">
            <span className="text-muted-foreground">Candidate: </span>
            <span className="font-medium">{row.candidateName}</span>
            <span className="text-muted-foreground"> · {row.candidateEmail}</span>
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <Label>Send via</Label>
          <RadioGroup
            value={channel}
            onValueChange={(value) => setChannel(value as Channel)}
          >
            {channels.map((option) => (
              <Label
                key={option.value}
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5 transition-colors hover:bg-muted/50",
                  channel === option.value && "border-primary bg-primary/5"
                )}
              >
                <RadioGroupItem value={option.value} className="mt-0.5" />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="flex items-center gap-1.5 text-sm font-medium">
                    <option.Icon className="size-3.5" />
                    {option.label}
                  </span>
                  <span className="text-xs font-normal text-muted-foreground">
                    {option.hint}
                  </span>
                </span>
              </Label>
            ))}
          </RadioGroup>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={invite.isPending}
          >
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={invite.isPending}>
            {invite.isPending ? (
              <>
                <Loader2 className="animate-spin" />
                Sending…
              </>
            ) : (
              <>
                <Rocket />
                {draft ? "Send invite" : "Send now"}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
