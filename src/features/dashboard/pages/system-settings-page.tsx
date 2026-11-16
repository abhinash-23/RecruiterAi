import * as React from "react"
import { Palette, Settings } from "lucide-react"

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
  usePlatformBranding,
  useSettingsMutations,
} from "@/services/super-admin"

const HEX = /^#[0-9a-fA-F]{6}$/

/**
 * Platform-level defaults — the branding a client inherits before setting their
 * own.
 *
 * Distinct from Admin → Branding: that changes one client's white-label, this
 * changes what everyone starts from.
 */
export function SystemSettingsPage() {
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
        icon={Settings}
        description="Platform-wide defaults. A client that hasn't set its own branding inherits what's here."
      />

      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader className="border-b">
            <CardTitle className="flex items-center gap-2 font-bold">
              <Palette className="size-4 text-muted-foreground" />
              Default branding
            </CardTitle>
            <CardDescription>
              Used on the login page when no client slug is supplied, or when
              the slug is unknown.
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
      </div>
    </>
  )
}
