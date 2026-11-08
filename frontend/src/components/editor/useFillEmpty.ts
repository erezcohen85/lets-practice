import { useEffect, useRef, useState } from 'react'
import { fillEmptyBars } from '@/domain/fillBars'
import { type StepLabel } from '@/domain/history'
import { type EditorDoc, type EditResult, type FilledLocator } from '@/domain/pieceEdits'
import { type TimingLayer } from '@/domain/types'
import { unmatchedSlots } from '@/domain/renumber'
import { useClients } from '@/lib/clients'
import { type EditorDocApi } from '@/lib/useEditorDoc'

/** The edits that can leave play slots without a locator without the user having asked for it: a Structure change of the bars or the play order, and the locator edits that shift the bars after them. */
const FILLING_STEPS: ReadonlySet<StepLabel['kind']> = new Set(['insert-piece-bar', 'remove-piece-bar', 'add-piece-bar-line', 'delete-piece-bar-line', 'set-piece-bars-in-box', 'edit-play-order', 'relabel-in-order', 'add-locator', 'delete-locator', 'relabel-locator', 'add-pickup-bar', 'remove-pickup-bar'])

/** The slot a plain "delete locator" left empty on purpose: the fill leaves it alone. */
function leftOnPurpose(label: StepLabel): FilledLocator[] {
  return label.kind === 'delete-locator' && label.bar !== undefined ? [{ bar: label.bar, passIndex: label.passIndex ?? 0 }] : []
}

/**
 * The fill after an edit, and once when the Editor opens: when an applied edit leaves play slots without a locator, ask the processor for their times
 * (only those slots are aligned, every locator that is there stays) and record the answer as one step ("fill-bars").
 * `afterEdit` is called with the result of each edit the editor applies; a map that is opened with empty slots is filled
 * once, from the doc the editor opened with. `onFill` is called with every fill that was applied (the timing it started from, the new doc, the slots it added);
 * `onFilled` is called when a fill left no slot empty. An answer that comes back after the timing
 * moved on is dropped. A refusal or a null leaves the bars empty, with the Realign banner, and `noRoom` says so until the
 * timing changes, as it does when an answer leaves some of them empty. `filling` is true while the processor works.
 */
export function useFillEmpty(pieceId: string, editor: EditorDocApi, onFilled?: () => void, onFill?: (fill: { from: TimingLayer; doc: EditorDoc; added: readonly FilledLocator[] }) => void) {
  const { processor } = useClients()
  const [filling, setFilling] = useState(false)
  // The timing whose empty bars the processor could not give a time.
  const [stuck, setStuck] = useState<TimingLayer | null>(null)
  const latest = useRef(editor)
  const alive = useRef(true)
  const opened = useRef(false)
  const done = useRef(onFilled)
  const filledWith = useRef(onFill)
  useEffect(() => {
    latest.current = editor
    done.current = onFilled
    filledWith.current = onFill
  })
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  async function run(doc: EditorDoc, skip: FilledLocator[]) {
    const answer = await processor.fillEmptyBars(pieceId, doc.timing)
    if (!alive.current) return
    // The user went on editing while the processor worked: this answer is for a timing that is gone.
    if (latest.current.doc.timing !== doc.timing) return
    const result = answer === null ? null : fillEmptyBars(latest.current.doc, answer, skip)
    if (result === null || !result.ok) {
      setStuck(doc.timing)
      return
    }
    latest.current.apply(result)
    if (unmatchedSlots(result.doc.timing).length > skip.length) setStuck(result.doc.timing)
    filledWith.current?.({ from: doc.timing, doc: result.doc, added: (result.doc.filled ?? []).slice((doc.filled ?? []).length) })
    // What the page says of the structure is for the bars that could not be filled.
    if (unmatchedSlots(result.doc.timing).length === 0) done.current?.()
  }

  function start(doc: EditorDoc, skip: FilledLocator[]) {
    setFilling(true)
    run(doc, skip)
      .catch(() => {})
      .finally(() => alive.current && setFilling(false))
  }

  useEffect(() => {
    if (opened.current) return
    opened.current = true
    const doc = latest.current.doc
    if (unmatchedSlots(doc.timing).length > 0) start(doc, [])
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, for the doc the editor opened with
  }, [])

  return {
    filling,
    noRoom: stuck !== null && stuck === editor.doc.timing,
    afterEdit(result: EditResult) {
      if (!result.ok || !FILLING_STEPS.has(result.label.kind)) return
      const skip = leftOnPurpose(result.label)
      const empty = unmatchedSlots(result.doc.timing).filter((slot) => !skip.some((s) => s.bar === slot.bar && s.passIndex === slot.passIndex))
      if (empty.length === 0) return
      start(result.doc, skip)
    },
  }
}
