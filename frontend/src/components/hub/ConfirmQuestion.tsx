import { useRef, useState, type ReactNode } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { ActionIcon, type ActionName } from '@/components/ui/action-icon'

/**
 * A question that must be answered before a change, as the Delete and Leave questions are: the buttons wait while the change
 * is saved, the question closes when it was, and when it was not, it says so here, where the user is looking, and stays open.
 */
export function ConfirmQuestion({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel,
  failedText,
  destructive,
  icon,
  confirmDisabled,
  children,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  confirmLabel: string
  cancelLabel: string
  /** Said inside the open question when `onConfirm` rejects. */
  failedText: string
  destructive?: boolean
  /** The icon at the start of the confirm button, for a question that does not destroy anything. */
  icon?: ActionName
  /** Holds the confirm button until something is answered in `children` (a tick, for the rights question). */
  confirmDisabled?: boolean
  /** Extra content under the description, such as a tick. */
  children?: ReactNode
  onConfirm: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  // A second click can arrive before the buttons have re-rendered as disabled.
  const running = useRef(false)

  const confirm = async () => {
    if (running.current) return
    running.current = true
    setBusy(true)
    setFailed(false)
    try {
      await onConfirm()
      onOpenChange(false)
    } catch {
      setFailed(true)
    } finally {
      running.current = false
      setBusy(false)
    }
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setFailed(false)
        onOpenChange(next)
      }}
    >
      <AlertDialogContent className="gap-5 rounded-card p-6 data-[size=default]:sm:max-w-md">
        <AlertDialogHeader className="place-items-start gap-2 text-start">
          <AlertDialogTitle className="text-xl leading-tight font-semibold">{title}</AlertDialogTitle>
          <AlertDialogDescription className="text-[15px] text-text-soft break-words">{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {children}
        {failed && (
          <p role="alert" className="text-sm text-problem">
            {failedText}
          </p>
        )}
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <AlertDialogCancel size="touch" disabled={busy}>
            {cancelLabel}
          </AlertDialogCancel>
          <AlertDialogAction variant={destructive ? 'destructive' : 'default'} size="touch" disabled={busy || confirmDisabled === true} onClick={() => void confirm()}>
            {icon !== undefined && <ActionIcon action={icon} />}
            {confirmLabel}
          </AlertDialogAction>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  )
}
