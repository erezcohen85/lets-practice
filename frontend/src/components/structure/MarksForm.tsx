import { Plus, X } from 'lucide-react'
import { useId, useState } from 'react'
import { ActionIcon } from '@/components/ui/action-icon'
import { Button } from '@/components/ui/button'
import { expandMarkRows, groupMarks, listedMarks } from '@/domain/markRanges'
import { type EditResult, type EditorDoc, lastRestBar, setMarks, validateMarks } from '@/domain/pieceEdits'
import { firstBar as firstBarOf } from '@/domain/shortBars'
import { type ListedMarkKind } from '@/domain/types'
import { useBarNames } from '@/lib/barNamesContext'
import { strings } from '@/strings'
import { FieldError } from './FieldError'
import { NativeSelect } from './NativeSelect'
import { NumberField } from './NumberField'
import { structureErrorText, toBar } from './fields'

const text = strings.structure
const ALL_KINDS: ListedMarkKind[] = ['fermata', 'rest', 'rit']

// A row is a range of bars, written as labels ("46", "p7"); an empty "to" means the same bar as "from". One bar shows as 46 to 46.
interface DraftMark { from: string; to: string; kind: ListedMarkKind }
interface RowError { row: number; message: string }

/**
 * The marks (fermata, rit., and the rests of the part open in the editor) as ranges, one row each; Apply checks them all and
 * records one step with one mark per bar. Fermata and rit. are the recording's, so every part has them; a rest is the part's own.
 * The caller keys it by the part and its marks.
 */
export function MarksForm({
  doc,
  partId,
  partName,
  onEdit,
  kinds = ALL_KINDS,
}: {
  doc: EditorDoc
  partId: string
  partName: string
  onEdit: (result: EditResult) => void
  /** The kinds this form edits (Piece > Marks: fermata and rit.; This part > Rests: rest); the others are kept as they are. */
  kinds?: ListedMarkKind[]
}) {
  const id = useId()
  const names = useBarNames()
  const barCount = doc.timing.barCount
  const firstBar = firstBarOf(doc.timing)
  const [initial] = useState<DraftMark[]>(() =>
    groupMarks(listedMarks(doc.timing, doc.pages.find((page) => page.partId === partId)))
      .filter((range) => kinds.includes(range.kind))
      .map((range) => ({ from: names.label(range.from), to: names.label(range.to), kind: range.kind })),
  )
  const [rows, setRows] = useState(initial)
  const [errors, setErrors] = useState<RowError[]>([])

  const change = (next: DraftMark[]) => {
    setRows(next)
    setErrors([])
  }
  const edit = (index: number, patch: Partial<DraftMark>) =>
    change(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)))

  const restLast = lastRestBar(doc.timing, doc.pages.find((page) => page.partId === partId))

  const submit = () => {
    const { marks, rowOf, reversed } = expandMarkRows(
      rows.map((row) => {
        const from = toBar(row.from, names)
        return { kind: row.kind, from, to: row.to.trim() === '' ? from : toBar(row.to, names) }
      }),
    )
    const found: RowError[] = [
      ...reversed.map((row) => ({ row, message: text.errors.markRangeBackwards })),
      ...validateMarks(marks, barCount, firstBar, restLast).map((error) => ({
        row: rowOf[error.index],
        message: structureErrorText(error, names.label(marks[error.index].kind === 'rest' ? restLast : barCount), names.label(firstBar)),
      })),
    ].filter((error, index, all) => all.findIndex((other) => other.row === error.row && other.message === error.message) === index)
    if (found.length > 0) return setErrors(found)
    const kept = listedMarks(doc.timing, doc.pages.find((page) => page.partId === partId)).filter((mark) => !kinds.includes(mark.kind))
    const result = setMarks(doc, [...marks, ...kept], partId)
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
      <p className="text-sm text-text-muted">
        {!kinds.includes('rest') ? text.marks.pieceHint : kinds.length === 1 ? text.marks.restsHint(partName) : text.marks.partHint(partName)}
      </p>
      {rows.length === 0 && <p className="text-sm text-text-muted">{text.marks.none}</p>}
      <ul className="flex flex-col gap-3">
        {rows.map((row, index) => {
          const rowErrors = errors.filter((error) => error.row === index)
          const errorId = `${id}-${index}-error`
          const described = rowErrors.length > 0 ? errorId : undefined
          return (
            <li key={index} className="flex flex-col gap-1.5">
              <div className="flex flex-wrap items-center gap-3">
                <NativeSelect
                  aria-label={text.marks.rowKind(index + 1)}
                  value={row.kind}
                  onChange={(event) => edit(index, { kind: event.target.value as ListedMarkKind })}
                  aria-describedby={described}
                >
                  {kinds.map((kind) => (
                    <option key={kind} value={kind}>
                      {text.marks.kinds[kind]}
                    </option>
                  ))}
                </NativeSelect>
                <span className="text-sm text-text-muted">{text.marks.from}</span>
                <NumberField
                  aria-label={text.marks.rowFrom(index + 1)}
                  value={row.from}
                  onValueChange={(from) => edit(index, { from })}
                  aria-invalid={rowErrors.length > 0}
                  aria-describedby={described}
                />
                <span className="text-sm text-text-muted">{text.marks.to}</span>
                <NumberField
                  aria-label={text.marks.rowTo(index + 1)}
                  value={row.to}
                  placeholder={row.from}
                  onValueChange={(to) => edit(index, { to })}
                  aria-invalid={rowErrors.length > 0}
                  aria-describedby={described}
                />
                <Button
                  type="button"
                  variant="ghost"
                  className="ms-auto size-11 text-text-soft"
                  aria-label={text.marks.remove(index + 1)}
                  onClick={() => change(rows.filter((_, i) => i !== index))}
                >
                  <X />
                </Button>
              </div>
              {rowErrors.map((error, n) => (
                <FieldError key={n} id={n === 0 ? errorId : undefined}>
                  {error.message}
                </FieldError>
              ))}
            </li>
          )
        })}
      </ul>
      {rows.some((row) => row.kind === 'rit') && <p className="text-sm text-text-muted">{text.marks.ritHint}</p>}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button type="button" variant="outline" size="touch" onClick={() => change([...rows, { from: '', to: '', kind: kinds[0] }])}>
          <Plus data-icon="inline-start" />
          {text.marks.add}
        </Button>
        <Button type="submit" size="touch" disabled={JSON.stringify(rows) === JSON.stringify(initial)}>
          <ActionIcon action="confirm" />
          {text.apply}
        </Button>
      </div>
    </form>
  )
}
