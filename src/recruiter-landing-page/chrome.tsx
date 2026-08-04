/** The page's fixed chrome: the top navigation and the footer. */
import * as React from "react"
import { ArrowRight, Menu } from "lucide-react"
import { Link } from "react-router-dom"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"
import { navItems } from "./data"
import type { NavState } from "./hooks"
import { BrandButton, useLanding } from "./ui"
/* ==========================================================================
   site-nav.tsx
   ========================================================================== */

interface SiteNavProps {
  navState: NavState
}

export function SiteNav({ navState }: SiteNavProps) {
  const { scrollToSection } = useLanding()
  const [mobileOpen, setMobileOpen] = React.useState(false)
  const { activeSection, scrolled, theme } = navState

  const onDark = theme === "dark"

  const go = (target: string) => {
    scrollToSection(target)
    setMobileOpen(false)
  }

  const navLinkClass = (target: string) =>
    cn(
      "relative cursor-pointer rounded-lg px-3.5 py-2 text-sm font-medium whitespace-nowrap transition-all",
      activeSection === target
        ? onDark
          ? "bg-white/15 text-white opacity-100"
          : "bg-brand-blue/5 text-brand-blue opacity-100"
        : "opacity-60 hover:bg-neutral-500/10 hover:opacity-100"
    )

  return (
    <div
      className={cn(
        // Below the dialog layer (z-50) so modals always cover the bar.
        "fixed inset-x-0 top-0 z-40 transition-[background,border-color,color] duration-400",
        onDark ? "text-white" : "text-ink",
        scrolled &&
          (onDark
            ? "border-b border-white/5 bg-surface-dark/85 backdrop-blur-xl"
            : "border-b border-hairline bg-white/85 backdrop-blur-xl")
      )}
    >
      <div
        className={cn(
          "mx-auto flex max-w-[1280px] items-center justify-between gap-5 px-12 transition-[padding] duration-400 ease-(--ease-out-expo) max-md:px-6",
          scrolled ? "py-3.5" : "py-6",
          "max-md:py-4"
        )}
      >
        <button
          type="button"
          onClick={() => go("home")}
          className="cursor-pointer text-[1.4rem] leading-none font-extrabold tracking-[-0.02em] whitespace-nowrap text-inherit"
        >
          Recruiter<span className="text-brand-pink">AI</span>
        </button>

        <nav
          aria-label="Main navigation"
          className="flex items-center gap-0.5 max-md:hidden"
        >
          {navItems.map((item) => (
            <button
              key={item.target}
              type="button"
              onClick={() => go(item.target)}
              className={navLinkClass(item.target)}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          {/* <BrandButton
            tone="ghost"
            scale="nav"
            onClick={() => go("access")}
            className={cn(
              "max-md:hidden",
              onDark &&
                "border-white/40 text-white hover:border-white hover:bg-white/10 hover:text-white"
            )}
          >
            Request Access
          </BrandButton> */}

          {/* Entry point into the authenticated product. */}
          <BrandButton
            tone={onDark ? "nav-dark" : "nav-light"}
            scale="nav"
            nativeButton={false}
            render={<Link to="/login" />}
            className="max-sm:hidden"
          >
            Get Started
            <ArrowRight />
          </BrandButton>

          <Button
            variant="ghost"
            size="icon"
            aria-label="Open menu"
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen((open) => !open)}
            className="hidden size-[38px] rounded-[10px] border border-current text-inherit opacity-60 hover:bg-transparent hover:opacity-100 max-md:flex"
          >
            <Menu className="size-5" />
          </Button>
        </div>
      </div>

      {mobileOpen ? (
        <div
          className={cn(
            "fixed inset-x-4 top-[68px] z-40 flex flex-col gap-1 rounded-2xl p-4 md:hidden",
            onDark
              ? "border border-white/10 bg-surface-dark/95 shadow-[0_10px_30px_rgba(0,0,0,0.5)]"
              : "border border-hairline bg-white/95 shadow-brand-lg"
          )}
        >
          {navItems.map((item) => (
            <button
              key={item.target}
              type="button"
              onClick={() => go(item.target)}
              className={cn(
                navLinkClass(item.target),
                "px-3.5 py-3 text-[15px]"
              )}
            >
              {item.label}
            </button>
          ))}

          <BrandButton
            tone="primary"
            scale="nav"
            nativeButton={false}
            render={<Link to="/login" />}
            className="mt-2 justify-center"
          >
            Get Started
            <ArrowRight />
          </BrandButton>
        </div>
      ) : null}
    </div>
  )
}

/* ==========================================================================
   site-footer.tsx
   ========================================================================== */

function FooterLink({
  onClick,
  children,
}: {
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mb-2.5 block cursor-pointer text-left text-sm text-white/40 transition-colors hover:text-brand-pink"
    >
      {children}
    </button>
  )
}

export function SiteFooter() {
  const { scrollToSection, openInterview } = useLanding()

  return (
    <footer
      data-nav-theme="dark"
      className="bg-surface-dark px-8 pt-20 pb-10 text-white/50 max-md:px-5"
    >
      <div className="mx-auto max-w-[1200px]">
        <div className="grid grid-cols-[2fr_1fr_1fr_1fr] gap-12 pb-12 max-lg:grid-cols-2 max-md:grid-cols-1 max-md:gap-8">
          <div>
            <button
              type="button"
              onClick={() => scrollToSection("home")}
              className="cursor-pointer text-2xl font-extrabold tracking-[-0.02em] text-white"
            >
              Recruiter<span className="text-brand-pink">AI</span>
            </button>
            <p className="mt-4 max-w-[320px] text-sm leading-relaxed text-white/40">
              An intelligent interview infrastructure with independent modules
              for proctoring, psychometrics, vitals, voice synthesis, role
              alignment, fraud detection, recording analysis, and IO sciences.
            </p>
          </div>

          <div>
            <h4 className="mb-4 text-[13px] font-bold tracking-[0.02em] text-white">
              Product
            </h4>
            <FooterLink onClick={() => scrollToSection("how")}>
              How It Works
            </FooterLink>
            <FooterLink onClick={openInterview}>
              Experience a Session
            </FooterLink>
            <FooterLink onClick={() => scrollToSection("api")}>
              Architecture &amp; API
            </FooterLink>
          </div>

          <div>
            <h4 className="mb-4 text-[13px] font-bold tracking-[0.02em] text-white">
              Trust
            </h4>
            <FooterLink onClick={() => scrollToSection("trust")}>
              Security &amp; Compliance
            </FooterLink>
            <FooterLink
              onClick={() =>
                toast("SOC 2 Type II audit report available under NDA.")
              }
            >
              SOC 2 Report
            </FooterLink>
            <FooterLink
              onClick={() =>
                toast("GDPR DPA available for enterprise customers.")
              }
            >
              GDPR / DPA
            </FooterLink>
            <FooterLink
              onClick={() =>
                toast(
                  "Bias audit results are shared with enterprise customers quarterly."
                )
              }
            >
              Bias Audit
            </FooterLink>
          </div>

          <div>
            <h4 className="mb-4 text-[13px] font-bold tracking-[0.02em] text-white">
              Company
            </h4>
            <FooterLink onClick={() => scrollToSection("access")}>
              Request Access
            </FooterLink>
            <FooterLink onClick={() => scrollToSection("home")}>
              Overview
            </FooterLink>
            <FooterLink
              onClick={() => toast("Privacy policy is available upon request.")}
            >
              Privacy
            </FooterLink>
            <FooterLink
              onClick={() =>
                toast("Security documentation is available upon request.")
              }
            >
              Security
            </FooterLink>
          </div>
        </div>

        <Separator className="bg-white/8" />

        <div className="flex flex-wrap items-center justify-between gap-3 pt-7 text-[13px] text-white/40 max-md:flex-col max-md:text-center">
          <span>
            © 2026 RecruiterAI. All rights reserved. The system informs
            decisions your team makes them.
          </span>
          <div className="flex gap-5">
            <button
              type="button"
              onClick={() => scrollToSection("access")}
              className="cursor-pointer text-white/40 transition-colors hover:text-white"
            >
              Contact
            </button>
            <button
              type="button"
              onClick={() =>
                toast("Terms of service are available upon request.")
              }
              className="cursor-pointer text-white/40 transition-colors hover:text-white"
            >
              Terms
            </button>
            <button
              type="button"
              onClick={() => toast("Cookie preferences updated.")}
              className="cursor-pointer text-white/40 transition-colors hover:text-white"
            >
              Cookies
            </button>
          </div>
        </div>
      </div>
    </footer>
  )
}
