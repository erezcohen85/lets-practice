import { Check, Minus, Plus, X } from 'lucide-react'
import { useState } from 'react'
import { ActionIcon } from '@/components/ui/action-icon'
import { Button } from '@/components/ui/button'
import { type EditResult, type EditorDoc, setShortBars } from '@/domain/pieceEdits'
import { markPickupBar, pickupOff, pickupOn, setPickupBarUnits, unmarkPickupBar } from '@/domain/pickup'
import { meterAt } from '@/domain/renumber'
import { DEFAULT_PICKUP_UNITS, hasPickup, shortUnits } from '@/domain/shortBars'
import { type BarNumber } from '@/domain/types'
import { useBarNames } from '@/lib/barNamesContext'
import { cn } from '@/lib/utils'
import { strings } from '@/strings'
import { BarsBox } from './BarsBox'
import { FieldError } from './FieldError'
import { NumberField } from './NumberField'

const text = strings.structure.pickup

/** The status chip of a pickup box: a dot that is filled when there is a pickup, and the words. */
export function PickupChip({ on, label }: { on: boolean; label: string }) {
  return (
    <p className="inline-flex w-fit items-center gap-2 rounded-full border border-border-strong bg-surface-2 px-3 py-1 text-[13px] text-text-soft">
      <span aria-hidden className={cn('size-2 rounded-full', on ? 'bg-primary-strong' : 'bg-text-muted')} />
      {label}
    </p>
  )
}

/** The Length line of a pickup row: [-] N [+] "beat(s) of 4". */
function LengthSteppers({ units, numerator, onChange }: { units: number; numerator: number; onChange(units: number): void }) {
  return (
    <div className="flex items-center gap-2 text-sm text-text-soft">
      <span>{text.length}</span>
      <Button type="button" variant="outline" size="icon-sm" aria-label={text.shorter} disabled={units <= 1} onClick={() => onChange(units - 1)}>
        <Minus />
      </Button>
      <output aria-label={text.length} className="min-w-6 text-center text-base font-semibold text-text tabular-nums">
        {units}
      </output>
      <Button type="button" variant="outline" size="icon-sm" aria-label={text.longer} disabled={units >= numerator - 1} onClick={() => onChange(units + 1)}>
        <Plus />
      </Button>
      <span>{text.beats(units, numerator)}</span>
    </div>
  )
}

/** A row the player is still filling in: the bar it goes before is typed, then set. */
interface Draft { id: number; bar: string; units: number }

/**
 * Piece > Bars > Pickup bars (Decisions 2026-11-06, Task 15). One row per pickup bar: the one at the top of the piece (it reads
 * p1) and any in the middle, which take no number of their own and read p7. "Before bar n" is the bar that will read n after the
 * pickup: a pickup before bar 7 reads p7, and the bars from there read one lower. Before bar 1 is the top of the piece (the first
 * bar of the score becomes the pickup and the later bars move one number down); the X puts it back. The length is 1 to
 * numerator - 1 beats, a beat being a note of the meter's denominator (eighths in 6/8). Every change is one step, and no part's
 * boxes change, so there is nothing to confirm.
 */
export function PickupForm({ doc, locked = false, onEdit }: { doc: EditorDoc; locked?: boolean; onEdit: (result: EditResult) => void }) {
  const { timing } = doc
  const names = useBarNames()
  const top = hasPickup(timing)
  const inMiddle = (timing.shortBars ?? []).filter((short) => short.unnumbered === true && short.bar > 0).sort((a, b) => a.bar - b.bar)
  const startMeter = meterAt(timing.meters, 1)
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [nextId, setNextId] = useState(1)
  const [error, setError] = useState<string | null>(null)

  const run = (result: EditResult, onRefused: (reason: string) => string): boolean => {
    if (result.ok) {
      setError(null)
      onEdit(result)
    } else setError(onRefused(result.reason))
    return result.ok
  }
  const refusedBar = (reason: string) => text.refusals[reason] ?? text.refusals.invalid
  const wrongLength = (numerator: number, denominator: number) => strings.structure.errors.shortBarNotShorter(`${numerator}/${denominator}`)

  const setTopLength = (units: number) => {
    const others = (timing.shortBars ?? []).filter((short) => short.bar !== 0)
    run(setShortBars(doc, [{ bar: 0, units }, ...others]), () => wrongLength(meterAt(timing.meters, 0).numerator, meterAt(timing.meters, 0).denominator))
  }
  const setBarLength = (bar: BarNumber, units: number) => {
    const meter = meterAt(timing.meters, bar)
    run(setPickupBarUnits(doc, bar, units), () => wrongLength(meter.numerator, meter.denominator))
  }
  const addDraft = () => {
    setDrafts([...drafts, { id: nextId, bar: top || drafts.length > 0 ? '' : '1', units: DEFAULT_PICKUP_UNITS }])
    setNextId(nextId + 1)
  }
  const editDraft = (id: number, change: Partial<Draft>) => setDrafts(drafts.map((draft) => (draft.id === id ? { ...draft, ...change } : draft)))
  const dropDraft = (id: number) => {
    setDrafts(drafts.filter((draft) => draft.id !== id))
    setError(null)
  }
  // Sets a row: "1" is the top of the piece, any other bar is marked short and unnumbered, with the bar read as a label.
  const setDraft = (draft: Draft) => {
    const typed = draft.bar.trim()
    if (typed === '1') {
      if (top) return setError(text.topTaken)
      const done = run(pickupOn(doc, draft.units), () => (timing.barCount < 2 ? text.notPossible : wrongLength(startMeter.numerator, startMeter.denominator)))
      if (done) dropDraft(draft.id)
      return
    }
    const bar = names.parse(typed)
    if (bar === null || bar > timing.barCount) return setError(strings.structure.errors.invalidBarField('1', names.label(timing.barCount)))
    if (run(markPickupBar(doc, bar, draft.units), refusedBar)) dropDraft(draft.id)
  }

  const count = (top ? 1 : 0) + inMiddle.length
  const topUnits = shortUnits(timing, 0) ?? DEFAULT_PICKUP_UNITS
  const topMeter = meterAt(timing.meters, 0)
  const rowClass = 'flex flex-col gap-2 rounded-[10px] border border-border bg-surface px-3 py-2.5'

  return (
    <BarsBox title={text.title} locked={locked}>
      <div className="flex items-center justify-between gap-3">
        <PickupChip on={count > 0} label={count === 0 ? text.none : text.count(count)} />
      </div>
      <p className="text-sm text-text-muted">{text.hint}</p>
      {top && (
        <div data-slot="pickup-row" className={rowClass}>
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-text">
              {text.before} <strong className="font-semibold">1</strong> · {text.row}
            </span>
            <Button type="button" variant="ghost" size="icon-sm" aria-label={text.remove} title={text.remove} onClick={() => run(pickupOff(doc), () => text.notPossible)}>
              <X />
            </Button>
          </div>
          <LengthSteppers units={topUnits} numerator={topMeter.numerator} onChange={setTopLength} />
        </div>
      )}
      {inMiddle.map((short) => {
        const meter = meterAt(timing.meters, short.bar)
        // The pickup reads p7: it goes before the bar that reads 7.
        const after = names.label(short.bar).slice(1)
        return (
          <div key={short.bar} data-slot="pickup-row" className={rowClass}>
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-text">
                {text.before} <strong className="font-semibold">{after}</strong>
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`${text.remove} ${names.label(short.bar)}`}
                title={text.remove}
                onClick={() => run(unmarkPickupBar(doc, short.bar), refusedBar)}
              >
                <X />
              </Button>
            </div>
            <LengthSteppers units={short.units} numerator={meter.numerator} onChange={(units) => setBarLength(short.bar, units)} />
          </div>
        )
      })}
      {drafts.map((draft) => (
        <form
          key={draft.id}
          data-slot="pickup-draft"
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            setDraft(draft)
          }}
          className={rowClass}
        >
          <div className="flex items-center gap-3">
            <span className="text-sm text-text">{text.before}</span>
            <NumberField
              autoFocus
              aria-label={text.beforeField}
              placeholder={text.barPlaceholder}
              value={draft.bar}
              onValueChange={(bar) => {
                editDraft(draft.id, { bar })
                setError(null)
              }}
              onFocus={(event) => event.target.select()}
              className="h-8 w-16"
            />
            <Button type="submit" size="sm" className="h-8 rounded-[9px] px-3 text-[13px] font-semibold">
              <Check data-icon="inline-start" />
              {text.set}
            </Button>
            <Button type="button" variant="ghost" size="icon-sm" className="ms-auto" aria-label={text.removeDraft} title={text.removeDraft} onClick={() => dropDraft(draft.id)}>
              <X />
            </Button>
          </div>
          <LengthSteppers units={draft.units} numerator={startMeter.numerator} onChange={(units) => editDraft(draft.id, { units })} />
        </form>
      ))}
      <Button type="button" variant="outline" size="touch" className="self-start rounded-xl border-border-strong bg-surface-2 text-sm font-medium" onClick={addDraft}>
        <ActionIcon action="add" />
        {text.add}
      </Button>
      {error !== null && <FieldError>{error}</FieldError>}
      <p className="text-[13px] text-text-muted">{text.foot(startMeter.numerator, startMeter.denominator)}</p>
    </BarsBox>
  )
}
