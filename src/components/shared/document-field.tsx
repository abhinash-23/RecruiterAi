import * as React from "react"
import { FileText, Loader2, Upload, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  RESUME_FILE_ACCEPT,
  ResumeFileError,
  readResumeFile,
} from "@/lib/read-resume-file"
import { cn } from "@/lib/utils"

/**
 * A long-text field that can be typed into, pasted into, **or** filled from a
 * PDF.
 *
 * Recruiters have the document, not its text. Asking them to open a PDF, select
 * all, and paste is a step that fails quietly — a two-column résumé pasted from
 * a viewer arrives interleaved, and the rounds built from it ask about nothing.
 * The extraction here keeps the lines (see `read-resume-file`).
 *
 * Nothing is uploaded: the text comes out of the file in the browser and goes
 * into the same field a recruiter would have typed into, so it is visible and
 * editable before anything is sent.
 */
export function DocumentField({
  id,
  label,
  hint,
  placeholder,
  value,
  onChange,
  rows = 4,
  disabled,
}: {
  id: string
  label: string
  /** Shown under the box. The file limits are stated by the control itself. */
  hint?: string
  placeholder?: string
  value: string
  onChange: (next: string) => void
  rows?: number
  disabled?: boolean
}) {
  const fileRef = React.useRef<HTMLInputElement | null>(null)

  /** The file the text came from, kept only so the field can say where it's from. */
  const [fileName, setFileName] = React.useState<string | null>(null)
  const [reading, setReading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [dragging, setDragging] = React.useState(false)

  const takeFile = async (file: File | undefined) => {
    if (!file || disabled) return
    setReading(true)
    setError(null)
    try {
      const text = await readResumeFile(file)
      onChange(text)
      setFileName(file.name)
    } catch (caught) {
      setFileName(null)
      setError(
        // Every failure in `readResumeFile` carries a next step the user can
        // take, so it goes on screen as written rather than as "upload failed".
        caught instanceof ResumeFileError
          ? caught.message
          : "That file couldn't be read. Paste the text instead."
      )
    } finally {
      setReading(false)
    }
  }

  return (
    <div
      className="flex flex-col gap-1.5"
      // The whole field is the drop target, not just a separate zone: the box is
      // where the text is going, so it's where a dragged file is aimed.
      onDragOver={(event) => {
        event.preventDefault()
        if (!disabled) setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault()
        setDragging(false)
        void takeFile(event.dataTransfer.files[0])
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id}>{label}</Label>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled || reading}
          onClick={() => fileRef.current?.click()}
          className="h-7 gap-1.5 px-2 text-xs text-muted-foreground"
        >
          {reading ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Upload className="size-3.5" />
          )}
          {reading ? "Reading…" : "Upload PDF"}
        </Button>

        <Input
          ref={fileRef}
          type="file"
          className="hidden"
          accept={RESUME_FILE_ACCEPT}
          disabled={disabled || reading}
          onChange={(event) => {
            void takeFile(event.target.files?.[0])
            // Let the same file be re-picked after clearing it — without this a
            // second attempt on an unchanged input fires no event at all.
            event.target.value = ""
          }}
        />
      </div>

      <Textarea
        id={id}
        rows={rows}
        value={value}
        disabled={disabled || reading}
        onChange={(event) => {
          onChange(event.target.value)
          // Once it's been edited by hand the filename no longer describes
          // what's in the box.
          setFileName(null)
        }}
        placeholder={
          dragging ? "Drop the file to read it…" : placeholder
        }
        className={cn(dragging && "border-primary bg-muted/40")}
      />

      {fileName ? (
        <div className="flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs">
          <FileText className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate">{fileName}</span>
          <span className="shrink-0 text-muted-foreground">
            {value.length.toLocaleString()} characters read
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Remove ${fileName}`}
            disabled={disabled}
            onClick={() => {
              setFileName(null)
              onChange("")
            }}
          >
            <X />
          </Button>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}

      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  )
}
