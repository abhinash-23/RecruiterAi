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
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? (
            <DialogDescription>{description}</DialogDescription>
          ) : null}
        </DialogHeader>

        <form
          id="entity-form"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <FormFields fields={fields} control={control} errors={errors} />
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
