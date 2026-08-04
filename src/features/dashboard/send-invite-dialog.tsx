import * as React from "react"
import {
  CheckCircle2,
  Link2,
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
import { useSendInterviewInvite, type InterviewRow } from "@/services/hr"
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
    hint: "Sent by the server to the candidate's address.",
  },
  {
    value: "whatsapp",
    label: "WhatsApp Only",
    Icon: MessageCircle,
    hint: "Opens WhatsApp with the message ready — you pick the contact and press send.",
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
 * Sends one candidate their interview invitation.
 *
 * **Only the email half goes through the API.** `POST /api/send-interview`
 * takes `{candidate_email, candidate_name, role, interview_url}` and has no
 * channel or phone field, so WhatsApp can't be a server-side send. It is a
 * hand-off instead: WhatsApp opens with the message composed, and the recruiter
 * picks the contact — the interview rows carry no phone number to address it to.
 */
export function SendInviteDialog({
  row,
  open,
  onOpenChange,
  initialChannel = "both",
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
  const send = useSendInterviewInvite()
  const [channel, setChannel] = React.useState<Channel>(initialChannel)
  const [sent, setSent] = React.useState(false)

  if (!row) return null

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
    if (channel !== "whatsapp") {
      try {
        const result = await send.mutateAsync({
          candidateEmail: row.candidateEmail,
          candidateName: row.candidateName,
          role: row.role,
          interviewUrl: link,
        })
        toast.success(result.message)
      } catch {
        // Already reported by the mutation. Stop here rather than opening
        // WhatsApp as if the whole send had worked.
        return
      }
    }

    if (channel !== "email") openWhatsApp()

    // Deliberately not closing. The emailed button is composed server-side and
    // has been seen to arrive without `interview_id` — which lands the
    // candidate on "this link isn't complete" — so the recruiter is handed the
    // link that definitely works before they walk away from this dialog.
    setSent(true)
  }

  if (sent) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400" />
              Invitation sent
            </DialogTitle>
            <DialogDescription>
              {channel === "whatsapp"
                ? "WhatsApp is open with the message ready to send."
                : `Emailed to ${row.candidateEmail} with the one-time code.`}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-2">
            <p className="text-sm">
              If the button in that email doesn&rsquo;t open the interview, send
              this link instead — the code stays the one they were emailed.
            </p>
            <div className="flex items-center gap-2 rounded-lg border p-2.5">
              <Link2 className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate font-mono text-xs">
                {link}
              </span>
              <CopyButton value={link} label="interview link" />
            </div>
          </div>

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
            Send interview invite
          </DialogTitle>
          <DialogDescription>
            The candidate needs both this link and the one-time code that was
            emailed with it.
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
            {CHANNELS.map((option) => (
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
            disabled={send.isPending}
          >
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={send.isPending}>
            {send.isPending ? (
              <>
                <Loader2 className="animate-spin" />
                Sending…
              </>
            ) : (
              <>
                <Rocket />
                Send now
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
