import * as React from "react"
import { addDays, format, formatDistanceToNowStrict } from "date-fns"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { cn } from "@/lib/utils"
import {
  usePlatformAdminMutations,
  type PlatformAdmin,
} from "@/services/super-admin"

import {
  formatAccessEnd,
  NO_LIMIT,
  toAccessPeriod,
  type AccessChoice,
  type AccessValue,
} from "./access-period-value"

/* ========================================================================== */
/*  The picker                                                                */
/* ========================================================================== */

const CHOICES: Array<{ value: Exclude<AccessChoice, "keep">; label: string }> =
  [
    { value: "none", label: "No limit" },
    { value: "2d", label: "2 days" },
    { value: "5d", label: "5 days" },
    { value: "1m", label: "1 month" },
    { value: "6m", label: "6 months" },
    { value: "until", label: "Until a date" },
  ]

/**
 * One shared control for create, Change access and Enable. The backend accepts
 * exactly one choice, which a radio group guarantees.
 */
export function AccessPicker({
  value,
  onChange,
  keepLabel,
  idPrefix = "access",
}: {
  value: AccessValue
  onChange: (next: AccessValue) => void
  /** Shown as the first option when there is a running period to keep. */
  keepLabel?: string
  idPrefix?: string
}) {
  // An "until" date must be after today; the backend checks it too.
  const tomorrow = format(addDays(new Date(), 1), "yyyy-MM-dd")
  const options = keepLabel
    ? [{ value: "keep" as const, label: keepLabel }, ...CHOICES]
    : CHOICES

  return (
    <div className="flex flex-col gap-2">
      <RadioGroup
        value={value.choice}
        onValueChange={(next) =>
          onChange({ ...value, choice: next as AccessChoice })
        }
        className="grid grid-cols-2 gap-2 sm:grid-cols-3"
        aria-label="Access period"
      >
        {options.map((option) => (
          <Label
            key={option.value}
            className={cn(
              "flex cursor-pointer items-center gap-2.5 rounded-xl border px-3 py-2 text-sm font-normal transition-colors hover:bg-muted/50",
              option.value === "keep" && "col-span-2 sm:col-span-3",
              value.choice === option.value && "border-primary bg-primary/5"
            )}
          >
            <RadioGroupItem value={option.value} />
            <span className="min-w-0 truncate">{option.label}</span>
          </Label>
        ))}
      </RadioGroup>

      {value.choice === "until" ? (
        <div className="flex flex-col gap-1.5">
          <Label
            htmlFor={`${idPrefix}-until`}
            className="text-xs text-muted-foreground"
          >
            Access ends at the end of this day
          </Label>
          <Input
            id={`${idPrefix}-until`}
            type="date"
            className="sm:w-48 dark:scheme-dark"
            min={tomorrow}
            value={value.until}
            onChange={(event) =>
              onChange({ ...value, until: event.target.value })
            }
          />
        </div>
      ) : null}
    </div>
  )
}

/* ========================================================================== */
/*  The Access column                                                         */
/* ========================================================================== */

export function AccessCell({ admin }: { admin: PlatformAdmin }) {
  if (admin.accessStatus === "unlimited" || !admin.accessEndsAt) {
    return <span className="text-muted-foreground">No limit</span>
  }

  const end = new Date(admin.accessEndsAt)

  if (admin.accessStatus === "ended") {
    return (
      <div className="flex flex-col gap-0.5">
        <span className="font-medium whitespace-nowrap text-red-600 dark:text-red-400">
          Ended
        </span>
        <span className="text-xs whitespace-nowrap text-muted-foreground">
          {formatAccessEnd(admin.accessEndsAt)}
        </span>
      </div>
    )
  }

  if (!admin.isActive) {
    return (
      <div className="flex flex-col gap-0.5">
        <span className="whitespace-nowrap">
          Until {format(end, "d MMM yyyy")}
        </span>
        <span className="text-xs whitespace-nowrap text-muted-foreground">
          Disabled by you
        </span>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-medium whitespace-nowrap">
        Until {formatAccessEnd(admin.accessEndsAt)}
      </span>
      <span className="text-xs whitespace-nowrap text-muted-foreground">
        {formatDistanceToNowStrict(end)} left
      </span>
    </div>
  )
}

/* ========================================================================== */
/*  Change access / Enable                                                    */
/* ========================================================================== */

/** Where an existing period starts the picker for Change access. */
function initialValue(admin: PlatformAdmin, mode: "change" | "enable") {
  const running =
    admin.accessStatus === "limited" && admin.accessEndsAt !== null
  if (mode === "enable") return NO_LIMIT
  if (running && admin.accessEndsAt) {
    return {
      choice: "until" as const,
      until: format(new Date(admin.accessEndsAt), "yyyy-MM-dd"),
    }
  }
  return NO_LIMIT
}

/**
 * `change`: a new period for an enabled admin, longer or shorter, applied at
 * once. `enable`: turns a disabled admin back on, with a period.
 */
export function AccessDialog({
  admin,
  mode,
  onClose,
}: {
  admin: PlatformAdmin | null
  mode: "change" | "enable"
  onClose: () => void
}) {
  const mutations = usePlatformAdminMutations()
  const [value, setValue] = React.useState<AccessValue>(NO_LIMIT)
  const [error, setError] = React.useState<string | null>(null)

  // Reset whenever the dialog opens for a row.
  const openFor = admin?.adminId ?? null
  const [seen, setSeen] = React.useState<string | null>(null)
  if (openFor !== seen) {
    setSeen(openFor)
    if (admin) setValue(initialValue(admin, mode))
    setError(null)
  }

  // A period that is still running ("limited", not "ended"), on a disabled
  // admin, can carry on.
  const keepLabel =
    mode === "enable" &&
    admin?.accessStatus === "limited" &&
    admin.accessEndsAt
      ? `Keep the current period (until ${formatAccessEnd(admin.accessEndsAt)})`
      : undefined

  const period = toAccessPeriod(value)
  const pending = mutations.setAccess.isPending || mutations.setActive.isPending

  const submit = async () => {
    if (!admin || !period) return
    setError(null)
    try {
      if (mode === "enable") {
        await mutations.setActive.mutateAsync({
          adminId: admin.adminId,
          isActive: true,
          access: period,
        })
      } else if (period !== "keep") {
        await mutations.setAccess.mutateAsync({
          adminId: admin.adminId,
          access: period,
        })
      }
      onClose()
    } catch (caught) {
      // The backend's own sentence, e.g. "The access end must be in the future."
      setError(
        caught instanceof Error && caught.message
          ? caught.message
          : "Couldn't save the access period."
      )
    }
  }

  const name = admin?.name ?? "this admin"

  return (
    <Dialog open={Boolean(admin)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {mode === "enable" ? `Enable ${name}` : `Change access for ${name}`}
          </DialogTitle>
          <DialogDescription>
            {mode === "enable"
              ? "The admin and their HRs can sign in again. Choose how long for."
              : "Applies at once. When the period ends, the admin and their HRs are signed out and the admin is disabled."}
          </DialogDescription>
        </DialogHeader>

        {admin && mode === "change" && admin.accessEndsAt ? (
          <p className="text-sm text-muted-foreground">
            Currently until{" "}
            <span className="font-medium text-foreground">
              {formatAccessEnd(admin.accessEndsAt)}
            </span>
            .
          </p>
        ) : null}

        <AccessPicker
          value={value}
          onChange={setValue}
          keepLabel={keepLabel}
          idPrefix="access-dialog"
        />

        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={pending || !period}>
            {pending
              ? "Saving…"
              : mode === "enable"
                ? "Enable admin"
                : "Save access"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
