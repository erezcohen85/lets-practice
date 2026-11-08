import { Plus, X } from 'lucide-react'
import { useId, useState } from 'react'
import { ActionIcon } from '@/components/ui/action-icon'
import { Button } from '@/components/ui/button'
import { type EditResult, type EditorDoc, setMeters, validateMeters, type StructureError } from '@/domain/pieceEdits'
import { type BarNames } from '@/domain/barNames'
import { type MeterChange } from '@/domain/types'
import { useBarNames } from '@/lib/barNamesContext'
import { strings } from '@/strings'
import { FieldError } from './FieldError'
import { NativeSelect } from './NativeSelect'
import { NumberField } from './NumberField'
import { structureErrorText, toBar, toNumber } from './fields'

const text = strings.structure
const DENOMINATORS = [1, 2, 4, 8, 16, 32]

interface DraftMeter { fromBar: string; numerator: string; denominator: string }

const draftOf = (meters: MeterChange[], names: BarNames): DraftMeter[] =>
  meters.map((change) => ({
    fromBar: names.label(change.fromBar),
    numerator: String(change.numerator),
    denominator: String(change.denominator),
  }))

/** The meter changes, one row each; Apply checks them all and records one step. The caller keys it by the doc's meters. */
export function MetersForm({ doc, onEdit }: { doc: EditorDoc; onEdit: (result: EditResult) => void }) {
  const id = useId()
  const barCount = doc.timing.barCount
  const names = useBarNames()
  // The "from bar" field holds a label; it becomes the internal bar when the player applies.
  const [initial] = useState(() => draftOf(doc.timing.meters, names))
  const [rows, setRows] = useState(initial)
  const [errors, setErrors] = useState<StructureError[]>([])

  const change = (next: DraftMeter[]) => {
    setRows(next)
    setErrors([])
  }
  const edit = (index: number, patch: Partial<DraftMeter>) =>
    change(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)))

  const submit = () => {
    const meters = rows.map((row) => ({
      fromBar: toBar(row.fromBar, names),
      numerator: toNumber(row.numerator),
      denominator: toNumber(row.denominator),
    }))
    const found = validateMeters(meters, barCount)
    if (found.length > 0) return setErrors(found)
    const result = setMeters(doc, meters)
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
      <ul className="flex flex-col gap-3">
        {rows.map((row, index) => {
          const rowErrors = errors.filter((error) => error.field === 'meters' && error.index === index)
          const errorId = `${id}-${index}-error`
          const described = rowErrors.length > 0 ? errorId : undefined
          return (
            <li key={index} className="flex flex-col gap-1.5">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-sm text-text-muted">{text.meters.fromBar}</span>
                <NumberField
                  aria-label={text.meters.rowFrom(index + 1)}
                  value={row.fromBar}
                  onValueChange={(fromBar) => edit(index, { fromBar })}
                  aria-invalid={rowErrors.length > 0}
                  aria-describedby={described}
                />
                <span className="text-sm text-text-muted">{text.meters.meter}</span>
                <NumberField
                  aria-label={text.meters.rowBeats(index + 1)}
                  value={row.numerator}
                  onValueChange={(numerator) => edit(index, { numerator })}
                  aria-invalid={rowErrors.length > 0}
                  aria-describedby={described}
                />
                <span aria-hidden className="text-text-muted">
                  /
                </span>
                <NativeSelect
                  aria-label={text.meters.rowUnit(index + 1)}
                  value={row.denominator}
                  onChange={(event) => edit(index, { denominator: event.target.value })}
                  aria-invalid={rowErrors.length > 0}
                  aria-describedby={described}
                >
                  {DENOMINATORS.map((unit) => (
                    <option key={unit} value={String(unit)}>
                      {unit}
                    </option>
                  ))}
                </NativeSelect>
                <Button
                  type="button"
                  variant="ghost"
                  className="ms-auto size-11 text-text-soft"
                  aria-label={text.meters.remove(index + 1)}
                  disabled={rows.length === 1}
                  onClick={() => change(rows.filter((_, i) => i !== index))}
                >
                  <X />
                </Button>
              </div>
              {rowErrors.map((error, n) => (
                <FieldError key={n} id={n === 0 ? errorId : undefined}>
                  {structureErrorText(error, names.label(barCount))}
                </FieldError>
              ))}
            </li>
          )
        })}
      </ul>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button
          type="button"
          variant="outline"
          size="touch"
          onClick={() => change([...rows, { fromBar: '', numerator: '4', denominator: '4' }])}
        >
          <Plus data-icon="inline-start" />
          {text.meters.add}
        </Button>
        <Button type="submit" size="touch" disabled={JSON.stringify(rows) === JSON.stringify(initial)}>
          <ActionIcon action="confirm" />
          {text.apply}
        </Button>
      </div>
    </form>
  )
}
