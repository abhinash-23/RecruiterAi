import * as React from "react"
import { format } from "date-fns"
import {
  ChevronDown,
  ExternalLink,
  Info,
  Loader2,
  Mail,
  Send,
  Sparkles,
  Target,
} from "lucide-react"

import { StatusBadge } from "@/components/shared/status-badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useCurrentUser } from "@/features/auth/auth-context"
import {
  FEEDBACK_MAX_ATTEMPTS,
  useFeedbackEmail,
  useResendFeedbackEmail,
  type FeedbackEmailContent,
  type FeedbackEmailState,
} from "@/services/hr"
import { cn } from "@/lib/utils"

/** The status as a chip: what it means for the reader, not the wire value. */
function statusChip(state: FeedbackEmailState) {
  switch (state.status) {
    case "sent":
      return {
        status: "completed",
        label: state.sentAt
          ? `Sent · ${format(new Date(state.sentAt), "d MMM, h:mm a")}`
          : "Sent",
      }
    case "pending":
      return { status: "pending", label: "Queued" }
    case "sending":
      return { status: "pending", label: "Sending…" }
    case "failed":
      return state.attempts < FEEDBACK_MAX_ATTEMPTS
        ? { status: "pending", label: "Not sent yet · retrying automatically" }
        : { status: "disabled", label: "Failed" }
    default:
      return { status: "draft", label: "Not sent" }
  }
}

/** The email as the candidate reads it: summary, strengths, then what to work on. */
function EmailPreview({ email }: { email: FeedbackEmailContent }) {
  return (
    <div className="flex flex-col gap-4 rounded-xl border bg-muted/30 p-4">
      <div>
        <p className="text-xs text-muted-foreground">Subject</p>
        <p className="text-sm font-medium wrap-break-word">{email.subject}</p>
      </div>

      {email.summary ? (
        <p className="text-sm leading-relaxed wrap-break-word">
          {email.summary}
        </p>
      ) : null}

      {email.strengths.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <p className="flex items-center gap-1.5 text-xs font-semibold tracking-wider text-emerald-700 uppercase dark:text-emerald-400">
            <Sparkles className="size-3.5" />
            What went well
          </p>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
            {email.strengths.map((strength) => (
              <li key={strength} className="wrap-break-word">
                {strength}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {email.improvements.length > 0 ? (
        <div className="flex flex-col gap-2">
          <p className="flex items-center gap-1.5 text-xs font-semibold tracking-wider text-amber-700 uppercase dark:text-amber-400">
            <Target className="size-3.5" />
            To work on
          </p>
          {email.improvements.map((item) => (
            <div
              key={item.area}
              className="flex flex-col gap-1.5 rounded-lg border bg-background p-3"
            >
              <p className="text-sm font-medium">{item.area}</p>
              {item.advice ? (
                <p className="text-sm wrap-break-word text-muted-foreground">
                  {item.advice}
                </p>
              ) : null}
              {item.resources.length > 0 ? (
                <ul className="flex flex-col gap-1">
                  {item.resources.map((resource) => (
                    <li key={resource.url}>
                      <a
                        href={resource.url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="group inline-flex items-start gap-1.5 text-sm text-blue-700 hover:underline dark:text-sky-400"
                      >
                        <ExternalLink className="mt-0.5 size-3.5 shrink-0" />
                        <span className="wrap-break-word">
                          {resource.title}
                          {resource.provider ? (
                            <span className="text-xs text-muted-foreground">
                              {" "}
                              · {resource.provider}
                            </span>
                          ) : null}
                        </span>
                      </a>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

/**
 * The feedback email the candidate gets after every scored interview — sent by
 * the backend on its own; this card only shows it and offers Resend.
 *
 * Hides itself on a backend without the feature. The technical failure reason
 * is for admins only: it names the mail server or the language model, which
 * means nothing to a recruiter and nothing they can act on.
 */
export function FeedbackEmailCard({ interviewId }: { interviewId: string }) {
  const user = useCurrentUser()
  const query = useFeedbackEmail(interviewId)
  const resend = useResendFeedbackEmail(interviewId)
  const [open, setOpen] = React.useState(false)

  if (query.isLoading) return <Skeleton className="h-28 w-full" />
  // Null is "this backend has no feedback email"; an error is shown as one.
  if (query.data === null) return null

  const state = query.data
  const busy =
    resend.isPending ||
    state?.status === "pending" ||
    state?.status === "sending"
  const chip = state ? statusChip(state) : null
  const canSend = state !== undefined && !busy

  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle className="flex items-center gap-2 font-bold">
          <Mail className="size-4 text-muted-foreground" />
          Candidate feedback email
        </CardTitle>
        <CardDescription>
          Sent automatically after the interview is scored: what went well and
          what to work on, with free learning links. It never includes a score.
        </CardDescription>
        {canSend ? (
          <CardAction>
            <Button size="sm" variant="outline" onClick={() => resend.mutate()}>
              <Send />
              {state.status === "none" ? "Send feedback" : "Resend"}
            </Button>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {query.isError ? (
          <p className="text-sm text-destructive">
            {query.error.message || "The feedback email couldn't be loaded."}
          </p>
        ) : state && chip ? (
          <>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
              <StatusBadge status={chip.status} label={chip.label} />
              {busy ? (
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
              ) : null}
              {state.to ? (
                <span className="text-muted-foreground">To {state.to}</span>
              ) : null}
              {state.status === "failed" ? (
                <span className="text-xs text-muted-foreground">
                  {state.attempts} of {FEEDBACK_MAX_ATTEMPTS} attempts
                </span>
              ) : null}
              {user.role === "admin" && state.lastError ? (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 text-xs text-muted-foreground underline underline-offset-2"
                      />
                    }
                  >
                    <Info className="size-3.5" />
                    Why?
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs wrap-break-word">
                    {state.lastError}
                  </TooltipContent>
                </Tooltip>
              ) : null}
            </div>

            {state.status === "none" ? (
              <p className="text-sm text-muted-foreground">
                No feedback email has been sent for this interview. It finished
                before feedback emails existed, or hasn&rsquo;t been queued yet.
                Use <strong>Send feedback</strong> to send one now.
              </p>
            ) : null}

            {state.email ? (
              <div className="flex flex-col gap-3">
                <button
                  type="button"
                  onClick={() => setOpen((current) => !current)}
                  aria-expanded={open}
                  className="inline-flex w-fit items-center gap-1 text-sm font-medium text-foreground hover:underline"
                >
                  <ChevronDown
                    className={cn(
                      "size-4 transition-transform",
                      open && "rotate-180"
                    )}
                  />
                  {open ? "Hide email" : "View email"}
                </button>
                {open ? <EmailPreview email={state.email} /> : null}
              </div>
            ) : state.status !== "none" ? (
              <p className="text-xs text-muted-foreground">
                The email appears here once it has been written.
              </p>
            ) : null}
          </>
        ) : null}
      </CardContent>
    </Card>
  )
}
