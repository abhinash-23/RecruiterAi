import { Link } from "react-router-dom"
import { BarChart3, ExternalLink } from "lucide-react"

import { MetaChip } from "@/components/shared/page-header"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { useCurrentUser } from "@/features/auth/auth-context"
import { ROLE_HOME } from "@/features/auth/types"
import { InterviewReportBody } from "@/features/dashboard/interview-report"
import { ReportDownloadButton } from "@/features/dashboard/report-downloads"
import { useInterviewReport } from "@/services/hr"

/**
 * One interview's report over the page it was opened from, so a recruiter
 * going down a job's shortlist doesn't lose their place (filters, page) for
 * every candidate they check.
 *
 * The same report as the results page — see `InterviewReportBody` — and read
 * only while open: `useInterviewReport` is disabled for a null id. "Open full
 * page" stays for anyone who wants a link to share or a tab of its own.
 */
export function InterviewReportDialog({
  interviewId,
  onClose,
}: {
  interviewId: string | null
  onClose: () => void
}) {
  const user = useCurrentUser()
  const { data, isLoading, isError } = useInterviewReport(
    interviewId ?? undefined
  )
  const results = data?.results ?? null

  return (
    <Dialog
      open={interviewId !== null}
      onOpenChange={(next) => !next && onClose()}
    >
      <DialogContent className="sm:max-w-5xl">
        <DialogHeader className="pr-8">
          <DialogTitle className="flex flex-wrap items-center gap-2 text-lg font-bold">
            <BarChart3 className="size-5 text-accent-brand" />
            {data?.candidateName ?? "Interview results"}
          </DialogTitle>
          <DialogDescription>
            {data
              ? `${data.role} · ${data.candidateEmail}`
              : "The candidate's interview report."}
          </DialogDescription>
          {data ? (
            <div className="flex flex-wrap items-center gap-2">
              {results ? (
                <>
                  <MetaChip tone={results.selected ? "success" : "danger"}>
                    {results.selected ? "Selected" : "Not selected"}
                  </MetaChip>
                  <MetaChip>Scored {results.overallScore} / 100</MetaChip>
                </>
              ) : (
                <MetaChip tone="warning">Report pending</MetaChip>
              )}
              {data.voiceHost ? (
                <MetaChip>
                  Interviewed by {data.voiceHost.name}
                  {data.voiceHost.languageLabel
                    ? ` · ${data.voiceHost.languageLabel}`
                    : ""}
                </MetaChip>
              ) : null}
              <div className="ml-auto flex flex-wrap items-center gap-2">
                {/* Only with a result: the endpoint answers 409 before one. */}
                {results ? (
                  <ReportDownloadButton interviewId={data.interviewId} />
                ) : null}
                <Button
                  variant="outline"
                  nativeButton={false}
                  render={
                    <Link
                      to={`${ROLE_HOME[user.role]}/results/${data.interviewId}`}
                    />
                  }
                >
                  <ExternalLink />
                  Open full page
                </Button>
              </div>
            </div>
          ) : null}
        </DialogHeader>

        {isLoading ? (
          <div className="flex flex-col gap-4">
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-72 w-full" />
          </div>
        ) : isError || !data ? (
          <div className="flex flex-col gap-1 py-6">
            <p className="font-medium">This report isn&rsquo;t available.</p>
            <p className="text-sm text-muted-foreground">
              The interview may not exist, or it belongs to a colleague. The API
              doesn&rsquo;t distinguish the two.
            </p>
          </div>
        ) : (
          // `min-w-0`: a grid item otherwise grows to its widest child, and
          // the tab list and long answers would push the dialog sideways.
          <div className="flex min-w-0 flex-col gap-4">
            <InterviewReportBody report={data} />
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
