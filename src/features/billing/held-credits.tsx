import * as React from "react"

import { ConfirmDialog } from "@/components/shared/confirm-dialog"
import { useRefundInterview } from "@/services/billing"

import { creditsText, type HeldCreditsTarget } from "./held-target"
import { RescheduleDialog } from "./reschedule-dialog"

export type { HeldCreditsTarget } from "./held-target"

/**
 * The Refund-or-Reschedule choice for an interview whose credits are on hold,
 * as two openers plus the dialogs they open — so the bell and the Interviews
 * page offer the exact same choice.
 *
 *   const held = useHeldCreditsChoice()
 *   <Button onClick={() => held.refund(target)}>Refund</Button>
 *   {held.dialogs}
 */
export function useHeldCreditsChoice() {
  const refundMutation = useRefundInterview()
  const [refunding, setRefunding] = React.useState<HeldCreditsTarget | null>(
    null
  )
  const [rescheduling, setRescheduling] =
    React.useState<HeldCreditsTarget | null>(null)

  const dialogs = (
    <>
      <ConfirmDialog
        open={refunding !== null}
        onOpenChange={(next) => !next && setRefunding(null)}
        title={
          refunding?.credits
            ? `Refund ${refunding.credits} credits?`
            : "Refund the credits?"
        }
        description={
          refunding
            ? `${creditsText(refunding)} held for ${refunding.candidateName}'s interview go back to the wallet. This settles the choice: the interview can't be rescheduled for free afterwards.`
            : ""
        }
        confirmLabel="Refund"
        destructive={false}
        onConfirm={() => {
          if (refunding) refundMutation.mutate(refunding.interviewId)
        }}
      />
      <RescheduleDialog
        target={rescheduling}
        onClose={() => setRescheduling(null)}
      />
    </>
  )

  return {
    refund: setRefunding,
    reschedule: setRescheduling,
    /** True while a refund request is in flight. */
    refundPending: refundMutation.isPending,
    dialogs,
  }
}
