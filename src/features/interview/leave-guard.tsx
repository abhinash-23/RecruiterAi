import * as React from "react"

import { ConfirmDialog } from "@/components/shared/confirm-dialog"

/**
 * Warns before a refresh throws the candidate out of their interview.
 *
 * **Why it matters:** the sitting lives only in this page's memory, and the tab
 * going away reports it closed — so a refresh mid-interview marks it abandoned,
 * nothing is scored, and the link can't be reopened. Before the sitting starts
 * it is just as final: the verified code is spent, and the server won't send
 * another for an interview that has already been verified.
 *
 * **Two layers, because browsers allow only so much:**
 *
 *  - **Keyboard refresh** (F5, Ctrl+R, Cmd+R, with or without Shift) is caught
 *    before the browser acts, and gets our own dialog in the app's theme. During
 *    the interview, confirming it **submits** what was answered — the same path
 *    as End interview, awaited while the page is still alive — rather than
 *    reloading into an abandoned sitting. There is no reason to reload after.
 *  - **Everything else** — the toolbar's reload button, closing the tab, typing
 *    a new address — can only be met with the browser's own `beforeunload`
 *    prompt. Its wording and look are the browser's: every modern browser
 *    ignores custom text there, and our page gets no chance to submit anything
 *    once it is confirmed. iOS Safari usually shows nothing at all.
 *
 * Deliberately **not** done: submitting from `pagehide`. A request fired while
 * the page dies is best-effort, can't wait for the recording to seal, and can't
 * tell a refresh from a closed tab. The reliable version of that is the
 * backend scoring on `interview-closed`.
 */
export function LeaveGuard({
  active,
  sitting,
  onSubmit,
}: {
  /** From a verified code until the interview is over. */
  active: boolean
  /** Whether the interview itself is under way — decides what is at stake. */
  sitting: boolean
  /**
   * Submits and ends the sitting. Absent while that is already happening, so a
   * second keypress can't submit twice — the key is still swallowed then.
   */
  onSubmit?: () => void
}) {
  const [asking, setAsking] = React.useState(false)
  /** Set once the candidate confirms a reload, so the browser's prompt doesn't follow ours. */
  const leavingRef = React.useRef(false)

  /* Read from the key handler without re-registering it on every render. */
  const canAskRef = React.useRef(true)
  React.useEffect(() => {
    canAskRef.current = !sitting || Boolean(onSubmit)
  })

  React.useEffect(() => {
    if (!active) return

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (leavingRef.current) return
      event.preventDefault()
      // Still required by some browsers to show the prompt at all; the text
      // itself is ignored everywhere.
      event.returnValue = ""
    }

    const onKeyDown = (event: KeyboardEvent) => {
      const refresh =
        event.key === "F5" ||
        ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "r")
      if (!refresh) return
      event.preventDefault()
      if (canAskRef.current) setAsking(true)
    }

    window.addEventListener("beforeunload", onBeforeUnload)
    // Capture phase, so nothing in the room can swallow the key first.
    window.addEventListener("keydown", onKeyDown, true)
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload)
      window.removeEventListener("keydown", onKeyDown, true)
    }
  }, [active])

  if (!active) return null

  if (sitting) {
    return (
      <ConfirmDialog
        open={asking}
        onOpenChange={setAsking}
        title="Refresh and end your interview?"
        description="Refreshing would end your interview, and it can't be restarted. If you continue, the answers you've given so far will be submitted and your interview will end here."
        confirmLabel="Submit and end"
        onConfirm={() => onSubmit?.()}
      />
    )
  }

  return (
    <ConfirmDialog
      open={asking}
      onOpenChange={setAsking}
      title="Refresh and end your interview?"
      description="Refreshing closes your interview. Your code has already been used and a new one can't be sent, so you'd have to ask your recruiter for a new interview."
      confirmLabel="Refresh anyway"
      onConfirm={() => {
        leavingRef.current = true
        window.location.reload()
      }}
    />
  )
}
