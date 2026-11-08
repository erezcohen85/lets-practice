import { useId, useState } from 'react'
import { ActionIcon } from '@/components/ui/action-icon'
import { Button } from '@/components/ui/button'
import { useBarNames } from '@/lib/barNamesContext'
import { cn } from '@/lib/utils'
import { strings } from '@/strings'
import { DroppedNote } from './DroppedNote'
import { FieldError } from './FieldError'
import { NumberField } from './NumberField'
import { toBar } from './fields'

const text = strings.structure.bars

export type Side = 'before' | 'after'

/** Before | After: a two-option choice, After first chosen. */
function SideToggle({ value, onChange, label }: { value: Side; onChange(side: Side): void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-[9px] border border-border-strong bg-surface p-0.5">
      {(['before', 'after'] as const).map((side) => (
        <button
          key={side}
          type="button"
          role="radio"
          aria-checked={value === side}
          onClick={() => onChange(side)}
          className={cn(
            'h-[26px] rounded-[7px] px-3 text-[13px] font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
            value === side ? 'bg-primary text-primary-foreground' : 'text-text-soft hover:text-text',
          )}
        >
          {text[side]}
        </button>
      ))}
    </div>
  )
}

/** What an Insert or a Remove answers: an error to show, or nothing (it was applied). */
export type RowAnswer = string | null

export interface BarEditRowsProps {
  /** The internal bars a field may name: first..last. The fields take labels ("7", "p7"). */
  range: { first: number; last: number }
  /** Applies the insert (or passes the edit on) and answers with a refusal text, or null. */
  onInsert(bar: number, side: Side): RowAnswer
  onRemove(bar: number): RowAnswer
  /** How many recording times the edit would clear, shown before Apply (0 when it clears none). */
  droppedByInsert?(bar: number, side: Side): number
  droppedByRemove?(bar: number): number
  /** The prefill of the Insert row, e.g. from the status line after a part edit. */
  prefill?: { action: 'insert' | 'remove'; bar: number }
}

/** "Insert a bar [Before | After] [Bar] Apply" and "Remove bar [Bar] Remove": the rows of a Bars box, piece or part. */
export function BarEditRows({ range, onInsert, onRemove, droppedByInsert, droppedByRemove, prefill }: BarEditRowsProps) {
  const id = useId()
  const names = useBarNames()
  const [side, setSide] = useState<Side>('after')
  // What the fields hold is a label; `insertValue` and `removeValue` are the internal bars they name.
  const [insertBar, setInsertBar] = useState(prefill?.action === 'insert' ? names.label(prefill.bar) : '')
  const [removeBar, setRemoveBar] = useState(prefill?.action === 'remove' ? names.label(prefill.bar) : '')
  const [insertError, setInsertError] = useState<string | null>(null)
  const [removeError, setRemoveError] = useState<string | null>(null)
  const insertValue = toBar(insertBar, names)
  const removeValue = toBar(removeBar, names)
  const valid = (n: number) => Number.isInteger(n) && n >= range.first && n <= range.last
  const wrongBar = strings.structure.errors.invalidBarField(names.label(range.first), names.label(range.last))

  return (
    <div className="flex flex-col gap-3">
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          setInsertError(valid(insertValue) ? onInsert(insertValue, side) : wrongBar)
        }}
        className="flex flex-col gap-1.5"
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="w-22 text-sm text-text-soft">{text.insertLabel}</span>
          <SideToggle value={side} onChange={setSide} label={text.side} />
          <NumberField
            id={`${id}-insert`}
            aria-label={text.insertField}
            placeholder={text.barPlaceholder}
            value={insertBar}
            onValueChange={(value) => {
              setInsertBar(value)
              setInsertError(null)
            }}
            aria-invalid={insertError !== null}
            className="h-8 w-16"
          />
          <Button type="submit" size="sm" className="h-8 rounded-[9px] px-3 text-[13px] font-semibold">
            <ActionIcon action="confirm" />
            {text.insertApply}
          </Button>
        </div>
        {insertError !== null && <FieldError>{insertError}</FieldError>}
        <DroppedNote count={valid(insertValue) ? (droppedByInsert?.(insertValue, side) ?? 0) : 0} />
      </form>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          setRemoveError(valid(removeValue) ? onRemove(removeValue) : wrongBar)
        }}
        className="flex flex-col gap-1.5"
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="w-22 text-sm text-text-soft">{text.removeLabel}</span>
          <NumberField
            id={`${id}-remove`}
            aria-label={text.removeField}
            placeholder={text.barPlaceholder}
            value={removeBar}
            onValueChange={(value) => {
              setRemoveBar(value)
              setRemoveError(null)
            }}
            aria-invalid={removeError !== null}
            className="h-8 w-16"
          />
          <Button type="submit" size="sm" variant="danger" className="h-8 rounded-[9px] px-3 text-[13px] font-semibold">
            <ActionIcon action="remove" />
            {text.removeApply}
          </Button>
        </div>
        {removeError !== null && <FieldError>{removeError}</FieldError>}
        <DroppedNote count={valid(removeValue) ? (droppedByRemove?.(removeValue) ?? 0) : 0} />
      </form>
    </div>
  )
}
