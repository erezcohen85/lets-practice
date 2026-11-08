import { X } from 'lucide-react'
import { useId } from 'react'
import { AdvancedReadingTick } from '@/components/newpiece/AdvancedReadingTick'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { strings } from '@/strings'

export interface PartRowData {
  key: number
  file: File
  name: string
  /** The part name is still being read from the PDF. */
  reading: boolean
  /** The user has typed in the name field: a read that comes back later must leave it alone. */
  edited: boolean
}

/**
 * One PDF of the piece: its file name (small), the part name to edit, the Advanced Reading tick and a button that removes
 * the part. From 640 px they sit in one row; below, the tick wraps under the name and the remove button. No colour.
 */
export function PartRow({
  part,
  error,
  onNameChange,
  onRemove,
  boxCheck,
}: {
  part: PartRowData
  error?: string
  onNameChange: (name: string) => void
  onRemove: () => void
  /** The Advanced Reading tick of the row; none when the build cannot do the box check. */
  boxCheck?: { checked: boolean; onToggle: () => void }
}) {
  const fileId = useId()
  const errorId = useId()

  return (
    <li className="flex flex-wrap items-center gap-x-3.5 gap-y-1 rounded-lg border border-border bg-surface px-4 py-3">
      <div className="order-1 min-w-0 flex-1">
        <p id={fileId} className="truncate text-[13px] leading-[1.3] text-text-muted">
          {part.file.name}
        </p>
        <Input
          aria-label={strings.newPiece.partName}
          aria-describedby={error === undefined ? fileId : `${fileId} ${errorId}`}
          aria-invalid={error === undefined ? undefined : true}
          value={part.name}
          placeholder={part.reading ? strings.newPiece.readingName : strings.newPiece.partNameHint}
          onChange={(event) => onNameChange(event.target.value)}
          autoComplete="off"
          className="mt-1 h-10 rounded-md border-border bg-background px-3 py-0 text-base md:text-base dark:bg-background"
        />
        {error !== undefined && (
          <p id={errorId} className="mt-1.5 text-sm text-problem">
            {error}
          </p>
        )}
      </div>
      {boxCheck !== undefined && <AdvancedReadingTick checked={boxCheck.checked} onToggle={boxCheck.onToggle} className="order-3 w-full sm:order-2 sm:w-auto" />}
      <Button
        type="button"
        variant="outline"
        aria-label={strings.newPiece.removePart}
        aria-describedby={fileId}
        onClick={onRemove}
        className="order-2 size-11 border-border bg-transparent text-text-soft sm:order-3 dark:border-border dark:bg-transparent dark:hover:bg-muted"
      >
        <X className="size-[18px]" strokeWidth={2} aria-hidden="true" />
      </Button>
    </li>
  )
}
