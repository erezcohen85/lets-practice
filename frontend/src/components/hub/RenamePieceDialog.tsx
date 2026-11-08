import { RenameDialog, type RenameTexts } from '@/components/hub/RenameDialog'
import { MAX_PIECE_TITLE } from '@/domain/names'
import { type NameSuggestion } from '@/lib/processorClient'
import { strings } from '@/strings'

const texts: RenameTexts = {
  title: strings.hub.renameTitle,
  label: strings.hub.renameLabel,
  save: strings.hub.renameSave,
  empty: strings.hub.renameEmpty,
  tooLong: strings.hub.renameTooLong,
  failed: strings.hub.renameFailed,
}

/** Asks for a new title for the piece (1 to 200 characters). `onRename` gets the trimmed title and rejects when it could not be saved. */
export function RenamePieceDialog({
  open,
  onOpenChange,
  title,
  onRename,
  suggest,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  onRename: (title: string) => Promise<void>
  /** Gives the dialog a "Suggest a name" button. */
  suggest?: () => Promise<NameSuggestion>
}) {
  return <RenameDialog open={open} onOpenChange={onOpenChange} value={title} max={MAX_PIECE_TITLE} texts={texts} onRename={onRename} suggest={suggest} />
}
