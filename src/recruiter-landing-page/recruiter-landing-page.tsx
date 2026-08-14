import * as React from "react"

import { Toaster } from "@/components/ui/sonner"
import { loadPixel, trackViewContent } from "@/lib/pixel"

import { SiteFooter, SiteNav } from "./chrome"
import { modules, navSections } from "./data"
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

  // The Meta Pixel is mounted here rather than in `index.html` so it belongs to
  // this route alone — see `loadPixel`. The candidate interview and the staff
  // console are on the same origin, and their URLs carry candidate identities.
  React.useEffect(() => {
    loadPixel()
  }, [])

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
      /*
       * Named per module — `Module: Proctoring` — rather than one shared event,
       * because which module a visitor opens is the interesting part: proctoring
       * and psychometrics are different buying conversations.
       *
       * A repeat click on the tab that is already open is dropped. It changes
       * nothing on screen, so counting it would only inflate whichever module a
       * visitor happened to land on first.
       */
      selectModule: (index) => {
        if (index !== selectedModule) {
          const module = modules[index]
          if (module) trackViewContent(`Module: ${module.shortName}`)
        }
        setSelectedModule(index)
      },
      /*
       * The two `trackViewContent` calls sit here, on the openers, rather than
       * on the buttons that call them — each dialog has more than one way in,
       * and per-button tracking counted whichever one happened to get wired.
       * The demo alone opens from the hero CTA, the "Live Preview" tab pinned to
       * the right edge, and a footer link; the playground from the API section
       * and from the module dialog.
       */
      openInterview: () => {
        trackViewContent("Live Interview Demo")
        setInterviewRun((run) => run + 1)
        setInterviewOpen(true)
      },
      openPlayground: (index) => {
        trackViewContent("Playground")
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
          // Its own opener rather than the context's, so it needs the event of
          // its own too. Left otherwise as it was: this path deliberately keeps
          // the current session id.
          onOpenPlayground={(index) => {
            trackViewContent("Playground")
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
