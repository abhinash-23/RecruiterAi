import * as React from "react"
import { Loader2, Pencil } from "lucide-react"

import { PhoneInput } from "@/components/shared/phone-input"
import { RequiredMark } from "@/components/shared/required-mark"
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
import { isValidEmail } from "@/lib/email"
import { isValidPhone } from "@/lib/phone"

export interface CandidateContact {
  name: string
  email: string
  /** Absent where the record has no phone — the field is then not shown. */
  phone?: string
}

/**
 * Corrects a candidate's name and email — and phone, where the record has one —
 * **before anything has been sent to them.**
 *
 * One dialog for both places that allow it: a draft interview, and a job
 * candidate who hasn't been scheduled. Both refuse the edit once the invitation
 * is out (it is already in the old inbox), so the caller only offers this
 * before then.
 *
 * Sends only the fields that changed: an empty body is a 422 on both
 * endpoints, so Save stays disabled until something differs.
 */
export function EditCandidateDialog({
  contact,
  description,
  pending,
  onSave,
  onOpenChange,
}: {
  /** The record being edited, or null when closed. */
  contact: CandidateContact | null
  description: string
  pending: boolean
  onSave: (changes: Partial<CandidateContact>) => Promise<unknown>
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={contact !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {/* Keyed by the record, so each opening starts from its saved values
            rather than whatever the previous one was left holding. */}
        {contact ? (
          <EditCandidateForm
            key={`${contact.name}|${contact.email}|${contact.phone ?? ""}`}
            contact={contact}
            description={description}
            pending={pending}
            onSave={onSave}
            onCancel={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function EditCandidateForm({
  contact,
  description,
  pending,
  onSave,
  onCancel,
}: {
  contact: CandidateContact
  description: string
  pending: boolean
  onSave: (changes: Partial<CandidateContact>) => Promise<unknown>
  onCancel: () => void
}) {
  const [name, setName] = React.useState(contact.name)
  const [email, setEmail] = React.useState(contact.email)
  const [phone, setPhone] = React.useState(contact.phone ?? "")
  const hasPhone = contact.phone !== undefined

  const changes: Partial<CandidateContact> = {}
  if (name.trim() !== contact.name) changes.name = name.trim()
  if (email.trim() !== contact.email) changes.email = email.trim()
  if (hasPhone && phone.trim() !== contact.phone) changes.phone = phone.trim()

  const emailValid = isValidEmail(email)
  // A phone may be cleared only if it was never set; otherwise it must be real.
  const phoneValid =
    !hasPhone ||
    (phone.trim() === "" ? !contact.phone : isValidPhone(phone))
  const ready =
    Object.keys(changes).length > 0 &&
    name.trim().length > 0 &&
    emailValid &&
    phoneValid

  const submit = async () => {
    try {
      await onSave(changes)
      onCancel()
    } catch {
      // Reported by the mutation; stay open so the edit isn't lost.
    }
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        if (ready && !pending) void submit()
      }}
      className="flex flex-col gap-4"
    >
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Pencil className="size-4" />
          Edit candidate
        </DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="edit-candidate-name">
          Name <RequiredMark />
        </Label>
        <Input
          id="edit-candidate-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          aria-invalid={name.trim().length === 0}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="edit-candidate-email">
          Email <RequiredMark />
        </Label>
        <Input
          id="edit-candidate-email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          aria-invalid={email.length > 0 && !emailValid}
        />
      </div>

      {hasPhone ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="edit-candidate-phone">Phone</Label>
          <PhoneInput
            id="edit-candidate-phone"
            value={phone}
            onChange={setPhone}
            invalid={!phoneValid}
            placeholder="90000 00000"
          />
        </div>
      ) : null}

      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={pending}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={!ready || pending}>
          {pending ? (
            <>
              <Loader2 className="animate-spin" />
              Saving…
            </>
          ) : (
            "Save changes"
          )}
        </Button>
      </DialogFooter>
    </form>
  )
}
