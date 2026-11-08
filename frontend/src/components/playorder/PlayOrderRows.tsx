import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react'
import { useId } from 'react'
import { FieldError } from '@/components/structure/FieldError'
import { NumberField } from '@/components/structure/NumberField'
import { structureErrorText, toBar } from '@/components/structure/fields'
import { Button } from '@/components/ui/button'
import { type StructureError } from '@/domain/pieceEdits'
import { playedBarCount, repeatedRanges } from '@/domain/playOrderSummary'
import { type BarNames } from '@/domain/barNames'
import { type PlayOrderRow } from '@/domain/types'
import { useBarNames } from '@/lib/barNamesContext'
import { strings } from '@/strings'

/** A row as typed: the fields hold text until the player applies. */
export interface PlayOrderDraftRow { from: string; to: string }

const text = strings.structure.playOrder
const iconButtonClass = 'size-11 text-text-soft'

/** The rows as internal bars, or null while any of them is blank or not a bar of the piece in order. */
function readRows(rows: PlayOrderDraftRow[], barCount: number, firstBar: number, names: BarNames): PlayOrderRow[] | null {
  const read = rows.map((row) => ({ from: toBar(row.from, names), to: toBar(row.to, names) }))
  const valid = read.every(
    ({ from, to }) => Number.isInteger(from) && Number.isInteger(to) && from >= firstBar && to <= barCount && from <= to,
  )
  return valid && read.length > 0 ? read : null
}

/** "72 bars played; bars 9-16 twice": the bars the rows play, and the runs of bars that are played more than once (by label). */
function summaryOf(rows: PlayOrderRow[], names: BarNames): string {
  const repeats = repeatedRanges(rows).map(({ from, to, times }) => text.repeated(names.label(from), names.label(to), times))
  return [text.played(playedBarCount(rows)), ...(repeats.length === 0 ? [] : [repeats.join(', ')])].join('; ')
}

/**
 * The play order as one row per range of bars, to add, remove and move, with the count of bars played under the list.
 * The rows are a draft owned by the caller; `errors` are the structure errors of the last Apply, by row.
 */
export function PlayOrderRows({
  rows,
  barCount,
  firstBar = 1,
  errors,
  onChange,
}: {
  rows: PlayOrderDraftRow[]
  barCount: number
  /** 0 when the piece has a pickup, else 1. */
  firstBar?: number
  errors: StructureError[]
  onChange: (rows: PlayOrderDraftRow[]) => void
}) {
  const id = useId()
  const names = useBarNames()
  const read = readRows(rows, barCount, firstBar, names)

  const edit = (index: number, change: Partial<PlayOrderDraftRow>) =>
    onChange(rows.map((row, i) => (i === index ? { ...row, ...change } : row)))
  const move = (index: number, by: -1 | 1) => {
    const next = [...rows]
    ;[next[index], next[index + by]] = [next[index + by], next[index]]
    onChange(next)
  }

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-3">
        {rows.map((row, index) => {
          const rowErrors = errors.filter((error) => error.field === 'playOrder' && error.index === index)
          const errorId = `${id}-${index}-error`
          return (
            <li key={index} className="flex flex-col gap-1.5">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-sm text-text-muted">{text.play}</span>
                <NumberField
                  aria-label={text.rowFrom(index + 1)}
                  value={row.from}
                  onValueChange={(from) => edit(index, { from })}
                  aria-invalid={rowErrors.length > 0}
                  aria-describedby={rowErrors.length > 0 ? errorId : undefined}
                />
                <span className="text-sm text-text-muted">{text.to}</span>
                <NumberField
                  aria-label={text.rowTo(index + 1)}
                  value={row.to}
                  onValueChange={(to) => edit(index, { to })}
                  aria-invalid={rowErrors.length > 0}
                  aria-describedby={rowErrors.length > 0 ? errorId : undefined}
                />
                <div className="ms-auto flex gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    className={iconButtonClass}
                    aria-label={text.moveUp(index + 1)}
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                  >
                    <ArrowUp />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className={iconButtonClass}
                    aria-label={text.moveDown(index + 1)}
                    disabled={index === rows.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    <ArrowDown />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className={iconButtonClass}
                    aria-label={text.remove(index + 1)}
                    disabled={rows.length === 1}
                    onClick={() => onChange(rows.filter((_, i) => i !== index))}
                  >
                    <X />
                  </Button>
                </div>
              </div>
              {rowErrors.map((error, n) => (
                <FieldError key={n} id={n === 0 ? errorId : undefined}>
                  {structureErrorText(error, names.label(barCount), names.label(firstBar))}
                </FieldError>
              ))}
            </li>
          )
        })}
      </ul>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button type="button" variant="outline" size="touch" onClick={() => onChange([...rows, { from: '', to: '' }])}>
          <Plus data-icon="inline-start" />
          {text.add}
        </Button>
        {read !== null && <p className="text-sm text-text-soft">{summaryOf(read, names)}</p>}
      </div>
    </div>
  )
}
