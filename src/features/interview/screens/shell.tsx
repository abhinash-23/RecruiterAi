import * as React from "react"
import { Loader2 } from "lucide-react"

import { ApiImage } from "@/components/shared/api-image"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

/**
 * Centred card used by every step before the room itself.
 *
 * The room is the exception on purpose: it is a three-column workspace, not a
 * card, so it does not come through here.
 */
export function Shell({
  title,
  description,
  children,
  footer,
  logoUrl,
}: {
  title: string
  description?: string
  children?: React.ReactNode
  footer?: React.ReactNode
  /** The hiring company's logo, when their branding has one. */
  logoUrl?: string | null
}) {
  return (
    <div className="flex min-h-svh items-center justify-center bg-muted/30 p-6">
      <Card className="w-full max-w-lg">
        {/* Above the title on every step before the room, so the candidate sees
            whose process this is from the first screen. */}
        {logoUrl ? (
          <div className="px-6">
            <ApiImage
              src={logoUrl}
              alt="Company logo"
              className="h-8 w-auto max-w-44 object-contain"
            />
          </div>
        ) : null}
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </CardHeader>
        {children ? <CardContent>{children}</CardContent> : null}
        {footer ? (
          <CardFooter className="justify-end gap-2">{footer}</CardFooter>
        ) : null}
      </Card>
    </div>
  )
}

/**
 * What the candidate sees while `verify-otp` is in flight.
 *
 * That call is not a code check — it is where the server writes the whole
 * question set, and it routinely runs for the better part of a minute. A spinner
 * inside the Start button leaves the form on screen looking as though nothing
 * happened, and a candidate who presses it again, or reloads, loses the sitting.
 * So the card becomes the wait: it says what is being built, and that it is
 * theirs to leave alone.
 */
export function PreparingCard({
  logoUrl,
  role,
}: {
  logoUrl: string | null
  role: string
}) {
  // Only for the reassurance line. Deliberately not a progress bar: the server
  // reports no progress, and a bar that invents one is a lie that also stalls
  // visibly at 90%.
  const [seconds, setSeconds] = React.useState(0)
  React.useEffect(() => {
    const timer = window.setInterval(() => setSeconds((n) => n + 1), 1000)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <Shell
      logoUrl={logoUrl}
      title="Preparing your interview"
      description={`Your questions are being written for the ${role} role. This usually takes under a minute.`}
    >
      <div className="flex items-center gap-3 rounded-xl border p-4">
        <Loader2 className="size-5 shrink-0 animate-spin text-brand-blue" />
        <div className="min-w-0">
          <p className="text-sm font-medium">
            {seconds < 30
              ? "Building your question set…"
              : "Still working — this one's taking longer than usual."}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Keep this tab open. It starts on its own when it&rsquo;s ready —
            there&rsquo;s nothing else to press.
          </p>
        </div>
      </div>
    </Shell>
  )
}

/**
 * What the candidate sees while the sitting is being submitted.
 *
 * The same reasoning as {@link PreparingCard}: this is not a round trip. It seals
 * the video with the recording service, then scores every answer server-side, and
 * the two together routinely run for several seconds. A spinner inside the Send
 * button leaves the room on screen, apparently idle and apparently still
 * answerable — and the one thing that must not happen here is a candidate
 * deciding it has hung and closing the tab, because that is the difference
 * between a sealed recording and a truncated one.
 *
 * So the card takes over, and it says the one thing that matters: don't leave.
 */
export function SubmittingCard({
  logoUrl,
  answered,
  total,
}: {
  logoUrl: string | null
  answered: number
  total: number
}) {
  return (
    <Shell
      logoUrl={logoUrl}
      title="Submitting your interview"
      description={`Scoring your ${answered} of ${total} answers and saving your recording.`}
    >
      <div className="flex items-center gap-3 rounded-xl border p-4">
        <Loader2 className="size-5 shrink-0 animate-spin text-brand-blue" />
        <div className="min-w-0">
          <p className="text-sm font-medium">Finishing up…</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Please keep this tab open until it finishes. It moves on by itself —
            there&rsquo;s nothing left to press.
          </p>
        </div>
      </div>
    </Shell>
  )
}

/** The gap between a session existing and its first question being ready. */
export function LoadingScreen({ logoUrl }: { logoUrl: string | null }) {
  return (
    <Shell logoUrl={logoUrl} title="Preparing your interview">
      <Loader2 className="size-5 animate-spin text-muted-foreground" />
    </Shell>
  )
}
