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
} from "@/services/admin"

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
 * The company logo: preview, replace, remove.
 *
 * Uploading and removing are their own endpoints, not fields on the branding
 * PATCH — so both take effect the moment they're clicked, without "Save
 * branding". The copy says so, because the neighbouring fields don't work that
 * way and a save button sitting below implies they all do.
 */
function LogoField({
  logoUrl,
  uploading,
  removing,
  onPick,
  onRemove,
}: {
  logoUrl: string | null
  uploading: boolean
  removing: boolean
  onPick: (file: File) => void
  onRemove: () => void
}) {
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [confirming, setConfirming] = React.useState(false)

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
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="branding-logo">Logo</Label>

      <div className="flex flex-wrap items-center gap-4">
        <div className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-xl border bg-muted/40">
          {logoUrl ? (
            <ApiImage
              src={logoUrl}
              alt="Company logo"
              className="size-full object-contain p-1.5"
              fallback={
                <ImageIcon className="size-6 text-muted-foreground/60" />
              }
            />
          ) : (
            <ImageIcon className="size-6 text-muted-foreground/60" />
          )}
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => inputRef.current?.click()}
            >
              <Upload />
              {uploading
                ? "Uploading…"
                : logoUrl
                  ? "Replace logo"
                  : "Upload logo"}
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

          <p className="text-xs text-muted-foreground">
            PNG, JPEG, SVG or WebP · up to{" "}
            {LOGO_UPLOAD.maxBytes / 1024 / 1024} MB. Saved as soon as you
            choose a file.
          </p>
        </div>

        <input
          ref={inputRef}
          id="branding-logo"
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
      </div>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Remove logo?"
        description="Candidates and staff will see the platform logo on your login page until you upload a new one."
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

                <LogoField
                  logoUrl={branding.data?.logoUrl ?? null}
                  uploading={mutations.uploadLogo.isPending}
                  removing={mutations.removeLogo.isPending}
                  onPick={(file) => mutations.uploadLogo.mutate(file)}
                  onRemove={() => mutations.removeLogo.mutate()}
                />

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
