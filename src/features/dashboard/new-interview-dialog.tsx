import * as React from "react"
import { AlertTriangle, CalendarPlus, Loader2 } from "lucide-react"

import { DocumentField } from "@/components/shared/document-field"
import { SelectOrText } from "@/components/shared/select-or-text"
import { RequiredMark } from "@/components/shared/required-mark"
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
import { RoundPicker } from "@/features/dashboard/round-picker"
import { formatRounds, useRoundSelection } from "@/features/dashboard/rounds"
import { useInterviewDefaults } from "@/services/admin"
import {
  DEFAULT_SELECTION_THRESHOLD_PCT,
  JOB_LIMITS,
  useCreateInterview,
  type CreatedInterview,
} from "@/services/hr"
import { isValidEmail } from "@/lib/email"

/**
 * Invites one candidate without a job or a shortlist, via
 * `POST /api/create-interview`.
 *
 * The funnel — job → Resumes → ranked shortlist → schedule — is the right path
 * when you're hiring for a role. This is for the case it can't express: a single
 * interview for someone already decided on, where a job with one candidate in it
 * would be bookkeeping for its own sake.
 *
 * The trade-off is stated on screen, not hidden: no Resume analysis, no fit
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
  const [threshold, setThreshold] = React.useState("")
  /* Opens on the company defaults — readable by HR as well as admin — and
     sends `rounds` only when the recruiter changes them; left alone, the
     server applies those same defaults. Either way this one interview is all
     it touches: the company defaults change only on the Branding page. */
  const defaults = useInterviewDefaults(open)
  const roundSelection = useRoundSelection(defaults.data?.rounds)
  const rounds = roundSelection.rounds
  const [result, setResult] = React.useState<CreatedInterview | null>(null)

  /**
   * Rounds that are switched on but have no document to build questions from.
   *
   * `resume` and `jd` are the only two that read anything, and with every round
   * on by default they are now selected for a recruiter who may well paste
   * neither. Surfaced, not silently corrected — see the note by the warning.
   */
  const emptySourceRounds = (
    [
      ["resume", resumeText],
      ["jd", jobDescription],
    ] as const
  )
    .filter(([round, text]) => rounds.includes(round) && !text.trim())
    .map(([round]) => round)

  // Checked here only to save an obvious round trip — the server validates too.
  const emailValid = isValidEmail(email)
  /* A document is required only while the round that reads it is on — the
     label's star follows the chip. Switching the round off is the other way
     to clear it, which the warning under the chips says. */
  const jdRequired = rounds.includes("jd")
  const resumeRequired = rounds.includes("resume")
  const ready =
    name.trim().length > 0 &&
    emailValid &&
    role.trim().length > 0 &&
    emptySourceRounds.length === 0

  const close = () => {
    onOpenChange(false)
    setName("")
    setEmail("")
    setRole("")
    setJobDescription("")
    setResumeText("")
    setTimeMinutes("")
    setLinkExpiryHours("")
    setThreshold("")
    // Back to following the defaults — the dialog is reused, and the next
    // interview should open the way the first one did.
    roundSelection.reset()
    setResult(null)
    create.reset()
  }

  const submit = async () => {
    const created = await create.mutateAsync({
      candidateName: name,
      candidateEmail: email,
      role: role.trim(),
      ...(jobDescription.trim() ? { jobDescription } : {}),
      ...(resumeText.trim() ? { resumeText } : {}),
      // Left out entirely when blank: the endpoint then resolves them from the
      // company's interview defaults, which is not the same as sending 0.
      ...(timeMinutes ? { timeMinutes: Number(timeMinutes) } : {}),
      ...(linkExpiryHours ? { linkExpiryHours: Number(linkExpiryHours) } : {}),
      ...(roundSelection.changed ? { rounds } : {}),
      // The same rule as the two above, and it matters more here: 0 is both a
      // 422 and a bar nobody could clear, while the field's absence leaves the
      // platform default in charge. This interview belongs to no job, so there
      // is nothing else for it to inherit a bar from.
      ...(threshold ? { selectionThresholdPct: Number(threshold) } : {}),
      /* **No `voiceMode` here any more, and that is the fix rather than a
         regression.** `createInterview` sends `voice_mode: true` itself now,
         unconditionally, because this being a per-call choice is precisely how
         the two creation paths came to hand two candidates two different
         interviews. There is no switch on the form and there is no longer one in
         the call. */
    })
    setResult(created)
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? null : close())}>
      {/* Wider than the app's other dialogs because of what's in it: two
          document fields whose text is read, not just filled in. At `xl` an
          uploaded Resume wrapped every line at about eight words, which is no
          way to check that a PDF came out of the parser intact. */}
      {/* A column rather than the base dialog's single scrolling block: the
          header and the footer stay put and only the form between them
          scrolls, so Create and invite is always on screen however long the
          pasted documents make the form. */}
      <DialogContent className="flex flex-col overflow-hidden sm:max-w-6xl">
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
                list below. Elena will interview them out loud.
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
                <strong>Send invite</strong> on the interview&rsquo;s row to
                email the link — the candidate can then ask for a fresh code
                from the link itself.
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
                Invites one candidate directly. There&rsquo;s no Resume analysis
                and no fit score, and it belongs to no job — for a ranked
                shortlist, add candidates to a job instead.
              </DialogDescription>
            </DialogHeader>

            {/* `-mx-4 px-4` and `-my-1 py-1` so focus rings at the edges
                aren't clipped by the scroll box. */}
            <div className="-mx-4 -my-1 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-4 py-1">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="new-interview-name">
                    Candidate name <RequiredMark />
                  </Label>
                  <Input
                    id="new-interview-name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Asha Rao"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="new-interview-email">
                    Email <RequiredMark />
                  </Label>
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
                <Label htmlFor="new-interview-role">
                  Role <RequiredMark />
                </Label>
                <SelectOrText
                  id="new-interview-role"
                  value={role}
                  onChange={setRole}
                  options={JOB_TITLE_OPTIONS}
                  placeholder="Pick a role, or choose Other"
                />
                <p className="text-xs text-muted-foreground">
                  What the candidate is told they&rsquo;re interviewing for.
                </p>
              </div>

              <div className="flex flex-col gap-2">
                <Label>Rounds</Label>
                <RoundPicker
                  value={rounds}
                  onChange={roundSelection.setRounds}
                  disabled={defaults.isLoading}
                />
                <p className="text-xs text-muted-foreground">
                  {roundSelection.changed ? (
                    <>
                      Changed for this interview only — your company&rsquo;s
                      defaults stay as they are.{" "}
                      <button
                        type="button"
                        onClick={roundSelection.reset}
                        className="font-medium text-foreground underline underline-offset-2"
                      >
                        Reset
                      </button>
                    </>
                  ) : (
                    <>
                      Your company&rsquo;s defaults
                      {defaults.data ? (
                        <> ({formatRounds(defaults.data.rounds)})</>
                      ) : null}
                      . Change them here for this interview only.
                    </>
                  )}
                </p>

                {/* The two rounds that need something to read.
                  Now that they start switched on, a recruiter who pastes
                  nothing gets them silently asking about nothing — so this says
                  so, at the moment it is fixable, rather than letting a
                  candidate sit an empty round. Named rather than auto-removed:
                  quietly dropping a round somebody can see is selected is the
                  worse surprise of the two. */}
                {emptySourceRounds.length > 0 ? (
                  <p className="flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                    <span>
                      {emptySourceRounds.map((round, index) => (
                        <React.Fragment key={round}>
                          {index > 0 ? " and " : ""}
                          <span className="font-mono">{round}</span>
                        </React.Fragment>
                      ))}{" "}
                      {emptySourceRounds.length > 1 ? "have" : "has"} nothing to
                      read yet — paste or upload{" "}
                      {emptySourceRounds.length > 1
                        ? "both documents"
                        : emptySourceRounds[0] === "jd"
                          ? "the job description"
                          : "the Resume"}{" "}
                      below, or switch{" "}
                      {emptySourceRounds.length > 1 ? "them" : "it"} off.
                    </span>
                  </p>
                ) : null}
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
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
                {/* Beside the other two settings that are "leave it blank for the
                  default", because it behaves exactly like them — except that
                  the default is the platform's rather than the company's, since
                  a job-less interview has no job to read one from. */}
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="new-interview-threshold">
                    Selection threshold %
                  </Label>
                  <Input
                    id="new-interview-threshold"
                    type="number"
                    min={JOB_LIMITS.thresholdMin}
                    max={JOB_LIMITS.thresholdMax}
                    value={threshold}
                    onChange={(event) => setThreshold(event.target.value)}
                    placeholder={`${DEFAULT_SELECTION_THRESHOLD_PCT} (default)`}
                  />
                </div>
              </div>

              {/* Both take a PDF, because both usually *are* one — the JD as
                often as the Resume. Read in the browser and dropped into the
                box, so it can be checked before the interview is created.

                Side by side, and `items-start` so the shorter one doesn't
                stretch: they're a pair the recruiter fills in together, and
                stacked they pushed the whole footer past the fold. Taller rows
                too, since the width now makes them worth reading. */}
              <div className="grid items-start gap-4 sm:grid-cols-2">
                <DocumentField
                  id="new-interview-jd"
                  label="Job description"
                  required={jdRequired}
                  rows={8}
                  value={jobDescription}
                  onChange={setJobDescription}
                  placeholder="what the jd round asks about. Paste it, or upload the PDF."
                  hint="PDF or TXT, up to 10 MB. Drop a file anywhere on the box."
                />

                <DocumentField
                  id="new-interview-resume"
                  label="Resume"
                  required={resumeRequired}
                  rows={8}
                  value={resumeText}
                  onChange={setResumeText}
                  placeholder="what the resume round asks about. Paste it, or upload the PDF."
                  hint="PDF or TXT, up to 10 MB. Scanned or image-only PDFs have no text to read — paste those in."
                />
              </div>
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
