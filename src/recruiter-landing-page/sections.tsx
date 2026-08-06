/**
 * Every content band on the landing page, in the order they appear: hero (and
 * the command-centre panel inside it), how it works, the proof band, trust,
 * the API section with its explorer, and the request-access form.
 */
import * as React from "react"
import {
  Activity,
  ArrowRight,
  Check,
  Eye,
  FileText,
  Gauge,
  Globe,
  Info,
  type LucideIcon,
  Mic,
  Play,
  ShieldCheck,
} from "lucide-react"
import { PhoneInput } from "@/components/shared/phone-input"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import {
  activeModuleRows,
  companySizes,
  howSteps,
  modules,
  oceanTraits,
  rotatorWords,
  trustCards,
  useCases,
} from "./data"
import { useStaggeredSteps, useWordRotator } from "./hooks"
import {
  BrandButton,
  HighlightedCode,
  SectionHeading,
  SignalBar,
  useLanding,
} from "./ui"
/* ==========================================================================
   hero-section.tsx
   ========================================================================== */

export function HeroSection() {
  const { openInterview, scrollToSection } = useLanding()
  const slotRef = React.useRef<HTMLSpanElement>(null)
  const measureRef = React.useRef<HTMLSpanElement>(null)
  const { current, previous, width } = useWordRotator(rotatorWords, {
    slotRef,
    measureRef,
  })

  const wordClass =
    "absolute top-0 left-0 flex h-[1.2em] items-center leading-[1.2] font-extrabold whitespace-nowrap text-brand-pink transition-[transform,opacity] duration-500 ease-[cubic-bezier(0.65,0,0.35,1)]"

  return (
    <section
      id="home"
      data-nav-theme="dark"
      className="relative overflow-hidden px-8 pt-40 pb-20 text-center max-md:px-5 max-md:pt-30 max-md:pb-15"
    >
      {/* Background reel + scrim. Kept in positive stacking order so the
          layers paint above the page background, not behind it. */}
      <div className="absolute inset-0 z-0 bg-surface-dark bg-cover bg-center">
        <video
          autoPlay
          muted
          loop
          playsInline
          data-decorative="true"
          className="absolute inset-0 size-full object-cover"
        >
          <source src="/demo.mp4" type="video/mp4" />
        </video>
      </div>
      <div className="absolute inset-0 z-1 bg-linear-180 from-surface-dark/85 via-surface-dark/60 to-surface-dark/90" />

      <div className="relative z-2 mx-auto max-w-[940px]">
        <h1
          className="mb-7 flex reveal flex-wrap items-baseline justify-center gap-x-[0.3em] gap-y-[0.2em] text-[clamp(36px,5.5vw,68px)] leading-[1.2] font-extrabold tracking-[-0.03em] text-white"
          data-revealed="true"
        >
          {/* Rotating verb: width animates so the rest of the line glides */}
          <span
            ref={slotRef}
            className="relative inline-block h-[1.2em] align-bottom leading-[1.2] transition-[width] duration-450 ease-[cubic-bezier(0.65,0,0.35,1)] [clip-path:inset(0_0_0_0)]"
            style={{ width }}
          >
            <span className="invisible leading-[1.2] font-extrabold whitespace-nowrap">
              {current}
            </span>
            {previous ? (
              <span
                key={`out-${previous}-${current}`}
                className={cn(wordClass, "-translate-y-full opacity-0")}
              >
                {previous}
              </span>
            ) : null}
            <span
              key={`in-${current}`}
              className={cn(wordClass, "translate-y-0 opacity-100")}
            >
              {current}
            </span>
            <span
              ref={measureRef}
              aria-hidden
              className="invisible absolute top-0 left-0 leading-[1.2] font-extrabold whitespace-nowrap"
            />
          </span>
          <span className="text-white">with</span>
          <span className="text-brand-pink">
            Intelligent <span className="text-white">precision.</span>
          </span>
        </h1>

        <p
          className="mx-auto mb-11 max-w-[700px] reveal text-[clamp(17px,2vw,20px)] leading-[1.55] text-white/80 delay-100"
          data-revealed="true"
        >
          Growth depends on the people you bring in. We built an infrastructure
          that runs deep, intelligent interviews, observes candidate behavior
          with explicit consent, and gives your team the clarity to make the
          right call. It doesn&rsquo;t replace your judgment. It scales it.
        </p>

        <div
          className="mb-15 flex reveal flex-wrap justify-center gap-3.5 delay-200"
          data-revealed="true"
        >
          <BrandButton tone="primary" onClick={openInterview}>
            <Play className="fill-current" />
            Experience a Live Interview
          </BrandButton>
          <BrandButton
            tone="ghost-on-dark"
            onClick={() => scrollToSection("api")}
          >
            Explore the Architecture
          </BrandButton>
          <BrandButton tone="dark" onClick={() => scrollToSection("access")}>
            Request Access
          </BrandButton>
        </div>
      </div>

      <div
        className="relative z-2 mx-auto max-w-[1140px] reveal delay-300"
        data-revealed="true"
      >
        <CommandCenter />
      </div>
    </section>
  )
}

/* ==========================================================================
   command-center.tsx
   ========================================================================== */

const vitalMetrics = [
  { label: "Gaze", value: "94%", verified: true },
  { label: "Heart Rate", value: "72" },
  { label: "HRV", value: "48" },
  { label: "Stress Idx", value: "Low" },
]

function PanelLabel({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "mb-3 text-[11px] font-bold tracking-[0.05em] text-ink/40 uppercase",
        className
      )}
    >
      {children}
    </div>
  )
}

/**
 * The illustrative "active interview" dashboard shown under the hero: a live
 * candidate feed on the left, module signals on the right.
 */
export function CommandCenter() {
  return (
    <Card className="gap-0 overflow-hidden rounded-3xl bg-surface p-0 py-0 text-left shadow-brand-xl ring-1 ring-hairline">
      {/* Session header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline bg-surface-alt px-[22px] py-3.5">
        <div className="flex items-center gap-3">
          <span className="size-2 animate-(--animate-brand-pulse) rounded-full bg-brand-pink" />
          <span className="text-[13px] font-semibold text-ink">
            Active Interview
          </span>
          <span className="text-xs text-ink/40">·</span>
          <span className="text-xs text-ink/60">Senior Backend Engineer</span>
        </div>
        <div className="flex items-center gap-4 text-[13px] text-ink/60">
          <span>Candidate: A. Chen</span>
          <span>·</span>
          <span className="font-mono">04:32</span>
        </div>
      </div>

      <div className="grid min-h-[480px] grid-cols-[1.4fr_1fr] max-lg:grid-cols-1">
        {/* Candidate feed */}
        <div className="border-r border-hairline p-7 max-lg:border-r-0">
          <div className="relative mb-5 aspect-16/10 w-full overflow-hidden rounded-2xl bg-surface-dark">
            <video
              autoPlay
              muted
              loop
              playsInline
              data-decorative="true"
              className="absolute inset-0 size-full object-cover"
            >
              <source
                src="https://recruiterai.nugget.ai/media/recruiter.mp4"
                type="video/mp4"
              />
            </video>
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_40%,rgba(255,255,255,0.06),transparent_60%)]" />
            <Badge className="absolute top-3 right-3 rounded-md brand-gradient text-[11px] font-semibold text-white">
              CONSENT VERIFIED
            </Badge>
          </div>

          <div className="flex items-start gap-3 rounded-2xl border border-brand-blue/15 bg-brand-blue/5 px-4 py-3.5">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg brand-gradient text-white">
              <Mic className="size-4" />
            </div>
            <div className="text-sm leading-normal text-ink">
              <strong className="mb-[3px] block text-[11px] font-bold tracking-[0.02em] text-brand-blue">
                SYSTEM INTERVIEWER
              </strong>
              Give an example of a system you designed where performance, cost,
              or reliability were major constraints.
            </div>
          </div>

          <div className="mt-4 text-[13px] leading-relaxed text-ink/60">
            <div className="mb-1.5 text-[11px] font-bold tracking-[0.04em] text-ink/40 uppercase">
              Live transcript · consent verified
            </div>
            At my previous role, I led the migration of our notification
            service. We were handling about 40 million events per day and the
            legacy queue kept falling behind...
          </div>
        </div>

        {/* Signal panel */}
        <div className="overflow-y-auto bg-surface-alt p-6 max-lg:border-t max-lg:border-hairline">
          <PanelLabel>
            Active Modules{" "}
            <span className="ml-1 text-brand-blue normal-case">10/10</span>
          </PanelLabel>

          <div className="mb-5 flex flex-col gap-1.5">
            {activeModuleRows.map((row) => (
              <div
                key={row.label}
                className="flex items-center justify-between rounded-lg border border-hairline bg-surface px-3 py-[7px] text-[13px]"
              >
                <div className="flex items-center gap-2">
                  <span className="size-1.5 rounded-full bg-brand-pink shadow-[0_0_0_3px_rgba(255,0,128,0.12)]" />
                  {row.label}
                </div>
                <span className="text-[11px] font-semibold text-brand-blue">
                  {row.status}
                </span>
              </div>
            ))}
          </div>

          <div className="mb-3.5">
            <div className="mb-1.5 flex items-baseline justify-between">
              <span className="text-xs font-semibold text-ink/60">
                Composite Score
                <span className="ml-1 text-[10px] opacity-60">conf: 0.86</span>
              </span>
              <span className="text-[22px] font-extrabold tracking-[-0.02em] text-brand-blue">
                82
              </span>
            </div>
            <SignalBar value={82} aria-label="Composite score" />
          </div>

          <div className="mb-3.5">
            <div className="mb-1.5 flex items-baseline justify-between">
              <span className="text-xs font-semibold text-ink/60">
                Signal Confidence
                <span className="ml-1 text-[10px] opacity-60">band: ±6</span>
              </span>
              <span className="text-[22px] font-extrabold tracking-[-0.02em] text-brand-blue">
                High
              </span>
            </div>
            <SignalBar value={86} aria-label="Signal confidence" />
          </div>

          <div className="mb-4 grid grid-cols-2 gap-1.5">
            {vitalMetrics.map((metric) => (
              <div
                key={metric.label}
                className="rounded-lg border border-hairline bg-surface px-3 py-2.5"
              >
                <div className="text-[10px] font-semibold tracking-[0.04em] text-ink/40 uppercase">
                  {metric.label}{" "}
                  {metric.verified ? (
                    <span className="text-brand-blue">✓</span>
                  ) : null}
                </div>
                <div className="mt-0.5 text-base font-bold text-ink">
                  {metric.value}
                </div>
              </div>
            ))}
          </div>

          <PanelLabel className="mt-4.5">Psychometrics · OCEAN</PanelLabel>
          <div className="flex gap-1">
            {oceanTraits.map((trait) => (
              <div
                key={trait.letter}
                className="flex-1 rounded-md border border-hairline bg-surface px-1 py-1.5 text-center"
              >
                <div className="text-[11px] font-bold text-brand-pink">
                  {trait.letter}
                </div>
                <div className="mt-0.5 text-[13px] font-bold text-ink">
                  {trait.value}
                </div>
              </div>
            ))}
          </div>

          <Separator className="my-3.5 opacity-0" />

          <div className="flex items-center justify-between rounded-lg border border-dashed border-hairline bg-surface px-3.5 py-2.5 text-[13px]">
            <span className="text-[13px] text-ink/60">
              Role Fit:{" "}
              <strong className="text-brand-blue">Strong (0.88)</strong>
            </span>
            <span className="font-semibold text-[#d97706]">
              Awaiting Human Review
            </span>
          </div>
        </div>
      </div>
    </Card>
  )
}

/* ==========================================================================
   how-it-works-section.tsx
   ========================================================================== */

export function HowItWorksSection() {
  const { containerRef, entered, activeCount } = useStaggeredSteps(
    howSteps.length
  )

  return (
    <section
      id="how"
      data-nav-theme="light"
      className="border-b border-hairline bg-surface px-8 py-35 max-md:px-5 max-md:py-20"
    >
      <div className="mx-auto max-w-[1200px]">
        <SectionHeading intro="A deliberate process that transforms a job description into an evidence-backed shortlist. We handle the scale. Your team keeps the judgment.">
          From business need to{" "}
          <span className="text-brand-blue">human decision.</span>
        </SectionHeading>
      </div>

      <div className="relative mx-auto mt-10 mb-15 h-[300px] max-w-[1200px] reveal overflow-hidden rounded-3xl delay-200">
        <img
          src="/how-it-works.png"
          alt="A hiring team reviewing candidates together"
          className="size-full object-cover"
        />
        <div className="absolute inset-0 bg-linear-90 from-brand-blue/20 to-brand-pink/20" />
      </div>

      <div
        ref={containerRef}
        className="mx-auto grid max-w-[1100px] grid-cols-4 gap-x-6 gap-y-16 max-lg:grid-cols-2 max-lg:gap-x-8 max-lg:gap-y-12 max-md:grid-cols-1 max-md:gap-10"
      >
        {howSteps.map((step, index) => {
          const isActive = index < activeCount

          return (
            <div
              key={step.title}
              className={cn(
                "flex flex-col items-center text-center transition-[opacity,transform] duration-600 ease-(--ease-out-expo)",
                entered
                  ? "translate-y-0 opacity-100"
                  : "translate-y-5 opacity-0"
              )}
              style={{ transitionDelay: `${(index + 1) * 100}ms` }}
            >
              <div
                className={cn(
                  "relative mb-5 flex size-20 items-center justify-center rounded-full transition-all duration-500 ease-(--ease-out-expo) [&_svg]:size-7.5",
                  isActive
                    ? "border border-transparent brand-gradient text-white opacity-100 shadow-[0_10px_24px_rgba(0,82,255,0.15)]"
                    : "border border-hairline bg-surface text-ink opacity-40 shadow-[0_4px_12px_rgba(0,0,0,0.03)]"
                )}
              >
                <step.Icon strokeWidth={2} />
                {isActive ? (
                  <span className="absolute -inset-1 animate-(--animate-ripple) rounded-full border-2 border-brand-pink opacity-0" />
                ) : null}
              </div>

              <div className="max-w-[180px]">
                <div className="mb-1.5 text-base font-bold text-ink">
                  {step.title}
                </div>
                <div className="text-[13px] leading-normal text-ink/60">
                  {step.desc}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

/* ==========================================================================
   proof-band.tsx
   ========================================================================== */

const RING_CIRCUMFERENCE = 283

interface ProofCardProps {
  visual: React.ReactNode
  headline: string
  detail: string
  delay?: string
}

function ProofCard({ visual, headline, detail, delay }: ProofCardProps) {
  return (
    <div
      className={cn(
        "reveal rounded-[20px] border border-white/8 bg-white/3 p-8 text-center transition-all hover:-translate-y-[5px] hover:border-brand-blue hover:bg-brand-blue/5",
        delay
      )}
    >
      {visual}
      <h4 className="mb-2 text-[28px] leading-tight font-extrabold tracking-[-0.03em]">
        {headline}
      </h4>
      <p className="text-sm text-white/60">{detail}</p>
    </div>
  )
}

function CircleIcon({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto mb-5 flex size-25 items-center justify-center rounded-full border border-white/10 bg-white/5 text-brand-pink [&_svg]:size-10">
      {children}
    </div>
  )
}

export function ProofBand() {
  /** 99.4% of the ring drawn — the dash offset the animation lands on. */
  const accuracyOffset = RING_CIRCUMFERENCE * (1 - 0.994)

  return (
    <section
      id="proof"
      data-nav-theme="dark"
      className="border-b border-hairline bg-surface-dark px-8 py-20 text-white max-md:px-5"
    >
      {/* Shared gradient for the progress rings */}
      <svg width="0" height="0" className="absolute" aria-hidden>
        <defs>
          <linearGradient id="infograd" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#0052FF" />
            <stop offset="100%" stopColor="#FF0080" />
          </linearGradient>
        </defs>
      </svg>

      <div className="mx-auto grid max-w-[1200px] grid-cols-4 gap-6 max-lg:grid-cols-2">
        <ProofCard
          headline="Signal Accuracy"
          detail="Validated against expert human baselines."
          visual={
            <div className="relative mx-auto mb-5 flex size-25 items-center justify-center">
              <svg
                viewBox="0 0 100 100"
                className="absolute inset-0 -rotate-90"
                aria-hidden
              >
                <circle
                  cx="50"
                  cy="50"
                  r="45"
                  fill="none"
                  strokeWidth="6"
                  strokeLinecap="round"
                  className="stroke-white/10"
                />
                <circle
                  cx="50"
                  cy="50"
                  r="45"
                  fill="none"
                  strokeWidth="6"
                  strokeLinecap="round"
                  stroke="url(#infograd)"
                  strokeDasharray={RING_CIRCUMFERENCE}
                  strokeDashoffset={RING_CIRCUMFERENCE}
                  className="animate-(--animate-draw-ring)"
                  style={
                    {
                      "--ring-offset-to": accuracyOffset,
                    } as React.CSSProperties
                  }
                />
              </svg>
              <span className="text-2xl font-extrabold text-white">99.4%</span>
            </div>
          }
        />

        <ProofCard
          delay="delay-100"
          headline="SOC 2 Type II"
          detail="Continuous third-party security audits."
          visual={
            <CircleIcon>
              <ShieldCheck strokeWidth={2} />
            </CircleIcon>
          }
        />

        <ProofCard
          delay="delay-200"
          headline="0 Automated Decisions"
          detail="Human-in-the-loop guaranteed by design."
          visual={
            <CircleIcon>
              <Globe strokeWidth={2} />
            </CircleIcon>
          }
        />

        <ProofCard
          delay="delay-300"
          headline="12M+ Signals"
          detail="Processed daily across global sessions."
          visual={
            <div className="mx-auto mb-5 flex size-25 items-end justify-center gap-1.5">
              {[
                { height: "40%", delay: "0s" },
                { height: "75%", delay: "0.2s" },
                { height: "50%", delay: "0.4s" },
                { height: "90%", delay: "0.6s" },
              ].map((bar) => (
                <span
                  key={bar.delay}
                  className="w-4 origin-bottom animate-(--animate-grow-bar) rounded-t brand-gradient"
                  style={{ height: bar.height, animationDelay: bar.delay }}
                />
              ))}
            </div>
          }
        />
      </div>
    </section>
  )
}

/* ==========================================================================
   trust-section.tsx
   ========================================================================== */

interface ProcessStep {
  Icon: LucideIcon
  title: string
  detail: string
}

const processSteps: ProcessStep[] = [
  {
    Icon: Activity,
    title: "Signal Generated",
    detail: "A module produces an output",
  },
  {
    Icon: Gauge,
    title: "Confidence Scored",
    detail: "Every number carries a margin",
  },
  {
    Icon: FileText,
    title: "Evidence Trail",
    detail: "Reviewable, exportable, auditable",
  },
  {
    Icon: Eye,
    title: "Human Review",
    detail: "Your team makes the call",
  },
]

export function TrustSection() {
  return (
    <section
      id="trust"
      data-nav-theme="light"
      className="border-b border-hairline bg-surface-alt px-8 py-35 max-md:px-5 max-md:py-20"
    >
      <div className="mx-auto grid max-w-[1200px] grid-cols-2 items-stretch gap-15 max-lg:grid-cols-1 max-lg:gap-10">
        <div className="relative h-full min-h-[500px] reveal overflow-hidden rounded-3xl shadow-brand-xl max-lg:min-h-[300px]">
          <img
            src="/trust-security.png"
            alt="Security operations dashboard"
            className="absolute inset-0 size-full object-cover"
          />
          <div className="absolute inset-0 bg-linear-180 from-transparent from-50% to-black/60" />
        </div>

        <div className="flex flex-col justify-center">
          <SectionHeading
            align="start"
            intro="Every signal we generate is consent-gated, confidence-scored, and built for human oversight. There are no black boxes, and there is no automation of the final decision."
          >
            Trust is not a feature.{" "}
            <span className="text-brand-blue">It&rsquo;s the foundation.</span>
          </SectionHeading>

          <div className="mt-10 grid grid-cols-2 gap-4 max-md:grid-cols-1">
            {trustCards.map((card, index) => (
              <Card
                key={card.title}
                className={cn(
                  "reveal gap-0 rounded-2xl bg-surface p-5 py-5 ring-1 ring-hairline transition-all hover:-translate-y-0.5 hover:shadow-brand hover:ring-brand-blue",
                  index < 2 ? "delay-200" : "delay-300"
                )}
              >
                <div className="mb-3 flex size-10 items-center justify-center rounded-[10px] bg-brand-blue/5 text-brand-blue [&_svg]:size-5">
                  <card.Icon strokeWidth={2} />
                </div>
                <div className="mb-1 text-sm font-bold text-ink">
                  {card.title}
                </div>
                <div className="text-xs leading-snug text-ink/60">
                  {card.desc}
                </div>
              </Card>
            ))}
          </div>
        </div>
      </div>

      {/* Signal lifecycle */}
      <div className="relative mx-auto mt-25 flex max-w-[1100px] reveal items-start justify-between px-5 max-lg:flex-wrap max-lg:gap-8 max-md:flex-col">
        <div
          aria-hidden
          className="absolute top-10 right-[10%] left-[10%] z-0 h-0.5 bg-linear-90 from-brand-blue to-brand-pink opacity-30 max-lg:hidden"
        />
        {processSteps.map((step) => (
          <div
            key={step.title}
            className="group relative z-1 w-[22%] text-center max-lg:w-[40%] max-md:w-full"
          >
            <div className="mx-auto mb-4 flex size-20 items-center justify-center rounded-full border-2 border-hairline bg-surface text-brand-blue shadow-[0_4px_12px_rgba(0,0,0,0.03)] transition-all group-hover:-translate-y-[5px] group-hover:border-brand-blue group-hover:text-brand-pink group-hover:shadow-[0_10px_24px_rgba(0,82,255,0.1)] [&_svg]:size-8">
              <step.Icon strokeWidth={2} />
            </div>
            <h5 className="mb-1.5 text-base font-bold text-ink">
              {step.title}
            </h5>
            <p className="text-[13px] leading-snug text-ink/60">
              {step.detail}
            </p>
          </div>
        ))}
      </div>
    </section>
  )
}

/* ==========================================================================
   api-explorer.tsx
   ========================================================================== */

function ColumnLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-3 text-[11px] font-bold tracking-[0.05em] text-ink/40 uppercase">
      {children}
    </div>
  )
}

function CodeBlock({ code }: { code: string }) {
  return (
    <pre className="m-0 overflow-x-auto rounded-xl bg-surface-dark p-4.5 font-mono text-[13px] leading-[1.65] break-words whitespace-pre-wrap text-[#c8d5cf]">
      <HighlightedCode code={code} />
    </pre>
  )
}

/**
 * Sidebar-plus-detail browser for the ten module endpoints. Selection is held
 * in the page context so the footer buttons and modals stay in sync.
 */
export function ApiExplorer() {
  const { selectedModule, selectModule } = useLanding()
  const active = modules[selectedModule] ?? modules[0]

  return (
    <div className="mx-auto grid max-w-[1200px] reveal grid-cols-[280px_1fr] overflow-hidden rounded-3xl border border-hairline bg-surface shadow-brand-lg delay-200 max-md:grid-cols-1">
      {/* Module list */}
      <ScrollArea className="max-h-[700px] border-r border-hairline bg-surface-alt max-md:max-h-none max-md:border-r-0 max-md:border-b">
        <div className="flex flex-col gap-1 p-4 max-md:flex-row max-md:overflow-x-auto max-md:p-3">
          {modules.map((module, index) => {
            const isActive = index === selectedModule

            return (
              <button
                key={module.id}
                type="button"
                aria-current={isActive}
                onClick={() => selectModule(index)}
                className={cn(
                  "flex w-full cursor-pointer items-center gap-3 rounded-xl border border-transparent p-3 text-left transition-all",
                  "max-md:w-25 max-md:shrink-0 max-md:flex-col max-md:items-center max-md:gap-2 max-md:p-2.5 max-md:text-center",
                  isActive
                    ? "border-brand-blue/20 bg-brand-blue/5"
                    : "hover:bg-surface"
                )}
              >
                <span
                  className={cn(
                    "flex size-9 shrink-0 items-center justify-center rounded-[10px] border bg-surface transition-all [&_svg]:size-4.5",
                    isActive
                      ? "border-brand-blue text-brand-blue opacity-100"
                      : "border-hairline text-ink opacity-40"
                  )}
                >
                  <module.Icon strokeWidth={2} />
                </span>
                <span className="flex flex-col gap-0.5 max-md:items-center">
                  <span className="text-[10px] font-bold text-ink/40">
                    MODULE {module.id}
                  </span>
                  <span
                    className={cn(
                      "text-[13px] font-semibold",
                      isActive ? "text-brand-blue" : "text-ink"
                    )}
                  >
                    {module.shortName}
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      </ScrollArea>

      {/* Endpoint detail */}
      <div className="bg-surface p-8 max-md:p-5">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-hairline pb-6">
          <div className="flex items-center gap-3.5">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-brand-blue/10 bg-brand-blue/5 text-brand-blue [&_svg]:size-5.5">
              <active.Icon strokeWidth={2} />
            </div>
            <div>
              <div className="text-lg font-bold text-ink">{active.name}</div>
              <div className="mt-0.5 text-[13px] text-ink/60">
                POST https://api.yourplatform.ai{active.endpoint}/start
              </div>
            </div>
          </div>
          <div className="rounded-lg border border-hairline bg-surface-alt px-3 py-1.5 font-mono text-xs text-ink">
            Bearer {active.apiKey}
          </div>
        </div>

        <div className="mt-6 grid grid-cols-2 max-lg:grid-cols-1">
          <div className="py-6 pr-6 max-lg:border-b max-lg:border-hairline max-lg:pr-0">
            <ColumnLabel>Description</ColumnLabel>
            <div className="mb-4 text-sm leading-relaxed text-ink/60">
              {active.desc}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {active.tags.map((tag) => (
                <Badge
                  key={tag}
                  className="rounded-md border border-brand-blue/10 bg-brand-blue/5 px-2 py-1 text-[11px] font-semibold text-brand-blue"
                >
                  {tag}
                </Badge>
              ))}
            </div>
          </div>

          <div className="border-l border-hairline py-6 pl-6 max-lg:border-l-0 max-lg:pl-0">
            <ColumnLabel>Sample Output</ColumnLabel>
            <div className="rounded-[10px] border border-hairline bg-surface-alt px-3.5 py-3 font-mono text-xs leading-[1.7] text-ink">
              {Object.entries(active.sample).map(([key, value]) => (
                <div key={key}>
                  <span className="text-brand-blue">{key}</span>:{" "}
                  {String(value)}
                </div>
              ))}
            </div>
          </div>
        </div>

        <Separator className="bg-hairline" />

        <div className="grid grid-cols-2 max-lg:grid-cols-1">
          <div className="py-6 pr-6 max-lg:border-b max-lg:border-hairline max-lg:pr-0">
            <ColumnLabel>Sample Request</ColumnLabel>
            <CodeBlock code={active.request} />
          </div>
          <div className="border-l border-hairline py-6 pl-6 max-lg:border-l-0 max-lg:pl-0">
            <ColumnLabel>Sample Response</ColumnLabel>
            <CodeBlock code={active.response} />
          </div>
        </div>

        <div className="mt-6 border-t border-hairline py-6">
          <div className="mb-2 text-xs font-bold text-ink/60">
            Integration Notes
          </div>
          <div className="text-[13px] leading-relaxed text-ink">
            {active.notes}
          </div>
        </div>
      </div>
    </div>
  )
}

/* ==========================================================================
   api-section.tsx
   ========================================================================== */

export function ApiSection() {
  const { openPlayground, openModuleDetails } = useLanding()

  return (
    <section
      id="api"
      data-nav-theme="light"
      className="bg-surface px-8 pt-35 pb-15 max-md:px-5 max-md:pt-20"
    >
      <div className="mx-auto mb-15 grid max-w-[1200px] grid-cols-2 items-stretch gap-15 max-lg:grid-cols-1 max-lg:gap-10">
        <div className="flex flex-col justify-center">
          <SectionHeading
            align="start"
            intro="Every module is an independent, specialized endpoint. Authenticate, start a session, stream results, and pull reports all from a single, consistent API surface."
          >
            <span className="text-brand-blue">Specialized Modules.</span> One
            Unified Interview.
          </SectionHeading>
        </div>

        <div className="relative h-full min-h-[350px] reveal overflow-hidden rounded-3xl shadow-brand-lg delay-200 max-lg:min-h-[300px]">
          <img
            // Rooted, like every other image on this page. A relative path
            // resolves against whatever URL the page happens to be on, so it
            // only works from the site root.
            src="/api-architecture.png"
            alt="Diagram of the platform's module architecture"
            className="absolute inset-0 size-full object-cover"
          />
          <div className="absolute inset-0 bg-linear-135 from-brand-blue/10 to-brand-pink/10" />
        </div>
      </div>

      <ApiExplorer />

      <div className="mt-10 flex reveal flex-wrap items-center justify-center gap-4 delay-300">
        <BrandButton tone="primary" onClick={() => openPlayground()}>
          <Play className="fill-current" />
          Open Playground
        </BrandButton>
        <BrandButton tone="ghost" onClick={() => openModuleDetails()}>
          <Info />
          View Module Details
        </BrandButton>
      </div>
    </section>
  )
}

/* ==========================================================================
   request-access-section.tsx
   ========================================================================== */

const fieldClass =
  "h-auto rounded-[10px] border-hairline bg-surface-alt px-3.5 py-3 text-sm text-ink transition-all focus-visible:border-brand-blue focus-visible:bg-surface focus-visible:ring-4 focus-visible:ring-brand-blue/12"

function FieldLabel({
  htmlFor,
  children,
  required,
}: {
  htmlFor: string
  children: React.ReactNode
  required?: boolean
}) {
  return (
    <Label
      htmlFor={htmlFor}
      className="mb-1.5 gap-1 text-[13px] font-semibold text-ink"
    >
      {children}
      {required ? <span className="text-brand-pink">*</span> : null}
    </Label>
  )
}

interface TextFieldProps {
  id: string
  name: string
  label: string
  placeholder: string
  type?: React.ComponentProps<"input">["type"]
  full?: boolean
}

function TextField({
  id,
  name,
  label,
  placeholder,
  type = "text",
  full,
}: TextFieldProps) {
  return (
    <div className={cn("flex flex-col", full && "col-span-full")}>
      <FieldLabel htmlFor={id} required>
        {label}
      </FieldLabel>
      <Input
        id={id}
        name={name}
        type={type}
        required
        placeholder={placeholder}
        className={fieldClass}
      />
    </div>
  )
}

interface SelectFieldProps {
  id: string
  name: string
  label: string
  placeholder: string
  options: string[]
  full?: boolean
}

function SelectField({
  id,
  name,
  label,
  placeholder,
  options,
  full,
}: SelectFieldProps) {
  return (
    <div className={cn("flex flex-col", full && "col-span-full")}>
      <FieldLabel htmlFor={id} required>
        {label}
      </FieldLabel>
      <Select name={name} required>
        <SelectTrigger id={id} className={cn(fieldClass, "w-full")}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option} value={option}>
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

export function RequestAccessSection() {
  const [submitted, setSubmitted] = React.useState(false)
  const formRef = React.useRef<HTMLFormElement | null>(null)

  // The phone field is controlled (it owns a country as well as a number), so
  // `form.reset()` can't clear it — this state has to be cleared by hand.
  const [phone, setPhone] = React.useState("")

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSubmitted(true)
  }

  const resetForm = () => {
    setSubmitted(false)
    setPhone("")
    formRef.current?.reset()
  }

  return (
    <section
      id="access"
      data-nav-theme="light"
      className="border-b border-hairline bg-surface-alt px-8 pt-15 pb-35 max-md:px-5 max-md:pb-20"
    >
      <div className="mx-auto grid max-w-[1100px] grid-cols-2 items-stretch gap-15 max-lg:grid-cols-1 max-lg:gap-10">
        <div className="relative h-full min-h-[600px] reveal overflow-hidden rounded-3xl shadow-brand-xl max-lg:min-h-[300px]">
          <img
            src="/access.png"
            alt="Recruiting team at work"
            className="absolute inset-0 size-full object-cover"
          />
          <div className="absolute inset-0 bg-linear-180 from-transparent from-50% to-black/40" />
        </div>

        <div className="flex flex-col justify-center">
          <SectionHeading
            align="start"
            intro="Tell us about your team and your hiring landscape. We will arrange a tailored walkthrough and provision your workspace."
          >
            Request Access
          </SectionHeading>

          <Card className="mt-10 reveal gap-0 rounded-3xl bg-surface p-12 py-12 shadow-brand-lg ring-1 ring-hairline delay-200 max-md:px-5 max-md:py-7">
            {submitted ? (
              <div className="px-5 py-10 text-center">
                <div className="mx-auto mb-5 flex size-16 items-center justify-center rounded-full border-2 border-brand-blue bg-brand-blue/5 text-brand-blue">
                  <Check className="size-7" strokeWidth={2.5} />
                </div>
                <div className="mb-2.5 text-[22px] font-extrabold text-ink">
                  Thank you. Your request is in.
                </div>
                <div className="mx-auto max-w-[420px] text-[15px] leading-relaxed text-ink/60">
                  Our team is reviewing it and will reach out shortly.
                </div>
                <BrandButton tone="ghost" className="mt-6" onClick={resetForm}>
                  Submit another request
                </BrandButton>
              </div>
            ) : (
              <form ref={formRef} onSubmit={onSubmit}>
                <div className="grid grid-cols-2 gap-4.5 max-md:grid-cols-1">
                  <TextField
                    id="access-name"
                    name="name"
                    label="Full Name"
                    placeholder="Jordan Avery"
                  />
                  <TextField
                    id="access-email"
                    name="email"
                    type="email"
                    label="Work Email"
                    placeholder="jordan@company.com"
                  />
                  <TextField
                    id="access-company"
                    name="company"
                    label="Company Name"
                    placeholder="Northwind Labs"
                  />
                  {/* The one field here that isn't a plain TextField: a phone
                      number needs its country, and this wears the same
                      `fieldClass` so it doesn't look imported. */}
                  <div className="flex flex-col">
                    <FieldLabel htmlFor="access-phone" required>
                      Phone Number
                    </FieldLabel>
                    <PhoneInput
                      id="access-phone"
                      value={phone}
                      onChange={setPhone}
                      placeholder="415 555 0142"
                      defaultCountry="US"
                      inputClassName={fieldClass}
                    />
                  </div>
                  <TextField
                    id="access-title"
                    name="title"
                    label="Job Title"
                    placeholder="Head of Talent"
                  />
                  <SelectField
                    id="access-size"
                    name="size"
                    label="Company Size"
                    placeholder="Select size"
                    options={companySizes}
                  />
                  <SelectField
                    id="access-usecase"
                    name="usecase"
                    label="Hiring Requirement / Use Case"
                    placeholder="Select primary use case"
                    options={useCases}
                    full
                  />

                  <div className="col-span-full flex flex-col">
                    <FieldLabel htmlFor="access-message">
                      Message / Notes
                    </FieldLabel>
                    <Textarea
                      id="access-message"
                      name="message"
                      placeholder="Share any specific roles, volumes, or timelines we should know about."
                      className={cn(fieldClass, "min-h-25 resize-y")}
                    />
                  </div>
                </div>

                <BrandButton
                  type="submit"
                  tone="primary"
                  className="mt-6 w-full"
                >
                  Submit Request
                  <ArrowRight />
                </BrandButton>
              </form>
            )}
          </Card>
        </div>
      </div>
    </section>
  )
}
