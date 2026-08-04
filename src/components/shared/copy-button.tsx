import * as React from "react"
import { Check, Copy } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"

interface CopyButtonProps {
  value: string
  /** Completes the aria-label, e.g. "interview link" → "Copy interview link". */
  label: string
}

/** Copy-to-clipboard button that briefly confirms it worked. */
export function CopyButton({ value, label }: CopyButtonProps) {
  const [copied, setCopied] = React.useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard access needs a secure context and can be blocked outright,
      // so tell the reader what to do instead of failing silently.
      toast.error("Clipboard is blocked — select the text and copy manually.")
    }
  }

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={`Copy ${label}`}
      onClick={() => void copy()}
    >
      {copied ? <Check className="text-emerald-600" /> : <Copy />}
    </Button>
  )
}
