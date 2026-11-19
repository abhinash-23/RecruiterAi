import * as React from "react"
import { format } from "date-fns"
import { AlertTriangle, AudioLines, Info, Loader2 } from "lucide-react"

import { ConfirmDialog } from "@/components/shared/confirm-dialog"
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
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Skeleton } from "@/components/ui/skeleton"
import { isMissingEndpoint } from "@/services/http-client"
import {
  useSetVoiceProvider,
  useVoiceProvider,
  type VoiceProviderState,
} from "@/services/super-admin"
import { cn } from "@/lib/utils"

function lastChanged(state: VoiceProviderState): string {
  if (state.chosenBy !== "super_admin" || !state.changedAt) {
    return "Server default (not changed yet)"
  }
  const when = new Date(state.changedAt)
  const at = Number.isNaN(when.getTime())
    ? ""
    : ` · ${format(when, "d MMM yyyy, h:mm a")}`
  return `Last changed by ${state.changedByEmail ?? "a super admin"}${at}`
}

function Notice({
  tone,
  children,
}: {
  tone: "info" | "warning"
  children: React.ReactNode
}) {
  const Icon = tone === "info" ? Info : AlertTriangle
  return (
    <p
      className={cn(
        "flex items-start gap-2 rounded-lg border px-3 py-2 text-sm",
        tone === "info"
          ? "border-sky-500/30 bg-sky-500/10"
          : "border-amber-500/30 bg-amber-500/10"
      )}
    >
      <Icon
        className={cn(
          "mt-0.5 size-4 shrink-0",
          tone === "info"
            ? "text-sky-600 dark:text-sky-400"
            : "text-amber-600 dark:text-amber-400"
        )}
      />
      <span>{children}</span>
    </p>
  )
}

/**
 * The super admin's switch for which provider speaks voice interviews, on
 * every company. Only on the super admin's System Settings: the route is theirs
 * alone, and the endpoints answer 403 to anyone else.
 *
 * The options come from the server, in its order. One that isn't set up there
 * is shown but can't be picked, with what it still needs.
 */
export function VoiceProviderCard() {
  const query = useVoiceProvider()
  const save = useSetVoiceProvider()
  const state = query.data
  /** Null: nothing picked yet, so the current one is what's selected. */
  const [picked, setPicked] = React.useState<string | null>(null)
  const [confirming, setConfirming] = React.useState(false)

  const selected = picked ?? state?.current ?? ""
  const target = state?.providers.find((option) => option.id === selected)
  const canSave =
    Boolean(state && target) &&
    target!.ready &&
    selected !== state!.current &&
    !save.isPending

  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle className="flex items-center gap-2 font-bold">
          <AudioLines className="size-4 text-muted-foreground" />
          Voice provider
        </CardTitle>
        <CardDescription>
          Which provider speaks voice interviews, for every company. A switch
          applies to interviews that start afterwards. Ones already in progress
          finish on the provider they started with.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {query.isLoading ? (
          <Skeleton className="h-36 w-full" />
        ) : query.isError || !state ? (
          <p className="text-sm text-muted-foreground">
            {isMissingEndpoint(query.error)
              ? "Choosing the voice provider isn't available on this server yet."
              : "Couldn't load the voice provider. Try again in a moment."}
          </p>
        ) : (
          <>
            {!state.voiceInterviewsEnabled ? (
              <Notice tone="info">
                Voice interviews are switched off on the server. Your choice
                applies once they&rsquo;re switched on.
              </Notice>
            ) : null}
            {!state.currentReady ? (
              <Notice tone="warning">
                {state.currentName} is no longer set up on the server, so voice
                interviews fall back to the typed interview. Choose a ready
                provider or ask the tech team.
              </Notice>
            ) : null}

            <div className="flex flex-col gap-0.5">
              <p className="text-sm">
                Current:{" "}
                <span className="font-semibold">{state.currentName}</span>
              </p>
              <p className="text-xs text-muted-foreground">
                {lastChanged(state)}
              </p>
            </div>

            <RadioGroup
              value={selected}
              onValueChange={(value) => setPicked(String(value))}
              aria-label="Voice provider"
            >
              {state.providers.map((option) => (
                <Label
                  key={option.id}
                  className={cn(
                    "flex items-start gap-3 rounded-xl border px-3 py-2.5 transition-colors",
                    option.ready
                      ? "cursor-pointer hover:bg-muted/50"
                      : "cursor-not-allowed border-dashed opacity-60",
                    selected === option.id && "border-primary bg-primary/5"
                  )}
                >
                  <RadioGroupItem
                    value={option.id}
                    disabled={!option.ready}
                    className="mt-0.5"
                  />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                      {option.name}
                      <span className="ml-auto flex items-center gap-1.5">
                        {option.ready ? (
                          <Badge variant="secondary">Ready</Badge>
                        ) : (
                          <Badge variant="outline">
                            Not set up on the server
                          </Badge>
                        )}
                        {option.current ? (
                          <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">
                            In use
                          </Badge>
                        ) : null}
                      </span>
                    </span>
                    {!option.ready && option.missing.length > 0 ? (
                      <span className="text-xs font-normal text-muted-foreground">
                        Needs: {option.missing.join(", ")}
                      </span>
                    ) : null}
                  </span>
                </Label>
              ))}
            </RadioGroup>
          </>
        )}
      </CardContent>

      <CardFooter className="justify-end">
        <Button disabled={!canSave} onClick={() => setConfirming(true)}>
          {save.isPending ? (
            <>
              <Loader2 className="animate-spin" />
              Switching…
            </>
          ) : (
            "Save"
          )}
        </Button>
      </CardFooter>

      {state && target ? (
        <ConfirmDialog
          open={confirming}
          onOpenChange={setConfirming}
          title={`Switch voice provider to ${target.name}?`}
          description={`All new voice interviews, for every company, will use ${target.name} from now on. Interviews already in progress will finish on ${state.currentName}.`}
          confirmLabel="Switch"
          destructive={false}
          onConfirm={() =>
            save.mutate(target.id, {
              // Back to following the server's answer, which is now current.
              onSuccess: () => setPicked(null),
            })
          }
        />
      ) : null}
    </Card>
  )
}
