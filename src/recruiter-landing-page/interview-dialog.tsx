import * as React from "react"
import {
  AlertCircle,
  ArrowRight,
  BadgeCheck,
  Check,
  ShieldCheck,
  Video,
} from "lucide-react"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { consentStatements } from "./data"
import { type SessionMetrics, useInterviewSession } from "./hooks"
import { BrandButton, BrandDialog, SignalBar } from "./ui"

interface InterviewDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

function StepIcon({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto mb-5 flex size-16 items-center justify-center rounded-full border-2 border-brand-blue bg-brand-blue/5 text-brand-blue [&_svg]:size-7">
      {children}
    </div>
  )
}

function PanelTitle({
  children,
  band,
  className,
}: {
  children: React.ReactNode
  band?: string
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between text-[11px] font-bold tracking-[0.05em] text-ink/40 uppercase",
        className
      )}
    >
      <span>{children}</span>
      {band ? (
        <span className="text-[10px] font-medium tracking-normal normal-case opacity-60">
          {band}
        </span>
      ) : null}
    </div>
  )
}

function MetricRow({
  label,
  value,
  bar,
  tone = "brand",
}: {
  label: string
  value: React.ReactNode
  bar: number
  tone?: "brand" | "amber"
}) {
  return (
    <div className="rounded-[10px] border border-hairline bg-surface p-3">
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-xs font-semibold text-ink/60">{label}</span>
        <span
          className={cn(
            "text-base font-extrabold",
            tone === "amber" ? "text-[#d97706]" : "text-ink"
          )}
        >
          {value}
        </span>
      </div>
      <SignalBar value={bar} tone={tone} aria-label={label} />
    </div>
  )
}

function LiveMetricsPanel({ metrics }: { metrics: SessionMetrics }) {
  return (
    <div className="scrollbar-none flex min-h-0 flex-col gap-3 overflow-y-auto bg-surface-alt p-5">
      <PanelTitle band="±5% band">Live Module Metrics</PanelTitle>
      <MetricRow
        label="Attention"
        value={`${metrics.attention}%`}
        bar={metrics.attention}
      />
      <MetricRow
        label="Confidence"
        value={metrics.confidence}
        bar={metrics.confidence}
      />
      <MetricRow
        label="Engagement"
        value={metrics.engagement}
        bar={metrics.engagement}
      />
      <MetricRow
        label="Stress Index"
        value={metrics.stress}
        bar={metrics.stress}
        tone="amber"
      />

      <PanelTitle band="consent-based · illustrative" className="mt-4.5">
        Vitals · rPPG
      </PanelTitle>
      <div className="grid grid-cols-2 gap-1.5">
        {[
          { label: "Heart Rate", value: metrics.hr },
          { label: "HRV", value: metrics.hrv },
        ].map((cell) => (
          <div
            key={cell.label}
            className="rounded-lg border border-hairline bg-surface px-3 py-2.5"
          >
            <div className="text-[10px] font-semibold tracking-[0.04em] text-ink/40 uppercase">
              {cell.label}
            </div>
            <div className="mt-0.5 text-base font-bold text-ink">
              {cell.value}
            </div>
          </div>
        ))}
      </div>

      <PanelTitle band="review required" className="mt-4.5">
        Risk &amp; Composite
      </PanelTitle>
      <MetricRow
        label="Signal Confidence"
        value={metrics.risk}
        bar={metrics.risk}
        tone="amber"
      />
      <MetricRow
        label="Composite Score"
        value={<span className="text-brand-blue">{metrics.composite}</span>}
        bar={metrics.composite}
      />
    </div>
  )
}

export function InterviewDialog({ open, onOpenChange }: InterviewDialogProps) {
  const videoRef = React.useRef<HTMLVideoElement>(null)
  const chatListRef = React.useRef<HTMLDivElement>(null)
  const session = useInterviewSession(videoRef)
  const [draft, setDraft] = React.useState("")
  const { stopStream, messages } = session

  // Release the camera as soon as the dialog is dismissed. A fresh session is
  // started by remounting (the parent keys this dialog per opening).
  React.useEffect(() => {
    if (!open) stopStream()
  }, [open, stopStream])

  // Keep the newest message in view by scrolling the list itself — using
  // scrollIntoView here would also scroll the surrounding dialog body.
  React.useEffect(() => {
    const list = chatListRef.current
    if (list) list.scrollTop = list.scrollHeight
  }, [messages])

  const send = () => {
    const text = draft
    setDraft("")
    void session.submitAnswer(text)
  }

  return (
    <BrandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Live Interview Session"
      width="max-w-[1100px] sm:max-w-[1100px]"
      // The live session fills the panel and scrolls its own chat list; below
      // lg it stacks into one column, so the body scrolls again there.
      bodyScroll={session.step !== "session"}
      fillHeight={session.step === "session"}
      bodyClassName={
        session.step === "session" ? "max-lg:overflow-y-auto" : undefined
      }
    >
      <>
        {/* ---------- Consent gate ---------- */}
        {session.step === "consent" ? (
          <div className="px-8 py-6 max-md:px-5">
            <div className="mx-auto max-w-[540px] text-center">
              <StepIcon>
                <ShieldCheck strokeWidth={2.5} />
              </StepIcon>
              <h3 className="mb-2 text-2xl font-extrabold text-ink">
                Before we begin
              </h3>
              <p className="mb-5 text-[14.5px] leading-relaxed text-ink/60">
                This is a guided interview session. The system will analyze your
                responses, attention, and behavior in real time. All data
                remains strictly within this session.
              </p>

              <div className="mb-2 flex justify-end">
                <button
                  type="button"
                  onClick={session.toggleAllConsent}
                  className="cursor-pointer rounded-md px-2 py-1 text-[13px] font-semibold text-brand-blue transition-colors hover:bg-brand-blue/5"
                >
                  {session.allConsented ? "Deselect All" : "Select All"}
                </button>
              </div>

              <div className="mb-6 flex flex-col gap-2 text-left">
                {consentStatements.map((item) => (
                  <Label
                    key={item.id}
                    className="flex cursor-pointer items-start gap-3 rounded-xl border border-hairline bg-surface-alt p-3.5 text-sm font-normal text-ink transition-all select-none hover:border-brand-blue/15 hover:bg-brand-blue/5"
                  >
                    <Checkbox
                      checked={Boolean(session.consents[item.id])}
                      onCheckedChange={() => session.toggleConsent(item.id)}
                      className="mt-px size-5 rounded-md border-2 border-hairline data-checked:border-transparent data-checked:brand-gradient"
                    />
                    <span>{item.label}</span>
                  </Label>
                ))}
              </div>

              <BrandButton
                tone="primary"
                disabled={!session.allConsented}
                onClick={() => session.setStep("camera")}
              >
                <ArrowRight />
                Continue
              </BrandButton>
            </div>
          </div>
        ) : null}

        {/* ---------- Camera handshake ---------- */}
        {session.step === "camera" ? (
          <div className="px-8 py-6 max-md:px-5">
            <div className="mx-auto max-w-[540px] text-center">
              <StepIcon>
                <Video strokeWidth={2.5} />
              </StepIcon>
              <h3 className="mb-2 text-2xl font-extrabold text-ink">
                Camera &amp; Microphone
              </h3>
              <p className="mb-5 text-[14.5px] leading-relaxed text-ink/60">
                We will request permission to access your camera and microphone.
                This enables face tracking, gaze analysis, and live
                transcription.
              </p>

              {session.cameraError ? (
                <div className="mb-5 flex items-start gap-2.5 rounded-[10px] border border-red-500/20 bg-red-500/8 px-4 py-3.5 text-left text-[13px] text-red-500">
                  <AlertCircle className="mt-px size-5 shrink-0" />
                  <div>{session.cameraError}</div>
                </div>
              ) : null}

              {session.devices ? (
                <div className="mb-5 flex flex-col gap-2.5 text-left">
                  {session.devices.cameras.length > 1 ? (
                    <div className="flex flex-col gap-1">
                      <Label className="text-xs font-semibold text-ink/60">
                        Camera
                      </Label>
                      <Select
                        value={session.selectedCamera}
                        onValueChange={(value) =>
                          session.setSelectedCamera(String(value))
                        }
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="System default" />
                        </SelectTrigger>
                        <SelectContent>
                          {session.devices.cameras.map((device, i) => (
                            <SelectItem
                              key={device.deviceId}
                              value={device.deviceId}
                            >
                              {device.label || `Camera ${i + 1}`}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ) : null}

                  {session.devices.microphones.length > 1 ? (
                    <div className="flex flex-col gap-1">
                      <Label className="text-xs font-semibold text-ink/60">
                        Microphone
                      </Label>
                      <Select
                        value={session.selectedMic}
                        onValueChange={(value) =>
                          session.setSelectedMic(String(value))
                        }
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="System default" />
                        </SelectTrigger>
                        <SelectContent>
                          {session.devices.microphones.map((device, i) => (
                            <SelectItem
                              key={device.deviceId}
                              value={device.deviceId}
                            >
                              {device.label || `Mic ${i + 1}`}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {session.cameraStatus ? (
                <div
                  className={cn(
                    "mb-6 text-sm",
                    session.cameraError ? "text-red-500" : "text-ink/60"
                  )}
                >
                  {session.cameraStatus}
                </div>
              ) : null}

              <div className="flex flex-wrap justify-center gap-3">
                <BrandButton tone="ghost" onClick={() => onOpenChange(false)}>
                  Cancel
                </BrandButton>
                <BrandButton
                  tone="primary"
                  disabled={session.requesting}
                  onClick={() => void session.startCamera()}
                >
                  {session.requesting
                    ? "Requesting access…"
                    : session.cameraError
                      ? "Retry Camera Access"
                      : "Allow Camera & Start"}
                </BrandButton>
                {session.cameraError ? (
                  <BrandButton tone="ghost" onClick={session.useDemoVideo}>
                    Use Demo Video Instead
                  </BrandButton>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}

        {/* ---------- Live session ---------- */}
        {session.step === "session" ? (
          <div className="grid h-full grid-cols-[1.3fr_1fr] grid-rows-[minmax(0,1fr)] max-lg:h-auto max-lg:min-h-[520px] max-lg:grid-cols-1 max-lg:grid-rows-none">
            <div className="flex min-h-0 flex-col gap-4 overflow-hidden border-r border-hairline p-5 max-lg:border-r-0 max-lg:border-b">
              <div className="flex items-center gap-1.5 self-start rounded-full border border-brand-blue/15 bg-brand-blue/5 px-3 py-1.5 text-[11px] font-semibold text-brand-blue">
                <BadgeCheck className="size-3" strokeWidth={2.5} />
                Consent verified · session active
              </div>

              <div className="flex gap-1">
                {Array.from({ length: session.totalQuestions }).map((_, i) => (
                  <span
                    key={i}
                    className={cn(
                      "h-1 flex-1 rounded-sm transition-colors",
                      i < session.questionIndex
                        ? "bg-brand-blue"
                        : i === session.questionIndex
                          ? "animate-(--animate-brand-pulse) bg-brand-pink opacity-50"
                          : "bg-hairline"
                    )}
                  />
                ))}
              </div>

              <div className="relative aspect-16/10 w-full shrink-0 overflow-hidden rounded-[14px] bg-surface-dark">
                <video
                  ref={videoRef}
                  autoPlay
                  muted
                  playsInline
                  className={cn(
                    "size-full -scale-x-100 bg-surface-dark object-cover",
                    session.demoMode && "hidden"
                  )}
                />
                {session.demoMode ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-5 text-center text-sm text-white/50">
                    <Video className="size-12 opacity-30" strokeWidth={1.5} />
                    <span>Camera preview unavailable</span>
                  </div>
                ) : null}

                <div className="pointer-events-none absolute inset-0">
                  <div className="face-brackets absolute top-[15%] left-1/4 h-[70%] w-1/2 animate-(--animate-face-track) rounded-xl border-2 border-brand-blue shadow-[0_0_0_3px_rgba(0,82,255,0.12)]" />
                  <div className="absolute top-3 right-3 rounded-md bg-brand-blue/90 px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur-sm">
                    Gaze: {session.gaze}
                  </div>
                </div>
              </div>

              <div
                ref={chatListRef}
                className="scrollbar-none flex min-h-30 flex-1 flex-col gap-2.5 overflow-y-auto pr-1"
              >
                {session.messages.map((message) => (
                  <div
                    key={message.id}
                    className={cn(
                      "max-w-[85%] rounded-xl px-3.5 py-3 text-[13px] leading-normal",
                      message.sender === "ai"
                        ? "self-start border border-hairline bg-surface-alt text-ink"
                        : "self-end brand-gradient text-white"
                    )}
                  >
                    <div className="mb-1 text-[10px] font-bold tracking-[0.04em] uppercase opacity-70">
                      {message.sender === "ai" ? "SYSTEM" : "CANDIDATE"}
                    </div>
                    <span
                      className={cn(message.pending && "italic opacity-60")}
                    >
                      {message.text}
                    </span>
                  </div>
                ))}
              </div>

              <div className="flex gap-2">
                <Input
                  value={draft}
                  disabled={session.awaitingModel}
                  placeholder="Type your response..."
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault()
                      send()
                    }
                  }}
                  className="h-auto flex-1 rounded-[10px] border-hairline bg-surface px-3.5 py-2.5 text-[13px] text-ink focus-visible:border-brand-blue focus-visible:ring-0"
                />
                <BrandButton
                  tone="primary"
                  scale="sm"
                  disabled={session.awaitingModel || !draft.trim()}
                  onClick={send}
                  className="shadow-none hover:translate-y-0 hover:shadow-none"
                >
                  Send
                </BrandButton>
              </div>
            </div>

            <LiveMetricsPanel metrics={session.metrics} />
          </div>
        ) : null}

        {/* ---------- Summary ---------- */}
        {session.step === "summary" ? (
          <div className="px-5 py-10 text-center">
            <StepIcon>
              <Check strokeWidth={2.5} />
            </StepIcon>
            <h3 className="mb-2 text-2xl font-extrabold text-ink">
              Session Complete
            </h3>
            <p className="mb-7 text-sm text-ink/60">
              All ten modules have completed their analysis. Here is the
              consolidated output for your review.
            </p>

            <div className="mx-auto mb-6 grid max-w-[640px] grid-cols-3 gap-3.5 max-md:grid-cols-1">
              {[
                {
                  value: session.summary.composite,
                  label: "Composite Score",
                  tone: "text-brand-blue",
                },
                {
                  value: session.summary.risk,
                  label: "Signal Confidence",
                  tone: "text-[#d97706]",
                },
                {
                  value: session.summary.fit,
                  label: "Role Fit",
                  tone: "text-brand-blue",
                },
              ].map((card) => (
                <div
                  key={card.label}
                  className="rounded-[14px] border border-hairline bg-surface-alt p-4.5 text-center"
                >
                  <div
                    className={cn(
                      "text-[32px] font-extrabold tracking-[-0.02em]",
                      card.tone
                    )}
                  >
                    {card.value}
                  </div>
                  <div className="mt-1 text-xs font-semibold text-ink/60">
                    {card.label}
                  </div>
                </div>
              ))}
            </div>

            <div className="mx-auto mb-6 flex max-w-[640px] items-start gap-2.5 rounded-xl border border-brand-blue/15 bg-brand-blue/5 p-4 text-left text-[13px] leading-relaxed text-ink">
              <BadgeCheck
                className="mt-px size-5 shrink-0 text-brand-blue"
                strokeWidth={2.5}
              />
              <span>
                <strong>The system supports hiring decisions.</strong> Final
                decisions remain entirely human-controlled. This summary is a
                recommendation based on session signals—please review the full
                transcript and module breakdown before proceeding.
              </span>
            </div>

            <div className="flex flex-wrap justify-center gap-3">
              <BrandButton tone="ghost" onClick={() => onOpenChange(false)}>
                Close
              </BrandButton>
              <BrandButton
                tone="primary"
                onClick={() => {
                  onOpenChange(false)
                  document
                    .getElementById("access")
                    ?.scrollIntoView({ behavior: "smooth" })
                }}
              >
                Request Full Report
              </BrandButton>
            </div>
          </div>
        ) : null}
      </>
    </BrandDialog>
  )
}
