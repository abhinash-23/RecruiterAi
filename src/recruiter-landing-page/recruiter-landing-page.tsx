import * as React from "react"

import { Toaster } from "@/components/ui/sonner"

import { SiteFooter, SiteNav } from "./chrome"
import { navSections } from "./data"
import { ModuleDetailsDialog, PlaygroundDialog } from "./dialogs"
import { useNavState, useScrollReveal } from "./hooks"
import { InterviewDialog } from "./interview-dialog"
import {
  ApiSection,
  HeroSection,
  HowItWorksSection,
  ProofBand,
  RequestAccessSection,
  TrustSection,
} from "./sections"
import {
  LandingProvider,
  LivePreviewFab,
  MouseGlow,
  type LandingContextValue,
} from "./ui"

/** Illustrative session id shown in the API playground. */
function newSessionId() {
  return `sess_${Math.random().toString(36).slice(2, 10)}`
}

/**
 * RecruiterAI marketing site: hero command centre, proof band, process,
 * trust posture, module/API explorer, and the access request form — plus the
 * three dialogs (live interview, module details, API playground).
 */
export function RecruiterLandingPage() {
  const rootRef = React.useRef<HTMLDivElement | null>(null)
  const navState = useNavState(navSections)
  useScrollReveal(rootRef)

  const [selectedModule, setSelectedModule] = React.useState(0)
  const [interviewOpen, setInterviewOpen] = React.useState(false)
  const [playgroundOpen, setPlaygroundOpen] = React.useState(false)
  const [detailsOpen, setDetailsOpen] = React.useState(false)

  // Bumped on each opening so the dialogs remount with fresh state, and a new
  // demo session id is minted for the playground.
  const [interviewRun, setInterviewRun] = React.useState(0)
  const [playgroundSession, setPlaygroundSession] = React.useState(newSessionId)

  const scrollToSection = React.useCallback((id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" })
  }, [])

  const landing = React.useMemo<LandingContextValue>(
    () => ({
      scrollToSection,
      selectedModule,
      selectModule: setSelectedModule,
      openInterview: () => {
        setInterviewRun((run) => run + 1)
        setInterviewOpen(true)
      },
      openPlayground: (index) => {
        if (index !== undefined) setSelectedModule(index)
        setPlaygroundSession(newSessionId())
        setPlaygroundOpen(true)
      },
      openModuleDetails: (index) => {
        if (index !== undefined) setSelectedModule(index)
        setDetailsOpen(true)
      },
    }),
    [scrollToSection, selectedModule]
  )

  return (
    <LandingProvider value={landing}>
      <div
        ref={rootRef}
        className="recruiter-landing min-h-svh overflow-x-hidden bg-surface leading-normal text-ink"
      >
        <MouseGlow />
        <LivePreviewFab />
        <SiteNav navState={navState} />

        <main>
          <HeroSection />
          <ProofBand />
          <HowItWorksSection />
          <TrustSection />
          <ApiSection />
          <RequestAccessSection />
        </main>

        <SiteFooter />

        <InterviewDialog
          key={`interview-${interviewRun}`}
          open={interviewOpen}
          onOpenChange={setInterviewOpen}
        />
        <PlaygroundDialog
          key={playgroundSession}
          open={playgroundOpen}
          onOpenChange={setPlaygroundOpen}
          moduleIndex={selectedModule}
          sessionId={playgroundSession}
        />
        <ModuleDetailsDialog
          open={detailsOpen}
          onOpenChange={setDetailsOpen}
          moduleIndex={selectedModule}
          onOpenPlayground={(index) => {
            setSelectedModule(index)
            setPlaygroundOpen(true)
          }}
          onViewDocs={() => scrollToSection("api")}
        />

        <Toaster position="bottom-center" />
      </div>
    </LandingProvider>
  )
}

export default RecruiterLandingPage
