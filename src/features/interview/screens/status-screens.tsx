import { CheckCircle2 } from "lucide-react"

import { Shell } from "./shell"

/**
 * The three screens a sitting can end on, and the one it can fail to begin on.
 *
 * All dead ends: none of them offers a retry, because none of the underlying
 * states can be retried from this page.
 */

/** No `interview_id` in the link, so this page can't tell which interview to open. */
export function IncompleteLinkScreen({ logoUrl }: { logoUrl: string | null }) {
  return (
    <Shell
      logoUrl={logoUrl}
      title="This link isn't complete"
      description="It's missing the interview id, so this page can't tell which interview to open."
    >
      <p className="text-sm text-muted-foreground">
        Reply to your invitation and ask for the link to be sent again. A working
        one contains <span className="font-mono">interview_id</span> in its
        address — your one-time code is still valid, so nothing has been lost.
      </p>
    </Shell>
  )
}

/**
 * Terminal by design: opened in a second tab, expired, consent refused, or
 * closed server-side. `reason` carries whichever it was.
 */
export function ClosedScreen({ reason }: { reason: string | null }) {
  return (
    <Shell title="Interview closed" description={reason ?? undefined}>
      <p className="text-sm text-muted-foreground">
        If you think this is a mistake, reply to your invitation email and the
        recruiter can issue a new link.
      </p>
    </Shell>
  )
}

/**
 * Submitted.
 *
 * **No score shown, deliberately.** `finish-interview` returns one, but a
 * candidate reading their own automated mark before a human has looked at the
 * interview invites an argument about a number the recruiter may not even act
 * on. The result is theirs to deliver.
 */
export function DoneScreen({
  logoUrl,
  role,
}: {
  logoUrl: string | null
  role: string
}) {
  return (
    <Shell
      logoUrl={logoUrl}
      title="Thank you — you're all done"
      description={`Your answers for ${role || "this"} Role have been submitted.`}
    >
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <CheckCircle2 className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
        The recruiter will be in touch. You can close this tab.
      </div>
    </Shell>
  )
}
