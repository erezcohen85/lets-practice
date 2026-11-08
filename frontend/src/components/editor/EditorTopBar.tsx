import { ChevronDown, Pencil, Trash2 } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { DeletePartDialog } from '@/components/hub/DeletePartDialog'
import { RenameDialog } from '@/components/hub/RenameDialog'
import { BackLink } from '@/components/shell/BackLink'
import { ViewSwitch } from '@/components/shell/ViewSwitch'
import { MAX_PART_NAME } from '@/domain/names'
import { cn } from '@/lib/utils'
import { strings } from '@/strings'

const text = strings.editor

export interface EditorTopBarProps {
  pieceId: string
  title: string
  parts: { id: string; name: string }[]
  partId: string
  onPartChange(partId: string): void
  /** Renames the current part; rejects when the name could not be saved. Without it the part menu has no rename item. */
  onRenamePart?(name: string): Promise<void>
  /** Deletes the current part for good (after the dialog's confirmation); rejects when it could not be deleted. Without it the part menu has no delete item. */
  onDeletePart?(): Promise<void>
  /** Where the Practice side of the toggle goes: the same part, at the first bar of the page in view. */
  practiceHref: string
}

/** The part chip: a button with the part's name that opens a menu of the parts, and of renaming this one. A neutral dot, no part colours. */
function PartChip({ parts, partId, onPartChange, onRenamePart, onDeletePart }: Pick<EditorTopBarProps, 'parts' | 'partId' | 'onPartChange' | 'onRenamePart' | 'onDeletePart'>) {
  const [open, setOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const chipRef = useRef<HTMLButtonElement>(null)
  const menuId = useId()
  const current = parts.find((part) => part.id === partId)

  useEffect(() => {
    if (!open) return
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', closeOutside)
    return () => document.removeEventListener('pointerdown', closeOutside)
  }, [open])

  return (
    <div
      ref={rootRef}
      className="relative"
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !open) return
        setOpen(false)
        chipRef.current?.focus()
      }}
    >
      <button
        ref={chipRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen(!open)}
        title={current?.name}
        className="inline-flex h-10 max-w-56 shrink-0 items-center gap-2 rounded-full border border-border bg-surface px-4 whitespace-nowrap text-sm font-medium text-text outline-none hover:bg-surface-2 focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-text-soft" />
        <span className="truncate">{current?.name}</span>
        <ChevronDown className="size-4 shrink-0 text-text-soft" aria-hidden="true" />
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label={text.partMenu}
          className="absolute start-0 top-full z-20 mt-2 flex min-w-56 flex-col gap-0.5 rounded-card border border-border bg-surface p-1 shadow-lg"
        >
          {parts.map((part) => (
            <button
              key={part.id}
              type="button"
              role="menuitemradio"
              aria-checked={part.id === partId}
              onClick={() => {
                setOpen(false)
                onPartChange(part.id)
              }}
              className={cn(
                'flex h-10 items-center rounded-lg px-3 text-start text-sm outline-none hover:bg-surface-2 focus-visible:ring-3 focus-visible:ring-ring/50',
                part.id === partId ? 'font-semibold text-primary-strong' : 'text-text',
              )}
            >
              {part.name}
            </button>
          ))}
          {onRenamePart !== undefined && (
            <>
              <div role="separator" className="mx-1 my-0.5 h-px bg-border" />
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false)
                  setRenaming(true)
                }}
                className="flex h-10 items-center gap-2 rounded-lg px-3 text-start text-sm text-text outline-none hover:bg-surface-2 focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <Pencil className="size-4 shrink-0 text-text-soft" aria-hidden="true" />
                {text.renamePart}
              </button>
            </>
          )}
          {onDeletePart !== undefined && (
            <>
              {onRenamePart === undefined && <div role="separator" className="mx-1 my-0.5 h-px bg-border" />}
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false)
                  setDeleting(true)
                }}
                className="flex h-10 items-center gap-2 rounded-lg px-3 text-start text-sm text-problem outline-none hover:bg-surface-2 focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <Trash2 className="size-4 shrink-0" aria-hidden="true" />
                {text.deletePart}
              </button>
            </>
          )}
        </div>
      )}
      {onRenamePart !== undefined && current !== undefined && (
        <RenameDialog
          open={renaming}
          onOpenChange={setRenaming}
          value={current.name}
          max={MAX_PART_NAME}
          texts={strings.hub.renamePartTexts}
          onRename={onRenamePart}
        />
      )}
      {onDeletePart !== undefined && current !== undefined && (
        <DeletePartDialog open={deleting} onOpenChange={setDeleting} name={current.name} isLast={parts.length === 1} onDelete={onDeletePart} />
      )}
    </div>
  )
}

/**
 * The Editor's top bar (board: Editor.png): the way back to the hub, the piece title and the part chip at the start,
 * the Practice / Edit toggle in the middle (the score zoom moved to the Edit bar lines row).
 */
export function EditorTopBar({
  pieceId,
  title,
  parts,
  partId,
  onPartChange,
  onRenamePart,
  onDeletePart,
  practiceHref,
}: EditorTopBarProps) {
  return (
    <header className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-border px-6 py-2.5">
      {/* Below sm (a phone) this takes a row of its own, so the switch wraps below it and does not squeeze the name to nothing. */}
      <div className="flex min-w-0 flex-1 basis-full items-center gap-4 sm:basis-0">
        <BackLink to={`/pieces/${pieceId}`}>{text.pieceHub}</BackLink>
        <h1 className="min-w-0 truncate text-lg font-bold">{title}</h1>
        <PartChip parts={parts} partId={partId} onPartChange={onPartChange} onRenamePart={onRenamePart} onDeletePart={onDeletePart} />
      </div>
      <ViewSwitch active="edit" practiceHref={practiceHref} editHref={`/pieces/${pieceId}/edit?part=${partId}`} />
      {/* Empty, as wide as the block at the start, so the switch stays centred from lg up; below it the name block takes the room. */}
      <div aria-hidden className="flex-1 max-lg:hidden" />
    </header>
  )
}
