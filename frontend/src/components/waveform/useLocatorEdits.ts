import { useCallback } from 'react'
import { useRefusalHint } from '@/components/editor/useRefusalHint'
import { regridRefusalText, regridSentence } from '@/components/waveform/regridEdit'
import { type DockEdit } from '@/components/waveform/WaveformDock'
import { snapLocators, moveLocators } from '@/domain/groupMove'
import { lineModeFor } from '@/domain/locatorModes'
import { type EditResult, type EditRefusal, type EditorDoc } from '@/domain/pieceEdits'
import { regridLocators } from '@/domain/regridEdits'
import { addLocatorAt, dragLocator, relabel, removeLocator } from '@/domain/timingEdits'
import { type ClickMode } from '@/domain/types'
import { strings } from '@/strings'

/** The edit a dock gesture asks for, worked out on the doc. Add and Delete follow the Renumber switch; Shift does the other one (UX part 10). */
function resultOf(doc: EditorDoc, edit: Exclude<DockEdit, { kind: 'snap-group' | 'regrid' }>, barLineMode: ClickMode): EditResult {
  switch (edit.kind) {
    case 'drag':
      return dragLocator(doc, edit.slot.bar, edit.slot.passIndex, edit.timeSec)
    case 'drag-group':
      return moveLocators(doc, edit.slots, edit.deltaSec)
    case 'add':
      return addLocatorAt(doc, edit.timeSec, lineModeFor(barLineMode, edit.shift))
    case 'delete':
      return removeLocator(doc, edit.slot.bar, edit.slot.passIndex, lineModeFor(barLineMode, edit.shift))
    case 'relabel':
      return relabel(doc, edit.slot.bar, edit.slot.passIndex, edit.bar, edit.passIndex)
  }
}

/**
 * The dock's locator edits on the editor's doc: each one is applied as one history step (`apply` records and saves it),
 * and the reason a refused one gives shows in the dock's hint line for a few seconds. A refused relabel reports to its
 * own field instead, which is under the line being typed on.
 */
export function useLocatorEdits(doc: EditorDoc, apply: (result: EditResult) => EditRefusal | null, barLineMode: ClickMode) {
  const refusal = useRefusalHint()
  const { show, showText } = refusal
  const onEdit = useCallback(
    (edit: DockEdit): EditRefusal | null => {
      if (edit.kind === 'snap-group') {
        // A group Snap says how many lines it moved and how many stayed.
        const outcome = snapLocators(doc, edit.slots, edit.beats, edit.direction, edit.durationSec)
        const reason = apply(outcome.result)
        const closest = edit.direction === 'closest'
        if (outcome.moved === 0) showText(closest ? strings.dock.snapNoneClosest : strings.dock.snapNone)
        else showText(closest ? strings.dock.snapDoneClosest(outcome.moved, outcome.skipped) : strings.dock.snapDone(outcome.moved, outcome.skipped))
        return reason
      }
      if (edit.kind === 'regrid') {
        // The outcome of the edit, not the plan, is what the sentence counts: the plan can promise more than the ripple does.
        const outcome = regridLocators(doc, edit.stretch, edit.beats, edit.beatsPerBar, edit.offsetSec, edit.referenceMeter)
        const reason = apply(outcome.result)
        if (reason !== null) showText(regridRefusalText(reason))
        else showText(regridSentence(outcome, edit.continuedFrom))
        return reason
      }
      const reason = apply(resultOf(doc, edit, barLineMode))
      if (reason !== null && edit.kind !== 'relabel') show(reason)
      return reason
    },
    [doc, apply, barLineMode, show, showText],
  )
  return { onEdit, refusal: refusal.hint }
}
