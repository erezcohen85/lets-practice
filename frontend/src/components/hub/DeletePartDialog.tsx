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

const t = strings.partDelete

/**
 * Asks before a part's files are deleted for good. The piece's last part cannot go: the dialog then says to delete the
 * piece instead and offers only Close. `onDelete` rejects when the part could not be deleted; the dialog then says so
 * (the server's own sentence when it gave one) and stays open, and a deleted part closes it.
 */
export function DeletePartDialog({
  open,
  onOpenChange,
  name,
  isLast,
  onDelete,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  name: string
  isLast: boolean
  onDelete: () => Promise<void>
}) {
  const [deleting, setDeleting] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)

  const confirm = async () => {
    setDeleting(true)
    setFailed(null)
    try {
      await onDelete()
      onOpenChange(false)
    } catch (error) {
      setFailed(sentenceOf(error) ?? t.failed)
    }
    setDeleting(false)
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setFailed(null)
        onOpenChange(next)
      }}
    >
      <AlertDialogContent className="gap-5 rounded-card p-6 data-[size=default]:sm:max-w-md">
        <AlertDialogHeader className="place-items-start gap-2 text-start">
          <AlertDialogTitle className="text-xl leading-tight font-semibold break-words">
            {isLast ? t.lastTitle(name) : t.title(name)}
          </AlertDialogTitle>
          <AlertDialogDescription className="text-[15px] text-text-soft">{isLast ? t.lastText : t.text}</AlertDialogDescription>
        </AlertDialogHeader>
        {failed !== null && (
          <p role="alert" className="text-sm text-problem">
            {failed}
          </p>
        )}
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <AlertDialogCancel size="touch" disabled={deleting}>
            {isLast ? t.close : strings.hub.cancel}
          </AlertDialogCancel>
          {!isLast && (
            <AlertDialogAction
              variant="destructive"
              size="touch"
              disabled={deleting}
              onClick={(event) => {
                // The alert dialog would close itself on the click; it closes when the part is gone.
                event.preventDefault()
                void confirm()
              }}
            >
              <ActionIcon action="delete" />
              {strings.hub.delete}
            </AlertDialogAction>
          )}
        </div>
      </AlertDialogContent>
    </AlertDialog>
  )
}
