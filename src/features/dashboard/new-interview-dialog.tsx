import * as React from "react"
import { AlertTriangle, CalendarPlus, Loader2 } from "lucide-react"

import { DocumentField } from "@/components/shared/document-field"
import { SelectOrText } from "@/components/shared/select-or-text"
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
import { JOB_TITLE_OPTIONS } from "@/config/entities"
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
      {/* Wider than the app's other dialogs because of what's in it: two
          document fields whose text is read, not just filled in. At `xl` an
          uploaded résumé wrapped every line at about eight words, which is no
          way to check that a PDF came out of the parser intact. */}
      <DialogContent className="sm:max-w-6xl">
        {result ? (
          <>
            <DialogHeader>
              <DialogTitle>Interview created</DialogTitle>
              {/* Deliberately not `result.message`. The API's wording is
                  "send the link and OTP via your mailing system", written for a
                  client that puts both on screen — advice this one can't be
                  followed on, and reads as a step the recruiter has missed. */}
              <DialogDescription>
                {name.trim() || "The candidate"} is booked in and shows in the
                list below.
              </DialogDescription>
            </DialogHeader>

            {/* Neither the link nor the one-time code is shown here. The code
                is a credential for someone else's sitting, and putting it on a
                recruiter's screen — to be copied into chat, or read off a shared
                display — is the one place it can leak. Nothing is lost by
                withholding it: the link is rebuilt from the interview's own row
                by "Send invite", and `resend-otp` will post a fresh code to the
                candidate's inbox from the link itself, so a failed email is
                recoverable without anyone handling the code. */}
            {/* Three states, not two — `emailSent` is null when the server
                reports nothing, which is what this endpoint does.
                Claiming "no email was sent" on that silence was wrong: the
                invitation does go out, so a recruiter was being sent to fix
                something that wasn't broken. */}
            {result.emailSent === false ? (
              <p className="flex items-start gap-1.5 text-sm text-amber-600 dark:text-amber-400">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                The server reported that no email was sent. Use{" "}
                <strong>Send invite</strong> on the interview&rsquo;s row to email
                the link — the candidate can then ask for a fresh code from the
                link itself.
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                The invitation goes to {email.trim()} with the link and one-time
                code.{" "}
                {result.emailSent === null
                  ? // Hedged only this far: the send is not confirmed in the
                    // response, and the recovery is one click on the row.
                    "If it doesn’t arrive, use Send invite on the interview’s row to send it again."
                  : ""}
              </p>
            )}

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

            {/* The same picker as a job's title, and the same list behind it —
                this *is* a job title, just one that never became a job. Leaving
                it a free text box is how the identical role arrives spelt three
                ways across three interviews. */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-interview-role">Role</Label>
              <SelectOrText
                id="new-interview-role"
                value={role}
                onChange={setRole}
                options={JOB_TITLE_OPTIONS}
                placeholder="Pick a role, or choose Other"
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

            {/* Both take a PDF, because both usually *are* one — the JD as
                often as the résumé. Read in the browser and dropped into the
                box, so it can be checked before the interview is created.

                Side by side, and `items-start` so the shorter one doesn't
                stretch: they're a pair the recruiter fills in together, and
                stacked they pushed the whole footer past the fold. Taller rows
                too, since the width now makes them worth reading. */}
            <div className="grid items-start gap-4 sm:grid-cols-2">
              <DocumentField
                id="new-interview-jd"
                label="Job description"
                rows={8}
                value={jobDescription}
                onChange={setJobDescription}
                placeholder="what the jd round asks about. Paste it, or upload the PDF."
                hint="PDF or TXT, up to 10 MB. Drop a file anywhere on the box."
              />

              <DocumentField
                id="new-interview-resume"
                label="Résumé"
                rows={8}
                value={resumeText}
                onChange={setResumeText}
                placeholder="what the resume round asks about. Paste it, or upload the PDF."
                hint="PDF or TXT, up to 10 MB. Scanned or image-only PDFs have no text to read — paste those in."
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
