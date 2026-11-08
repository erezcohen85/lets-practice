import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { type EditorDoc, type EditResult } from '@/domain/pieceEdits'
import { pieceImpact } from '@/domain/pieceImpact'
import { strings } from '@/strings'
import { ActionIcon } from '@/components/ui/action-icon'

const t = strings.editor.pieceEditing
/** The parts named in the confirm; the rest are counted. */
const NAMED_PARTS = 3

export interface PendingPieceChange { before: EditorDoc; result: Extract<EditResult, { ok: true }> }

/** "This changes the whole piece": asked before every change to the piece's number of bars (Decisions 2026-11-03). */
export function PieceChangeConfirm({
  pending,
  parts,
  onConfirm,
  onCancel,
}: {
  pending: PendingPieceChange | null
  parts: readonly { id: string; name: string }[]
  onConfirm(): void
  onCancel(): void
}) {
  const impact = pending === null ? null : pieceImpact(pending.before, pending.result)
  const off = impact?.partsOff.map((part) => parts.find((p) => p.id === part.partId)?.name ?? part.partId) ?? []
  return (
    <AlertDialog open={pending !== null} onOpenChange={(open) => !open && onCancel()}>
      <AlertDialogContent className="gap-5 rounded-card p-6 data-[size=default]:sm:max-w-md">
        <AlertDialogHeader className="place-items-start gap-2 text-start">
          <AlertDialogTitle className="text-xl leading-tight font-semibold">{t.confirmTitle}</AlertDialogTitle>
          <AlertDialogDescription className="flex flex-col gap-2 text-[15px] text-text-soft">
            {impact !== null && (
              <>
                <span>{t.confirmBars(impact.barsAdded, impact.barsRemoved, parts.length)}</span>
                <span>{t.confirmOff(off.slice(0, NAMED_PARTS), Math.max(0, off.length - NAMED_PARTS))}</span>
                {impact.timesDropped > 0 && <span>{t.confirmTimes(impact.timesDropped)}</span>}
              </>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <AlertDialogCancel size="touch">{strings.hub.cancel}</AlertDialogCancel>
          <AlertDialogAction size="touch" onClick={onConfirm}>
            <ActionIcon action="confirm" />
            {t.confirmAction}
          </AlertDialogAction>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  )
}
