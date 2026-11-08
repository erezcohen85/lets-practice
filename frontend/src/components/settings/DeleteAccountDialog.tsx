import { useEffect, useRef, useState } from 'react'
import { ActionIcon } from '@/components/ui/action-icon'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { AccountDeletionError } from '@/lib/accountDeletion'
import { useClients } from '@/lib/clients'
import { strings } from '@/strings'

const text = strings.settings
const dialogText = text.deleteAccountDialog

/**
 * Two messages before an account goes: what will be lost, then "Are you sure?". Cancel is the focused button at both, and
 * closes the dialog without deleting anything. `onDelete` rejects with an AccountDeletionError, and the dialog then says which
 * step stopped and stays open at the final message, so the person can try again. When it resolves, the session ends and the
 * page changes, so there is nothing left to close.
 */
export function DeleteAccountDialog({ open, onOpenChange, onDelete }: { open: boolean; onOpenChange: (open: boolean) => void; onDelete: () => Promise<void> }) {
  // Mounted only while open, so each opening starts at the first message with nothing left over from the last.
  return open ? <DeleteAccountSteps onClose={() => onOpenChange(false)} onDelete={onDelete} /> : null
}

function DeleteAccountSteps({ onClose, onDelete }: { onClose: () => void; onDelete: () => Promise<void> }) {
  const { data } = useClients()
  const [step, setStep] = useState<'first' | 'second'>('first')
  const [pieceCount, setPieceCount] = useState<number | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)
  const cancel = useRef<HTMLButtonElement>(null)

  // The number of pieces is read once; a failed read just leaves the number out.
  useEffect(() => {
    let current = true
    data
      .listPieces()
      .then((pieces) => current && setPieceCount(pieces.filter((piece) => piece.role === 'owner').length))
      .catch(() => {})
    return () => {
      current = false
    }
  }, [data])

  // The button that was pressed to get to the final message is replaced, so focus goes back to the safe choice.
  useEffect(() => {
    cancel.current?.focus()
  }, [step])

  const confirm = async () => {
    setDeleting(true)
    setFailed(null)
    try {
      await onDelete()
    } catch (error) {
      const stopped = error instanceof AccountDeletionError ? error.step : 'account'
      setFailed(dialogText.failed[stopped])
      setDeleting(false)
    }
  }

  return (
    <AlertDialog open onOpenChange={(next) => !next && !deleting && onClose()}>
      <AlertDialogContent className="gap-5 rounded-card p-6 data-[size=default]:sm:max-w-md">
        <AlertDialogHeader className="place-items-start gap-2 text-start">
          <AlertDialogTitle className="text-xl leading-tight font-semibold">{step === 'first' ? dialogText.firstTitle : dialogText.secondTitle}</AlertDialogTitle>
          <AlertDialogDescription className="text-[15px] text-text-soft">{step === 'first' ? dialogText.firstText : dialogText.secondText}</AlertDialogDescription>
        </AlertDialogHeader>
        {step === 'first' && pieceCount !== null && <p className="text-[15px] font-medium">{dialogText.pieceCount(pieceCount)}</p>}
        {failed !== null && (
          <p role="alert" className="text-sm text-problem">
            {failed}
          </p>
        )}
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <AlertDialogCancel ref={cancel} size="touch" disabled={deleting}>
            {text.cancel}
          </AlertDialogCancel>
          {step === 'first' ? (
            <Button variant="destructive" size="touch" onClick={() => setStep('second')}>
              {dialogText.continue}
            </Button>
          ) : (
            <Button variant="destructive" size="touch" disabled={deleting} onClick={() => void confirm()}>
              <ActionIcon action="delete" />
              {deleting ? dialogText.deleting : dialogText.confirm}
            </Button>
          )}
        </div>
      </AlertDialogContent>
    </AlertDialog>
  )
}
