import { AlertTriangle } from "lucide-react"

import { Button } from "@/components/ui/button"

import { Shell } from "./shell"

/**
 * Consent, asked before anything is captured.
 *
 * Refusal is terminal and the copy says so plainly — the link cannot be reused,
 * so a candidate must not discover that after the fact.
 */
export function ConsentScreen({
  logoUrl,
  onDecide,
  busy,
  error,
}: {
  logoUrl: string | null
  onDecide: (given: boolean) => void
  busy: boolean
  error: string | null
}) {
  return (
    <Shell
      logoUrl={logoUrl}
      title="Before we begin"
      description="This interview is recorded and scored automatically."
      footer={
        <>
          <Button
            variant="outline"
            onClick={() => onDecide(false)}
            disabled={busy}
          >
            I don&rsquo;t consent
          </Button>
          <Button onClick={() => onDecide(true)} disabled={busy}>
            {busy ? "Saving…" : "I consent — continue"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-sm text-muted-foreground">
        <p>
          Your camera and microphone are used during the interview, and your
          answers are scored by an automated system and shared with the
          recruiting team at the company you applied to.
        </p>
        {/* Required before the publisher side may run: a candidate has to be
            told they can be watched *while* they sit, which is a different
            thing from a recording reviewed afterwards. */}
        <p>A recruiter may view your interview live.</p>
        <p className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-amber-700 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          Declining ends this interview permanently — the link cannot be reused.
        </p>
        {error ? (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    </Shell>
  )
}
