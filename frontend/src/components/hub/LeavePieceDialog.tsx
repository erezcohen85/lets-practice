import { useState } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { strings } from '@/strings'

// The body is its own component, so each time the dialog opens it starts with its buttons on and no error: the Library
// keeps one dialog for all its cards, and leaving one piece must not leave the next piece's buttons off.
function LeavePieceBody({ title, onLeave }: { title: string; onLeave: () => Promise<void> }) {
  const [leaving, setLeaving] = useState(false)
  const [failed, setFailed] = useState(false)

  const confirm = async () => {
    setLeaving(true)
    setFailed(false)
    try {
      await onLeave()
    } catch {
      setFailed(true)
      setLeaving(false)
    }
  }

  return (
    <>
      <AlertDialogHeader className="place-items-start gap-2 text-start">
        <AlertDialogTitle className="text-xl leading-tight font-semibold break-words">{strings.hub.leaveQuestion(title)}</AlertDialogTitle>
      </AlertDialogHeader>
      {failed && (
        <p role="alert" className="text-sm text-problem">
          {strings.hub.leaveFailed}
        </p>
      )}
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <AlertDialogCancel size="touch" disabled={leaving}>
          {strings.hub.leaveCancel}
        </AlertDialogCancel>
        <AlertDialogAction variant="destructive" size="touch" disabled={leaving} onClick={() => void confirm()}>
          {strings.hub.leaveConfirm}
        </AlertDialogAction>
      </div>
    </>
  )
}

/**
 * Asks before a member leaves a piece: it goes from their library, and the link brings it back. `onLeave` rejects when
 * they could not leave; the dialog then says so and stays open.
 */
export function LeavePieceDialog({
  open,
  onOpenChange,
  title,
  onLeave,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  onLeave: () => Promise<void>
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="gap-5 rounded-card p-6 data-[size=default]:sm:max-w-md">
        <LeavePieceBody title={title} onLeave={onLeave} />
      </AlertDialogContent>
    </AlertDialog>
  )
}
