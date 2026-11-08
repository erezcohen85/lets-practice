import { useState } from 'react'
import { PlayOrderRows, type PlayOrderDraftRow } from '@/components/playorder/PlayOrderRows'
import { ActionIcon } from '@/components/ui/action-icon'
import { Button } from '@/components/ui/button'
import { type EditResult, type EditorDoc, setPlayOrder, validatePlayOrder, type StructureError } from '@/domain/pieceEdits'
import { type BarNames } from '@/domain/barNames'
import { firstBar as firstBarOf } from '@/domain/shortBars'
import { type PlayOrderRow } from '@/domain/types'
import { useBarNames } from '@/lib/barNamesContext'
import { strings } from '@/strings'
import { DroppedNote } from './DroppedNote'
import { toBar } from './fields'

const draftOf = (rows: PlayOrderRow[], names: BarNames): PlayOrderDraftRow[] =>
  rows.map((row) => ({ from: names.label(row.from), to: names.label(row.to) }))

/** The play order as rows. The caller keys it by the doc's play order. Before Apply it says how many recording times would go. */
export function PlayOrderForm({ doc, onEdit }: { doc: EditorDoc; onEdit: (result: EditResult) => void }) {
  const barCount = doc.timing.barCount
  const firstBar = firstBarOf(doc.timing)
  const names = useBarNames()
  // The fields hold labels ("17", "p7"); `numbers` are the internal bars they name.
  const [initial] = useState(() => draftOf(doc.timing.playOrder, names))
  const [rows, setRows] = useState(initial)
  const [errors, setErrors] = useState<StructureError[]>([])

  const numbers = rows.map((row) => ({ from: toBar(row.from, names), to: toBar(row.to, names) }))
  const preview = validatePlayOrder(numbers, barCount, firstBar).length === 0 ? setPlayOrder(doc, numbers) : null
  const dropped = preview?.ok ? preview.droppedLocators.length : 0

  const submit = () => {
    const found = validatePlayOrder(numbers, barCount, firstBar)
    if (found.length > 0) return setErrors(found)
    const result = setPlayOrder(doc, numbers)
    if (result.ok) onEdit(result)
  }

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
      className="flex flex-col gap-3"
    >
      <PlayOrderRows
        rows={rows}
        barCount={barCount}
        firstBar={firstBar}
        errors={errors}
        onChange={(next) => {
          setRows(next)
          setErrors([])
        }}
      />
      <DroppedNote count={dropped} />
      <div className="flex justify-end">
        <Button type="submit" size="touch" disabled={JSON.stringify(rows) === JSON.stringify(initial)}>
          <ActionIcon action="confirm" />
          {strings.structure.apply}
        </Button>
      </div>
    </form>
  )
}
