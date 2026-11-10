import * as React from "react"
import { Navigate, Route, Routes } from "react-router-dom"

import { ErrorBoundary } from "@/components/shared/error-boundary"
import { LoginPage } from "@/features/auth/login-page"
import { RequireAuth } from "@/features/auth/require-auth"
import { DashboardLayout } from "@/features/dashboard/dashboard-layout"
import { CrashScreen } from "@/features/interview/screens/status-screens"

/**
 * A route's page, fetched the first time it is opened rather than with the app.
 *
 * Everything used to ship as one bundle of about 1.5 MB, so a candidate opening
 * an invitation on a phone downloaded the whole hiring console before seeing a
 * single question. The shell stays eager — the router, the sign-in page, the
 * dashboard's frame — because it is small and every visit needs some of it.
 *
 * The pages are named exports, which `React.lazy` can't take directly.
 */
function lazyPage<Name extends string>(
  load: () => Promise<Record<Name, React.ComponentType>>,
  name: Name
) {
  return React.lazy(() => load().then((module) => ({ default: module[name] })))
}

const RecruiterLandingPage = lazyPage(
  () => import("@/recruiter-landing-page"),
  "RecruiterLandingPage"
)
const CandidateInterviewPage = lazyPage(
  () => import("@/features/interview/candidate-interview-page"),
  "CandidateInterviewPage"
)
const OverviewPage = lazyPage(
  () => import("@/features/dashboard/pages/overview-page"),
  "OverviewPage"
)
const AdminsPage = lazyPage(
  () => import("@/features/dashboard/pages/admins-page"),
  "AdminsPage"
)
const SystemSettingsPage = lazyPage(
  () => import("@/features/dashboard/pages/system-settings-page"),
  "SystemSettingsPage"
)
const ActivityLogsPage = lazyPage(
  () => import("@/features/dashboard/pages/activity-logs-page"),
  "ActivityLogsPage"
)
const ProfilePage = lazyPage(
  () => import("@/features/dashboard/pages/profile-page"),
  "ProfilePage"
)
const HrPage = lazyPage(
  () => import("@/features/dashboard/pages/hr-page"),
  "HrPage"
)
const JobsPage = lazyPage(
  () => import("@/features/dashboard/pages/jobs-page"),
  "JobsPage"
)
const JobShortlistPage = lazyPage(
  () => import("@/features/dashboard/pages/job-shortlist-page"),
  "JobShortlistPage"
)
const InterviewsPage = lazyPage(
  () => import("@/features/dashboard/pages/interviews-page"),
  "InterviewsPage"
)
const LiveInterviewsPage = lazyPage(
  () => import("@/features/dashboard/pages/live-interviews-page"),
  "LiveInterviewsPage"
)
const LiveInterviewPage = lazyPage(
  () => import("@/features/dashboard/pages/live-interview-page"),
  "LiveInterviewPage"
)
const ResultsPage = lazyPage(
  () => import("@/features/dashboard/pages/results-page"),
  "ResultsPage"
)
const InterviewResultPage = lazyPage(
  () => import("@/features/dashboard/pages/interview-result-page"),
  "InterviewResultPage"
)
const ResumeAnalyzerPage = lazyPage(
  () => import("@/features/dashboard/pages/resume-analyzer-page"),
  "ResumeAnalyzerPage"
)
const BrandingPage = lazyPage(
  () => import("@/features/dashboard/pages/branding-page"),
  "BrandingPage"
)

/**
 * Shown while a page outside the dashboard — the landing page, the candidate's
 * room — is still downloading. The same markup as the boot loader in
 * `index.html`, whose styles live in its `<head>` and so outlast it: the first
 * visit goes from that loader to this one with nothing changing on screen.
 */
function RouteLoader() {
  return (
    <div id="boot-loader" role="status" aria-live="polite">
      <div className="boot-spinner" aria-hidden="true" />
      <div className="boot-name">RecruiterAI</div>
      <div>Loading…</div>
    </div>
  )
}

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
    <React.Suspense fallback={<RouteLoader />}>
      <Routes>
        <Route path="/" element={<RecruiterLandingPage />} />
        <Route path="/login" element={<LoginPage />} />

        {/* Candidate-facing and deliberately unauthenticated: a candidate has no
          account, only a link and a one-time code. `/otp` is the path the
          backend puts in invitation emails. */}
        <Route path="/otp" element={<CandidateRoute />} />
        <Route path="/interview" element={<CandidateRoute />} />

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
            <Route
              path="results/:interviewId"
              element={<InterviewResultPage />}
            />
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
            <Route
              path="results/:interviewId"
              element={<InterviewResultPage />}
            />
            <Route path="resume-analyzer" element={<ResumeAnalyzerPage />} />
            <Route path="profile" element={<ProfilePage />} />
          </Route>
        </Route>

        {/* Unknown URL: send signed-in users home, everyone else to the site. */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </React.Suspense>
  )
}

/**
 * The candidate's own boundary, inside the app-wide one, so a crash in the room
 * speaks to a candidate rather than to staff. No `resetKey`: a candidate never
 * navigates within the app, so there is nothing to recover on.
 */
function CandidateRoute() {
  return (
    <ErrorBoundary name="candidate" fallback={() => <CrashScreen />}>
      <CandidateInterviewPage />
    </ErrorBoundary>
  )
}
