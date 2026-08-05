import { Navigate, Route, Routes } from "react-router-dom"

import { LoginPage } from "@/features/auth/login-page"
import { RequireAuth } from "@/features/auth/require-auth"
import { DashboardLayout } from "@/features/dashboard/dashboard-layout"
import { ActivityLogsPage } from "@/features/dashboard/pages/activity-logs-page"
import { AdminsPage } from "@/features/dashboard/pages/admins-page"
import { BrandingPage } from "@/features/dashboard/pages/branding-page"
import { HrPage } from "@/features/dashboard/pages/hr-page"
import { InterviewResultPage } from "@/features/dashboard/pages/interview-result-page"
import { InterviewsPage } from "@/features/dashboard/pages/interviews-page"
import { JobShortlistPage } from "@/features/dashboard/pages/job-shortlist-page"
import { JobsPage } from "@/features/dashboard/pages/jobs-page"
import { LiveInterviewPage } from "@/features/dashboard/pages/live-interview-page"
import { LiveInterviewsPage } from "@/features/dashboard/pages/live-interviews-page"
import { OverviewPage } from "@/features/dashboard/pages/overview-page"
import { ProfilePage } from "@/features/dashboard/pages/profile-page"
import { ResultsPage } from "@/features/dashboard/pages/results-page"
import { ResumeAnalyzerPage } from "@/features/dashboard/pages/resume-analyzer-page"
import { SystemSettingsPage } from "@/features/dashboard/pages/system-settings-page"
import { CandidateInterviewPage } from "@/features/interview/candidate-interview-page"
import { RecruiterLandingPage } from "@/recruiter-landing-page"

/**
 * Route table, mirroring the API's own hierarchy.
 *
 * Each role's subtree is wrapped in `RequireAuth` with its allowed roles, so an
 * Admin URL typed by an HR user redirects rather than rendering. That is
 * cosmetic only — the server re-checks every request.
 *
 * Admin and HR share the whole hiring funnel because the API does: every
 * `/api/hr/*` endpoint accepts an admin token and answers with company-wide
 * data instead of just that user's.
 */
export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<RecruiterLandingPage />} />
      <Route path="/login" element={<LoginPage />} />

      {/* Candidate-facing and deliberately unauthenticated: a candidate has no
          account, only a link and a one-time code. `/otp` is the path the
          backend puts in invitation emails. */}
      <Route path="/otp" element={<CandidateInterviewPage />} />
      <Route path="/interview" element={<CandidateInterviewPage />} />

      {/* ---------------------------------------------------- Super Admin - */}
      <Route element={<RequireAuth roles={["super_admin"]} />}>
        <Route path="/super-admin" element={<DashboardLayout />}>
          <Route index element={<OverviewPage />} />
          <Route path="admins" element={<AdminsPage />} />
          <Route path="settings" element={<SystemSettingsPage />} />
          <Route path="activity" element={<ActivityLogsPage />} />
          <Route path="profile" element={<ProfilePage />} />
        </Route>
      </Route>

      {/* ---------------------------------------------------------- Admin - */}
      <Route element={<RequireAuth roles={["admin"]} />}>
        <Route path="/admin" element={<DashboardLayout />}>
          <Route index element={<OverviewPage />} />
          <Route path="hr" element={<HrPage />} />
          <Route path="jobs" element={<JobsPage />} />
          <Route path="jobs/:jobId" element={<JobShortlistPage />} />
          <Route path="interviews" element={<InterviewsPage />} />
          <Route path="live" element={<LiveInterviewsPage />} />
          <Route path="live/:interviewId" element={<LiveInterviewPage />} />
          <Route path="results" element={<ResultsPage />} />
          <Route path="results/:interviewId" element={<InterviewResultPage />} />
          <Route path="resume-analyzer" element={<ResumeAnalyzerPage />} />
          <Route path="branding" element={<BrandingPage />} />
          <Route path="activity" element={<ActivityLogsPage />} />
          <Route path="profile" element={<ProfilePage />} />
        </Route>
      </Route>

      {/* ------------------------------------------------------------- HR - */}
      <Route element={<RequireAuth roles={["hr"]} />}>
        <Route path="/hr" element={<DashboardLayout />}>
          <Route index element={<OverviewPage />} />
          <Route path="jobs" element={<JobsPage />} />
          <Route path="jobs/:jobId" element={<JobShortlistPage />} />
          <Route path="interviews" element={<InterviewsPage />} />
          <Route path="live" element={<LiveInterviewsPage />} />
          <Route path="live/:interviewId" element={<LiveInterviewPage />} />
          <Route path="results" element={<ResultsPage />} />
          <Route path="results/:interviewId" element={<InterviewResultPage />} />
          <Route path="resume-analyzer" element={<ResumeAnalyzerPage />} />
          <Route path="profile" element={<ProfilePage />} />
        </Route>
      </Route>

      {/* Unknown URL: send signed-in users home, everyone else to the site. */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
