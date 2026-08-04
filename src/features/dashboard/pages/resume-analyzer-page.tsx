import * as React from "react"
import { FileText, Loader2, Sparkles, Upload, X } from "lucide-react"

import { PageHeader } from "@/components/shared/page-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { Textarea } from "@/components/ui/textarea"
import { RESUME_ANALYSIS_MAX_CHARS, useResumeAnalysis } from "@/services/hr"
import {
  RESUME_FILE_ACCEPT,
  ResumeFileError,
  readResumeFile,
} from "@/lib/read-resume-file"
import { cn } from "@/lib/utils"

function scoreTone(score: number) {
  if (score >= 70) return "text-emerald-600 dark:text-emerald-400"
  if (score >= 40) return "text-amber-600 dark:text-amber-400"
  return "text-destructive"
}

/** Everything the analyzer returned beyond the headline fields. */
function AnalysisDetail({ raw }: { raw: Record<string, unknown> }) {
  const skip = new Set(["fit_score", "recommendation", "analyzer_version", "status"])
  const entries = Object.entries(raw).filter(
    ([key, value]) =>
      !skip.has(key) && value !== null && value !== undefined && value !== ""
  )

  if (entries.length === 0) return null

  return (
    <dl className="flex flex-col gap-3">
      {entries.map(([key, value]) => (
        <div key={key}>
          <dt className="text-xs text-muted-foreground">
            {key.replace(/_/g, " ")}
          </dt>
          <dd className="text-sm">
            {Array.isArray(value) ? (
              <div className="mt-1 flex flex-wrap gap-1">
                {value.map((item, index) => (
                  <Badge
                    key={`${String(item)}-${index}`}
                    variant="secondary"
                    className="h-auto font-normal whitespace-normal"
                  >
                    {String(item)}
                  </Badge>
                ))}
              </div>
            ) : typeof value === "object" ? (
              <pre className="mt-1 overflow-x-auto rounded-lg bg-muted/50 p-2 text-xs">
                {JSON.stringify(value, null, 2)}
              </pre>
            ) : (
              String(value)
            )}
          </dd>
        </div>
      ))}
    </dl>
  )
}

/**
 * Scores one résumé against one job description, without creating a candidate
 * or touching a job.
 *
 * Same engine as the funnel. When the AI proxy is unreachable it falls back to
 * keyword matching and can take **around 20 seconds**, so the pending state has
 * to say so rather than implying an instant answer.
 */
export function ResumeAnalyzerPage() {
  const analysis = useResumeAnalysis()

  const [role, setRole] = React.useState("")
  const [jobDescription, setJobDescription] = React.useState("")
  const [resumeText, setResumeText] = React.useState("")

  /** The uploaded file's name, kept only so the UI can show what was read. */
  const [fileName, setFileName] = React.useState<string | null>(null)
  const [reading, setReading] = React.useState(false)
  const [fileError, setFileError] = React.useState<string | null>(null)
  const [dragging, setDragging] = React.useState(false)

  const takeFile = async (file: File | undefined) => {
    if (!file) return
    setReading(true)
    setFileError(null)
    try {
      const text = await readResumeFile(file)
      setResumeText(text)
      setFileName(file.name)
    } catch (caught) {
      setFileName(null)
      setFileError(
        caught instanceof ResumeFileError
          ? caught.message
          : "That file couldn't be read. Paste the text instead."
      )
    } finally {
      setReading(false)
    }
  }

  const result = analysis.data
  const tooLong =
    resumeText.length > RESUME_ANALYSIS_MAX_CHARS ||
    jobDescription.length > RESUME_ANALYSIS_MAX_CHARS
  const ready =
    resumeText.trim().length > 0 &&
    jobDescription.trim().length > 0 &&
    !tooLong &&
    !reading

  return (
    <>
      <PageHeader
        title="Resume Analyzer"
        description="Score a single résumé against a job description. Nothing is saved — use a job's shortlist when you want the result kept."
      />

      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
        {result ? (
          <Card>
            <CardHeader>
              <CardTitle>Result</CardTitle>
              <CardDescription>
                {result.analyzerVersion === "keyword_fallback"
                  ? "Scored by keyword matching — the AI analyzer wasn't reachable."
                  : "Scored by the AI analyzer."}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              <div className="flex flex-wrap items-center gap-6">
                <span
                  className={cn(
                    "text-5xl leading-none font-semibold tabular-nums",
                    scoreTone(result.fitScore ?? 0)
                  )}
                >
                  {result.fitScore ?? "—"}
                  <span className="text-xl text-muted-foreground">/100</span>
                </span>
                <div className="min-w-48 flex-1">
                  <Progress value={result.fitScore ?? 0} />
                </div>
                {result.recommendation ? (
                  <Badge variant="secondary" className="h-auto whitespace-normal">
                    {result.recommendation}
                  </Badge>
                ) : null}
              </div>

              <AnalysisDetail raw={result.raw} />

              <Button
                variant="outline"
                onClick={() => {
                  setFileName(null)
                  setFileError(null)
                  analysis.reset()
                }}
              >
                Analyse another
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Inputs</CardTitle>
              <CardDescription>
                Both fields are required, up to{" "}
                {RESUME_ANALYSIS_MAX_CHARS.toLocaleString()} characters each.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="analyzer-role">Role (optional)</Label>
                <Input
                  id="analyzer-role"
                  value={role}
                  onChange={(event) => setRole(event.target.value)}
                  placeholder="Senior Backend Engineer"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="analyzer-jd">Job description</Label>
                <Textarea
                  id="analyzer-jd"
                  rows={7}
                  value={jobDescription}
                  onChange={(event) => setJobDescription(event.target.value)}
                  placeholder="Responsibilities, must-have skills, seniority…"
                />
                <p className="text-xs text-muted-foreground">
                  {jobDescription.length.toLocaleString()} /{" "}
                  {RESUME_ANALYSIS_MAX_CHARS.toLocaleString()}
                </p>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="analyzer-resume">Résumé</Label>

                {/* The analyzer endpoint only takes text, so a PDF is read in
                    the browser and dropped into the field below — where it
                    stays editable, since extraction from a heavily formatted
                    CV is never perfect. */}
                {fileName ? (
                  <div className="flex items-center gap-2 rounded-lg bg-muted/50 px-2.5 py-1.5 text-sm">
                    <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{fileName}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {resumeText.length.toLocaleString()} characters read
                    </span>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remove ${fileName}`}
                      onClick={() => {
                        setFileName(null)
                        setResumeText("")
                      }}
                    >
                      <X />
                    </Button>
                  </div>
                ) : (
                  <>
                    <Label
                      htmlFor="analyzer-file"
                      onDragOver={(event) => {
                        event.preventDefault()
                        setDragging(true)
                      }}
                      onDragLeave={() => setDragging(false)}
                      onDrop={(event) => {
                        event.preventDefault()
                        setDragging(false)
                        void takeFile(event.dataTransfer.files[0])
                      }}
                      className={cn(
                        "flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed px-4 py-6 text-center transition-colors hover:bg-muted/40",
                        dragging && "border-primary bg-muted/40"
                      )}
                    >
                      {reading ? (
                        <Loader2 className="size-5 animate-spin text-muted-foreground" />
                      ) : (
                        <Upload className="size-5 text-muted-foreground" />
                      )}
                      <span className="text-sm font-medium">
                        {reading
                          ? "Reading the file…"
                          : "Upload a résumé, or drop it here"}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        PDF or TXT · 10 MB · or paste the text below
                      </span>
                    </Label>
                    <Input
                      id="analyzer-file"
                      type="file"
                      className="hidden"
                      accept={RESUME_FILE_ACCEPT}
                      disabled={reading}
                      onChange={(event) => {
                        void takeFile(event.target.files?.[0])
                        // Let the same file be re-picked after clearing it.
                        event.target.value = ""
                      }}
                    />
                  </>
                )}

                {fileError ? (
                  <p role="alert" className="text-sm text-destructive">
                    {fileError}
                  </p>
                ) : null}

                <Textarea
                  id="analyzer-resume"
                  rows={9}
                  value={resumeText}
                  onChange={(event) => {
                    setResumeText(event.target.value)
                    // Once it's been edited by hand the filename no longer
                    // describes what's in the box.
                    setFileName(null)
                  }}
                  placeholder="Paste the résumé text…"
                />
                <p className="text-xs text-muted-foreground">
                  {resumeText.length.toLocaleString()} /{" "}
                  {RESUME_ANALYSIS_MAX_CHARS.toLocaleString()}
                </p>
              </div>

              {tooLong ? (
                <p className="text-sm text-destructive">
                  Both fields must stay under{" "}
                  {RESUME_ANALYSIS_MAX_CHARS.toLocaleString()} characters.
                </p>
              ) : null}

              <Button
                disabled={!ready || analysis.isPending}
                onClick={() =>
                  analysis.mutate({
                    resumeText,
                    jobDescription,
                    ...(role.trim() ? { role } : {}),
                  })
                }
              >
                {analysis.isPending ? (
                  <>
                    <Loader2 className="animate-spin" />
                    Analysing — this can take ~20 seconds
                  </>
                ) : (
                  <>
                    <Sparkles />
                    Analyse résumé
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </>
  )
}
