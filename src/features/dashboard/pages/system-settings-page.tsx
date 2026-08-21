import * as React from "react"

import { PageHeader } from "@/components/shared/page-header"
import { Badge } from "@/components/ui/badge"
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
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import {
  usePlatformBranding,
  usePlatformSettings,
  useSettingsMutations,
} from "@/services/super-admin"

const HEX = /^#[0-9a-fA-F]{6}$/

/** Any colour the store holds, however many digits it was written with. */
const HEX_VALUE = /^#[0-9a-fA-F]{3,8}$/

/** `interview_defaults` → `Interview defaults`. */
function humanise(key: string) {
  const spaced = key.replace(/[._-]+/g, " ").trim()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

/**
 * One stored value, rendered as what it is.
 *
 * The store is schemaless — features write whatever shape they own — so this
 * switches on the runtime type rather than on a known key. Anything it can't
 * recognise falls through to indented JSON, which is still readable; the point
 * is only that the common cases don't have to be.
 */
function SettingValue({ value }: { value: unknown }) {
  if (value === null || value === undefined || value === "") {
    return <span className="text-muted-foreground">—</span>
  }

  if (typeof value === "boolean") {
    return <span>{value ? "Yes" : "No"}</span>
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <span className="text-muted-foreground">—</span>
    }
    return (
      <div className="flex flex-wrap gap-1">
        {value.map((item, index) => (
          <Badge
            key={`${String(item)}-${index}`}
            variant="secondary"
            className="font-normal"
          >
            {typeof item === "object" ? JSON.stringify(item) : String(item)}
          </Badge>
        ))}
      </div>
    )
  }

  if (typeof value === "object") {
    return (
      <pre className="overflow-x-auto rounded-md bg-muted px-2 py-1.5 font-mono text-xs">
        {JSON.stringify(value, null, 2)}
      </pre>
    )
  }

  const text = String(value)

  if (HEX_VALUE.test(text)) {
    return (
      <span className="inline-flex items-center gap-2">
        <span
          className="size-3.5 shrink-0 rounded-full ring-1 ring-foreground/15"
          style={{ backgroundColor: text }}
        />
        <span className="font-mono">{text}</span>
      </span>
    )
  }

  return <span className="break-words">{text}</span>
}

/**
 * One top-level key of the store, with its own keys beneath it.
 *
 * A section per key rather than one list of everything: the store nests two
 * deep, and flattening it puts `app_name` from three different clients next to
 * each other with nothing to say which is whose.
 */
function SettingGroup({
  label,
  hint,
  value,
}: {
  label: string
  hint?: string
  value: unknown
}) {
  const nested =
    value !== null && typeof value === "object" && !Array.isArray(value)

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline gap-2">
        <h3 className="text-sm font-medium">{label}</h3>
        {hint ? (
          <span className="font-mono text-xs text-muted-foreground">
            {hint}
          </span>
        ) : null}
      </div>

      {nested ? (
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          {Object.entries(value as Record<string, unknown>).map(([key, own]) => (
            <div key={key} className="flex min-w-0 flex-col gap-0.5">
              <dt className="font-mono text-xs text-muted-foreground">{key}</dt>
              <dd className="min-w-0 text-sm">
                <SettingValue value={own} />
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <div className="text-sm">
          <SettingValue value={value} />
        </div>
      )}
    </div>
  )
}

/**
 * The store's keys in reading order: the platform's own first, then the
 * per-client `branding:<company-id>` overrides, which are the many.
 */
function orderedSettings(store: Record<string, unknown>) {
  const entries = Object.entries(store)
  const isOverride = (key: string) => key.startsWith("branding:")

  return [
    ...entries.filter(([key]) => !isOverride(key)),
    ...entries.filter(([key]) => isOverride(key)),
  ].map(([key, value]) => ({
    key,
    value,
    label: isOverride(key) ? "Client branding" : humanise(key),
    hint: isOverride(key) ? key.slice("branding:".length) : undefined,
  }))
}

/**
 * Platform-level defaults — the branding a client inherits before setting their
 * own, and the raw settings store behind it.
 *
 * Distinct from Admin → Branding: that changes one client's white-label, this
 * changes what everyone starts from.
 */
export function SystemSettingsPage() {
  const settings = usePlatformSettings()
  const branding = usePlatformBranding()
  const mutations = useSettingsMutations()

  const [appName, setAppName] = React.useState("")
  const [primaryColor, setPrimaryColor] = React.useState("#0052ff")
  const [accentColor, setAccentColor] = React.useState("#818cf8")

  const loaded = React.useRef(false)
  React.useEffect(() => {
    if (loaded.current || !branding.data) return
    loaded.current = true
    setAppName(branding.data.appName ?? "")
    setPrimaryColor(branding.data.primaryColor || "#0052ff")
    setAccentColor(branding.data.accentColor || "#818cf8")
  }, [branding.data])

  const colorsValid = HEX.test(primaryColor) && HEX.test(accentColor)

  return (
    <>
      <PageHeader
        title="System Settings"
        description="Platform-wide defaults. A client that hasn't set its own branding inherits what's here."
      />

      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Default branding</CardTitle>
            <CardDescription>
              Used on the login page when no client slug is supplied, or when the
              slug is unknown.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {branding.isLoading ? (
              <Skeleton className="h-32 w-full" />
            ) : (
              <>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="platform-app-name">Platform name</Label>
                  <Input
                    id="platform-app-name"
                    value={appName}
                    onChange={(event) => setAppName(event.target.value)}
                    placeholder="CognitiveScreen AI"
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="platform-primary">Primary colour</Label>
                    <Input
                      id="platform-primary"
                      value={primaryColor}
                      onChange={(event) => setPrimaryColor(event.target.value)}
                      className="font-mono"
                      aria-invalid={!HEX.test(primaryColor)}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="platform-accent">Accent colour</Label>
                    <Input
                      id="platform-accent"
                      value={accentColor}
                      onChange={(event) => setAccentColor(event.target.value)}
                      className="font-mono"
                      aria-invalid={!HEX.test(accentColor)}
                    />
                  </div>
                </div>
                {!colorsValid ? (
                  <p className="text-xs text-destructive">
                    Colours must be 6-digit hex, e.g. #0052ff.
                  </p>
                ) : null}
              </>
            )}
          </CardContent>
          <CardFooter className="justify-end">
            <Button
              disabled={!colorsValid || mutations.updateBranding.isPending}
              onClick={() =>
                mutations.updateBranding.mutate({
                  appName,
                  primaryColor,
                  accentColor,
                })
              }
            >
              {mutations.updateBranding.isPending
                ? "Saving…"
                : "Save default branding"}
            </Button>
          </CardFooter>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Stored settings</CardTitle>
            <CardDescription>
              Everything <code className="font-mono">GET /api/settings</code>{" "}
              currently holds. Read-only here — individual keys are written by
              the features that own them.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {settings.isLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : Object.keys(settings.data ?? {}).length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No settings stored yet.
              </p>
            ) : (
              orderedSettings(settings.data ?? {}).map((group, index) => (
                <React.Fragment key={group.key}>
                  {index > 0 ? <Separator /> : null}
                  <SettingGroup
                    label={group.label}
                    hint={group.hint}
                    value={group.value}
                  />
                </React.Fragment>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </>
  )
}
