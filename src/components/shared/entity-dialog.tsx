import * as React from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm, type Resolver } from "react-hook-form"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

import { cn } from "@/lib/utils"

import {
  emptyValues,
  schemaFromFields,
  type FieldSpec,
  type FormValues,
} from "./field-schema"
import { FormFields } from "./form-fields"

interface EntityDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  fields: FieldSpec[]
  /** Pre-filled values put the dialog into edit mode. */
  initialValues?: FormValues | null
  submitLabel?: string
  pending?: boolean
  onSubmit: (values: FormValues) => Promise<void> | void
  /**
   * Extra classes for the dialog surface — in practice a wider `sm:max-w-*`.
   *
   * The right width belongs to the *form*, not to this component: three screens
   * share it, and the two that ask for a handful of short fields would only look
   * sparse at the width a job description needs. Every other dialog in the app
   * already picks its own, so this is the same rule rather than a new one.
   */
  contentClassName?: string
  /**
   * Controls that aren't a `FieldSpec` — rendered inside the form, after the
   * generated fields. Their state is the caller's; the dialog only places them.
   */
  extra?: React.ReactNode
}

/**
 * One dialog for every create/edit form in the app — admins, HR, candidates.
 * The caller supplies a field list; validation is generated from it, so no
 * screen writes its own form markup or schema.
 */
export function EntityDialog({
  open,
  onOpenChange,
  title,
  description,
  fields,
  initialValues,
  submitLabel = "Save",
  pending,
  onSubmit,
  contentClassName,
  extra,
}: EntityDialogProps) {
  const schema = React.useMemo(() => schemaFromFields(fields), [fields])
  const defaults = React.useMemo(
    () => initialValues ?? emptyValues(fields),
    [initialValues, fields]
  )

  const {
    control,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema) as unknown as Resolver<FormValues>,
    defaultValues: defaults,
  })

  // Load the right values whenever the dialog opens for a different row.
  React.useEffect(() => {
    if (open) reset(defaults)
  }, [open, defaults, reset])

  const submit = handleSubmit(async (values) => {
    try {
      await onSubmit(values)
    } catch (error) {
      // A rejected submit is a *handled* outcome: the caller's mutation has
      // already shown the server's message, and the dialog stays open with the
      // values intact so they can be corrected. Letting it propagate would only
      // surface as an unhandled rejection, since `submit()` is fire-and-forget.
      if (import.meta.env.DEV) {
        console.warn("[entity-dialog] submit rejected; dialog left open.", error)
      }
    }
  })

  const busy = pending || isSubmitting

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* The fields stack one per row — see `FormFields` — so this is the width
          of a single control, not of two side by side. `3xl` measured for the
          old two-up grid and left every input stretched across 768px; `xl` is
          still wide enough that a phone's number box isn't a stub beside its
          country select, which is what was wrong with the original `lg`. */}
      {/* `cn` last, so a caller's `sm:max-w-*` replaces the default rather than
          joining it — twMerge resolves the conflict in the caller's favour. */}
      {/* A column, not one scrolling block: the header and the Save button
          stay put and only the form scrolls, so a long job description can't
          push the footer out of sight. */}
      <DialogContent
        className={cn(
          "flex max-h-[90vh] flex-col overflow-hidden sm:max-w-xl",
          contentClassName
        )}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? (
            <DialogDescription>{description}</DialogDescription>
          ) : null}
        </DialogHeader>

        {/* `-mx-4 px-4` and `-my-1 py-1` keep focus rings at the edges from
            being clipped by the scroll box. */}
        <form
          className="-mx-4 -my-1 min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-1"
          id="entity-form"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <FormFields fields={fields} control={control} errors={errors} />
          {extra ? <div className="mt-4">{extra}</div> : null}
        </form>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            Cancel
          </Button>
          {/* `form="entity-form"` is what lets a button outside the <form>
              submit it — so no onClick handler here. Having both fired the
              submit twice per click, which against a real API meant two POSTs:
              the first succeeded and the second came back 409. */}
          <Button type="submit" form="entity-form" disabled={busy}>
            {busy ? "Saving…" : submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
