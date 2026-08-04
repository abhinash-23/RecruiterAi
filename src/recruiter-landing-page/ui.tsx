/* eslint-disable react-refresh/only-export-components */
/**
 * The landing page's shared context and its small building blocks — buttons,
 * the modal shell, section headings, score bars, highlighted code, and the two
 * floating chrome elements.
 */
import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Play, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Progress } from "@/components/ui/progress"
import { cn } from "@/lib/utils"
import { useMouseGlow } from "./hooks"
import { tokenizeCode, type TokenKind } from "./lib"
/* ==========================================================================
   landing-context.tsx
   ========================================================================== */

export interface LandingContextValue {
  /** Smooth-scrolls to a section id. */
  scrollToSection: (id: string) => void
  /** Index of the module selected in the API explorer. */
  selectedModule: number
  selectModule: (index: number) => void
  openInterview: () => void
  openPlayground: (index?: number) => void
  openModuleDetails: (index?: number) => void
}

const LandingContext = React.createContext<LandingContextValue | null>(null)

export function LandingProvider({
  value,
  children,
}: {
  value: LandingContextValue
  children: React.ReactNode
}) {
  return (
    <LandingContext.Provider value={value}>{children}</LandingContext.Provider>
  )
}

export function useLanding(): LandingContextValue {
  const context = React.useContext(LandingContext)

  if (!context) {
    throw new Error("useLanding must be used within a LandingProvider")
  }

  return context
}

/* ==========================================================================
   brand-button.tsx
   ========================================================================== */

const brandButtonVariants = cva(
  "h-auto rounded-xl font-semibold transition-all [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      tone: {
        primary:
          "brand-gradient text-white shadow-[0_4px_20px_rgba(0,82,255,0.2)] hover:-translate-y-0.5 hover:shadow-[0_8px_30px_rgba(255,0,128,0.3)]",
        dark: "border-transparent bg-ink text-white hover:-translate-y-0.5 hover:bg-ink/90",
        ghost:
          "border border-hairline bg-transparent text-ink hover:border-brand-blue hover:bg-brand-blue/5 hover:text-brand-blue",
        "ghost-on-dark":
          "border border-white/40 bg-transparent text-white hover:border-white hover:bg-white/10 hover:text-white",
        "nav-dark":
          "border-transparent bg-white text-ink hover:-translate-y-px hover:bg-[#eee]",
        "nav-light":
          "border-transparent bg-ink text-white hover:-translate-y-px hover:bg-[#333]",
      },
      scale: {
        default: "gap-2 px-6 py-3.5 text-[15px]",
        sm: "gap-1.5 rounded-[10px] px-4 py-2.5 text-[13px]",
        nav: "gap-1.5 rounded-[10px] px-[18px] py-2.5 text-sm",
      },
    },
    defaultVariants: { tone: "primary", scale: "default" },
  }
)

type BrandButtonProps = React.ComponentProps<typeof Button> &
  VariantProps<typeof brandButtonVariants>

/**
 * The landing page's button treatments — gradient, solid dark, and two ghost
 * variants — layered on top of the shared shadcn Button.
 */
export function BrandButton({
  className,
  tone,
  scale,
  ...props
}: BrandButtonProps) {
  return (
    <Button
      variant="ghost"
      className={cn(brandButtonVariants({ tone, scale }), className)}
      {...props}
    />
  )
}

/* ==========================================================================
   brand-dialog.tsx
   ========================================================================== */

interface BrandDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  /** Max width of the panel, e.g. `max-w-[1100px]`. */
  width: string
  children: React.ReactNode
  /** Extra classes for the body. */
  bodyClassName?: string
  /**
   * Whether the body itself scrolls. Set false when the content manages its own
   * internal scrolling and should fill the panel instead.
   */
  bodyScroll?: boolean
  /**
   * Give the panel a definite height rather than sizing it to its content.
   * Required when the body relies on `h-full`/`flex-1` to size itself — with an
   * auto height the children would lay out at their content size and spill.
   */
  fillHeight?: boolean
}

/**
 * Shared modal shell for the landing page: a dark blurred scrim, a header that
 * stays put while the body scrolls, and no scrollbar chrome over the content.
 */
export function BrandDialog({
  open,
  onOpenChange,
  title,
  width,
  children,
  bodyClassName,
  bodyScroll = true,
  fillHeight = false,
}: BrandDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        overlayClassName="bg-black/70 supports-backdrop-filter:backdrop-blur-md"
        className={cn(
          "flex max-h-[92vh] w-full flex-col gap-0 overflow-hidden rounded-3xl bg-surface p-0 text-ink shadow-brand-xl ring-0",
          fillHeight && "h-[92vh]",
          width
        )}
      >
        <DialogHeader className="flex shrink-0 flex-row items-center justify-between gap-4 border-b border-hairline px-6 py-4">
          <DialogTitle className="text-[17px] font-bold text-ink">
            {title}
          </DialogTitle>
          <DialogClose
            render={
              <Button
                variant="ghost"
                aria-label="Close"
                className="size-[34px] shrink-0 rounded-[9px] border border-hairline bg-surface text-ink hover:border-brand-pink hover:bg-surface hover:text-brand-pink"
              />
            }
          >
            <X className="size-[18px]" strokeWidth={2.5} />
          </DialogClose>
        </DialogHeader>

        <div
          className={cn(
            "scrollbar-none min-h-0 flex-1",
            bodyScroll ? "overflow-y-auto" : "overflow-hidden",
            bodyClassName
          )}
        >
          {children}
        </div>
      </DialogContent>
    </Dialog>
  )
}

/* ==========================================================================
   section-heading.tsx
   ========================================================================== */

interface SectionHeadingProps {
  children: React.ReactNode
  intro?: React.ReactNode
  align?: "center" | "start"
  className?: string
  introClassName?: string
}

/**
 * The shared section title + supporting paragraph, centred by default and
 * left-aligned for the two-column sections.
 */
export function SectionHeading({
  children,
  intro,
  align = "center",
  className,
  introClassName,
}: SectionHeadingProps) {
  return (
    <>
      <h2
        className={cn(
          "reveal text-[clamp(32px,4.5vw,52px)] leading-[1.1] font-extrabold tracking-[-0.03em] text-ink",
          align === "center" ? "text-center" : "text-left",
          className
        )}
      >
        {children}
      </h2>
      {intro ? (
        <p
          className={cn(
            "mt-5 max-w-[660px] reveal text-lg leading-relaxed text-ink/60 delay-100",
            align === "center" ? "mx-auto text-center" : "text-left",
            introClassName
          )}
        >
          {intro}
        </p>
      ) : null}
    </>
  )
}

/* ==========================================================================
   signal-bar.tsx
   ========================================================================== */

interface SignalBarProps {
  value: number
  tone?: "brand" | "amber"
  className?: string
  "aria-label"?: string
}

/**
 * The thin score bar used throughout the command centre and live session
 * panels. Wraps the shadcn Progress primitive so every value is exposed to
 * assistive tech instead of being a decorative div.
 */
export function SignalBar({
  value,
  tone = "brand",
  className,
  ...props
}: SignalBarProps) {
  return (
    <Progress
      value={value}
      className={cn(
        "block [&_[data-slot=progress-track]]:h-1.5 [&_[data-slot=progress-track]]:rounded-[3px] [&_[data-slot=progress-track]]:bg-hairline",
        "[&_[data-slot=progress-indicator]]:rounded-[3px] [&_[data-slot=progress-indicator]]:transition-[width] [&_[data-slot=progress-indicator]]:duration-[1200ms] [&_[data-slot=progress-indicator]]:ease-(--ease-out-expo)",
        tone === "brand"
          ? "[&_[data-slot=progress-indicator]]:brand-gradient"
          : "[&_[data-slot=progress-indicator]]:bg-linear-to-r [&_[data-slot=progress-indicator]]:from-[#f59e0b] [&_[data-slot=progress-indicator]]:to-[#d97706]",
        className
      )}
      {...props}
    />
  )
}

/* ==========================================================================
   highlighted-code.tsx
   ========================================================================== */

const TOKEN_CLASS: Record<TokenKind, string> = {
  comment: "text-[#6b7c75] italic",
  string: "text-brand-pink",
  key: "text-brand-blue",
  number: "text-[#93c5fd]",
  plain: "",
}

/**
 * Renders a syntax-highlighted snippet. Builds real React nodes rather than an
 * HTML string, so nothing untrusted is ever injected into the DOM.
 */
export function HighlightedCode({ code }: { code: string }) {
  const tokens = React.useMemo(() => tokenizeCode(code), [code])

  return (
    <>
      {tokens.map((token, i) =>
        token.kind === "plain" ? (
          <React.Fragment key={i}>{token.text}</React.Fragment>
        ) : (
          <span key={i} className={TOKEN_CLASS[token.kind]}>
            {token.text}
          </span>
        )
      )}
    </>
  )
}

/* ==========================================================================
   mouse-glow.tsx
   ========================================================================== */

/**
 * Ambient brand-coloured glow that follows the cursor. Renders nothing on
 * touch devices or when the visitor prefers reduced motion.
 */
export function MouseGlow() {
  const position = useMouseGlow()

  if (!position) return null

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed z-30 size-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(0,82,255,0.15),rgba(255,0,128,0.05)_40%,transparent_70%)] mix-blend-multiply blur-[40px] transition-transform duration-150 ease-out"
      style={{ left: position.x, top: position.y }}
    />
  )
}

/* ==========================================================================
   live-preview-fab.tsx
   ========================================================================== */

/**
 * Vertical tab pinned to the right edge that launches the live interview demo.
 */
export function LivePreviewFab() {
  const { openInterview } = useLanding()

  return (
    <Button
      variant="ghost"
      onClick={openInterview}
      className="fixed top-1/2 right-0 z-30 h-auto -translate-y-1/2 flex-col gap-2.5 rounded-l-xl rounded-r-none brand-gradient px-3 py-[18px] text-sm font-bold text-white shadow-[-4px_4px_20px_rgba(0,0,0,0.15)] transition-[padding] duration-300 [writing-mode:vertical-rl] hover:bg-transparent hover:pr-[18px] hover:text-white max-md:px-2 max-md:py-3 max-md:text-xs"
    >
      <Play className="rotate-90 fill-current [writing-mode:horizontal-tb]" />
      Live Preview
    </Button>
  )
}
