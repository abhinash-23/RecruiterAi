import { AlertTriangle } from "lucide-react"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { cn } from "@/lib/utils"

interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title?: string
  description: string
  confirmLabel?: string
  destructive?: boolean
  onConfirm: () => void
}

/**
 * Single confirmation prompt for every destructive or irreversible action:
 * a warning glyph, the question, and an explicit yes.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title = "Confirm Action",
  description,
  confirmLabel = "Yes, Proceed",
  destructive = true,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      {/* `size="sm"` keeps the header centred at every breakpoint and lays the
          footer out as two equal buttons. */}
      <AlertDialogContent size="sm" className="sm:max-w-sm">
        <AlertDialogHeader>
          <span
            className={cn(
              "mb-1 flex size-12 items-center justify-center rounded-full",
              destructive
                ? "bg-amber-500/15 text-amber-500"
                : "bg-brand-blue/10 text-brand-blue"
            )}
          >
            <AlertTriangle className="size-6" />
          </span>
          <AlertDialogTitle className="font-heading text-lg">
            {title}
          </AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant={destructive ? "destructive" : "default"}
            onClick={() => {
              onConfirm()
              onOpenChange(false)
            }}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
