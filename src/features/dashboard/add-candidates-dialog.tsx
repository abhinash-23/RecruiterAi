import * as React from "react"
import { FileText, Upload, X } from "lucide-react"

import { PhoneInput } from "@/components/shared/phone-input"
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import {
  INTAKE_LIMITS,
  type CandidateIntakeRow,
  type IntakeResult,
} from "@/services/hr"
import { isValidEmail } from "@/lib/email"
import { isValidPhone } from "@/lib/phone"
import { cn } from "@/lib/utils"

interface AddCandidatesDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onAddRows: (rows: CandidateIntakeRow[]) => Promise<IntakeResult>
  onUpload: (files: File[]) => Promise<IntakeResult>
  pending?: boolean
}

/**
 * Two ways into the funnel: paste one Resume, or drop a stack of files.
 *
 * The typed path validates before sending because the server's 30-character
 * Resume minimum is **schema-level** — one short row 422s the entire batch
 * rather than coming back as a per-item error, so an unvalidated form would
 * silently lose the good rows too.
 */
export function AddCandidatesDialog({
  open,
  onOpenChange,
  onAddRows,
  onUpload,
  pending,
}: AddCandidatesDialogProps) {
  const [email, setEmail] = React.useState("")
  const [name, setName] = React.useState("")
  const [phone, setPhone] = React.useState("")
  const [resumeText, setResumeText] = React.useState("")
  const [files, setFiles] = React.useState<File[]>([])
  const [errors, setErrors] = React.useState<string[]>([])
  const [result, setResult] = React.useState<IntakeResult | null>(null)

  /**
   * The files the last pick added. The list is capped and scrolls, so new
   * files land below the fold; without this a second pick looked like it had
   * done nothing. The list scrolls down to them and tints them for a moment.
   */
  const [justAdded, setJustAdded] = React.useState<File[]>([])
  const listRef = React.useRef<HTMLUListElement>(null)

  React.useEffect(() => {
    if (justAdded.length === 0) return
    const list = listRef.current
    list?.scrollTo({ top: list.scrollHeight, behavior: "smooth" })
    const timer = window.setTimeout(() => setJustAdded([]), 1500)
    return () => window.clearTimeout(timer)
  }, [justAdded])

  const reset = () => {
    setEmail("")
    setName("")
    setPhone("")
    setResumeText("")
    setFiles([])
    setJustAdded([])
    setErrors([])
    setResult(null)
  }

  const short = resumeText.trim().length < INTAKE_LIMITS.resumeMin

  const submitTyped = async () => {
    const problems: string[] = []
    if (!isValidEmail(email)) {
      problems.push("Enter a valid email address.")
    }
    if (!name.trim()) {
      problems.push("Enter the candidate's name.")
    }
    if (!isValidPhone(phone)) {
      problems.push("Enter a valid phone number.")
    }
    if (short) {
      problems.push(
        `Paste at least ${INTAKE_LIMITS.resumeMin} characters of Resume — the server rejects the whole batch below that.`
      )
    }
    setErrors(problems)
    if (problems.length > 0) return

    const outcome = await onAddRows([
      { email, name, phone, resumeText },
    ])
    setResult(outcome)
    if (outcome.errors.length === 0) {
      onOpenChange(false)
      reset()
    }
  }

  const submitFiles = async () => {
    if (files.length === 0) {
      setErrors(["Choose at least one Resume file."])
      return
    }
    setErrors([])
    const outcome = await onUpload(files)
    setResult(outcome)
    if (outcome.errors.length === 0) {
      onOpenChange(false)
      reset()
    }
  }

  /**
   * Adds to the list rather than replacing it, so Resumes can be gathered from
   * more than one folder by opening the picker again. A file already listed is
   * skipped rather than sent twice, and anything past the batch limit is named
   * instead of silently dropped.
   */
  const pickFiles = (chosen: FileList | null) => {
    if (!chosen) return
    const same = (a: File, b: File) =>
      a.name === b.name && a.size === b.size && a.lastModified === b.lastModified

    const fresh = [...chosen].filter(
      (file, index, all) =>
        !files.some((listed) => same(listed, file)) &&
        all.findIndex((other) => same(other, file)) === index
    )
    const tooBig = fresh.filter((f) => f.size > INTAKE_LIMITS.maxFileBytes)
    const fitting = fresh.filter((f) => f.size <= INTAKE_LIMITS.maxFileBytes)
    const room = Math.max(0, INTAKE_LIMITS.maxFiles - files.length)
    const overflow = fitting.slice(room)

    const problems: string[] = []
    if (tooBig.length > 0) {
      problems.push(
        `${tooBig.map((f) => f.name).join(", ")} — over the 10 MB limit.`
      )
    }
    if (overflow.length > 0) {
      problems.push(
        `${overflow.map((f) => f.name).join(", ")} — not added, a batch holds ${INTAKE_LIMITS.maxFiles} files.`
      )
    }
    setErrors(problems)
    const added = fitting.slice(0, room)
    setFiles([...files, ...added])
    if (added.length > 0) setJustAdded(added)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) reset()
      }}
    >
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Add candidates</DialogTitle>
          <DialogDescription>
            Resumes are scored against this job&rsquo;s description
            automatically. Scoring runs in the background — the shortlist
            updates itself.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="upload">
          <TabsList>
            <TabsTrigger value="upload">Upload files</TabsTrigger>
            <TabsTrigger value="typed">Paste one Resume</TabsTrigger>
          </TabsList>

          <TabsContent value="upload" className="flex flex-col gap-3 pt-3">
            <Label
              htmlFor="candidate-files"
              className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed px-4 py-8 text-center hover:bg-muted/40"
            >
              <Upload className="size-5 text-muted-foreground" />
              <span className="text-sm font-medium">
                Choose Resumes, or drop them here
              </span>
              <span className="text-xs text-muted-foreground">
                PDF, DOCX or TXT · up to {INTAKE_LIMITS.maxFiles} files · 10 MB
                each
              </span>
            </Label>
            <Input
              id="candidate-files"
              type="file"
              multiple
              className="hidden"
              accept={INTAKE_LIMITS.acceptedFileTypes}
              onChange={(event) => {
                pickFiles(event.target.files)
                // Let the same file be re-picked after clearing it.
                event.target.value = ""
              }}
            />

            {/* Capped and scrolled inside, so a batch of 20 doesn't stretch the
                dialog past the screen and push Upload out of sight. The cap
                lands partway through the fifth row on purpose: scrollbars are
                hidden app-wide, and a cut-off row is the cue there's more. */}
            {files.length > 0 ? (
              <ul
                ref={listRef}
                className="flex max-h-48 flex-col gap-1 overflow-y-auto overscroll-contain"
              >
                {files.map((file) => (
                  <li
                    key={`${file.name}-${file.size}`}
                    className={cn(
                      "flex shrink-0 items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm transition-colors duration-700",
                      justAdded.includes(file) ? "bg-primary/15" : "bg-muted/50"
                    )}
                  >
                    <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{file.name}</span>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remove ${file.name}`}
                      onClick={() =>
                        setFiles((current) =>
                          current.filter((f) => f !== file)
                        )
                      }
                    >
                      <X />
                    </Button>
                  </li>
                ))}
              </ul>
            ) : null}

            <p className="text-xs text-muted-foreground">
              Names and emails are read out of the documents themselves.
            </p>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={pending}
              >
                Cancel
              </Button>
              <Button onClick={() => void submitFiles()} disabled={pending}>
                {pending ? "Uploading…" : `Upload ${files.length || ""}`.trim()}
              </Button>
            </DialogFooter>
          </TabsContent>

          <TabsContent value="typed" className="flex flex-col gap-3 pt-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="candidate-email">
                  Email <RequiredMark />
                </Label>
                <Input
                  id="candidate-email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="candidate@example.com"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="candidate-name">
                  Name <RequiredMark />
                </Label>
                <Input
                  id="candidate-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Asha Rao"
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="candidate-phone">
                Phone <RequiredMark />
              </Label>
              {/* Same control as every other phone field in the app, so what
                  gets stored is always E.164 — a bare "90000 00000" typed here
                  isn't diallable and won't match the same person entered from
                  the HR form. */}
              <PhoneInput
                id="candidate-phone"
                value={phone}
                onChange={setPhone}
                placeholder="90000 00000"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="candidate-resume">
                Resume text <RequiredMark />
              </Label>
              <Textarea
                id="candidate-resume"
                rows={8}
                value={resumeText}
                onChange={(event) => setResumeText(event.target.value)}
                placeholder="Paste the Resume…"
              />
              <p
                className={
                  short && resumeText.length > 0
                    ? "text-xs text-destructive"
                    : "text-xs text-muted-foreground"
                }
              >
                {resumeText.trim().length} / {INTAKE_LIMITS.resumeMin} characters
                minimum
              </p>
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={pending}
              >
                Cancel
              </Button>
              <Button onClick={() => void submitTyped()} disabled={pending}>
                {pending ? "Adding…" : "Add candidate"}
              </Button>
            </DialogFooter>
          </TabsContent>
        </Tabs>

        {errors.length > 0 ? (
          <div
            role="alert"
            className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {errors.map((message) => (
              <p key={message}>{message}</p>
            ))}
          </div>
        ) : null}

        {/* Batch calls succeed partially, so show what the server rejected
            rather than closing on a half-done result. */}
        {result && result.errors.length > 0 ? (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm">
            <p className="font-medium">
              {result.created.length} added, {result.errors.length} rejected:
            </p>
            <ul className="mt-1 list-inside list-disc text-xs">
              {result.errors.map((error, index) => (
                <li key={`${error.email ?? error.filename ?? index}`}>
                  {error.email ?? error.filename ?? `Row ${index + 1}`} —{" "}
                  {error.error}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
