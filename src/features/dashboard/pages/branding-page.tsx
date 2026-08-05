import * as React from "react"
import { ImageIcon, Trash2, Upload } from "lucide-react"

import { ApiImage } from "@/components/shared/api-image"
import { ConfirmDialog } from "@/components/shared/confirm-dialog"
import { PageHeader } from "@/components/shared/page-header"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import {
  INTERVIEW_ROUND_OPTIONS,
  LOGO_UPLOAD,
  useBranding,
  useCompanyMutations,
  useInterviewDefaults,
  type InterviewRound,
  type LogoTheme,
} from "@/services/admin"
import { cn } from "@/lib/utils"

const HEX = /^#[0-9a-fA-F]{6}$/

/** Colour text field paired with a native swatch picker. */
function ColorField({
  id,
  label,
  value,
  onChange,
}: {
  id: string
  label: string
  value: string
  onChange: (next: string) => void
}) {
  const valid = HEX.test(value)

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="#0052ff"
          aria-invalid={!valid}
          className="font-mono"
        />
        <input
          type="color"
          aria-label={`${label} swatch`}
          value={valid ? value : "#000000"}
          onChange={(event) => onChange(event.target.value)}
          className="size-9 shrink-0 cursor-pointer rounded-lg border bg-transparent"
        />
      </div>
      {!valid ? (
        <p className="text-xs text-destructive">
          Use a 6-digit hex colour, e.g. #0052ff — the API rejects anything else.
        </p>
      ) : null}
    </div>
  )
}

/**
 * One theme's logo: preview on that theme's own background, upload, remove.
 *
 * The preview swatch is fixed light or fixed dark whatever the admin's own theme
 * is — the whole point of two slots is to see the logo against the background it
 * will actually sit on, and a preview that follows the viewer's theme can't show
 * you the case you're fixing.
 *
 * Uploading and removing are their own endpoints, not fields on the branding
 * PATCH, so both take effect the moment they're clicked without "Save branding".
 * The copy says so, because the neighbouring fields don't work that way and a
 * save button sitting below implies they all do.
 */
function LogoSlot({
  theme,
  logoUrl,
  shared,
  uploading,
  removing,
  onPick,
  onRemove,
}: {
  theme: LogoTheme
  /** The URL the server resolved for this theme — possibly the other slot's. */
  logoUrl: string | null
  /** True when both themes resolve to the same file, so this is a fallback. */
  shared: boolean
  uploading: boolean
  removing: boolean
  onPick: (file: File) => void
  onRemove: () => void
}) {
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [confirming, setConfirming] = React.useState(false)

  const dark = theme === "dark"
  const busy = uploading || removing

  const take = (file: File | undefined) => {
    if (!file) return

    if (!LOGO_UPLOAD.accept.split(",").includes(file.type)) {
      setError("Logos must be a PNG, JPEG, SVG or WebP image.")
      return
    }
    if (file.size > LOGO_UPLOAD.maxBytes) {
      setError(`${file.name} is larger than ${LOGO_UPLOAD.maxBytes / 1024 / 1024} MB.`)
      return
    }

    setError(null)
    onPick(file)
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border p-3">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={`branding-logo-${theme}`}>
          {dark ? "Dark theme" : "Light theme"}
        </Label>
        {shared ? (
          <span className="text-[11px] text-muted-foreground">
            shared
          </span>
        ) : null}
      </div>

      <div
        className={cn(
          "grid h-24 place-items-center overflow-hidden rounded-lg border",
          // Hard-coded, not theme tokens: this is a preview *of* a theme.
          dark ? "border-white/10 bg-[#0b0b0c]" : "border-black/10 bg-white"
        )}
      >
        {logoUrl ? (
          <ApiImage
            src={logoUrl}
            alt={`Company logo on the ${theme} theme`}
            className="max-h-16 w-auto max-w-[80%] object-contain"
            fallback={<ImageIcon className="size-6 text-muted-foreground/60" />}
          />
        ) : (
          <ImageIcon
            className={cn(
              "size-6",
              dark ? "text-white/25" : "text-black/25"
            )}
          />
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          <Upload />
          {uploading ? "Uploading…" : logoUrl ? "Replace" : "Upload"}
        </Button>

        {logoUrl ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => setConfirming(true)}
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 />
            {removing ? "Removing…" : "Remove"}
          </Button>
        ) : null}
      </div>

      <input
        ref={inputRef}
        id={`branding-logo-${theme}`}
        type="file"
        className="hidden"
        accept={LOGO_UPLOAD.accept}
        disabled={busy}
        onChange={(event) => {
          take(event.target.files?.[0])
          // Let the same file be re-picked after a failed attempt.
          event.target.value = ""
        }}
      />

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Remove the ${theme}-theme logo?`}
        description={
          shared
            ? `This is the only logo you've uploaded, so it's currently serving both themes — removing it leaves the platform logo on both.`
            : `The ${dark ? "light" : "dark"}-theme logo stays, and will serve both themes until you upload a new one here.`
        }
        confirmLabel="Remove logo"
        onConfirm={onRemove}
      />
    </div>
  )
}

/**
 * The client's white-label settings and the interview defaults HR inherits.
 *
 * Branding changes are visible immediately on the public
 * `GET /api/branding?company=<slug>` that the login page reads, so this screen
 * changes what candidates and staff see before they authenticate.
 */
export function BrandingPage() {
  const branding = useBranding()
  const defaults = useInterviewDefaults()
  const mutations = useCompanyMutations()

  const [appName, setAppName] = React.useState("")
  const [primaryColor, setPrimaryColor] = React.useState("#0052ff")
  const [accentColor, setAccentColor] = React.useState("#818cf8")
  const [clearingBoth, setClearingBoth] = React.useState(false)

  const darkLogo = branding.data?.logoDarkUrl ?? null
  const lightLogo = branding.data?.logoLightUrl ?? null
  /**
   * Both themes resolving to the same file means only one logo exists and the
   * server is serving it to both — the documented fallback. It's worth saying so
   * on the tiles, because otherwise the light slot looks filled when it isn't,
   * and "Remove" there would appear to do nothing.
   */
  const sharedLogo = Boolean(darkLogo) && darkLogo === lightLogo

  // Load the saved values once they arrive, without clobbering local edits.
  const loaded = React.useRef(false)
  React.useEffect(() => {
    if (loaded.current || !branding.data) return
    loaded.current = true
    setAppName(branding.data.appName ?? "")
    setPrimaryColor(branding.data.primaryColor || "#0052ff")
    setAccentColor(branding.data.accentColor || "#818cf8")
  }, [branding.data])

  const [rounds, setRounds] = React.useState<InterviewRound[] | null>(null)
  const [timeMinutes, setTimeMinutes] = React.useState("")
  const [linkExpiryHours, setLinkExpiryHours] = React.useState("")

  const defaultsLoaded = React.useRef(false)
  React.useEffect(() => {
    if (defaultsLoaded.current || !defaults.data) return
    defaultsLoaded.current = true
    setRounds(defaults.data.rounds)
    setTimeMinutes(String(defaults.data.timeMinutes))
    setLinkExpiryHours(String(defaults.data.linkExpiryHours))
  }, [defaults.data])

  const toggleRound = (round: InterviewRound) =>
    setRounds((current) => {
      const next = new Set(current ?? [])
      if (next.has(round)) next.delete(round)
      else next.add(round)
      // Preserve the canonical order rather than click order.
      return INTERVIEW_ROUND_OPTIONS.filter((option) => next.has(option))
    })

  const colorsValid = HEX.test(primaryColor) && HEX.test(accentColor)

  return (
    <>
      <PageHeader
        title="Branding"
        description="How your workspace appears to your team and your candidates, and what an interview looks like by default."
      />

      <ConfirmDialog
        open={clearingBoth}
        onOpenChange={setClearingBoth}
        title="Remove both logos?"
        description="Your dark- and light-theme logos are both cleared. Candidates and staff see the platform logo on your login page until you upload a new one."
        confirmLabel="Remove both"
        onConfirm={() => mutations.removeLogo.mutate(undefined)}
      />

      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle>White-label</CardTitle>
            <CardDescription>
              Shown on the login page for your company&rsquo;s slug, before
              anyone signs in.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {branding.isLoading ? (
              <Skeleton className="h-32 w-full" />
            ) : (
              <>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="branding-app-name">Workspace name</Label>
                  <Input
                    id="branding-app-name"
                    value={appName}
                    onChange={(event) => setAppName(event.target.value)}
                    placeholder="Acme Hiring"
                  />
                </div>

                <div className="flex flex-col gap-2">
                  <div className="flex flex-col gap-0.5">
                    <Label>Logos</Label>
                    <p className="text-xs text-muted-foreground">
                      One per theme, because a logo drawn for a dark background
                      disappears into a light one. Upload just one and it serves
                      both. PNG, JPEG, SVG or WebP · up to{" "}
                      {LOGO_UPLOAD.maxBytes / 1024 / 1024} MB, saved as soon as
                      you choose a file.
                    </p>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <LogoSlot
                      theme="dark"
                      logoUrl={darkLogo}
                      shared={sharedLogo}
                      uploading={
                        mutations.uploadLogo.isPending &&
                        mutations.uploadLogo.variables?.theme !== "light"
                      }
                      removing={
                        mutations.removeLogo.isPending &&
                        mutations.removeLogo.variables !== "light"
                      }
                      onPick={(file) =>
                        mutations.uploadLogo.mutate({ file, theme: "dark" })
                      }
                      onRemove={() => mutations.removeLogo.mutate("dark")}
                    />
                    <LogoSlot
                      theme="light"
                      logoUrl={lightLogo}
                      shared={sharedLogo}
                      uploading={
                        mutations.uploadLogo.isPending &&
                        mutations.uploadLogo.variables?.theme === "light"
                      }
                      removing={
                        mutations.removeLogo.isPending &&
                        mutations.removeLogo.variables === "light"
                      }
                      onPick={(file) =>
                        mutations.uploadLogo.mutate({ file, theme: "light" })
                      }
                      onRemove={() => mutations.removeLogo.mutate("light")}
                    />
                  </div>

                  {/* The endpoint's own asymmetry, surfaced rather than hidden:
                      DELETE with no `?theme=` clears *both* slots, which is not
                      what either per-slot button does. */}
                  {darkLogo || lightLogo ? (
                    <div>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={mutations.removeLogo.isPending}
                        onClick={() => setClearingBoth(true)}
                        className="text-muted-foreground"
                      >
                        <Trash2 />
                        Remove both
                      </Button>
                    </div>
                  ) : null}
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <ColorField
                    id="branding-primary"
                    label="Primary colour"
                    value={primaryColor}
                    onChange={setPrimaryColor}
                  />
                  <ColorField
                    id="branding-accent"
                    label="Accent colour"
                    value={accentColor}
                    onChange={setAccentColor}
                  />
                </div>
              </>
            )}
          </CardContent>
          <CardFooter className="justify-end">
            <Button
              disabled={
                !colorsValid ||
                branding.isLoading ||
                mutations.updateBranding.isPending
              }
              onClick={() =>
                mutations.updateBranding.mutate({
                  appName,
                  primaryColor,
                  accentColor,
                })
              }
            >
              {mutations.updateBranding.isPending ? "Saving…" : "Save branding"}
            </Button>
          </CardFooter>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Interview defaults</CardTitle>
            <CardDescription>
              Applied whenever a recruiter schedules without overriding them.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {defaults.isLoading ? (
              <Skeleton className="h-32 w-full" />
            ) : (
              <>
                <div className="flex flex-col gap-2">
                  <Label>Rounds</Label>
                  <div className="flex flex-wrap gap-2">
                    {INTERVIEW_ROUND_OPTIONS.map((round) => {
                      const on = (rounds ?? []).includes(round)
                      return (
                        <Button
                          key={round}
                          type="button"
                          variant={on ? "default" : "outline"}
                          size="sm"
                          onClick={() => toggleRound(round)}
                        >
                          {round}
                        </Button>
                      )
                    })}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    The API accepts only these five; anything else is rejected.
                  </p>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="defaults-minutes">Sitting length (min)</Label>
                    <Input
                      id="defaults-minutes"
                      type="number"
                      min={5}
                      max={180}
                      value={timeMinutes}
                      onChange={(event) => setTimeMinutes(event.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="defaults-expiry">Link valid (hours)</Label>
                    <Input
                      id="defaults-expiry"
                      type="number"
                      min={1}
                      max={720}
                      value={linkExpiryHours}
                      onChange={(event) =>
                        setLinkExpiryHours(event.target.value)
                      }
                    />
                  </div>
                </div>
              </>
            )}
          </CardContent>
          <CardFooter className="justify-end">
            <Button
              disabled={
                defaults.isLoading ||
                (rounds ?? []).length === 0 ||
                mutations.updateInterviewDefaults.isPending
              }
              onClick={() =>
                mutations.updateInterviewDefaults.mutate({
                  rounds: rounds ?? undefined,
                  timeMinutes: Number(timeMinutes) || undefined,
                  linkExpiryHours: Number(linkExpiryHours) || undefined,
                })
              }
            >
              {mutations.updateInterviewDefaults.isPending
                ? "Saving…"
                : "Save defaults"}
            </Button>
          </CardFooter>
        </Card>
      </div>
    </>
  )
}
