import { useState } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { ActionIcon } from '@/components/ui/action-icon'
import { sentenceOf } from '@/lib/processorClient'
import { strings } from '@/strings'

// The body is its own component, so each time the dialog opens it starts with its buttons on and no error: the Library
// keeps one dialog for all its cards, and a delete that worked must not leave the next piece's buttons off.
function DeletePieceBody({ title, note, onDelete }: { title: string; note?: string; onDelete: () => Promise<void> }) {
  const [deleting, setDeleting] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)

  const confirm = async () => {
    setDeleting(true)
    setFailed(null)
    try {
      await onDelete()
    } catch (error) {
      setFailed(sentenceOf(error) ?? strings.hub.deleteFailed)
      setDeleting(false)
    }
  }

  return (
    <>
      <AlertDialogHeader className="place-items-start gap-2 text-start">
        <AlertDialogTitle className="text-xl leading-tight font-semibold break-words">
          {strings.hub.deleteTitle(title)}
        </AlertDialogTitle>
        <AlertDialogDescription className="text-[15px] text-text-soft">{strings.hub.deleteText}</AlertDialogDescription>
        {note !== undefined && <p className="text-[15px] text-text-soft">{note}</p>}
      </AlertDialogHeader>
      {failed !== null && (
        <p role="alert" className="text-sm text-problem">
          {failed}
        </p>
      )}
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <AlertDialogCancel size="touch" disabled={deleting}>
          {strings.hub.cancel}
        </AlertDialogCancel>
        <AlertDialogAction variant="destructive" size="touch" disabled={deleting} onClick={() => void confirm()}>
          <ActionIcon action="delete" />
          {strings.hub.delete}
        </AlertDialogAction>
      </div>
    </>
  )
}

/**
 * Asks before the piece goes: its recording, parts and map are removed with it. `onDelete` rejects when the piece could
 * not be deleted; the dialog then says so (in the sentence of a SentenceError, if it has one) and stays open. `note` is a second
 * line under the question: a plan that counts the pieces made says here that deleting one does not give it back.
 */
export function DeletePieceDialog({
  open,
  onOpenChange,
  title,
  note,
  onDelete,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  note?: string
  onDelete: () => Promise<void>
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="gap-5 rounded-card p-6 data-[size=default]:sm:max-w-md">
        <DeletePieceBody title={title} note={note} onDelete={onDelete} />
      </AlertDialogContent>
    </AlertDialog>
  )
}
