import { useState } from 'react'
import { type EditResult, type FilledLocator } from '@/domain/pieceEdits'
import { shiftedBars, type ShiftedBars } from '@/domain/locatorModes'
import { type BarNames } from '@/domain/barNames'
import { type TimingLayer } from '@/domain/types'
import { barWithPass, strings } from '@/strings'

interface Note {
  /** The timing the note is true of: it shows only while the doc still has it, so an Undo, Redo, realign or any later edit takes it away. */
  timing: TimingLayer
  /** A Delete or Add on the waveform moved the later bars; null for a relabel. */
  moved: ShiftedBars | null
  /** A play order edit that relabelled the locators: how many took a new label. */
  relabeled: { count: number } | null
  filled: readonly FilledLocator[]
}

/** The relabel sentence, and what the fill that followed took from the recording. */
const relabeledSentence = (count: number, filled: number) =>
  filled === 0 ? strings.editor.status.relabeled(count) : `${strings.editor.status.relabeled(count)} ${strings.editor.status.filled(filled)}`

const labelOf = (names: BarNames) => (slot: { bar: number; passIndex: number }) => barWithPass(names.label(slot.bar), slot.passIndex)

/**
 * The status line's sentence for a Delete or Add on the waveform that moved the later bars (UX part 10): which bars
 * moved, and which bars the fill that followed took from the recording; and, after a relabel in play order, how many locators were relabelled. `afterEdit` gets the timing before the edit and
 * its result; `afterFill` gets the fill that was applied (see useFillEmpty). `sentence` is null when there is nothing to say.
 */
export function useShiftNote(timing: TimingLayer, names: BarNames) {
  const label = labelOf(names)
  const filledOf = (filled: readonly FilledLocator[]) =>
    filled.length === 0 ? null : { first: label(filled[0]), last: label(filled[filled.length - 1]), count: filled.length }
  const [note, setNote] = useState<Note | null>(null)
  const shown = note !== null && note.timing === timing ? note : null
  return {
    sentence:
      shown === null
        ? null
        : shown.moved === null
          ? relabeledSentence(shown.relabeled?.count ?? 0, shown.filled.length)
          : strings.editor.status.shifted(
              { first: label(shown.moved.first), last: label(shown.moved.last), count: shown.moved.count, direction: shown.moved.direction },
              filledOf(shown.filled),
            ),
    afterEdit(before: TimingLayer, result: EditResult) {
      if (result.ok && (result.label.kind === 'edit-play-order' || result.label.kind === 'add-pickup-bar') && (result.label.count ?? 0) > 0) {
        setNote({ timing: result.doc.timing, moved: null, relabeled: { count: result.label.count ?? 0 }, filled: [] })
        return
      }
      if (!result.ok || (result.label.kind !== 'add-locator' && result.label.kind !== 'delete-locator')) return
      const moved = shiftedBars(before, result.doc.timing)
      setNote(moved === null ? null : { timing: result.doc.timing, moved, relabeled: null, filled: [] })
    },
    afterFill(fill: { from: TimingLayer; doc: { timing: TimingLayer }; added: readonly FilledLocator[] }) {
      setNote((previous) => (previous !== null && previous.timing === fill.from ? { ...previous, timing: fill.doc.timing, filled: fill.added } : previous))
    },
  }
}
