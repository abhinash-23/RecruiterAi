import * as React from "react"
import { FileText, FolderOpen, Loader2, Upload, X } from "lucide-react"

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
  BULK_LIMITS,
  INTAKE_LIMITS,
  type CandidateIntakeRow,
  type IntakeResult,
  type ResumeRejection,
} from "@/services/hr"
import { isValidEmail } from "@/lib/email"
import { isValidPhone } from "@/lib/phone"
import { cn } from "@/lib/utils"

import { checkFiles } from "./bulk-upload/upload-store"

/** Files listed one by one; past this the list says how many more. */
const LISTED_FILES = 100

/** Same file picked twice, from the same place. */
const fileKey = (file: File) =>
  `${file.webkitRelativePath || file.name}:${file.size}:${file.lastModified}`

const megabytes = (bytes: number) =>
  bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / (1024 * 1024)).toLocaleString("en-IN", { maximumFractionDigits: 1 })} MB`

/** "a.pdf, b.pdf and 12 more" */
function nameList(items: ResumeRejection[], shown = 5) {
  const names = items.slice(0, shown).map((item) => item.name)
  const rest = items.length - names.length
  return rest > 0 ? `${names.join(", ")} and ${rest} more` : names.join(", ")
}

interface AddCandidatesDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onAddRows: (rows: CandidateIntakeRow[]) => Promise<IntakeResult>
  /**
   * Sends the files. `"started"` means a bulk upload is under way and the
   * page shows its progress, so the dialog closes; an `IntakeResult` is the
   * old one-shot upload's answer.
   */
  onUpload: (files: File[]) => Promise<IntakeResult | "started">
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
  /** Opening the batch: the one wait before the dialog can close. */
  const [starting, setStarting] = React.useState(false)
  const [dragging, setDragging] = React.useState(false)
  const folderRef = React.useRef<HTMLInputElement>(null)
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
    setStarting(false)
    setDragging(false)
  }

  const busy = Boolean(pending) || starting
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0)

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
        `Paste at least ${INTAKE_LIMITS.resumeMin} characters of Resume. The server rejects the whole batch below that.`
      )
    }
    setErrors(problems)
    if (problems.length > 0) return

    let outcome
    try {
      outcome = await onAddRows([{ email, name, phone, resumeText }])
    } catch {
      // Reported by the mutation; stay open so the row isn't lost.
      return
    }
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
    setStarting(true)
    let outcome
    try {
      outcome = await onUpload(files)
    } catch (error) {
      // Keep the files picked so they can be resent.
      setErrors([
        error instanceof Error ? error.message : "The upload didn't start.",
      ])
      return
    } finally {
      setStarting(false)
    }
    if (outcome === "started") {
      onOpenChange(false)
      reset()
      return
    }
    setResult(outcome)
    if (outcome.errors.length === 0) {
      onOpenChange(false)
      reset()
    }
  }

  /**
   * Adds to the list rather than replacing it, so Resumes can be gathered from
   * more than one folder by opening the picker again. A file already listed is
   * skipped rather than sent twice. Files the server would refuse are named
   * here and left out; from a folder, files that aren't Resumes at all (images,
   * spreadsheets) are only counted.
   */
  const pickFiles = (chosen: File[], fromFolder = false) => {
    if (chosen.length === 0) return
    const seen = new Set(files.map(fileKey))
    const { accepted, rejected } = checkFiles(chosen)
    const added = accepted.filter((file) => {
      const key = fileKey(file)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })

    const wrongType = rejected.filter((r) => r.error.startsWith("Not a"))
    const refused = rejected.filter((r) => !r.error.startsWith("Not a"))
    const problems: string[] = []
    if (refused.length > 0) {
      problems.push(
        `${nameList(refused)}: left out, because they're empty or over 10 MB.`
      )
    }
    if (wrongType.length > 0) {
      problems.push(
        fromFolder
          ? `${wrongType.length} other ${wrongType.length === 1 ? "file" : "files"} in the folder left out: not PDF, DOCX or TXT.`
          : `${nameList(wrongType)}: left out, because only PDF, DOCX and TXT are read.`
      )
    }
    setErrors(problems)
    setResult(null)
    setFiles([...files, ...added])
    if (added.length > 0) setJustAdded(added.slice(-LISTED_FILES))
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
            automatically. Scoring runs in the background. The shortlist updates
            itself.
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
              onDragOver={(event) => {
                event.preventDefault()
                setDragging(true)
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault()
                setDragging(false)
                pickFiles([...event.dataTransfer.files])
              }}
              className={cn(
                "flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed px-4 py-8 text-center transition-colors hover:bg-muted/40",
                dragging && "border-accent-brand bg-accent-brand-muted"
              )}
            >
              <Upload className="size-5 text-muted-foreground" />
              <span className="text-sm font-medium">
                Choose Resumes, or drop them here
              </span>
              <span className="text-xs text-muted-foreground">
                PDF, DOCX or TXT · as many as you need · 10 MB each
              </span>
            </Label>
            <Input
              id="candidate-files"
              type="file"
              multiple
              className="hidden"
              accept={BULK_LIMITS.acceptedFileTypes}
              onChange={(event) => {
                pickFiles([...(event.target.files ?? [])])
                // Let the same file be re-picked after clearing it.
                event.target.value = ""
              }}
            />
            {/* A whole folder at once. `webkitdirectory` isn't in React's
                types, and every current browser supports it. */}
            <input
              ref={folderRef}
              type="file"
              multiple
              className="hidden"
              {...({
                webkitdirectory: "",
              } as React.InputHTMLAttributes<HTMLInputElement>)}
              onChange={(event) => {
                pickFiles([...(event.target.files ?? [])], true)
                event.target.value = ""
              }}
            />

            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => folderRef.current?.click()}
              >
                <FolderOpen />
                Choose a folder
              </Button>
              {files.length > 0 ? (
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground tabular-nums">
                    {files.length.toLocaleString("en-IN")}{" "}
                    {files.length === 1 ? "file" : "files"} ·{" "}
                    {megabytes(totalBytes)}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => {
                      setFiles([])
                      setErrors([])
                    }}
                  >
                    Clear
                  </Button>
                </div>
              ) : null}
            </div>

            {/* Capped and scrolled inside, so a long pick doesn't stretch the
                dialog past the screen and push Upload out of sight. The cap
                lands partway through the fifth row on purpose: scrollbars are
                hidden app-wide, and a cut-off row is the cue there's more. */}
            {files.length > 0 ? (
              <ul
                ref={listRef}
                className="flex max-h-48 flex-col gap-1 overflow-y-auto overscroll-contain"
              >
                {files.slice(0, LISTED_FILES).map((file) => (
                  <li
                    key={fileKey(file)}
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
                      disabled={busy}
                      onClick={() =>
                        setFiles((current) => current.filter((f) => f !== file))
                      }
                    >
                      <X />
                    </Button>
                  </li>
                ))}
                {files.length > LISTED_FILES ? (
                  <li className="shrink-0 px-2.5 py-1.5 text-xs text-muted-foreground">
                    And {(files.length - LISTED_FILES).toLocaleString("en-IN")}{" "}
                    more
                  </li>
                ) : null}
              </ul>
            ) : null}

            <p className="text-xs text-muted-foreground">
              Names and emails are read out of the documents themselves, so
              every Resume needs an email address in it. A large upload carries
              on after this closes, and the job page shows its progress.
            </p>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={busy}
              >
                Cancel
              </Button>
              <Button onClick={() => void submitFiles()} disabled={busy}>
                {busy ? (
                  <>
                    <Loader2 className="animate-spin" />
                    Uploading…
                  </>
                ) : (
                  `Upload ${files.length ? files.length.toLocaleString("en-IN") : ""}`.trim()
                )}
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
                {resumeText.trim().length} / {INTAKE_LIMITS.resumeMin}{" "}
                characters minimum
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
            className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm wrap-break-word text-destructive"
          >
            {errors.map((message) => (
              <p key={message}>{message}</p>
            ))}
          </div>
        ) : null}

        {/* Batch calls succeed partially, so show what the server rejected
            rather than closing on a half-done result. */}
        {result && result.errors.length > 0 ? (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm wrap-break-word">
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
