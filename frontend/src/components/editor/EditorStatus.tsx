import { ActionIcon } from '@/components/ui/action-icon'
import { Button } from '@/components/ui/button'
import { type BarCountAdvice } from '@/domain/pieceImpact'
import { type SaveState } from '@/lib/useEditorDoc'
import { strings } from '@/strings'

const text = strings.editor

export interface EditorStatusProps {
  saveState: SaveState
  /** The "Renumber the bars after" switch could not be saved. */
  settingsFailed: boolean
  /** The shown part has a different number of bars than the piece (from partProblems), with its display name and what to offer (barCountAdvice). */
  partProblem: { name: string; partBars: number; pieceBars: number; advice?: BarCountAdvice | null } | null
  /** Play slots without a locator. */
  unmatchedCount: number
  /** Bar lines dragged by hand and not resolved yet. */
  movedCount: number
  /** A Structure edit was made since the last realign in this visit. */
  structureChanged: boolean
  realigning: boolean
  /** Whether this deployment can realign: without it the line says which bars have no time, and offers no button. Default true. */
  canRealign?: boolean
  /** The processor is finding times for the bars an edit left empty. */
  filling?: boolean
  /** The fill found no time for the bars that have none. */
  noRoom?: boolean
  /** Bars filled in by the app and not looked at yet (not confirmed, not checked). */
  filledCount?: number
  /** What the last Delete or Add on the waveform moved, as a sentence. */
  shiftNote?: string | null
  /** Why the last realign did not finish. */
  realignError: string | null
  /** A calm note about the job in progress (it is slow), not an error. */
  realignNote?: string | null
  onRetry(): void
  onOpenStructure(): void
  onRealign(): void
  /** Asks to turn on Edit piece structure (its warning): offered only when most other parts agree with this part. */
  onEditPiece?(): void
}

/**
 * The one line at the end of the page line, most important first: Not saved with Retry, a failed realign, the bar
 * count of the part against the piece with the part's own fix (and Edit piece structure only when most other parts agree
 * with this part), the bars without a time with Realign. When none of these
 * applies the line is empty. A live region, so each problem is announced when it appears.
 */
export function EditorStatus({
  saveState,
  settingsFailed,
  partProblem,
  unmatchedCount,
  movedCount,
  structureChanged,
  realigning,
  canRealign = true,
  filling = false,
  noRoom = false,
  filledCount = 0,
  shiftNote = null,
  realignError,
  realignNote = null,
  onRetry,
  onOpenStructure,
  onRealign,
  onEditPiece,
}: EditorStatusProps) {
  const items: { key: string; node: React.ReactNode }[] = []
  if (saveState === 'failed') {
    items.push({
      key: 'saved',
      node: (
        <>
          <span className="text-problem">{text.notSaved}</span>
          <Button variant="outline" size="sm" onClick={onRetry}>
            {text.retrySave}
          </Button>
        </>
      ),
    })
  }
  if (settingsFailed) items.push({ key: 'settings', node: <span className="text-problem">{strings.settings.saveFailed}</span> })
  if (realignError !== null) items.push({ key: 'error', node: <span className="text-problem">{realignError}</span> })
  if (realignNote !== null) items.push({ key: 'note', node: <span>{realignNote}</span> })
  if (partProblem !== null) {
    items.push({
      key: 'bars',
      node: (
        <>
          <span className="text-warning-text">
            {text.status.partBars(partProblem.name, partProblem.partBars, partProblem.pieceBars)}{' '}
            {partProblem.advice?.kind === 'piece-may-be-wrong'
              ? text.status.guidePiece(partProblem.advice.agreeWithPart, partProblem.advice.others)
              : partProblem.advice?.kind === 'part-misread'
                ? text.status.guideMisread(partProblem.name, partProblem.advice.diff)
                : null}
          </span>
          <Button variant="outline" size="sm" onClick={onOpenStructure}>
            {text.status.openStructure}
          </Button>
          {partProblem.advice !== undefined && partProblem.advice !== null && partProblem.advice.kind !== 'part-misread' && onEditPiece !== undefined && (
            <Button variant="outline" size="sm" onClick={onEditPiece}>
              {text.status.editPiece}
            </Button>
          )}
        </>
      ),
    })
  }
  if (unmatchedCount > 0 || structureChanged || realigning) {
    items.push({
      key: 'realign',
      node: (
        <>
          <span className="text-warning-text">
            {unmatchedCount > 0 ? text.status.unmatched(unmatchedCount) : text.status.structureChanged}
            {unmatchedCount > 0 && noRoom && ` ${text.status.noRoom}`}
          </span>
          {/* pointer-events stay on when disabled, or the tip would not show while it realigns. */}
          {canRealign && (
            <Button size="sm" disabled={realigning} title={text.status.realignTip} className="disabled:pointer-events-auto" onClick={onRealign}>
              <ActionIcon action="realign" />
              {realigning ? text.status.realigning : text.status.realign}
            </Button>
          )}
        </>
      ),
    })
  }
  if (filling) items.push({ key: 'filling', node: <span>{text.status.filling}</span> })
  // The shift sentence already says which bars were filled, so the general line would only crowd the page line.
  if (filledCount > 0 && shiftNote === null) items.push({ key: 'filled', node: <span className="text-moved">{text.status.filled(filledCount)}</span> })
  if (shiftNote !== null) items.push({ key: 'shifted', node: <span>{shiftNote}</span> })
  if (movedCount > 0) items.push({ key: 'moved', node: <span className="text-moved">{text.status.moved(movedCount)}</span> })

  return (
    <div role="status" data-slot="editor-status" className="flex flex-wrap items-center justify-end gap-x-5 gap-y-1 text-sm text-text-soft">
      {items.map(({ key, node }) => (
        <span key={key} className="flex items-center gap-2">
          {node}
        </span>
      ))}
    </div>
  )
}
