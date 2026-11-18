import { Link, useParams } from "react-router-dom"
import { ArrowLeft, BarChart3 } from "lucide-react"

import { MetaChip, PageHeader } from "@/components/shared/page-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useCurrentUser } from "@/features/auth/auth-context"
import { ROLE_HOME } from "@/features/auth/types"
import { InterviewReportBody } from "@/features/dashboard/interview-report"
import { ReportDownloadButton } from "@/features/dashboard/report-downloads"
import { useInterviewReport } from "@/services/hr"

/**
 * The full report for one interview, from `GET /api/get-results/{id}`.
 *
 * The header fields exist from the moment the interview is scheduled; the
 * `results` body is null until the candidate finishes, so the page renders a
 * "not finished yet" state rather than an error for an interview in flight.
 */
export function InterviewResultPage() {
  const { interviewId } = useParams<{ interviewId: string }>()
  const user = useCurrentUser()
  const { data, isLoading, isError } = useInterviewReport(interviewId)

  const backHref = `${ROLE_HOME[user.role]}/results`

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-10 w-72 max-w-full" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    )
  }

  if (isError || !data) {
    return (
      <Card>
        <CardContent className="flex flex-col items-start gap-3 py-8">
          <p className="font-medium">This report isn&rsquo;t available.</p>
          <p className="text-sm text-muted-foreground">
            The interview may not exist, or it belongs to a colleague. The API
            doesn&rsquo;t distinguish the two.
          </p>
          <Button
            variant="outline"
            nativeButton={false}
            render={<Link to={backHref} />}
          >
            <ArrowLeft />
            Back to results
          </Button>
        </CardContent>
      </Card>
    )
  }

  const { results } = data

  return (
    <>
      <PageHeader
        title={data.candidateName}
        icon={BarChart3}
        description={`${data.role} · ${data.candidateEmail}`}
        meta={
          <>
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
            {/* Who asked, and in what language: a Hindi sitting's answers
                read differently from an English one's, and the reader should
                know before they get to them. */}
            {data.voiceHost ? (
              <MetaChip>
                Interviewed by {data.voiceHost.name}
                {data.voiceHost.languageLabel
                  ? ` · ${data.voiceHost.languageLabel}`
                  : ""}
              </MetaChip>
            ) : null}
          </>
        }
        actions={
          <>
            <Button
              variant="outline"
              nativeButton={false}
              render={<Link to={backHref} />}
            >
              <ArrowLeft />
              Back to results
            </Button>
            {/* Only with a result: the endpoint answers 409 before one. */}
            {results ? (
              <ReportDownloadButton interviewId={data.interviewId} />
            ) : null}
          </>
        }
      />

      <InterviewReportBody report={data} />
    </>
  )
}
