import { type EditResult, type EditorDoc, insertPieceBar, removePieceBar } from '@/domain/pieceEdits'
import { pieceTally, type BarTally } from '@/domain/shortBars'
import { type BarNumber, type ClickMode } from '@/domain/types'
import { RenumberSwitch } from '@/components/editor/RenumberSwitch'
import { useBarNames } from '@/lib/barNamesContext'
import { strings } from '@/strings'
import { BarEditRows } from './BarEditRows'
import { BarsBox } from './BarsBox'
import { DetectedChip } from './DetectedChip'
import { PickupForm } from './PickupForm'

const text = strings.structure.bars

export interface BarsPrefill { action: 'insert' | 'remove'; bar: BarNumber }

/** What a plain or ripple change would do to the recording times, before the player applies it. */
function droppedBy(result: EditResult): number {
  return result.ok ? result.droppedLocators.length : 0
}

/**
 * Piece > Bars: two boxes side by side (stacked when narrow). "Bars in the piece" has the Detected chip, the Renumber
 * switch, Insert [Before | After] bar n and Remove bar n, in the piece only (no part's boxes or rests change); "Pickup bars"
 * is the top-of-the-piece pickup. Before bar n is `insertPieceBar` after bar n - 1. The caller keys it by the prefill.
 */
export function BarsForm({
  doc,
  detected,
  locked = false,
  barLineMode,
  onBarLineModeChange,
  prefill,
  onEdit,
}: {
  doc: EditorDoc
  /** The piece's bars when the Editor opened. */
  detected: BarTally
  locked?: boolean
  barLineMode: ClickMode
  onBarLineModeChange?(mode: ClickMode): void
  prefill?: BarsPrefill
  onEdit: (result: EditResult) => void
}) {
  const barCount = doc.timing.barCount
  const names = useBarNames()
  const apply = (result: EditResult, refusal: string): string | null => {
    if (result.ok) {
      onEdit(result)
      return null
    }
    return result.reason === 'only-bar' ? strings.structure.errors.onlyBar : refusal
  }
  const invalid = strings.structure.errors.invalidBarField('1', names.label(barCount))
  return (
    <div className="flex flex-wrap items-start gap-x-6 gap-y-4">
      <BarsBox title={text.pieceTitle} locked={locked}>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <DetectedChip detected={detected} now={pieceTally(doc.timing)} />
          {onBarLineModeChange !== undefined && <RenumberSwitch mode={barLineMode} onChange={onBarLineModeChange} />}
        </div>
        <BarEditRows
          key={prefill === undefined ? 'none' : `${prefill.action}:${prefill.bar}`}
          range={{ first: 1, last: barCount }}
          prefill={prefill}
          onInsert={(bar, side) => apply(insertPieceBar(doc, side === 'before' ? bar - 1 : bar, barLineMode), invalid)}
          onRemove={(bar) => apply(removePieceBar(doc, bar, barLineMode), invalid)}
          droppedByInsert={(bar, side) => droppedBy(insertPieceBar(doc, side === 'before' ? bar - 1 : bar, barLineMode))}
          droppedByRemove={(bar) => droppedBy(removePieceBar(doc, bar, barLineMode))}
        />
        <p className="text-[13px] text-text-muted">{text.pieceNote}</p>
      </BarsBox>
      <PickupForm key={JSON.stringify(doc.timing.shortBars)} doc={doc} locked={locked} onEdit={onEdit} />
    </div>
  )
}
