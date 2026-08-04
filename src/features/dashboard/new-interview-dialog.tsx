import * as React from "react"
import { AlertTriangle, CalendarPlus, KeyRound, Link2, Loader2 } from "lucide-react"

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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { INTERVIEW_ROUND_OPTIONS, type InterviewRound } from "@/services/admin"
import { useCreateInterview, type CreatedInterview } from "@/services/hr"

/** A plausible email, checked here only to save an obvious round trip. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Invites one candidate without a job or a shortlist, via
 * `POST /api/create-interview`.
 *
 * The funnel — job → résumés → ranked shortlist → schedule — is the right path
 * when you're hiring for a role. This is for the case it can't express: a single
 * interview for someone already decided on, where a job with one candidate in it
 * would be bookkeeping for its own sake.
 *
 * The trade-off is stated on screen, not hidden: no résumé analysis, no fit
 * score, and the interview belongs to no job, so it never appears on a
 * shortlist.
 */
export function NewInterviewDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const create = useCreateInterview()

  const [name, setName] = React.useState("")
  const [email, setEmail] = React.useState("")
  const [role, setRole] = React.useState("")
  const [jobDescription, setJobDescription] = React.useState("")
  const [resumeText, setResumeText] = React.useState("")
  const [timeMinutes, setTimeMinutes] = React.useState("")
  const [linkExpiryHours, setLinkExpiryHours] = React.useState("")
  const [rounds, setRounds] = React.useState<InterviewRound[]>([])
  const [result, setResult] = React.useState<CreatedInterview | null>(null)

  const emailValid = EMAIL.test(email.trim())
  const ready = name.trim().length > 0 && emailValid

  const close = () => {
    onOpenChange(false)
    setName("")
    setEmail("")
    setRole("")
    setJobDescription("")
    setResumeText("")
    setTimeMinutes("")
    setLinkExpiryHours("")
    setRounds([])
    setResult(null)
    create.reset()
  }

  const toggleRound = (round: InterviewRound) =>
    setRounds((current) =>
      current.includes(round)
        ? current.filter((item) => item !== round)
        : // Kept in the API's canonical order rather than click order.
          INTERVIEW_ROUND_OPTIONS.filter(
            (option) => option === round || current.includes(option)
          )
    )

  const submit = async () => {
    const created = await create.mutateAsync({
      candidateName: name,
      candidateEmail: email,
      ...(role.trim() ? { role } : {}),
      ...(jobDescription.trim() ? { jobDescription } : {}),
      ...(resumeText.trim() ? { resumeText } : {}),
      // Left out entirely when blank: the endpoint then resolves them from the
      // company's interview defaults, which is not the same as sending 0.
      ...(timeMinutes ? { timeMinutes: Number(timeMinutes) } : {}),
      ...(linkExpiryHours ? { linkExpiryHours: Number(linkExpiryHours) } : {}),
      ...(rounds.length ? { rounds } : {}),
    })
    setResult(created)
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? null : close())}>
      <DialogContent className="sm:max-w-xl">
        {result ? (
          <>
            <DialogHeader>
              <DialogTitle>Interview created</DialogTitle>
              <DialogDescription>{result.message}</DialogDescription>
            </DialogHeader>

            {result.emailSent ? (
              <p className="text-sm text-muted-foreground">
                The invitation was emailed to {email.trim()} with the link and
                one-time code.
              </p>
            ) : (
              <p className="flex items-start gap-1.5 text-sm text-amber-600 dark:text-amber-400">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                No email was sent — pass these on yourself. They are shown once.
              </p>
            )}

            {/* Shown whatever the email did: the code never appears again, and
                an invitation nobody received is worse than a duplicate. */}
            {result.interviewLink ? (
              <div className="flex items-center gap-2 rounded-lg border p-3 text-sm">
                <Link2 className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate font-mono text-xs">
                  {result.interviewLink}
                </span>
                <CopyButton value={result.interviewLink} label="link" />
              </div>
            ) : null}

            {result.otpCode ? (
              <div className="flex items-center gap-2 rounded-lg border p-3 text-sm">
                <KeyRound className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="flex-1 font-mono tracking-[0.3em]">
                  {result.otpCode}
                </span>
                <CopyButton value={result.otpCode} label="code" />
              </div>
            ) : null}

            <DialogFooter>
              <Button onClick={close}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>New interview</DialogTitle>
              <DialogDescription>
                Invites one candidate directly. There&rsquo;s no résumé
                analysis and no fit score, and it belongs to no job — for a
                ranked shortlist, add candidates to a job instead.
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="new-interview-name">Candidate name *</Label>
                <Input
                  id="new-interview-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Asha Rao"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="new-interview-email">Email *</Label>
                <Input
                  id="new-interview-email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  aria-invalid={email.length > 0 && !emailValid}
                  placeholder="candidate@example.com"
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-interview-role">Role</Label>
              <Input
                id="new-interview-role"
                value={role}
                onChange={(event) => setRole(event.target.value)}
                placeholder="Backend Engineer"
              />
              <p className="text-xs text-muted-foreground">
                What the candidate is told they&rsquo;re interviewing for.
                Defaults to “General”.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <Label>Rounds</Label>
              <div className="flex flex-wrap gap-2">
                {INTERVIEW_ROUND_OPTIONS.map((round) => {
                  const on = rounds.includes(round)
                  return (
                    <Button
                      key={round}
                      type="button"
                      variant={on ? "default" : "outline"}
                      size="sm"
                      onClick={() => toggleRound(round)}
                    >
                      {round}
                    </Button>
                  )
                })}
              </div>
              <p className="text-xs text-muted-foreground">
                Leave all off to use your company&rsquo;s defaults. The
                <span className="font-mono"> resume </span>and
                <span className="font-mono"> jd </span>rounds need the two
                fields below to ask anything useful.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="new-interview-minutes">Sitting length</Label>
                <Input
                  id="new-interview-minutes"
                  type="number"
                  min={5}
                  max={180}
                  value={timeMinutes}
                  onChange={(event) => setTimeMinutes(event.target.value)}
                  placeholder="Company default"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="new-interview-expiry">
                  Link valid for (hours)
                </Label>
                <Input
                  id="new-interview-expiry"
                  type="number"
                  min={0.01}
                  max={720}
                  step={0.25}
                  value={linkExpiryHours}
                  onChange={(event) => setLinkExpiryHours(event.target.value)}
                  placeholder="Company default"
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-interview-jd">Job description</Label>
              <Textarea
                id="new-interview-jd"
                value={jobDescription}
                onChange={(event) => setJobDescription(event.target.value)}
                placeholder="Optional — what the jd round asks about."
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-interview-resume">Résumé text</Label>
              <Textarea
                id="new-interview-resume"
                value={resumeText}
                onChange={(event) => setResumeText(event.target.value)}
                placeholder="Optional — what the resume round asks about."
              />
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={close}
                disabled={create.isPending}
              >
                Cancel
              </Button>
              <Button
                onClick={() => void submit()}
                disabled={!ready || create.isPending}
              >
                {create.isPending ? (
                  <>
                    <Loader2 className="animate-spin" />
                    Creating…
                  </>
                ) : (
                  <>
                    <CalendarPlus />
                    Create and invite
                  </>
                )}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
