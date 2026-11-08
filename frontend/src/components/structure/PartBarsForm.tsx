import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { type EditResult, type EditorDoc } from '@/domain/pieceEdits'
import { insertPartBar, removePartBar, shiftPartPickup, splitPartPickup } from '@/domain/partBars'
import { barTally, hasPickup, type BarTally } from '@/domain/shortBars'
import { useBarNames } from '@/lib/barNamesContext'
import { strings } from '@/strings'
import { BarEditRows } from './BarEditRows'
import { BarsBox } from './BarsBox'
import { DetectedChip } from './DetectedChip'
import { FieldError } from './FieldError'
import { PickupChip } from './PickupForm'

const text = strings.structure.bars
const pickupText = strings.structure.partPickup

function refusalText(reason: string, fallback: string): string {
  return text.refusals[reason] ?? fallback
}

/**
 * This part > Bars: two boxes. "Bars in this part" has the part's Detected chip (its boxes when the Editor opened), Insert
 * [Before | After] bar n and Remove bar n: each splits or merges a box of this part only, so the piece, the other parts and the
 * recording times stay. "Pickup bars" says whether the part has the piece's pickup (box 0) and, when the piece has one and the part
 * does not, asks how to give it.
 */
export function PartBarsForm({
  doc,
  partId,
  detected,
  onEdit,
}: {
  doc: EditorDoc
  partId: string
  /** This part's boxes when the Editor opened. */
  detected: BarTally
  onEdit(result: EditResult): void
}) {
  const names = useBarNames()
  const page = doc.pages.find((p) => p.partId === partId)
  const now = barTally(page?.bars ?? [], doc.timing.shortBars)
  const boxes = page?.bars.map((box) => box.bar) ?? [1]
  const first = Math.min(...boxes)
  const last = Math.max(...boxes)
  const [pickupError, setPickupError] = useState<string | null>(null)
  const run = (result: EditResult, fallback: string): string | null => {
    if (result.ok) {
      onEdit(result)
      return null
    }
    return refusalText(result.reason, fallback)
  }
  const pieceHas = hasPickup(doc.timing)
  const partHas = now.pickup
  const choose = (result: EditResult) => {
    if (result.ok) {
      setPickupError(null)
      onEdit(result)
    } else setPickupError(pickupText.refusals[result.reason] ?? pickupText.refusals['no-box'])
  }

  return (
    <div className="flex flex-wrap items-start gap-x-6 gap-y-4">
      <BarsBox title={text.partTitle}>
        <DetectedChip detected={detected} now={now} />
        <BarEditRows
          range={{ first, last }}
          onInsert={(bar, side) => run(insertPartBar(doc, partId, bar, side), strings.structure.errors.invalidBarField(names.label(first), names.label(last)))}
          onRemove={(bar) => run(removePartBar(doc, partId, bar), strings.structure.errors.invalidBarField(names.label(first), names.label(last)))}
        />
        <p className="text-[13px] text-text-muted">{text.partNote}</p>
      </BarsBox>
      <BarsBox title={strings.structure.pickup.title}>
        <PickupChip on={partHas} label={partHas ? pickupText.present : pickupText.none} />
        {partHas && <p className="text-sm text-text-muted">{pickupText.has}</p>}
        {!partHas && !pieceHas && <p className="text-sm text-text-muted">{pickupText.noPiece}</p>}
        {!partHas && pieceHas && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-text-muted">{pickupText.ask}</p>
            <div className="flex flex-col gap-1">
              <Button type="button" variant="outline" size="touch" className="self-start" onClick={() => choose(splitPartPickup(doc, partId))}>
                {pickupText.split}
              </Button>
              <p className="text-[13px] text-text-muted">{pickupText.splitHint}</p>
            </div>
            <div className="flex flex-col gap-1">
              <Button type="button" variant="outline" size="touch" className="self-start" onClick={() => choose(shiftPartPickup(doc, partId))}>
                {pickupText.shift}
              </Button>
              <p className="text-[13px] text-text-muted">{pickupText.shiftHint}</p>
            </div>
            {pickupError !== null && <FieldError>{pickupError}</FieldError>}
          </div>
        )}
      </BarsBox>
    </div>
  )
}
