import { Repeat } from 'lucide-react'
import { useId, useState } from 'react'
import { parseRange, rangeLabel, type LoopRange } from '@/domain/practice'
import { type SlotTiming } from '@/domain/tempo'
import { useBarNames } from '@/lib/barNamesContext'
import { cn } from '@/lib/utils'
import { strings } from '@/strings'
import { loopClass } from './loopColour'

/**
 * "Loop 13–24": the range as the toolbar's editable field. It shows the label of the range ("13 (2)–24" for a second
 * pass, "p7–9" from a pickup); Enter or leaving the field sets what was typed, an empty field clears the loop, and a text that is not a range
 * of this piece says why under the field and leaves the loop alone. Escape puts the label back.
 */
export function RangeField({
  timeline,
  range,
  looping,
  onChange,
  onToggleLooping,
}: {
  timeline: SlotTiming[]
  range: LoopRange | null
  /** The range repeats; off after a move outside it, with the range kept. */
  looping: boolean
  onChange(range: LoopRange | null): void
  onToggleLooping(on: boolean): void
}) {
  const errorId = useId()
  const names = useBarNames()
  const label = range === null ? '' : rangeLabel(timeline, range, names)
  const [draft, setDraft] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const finish = () => {
    setDraft(null)
    setError(null)
  }
  // Returns false when the text is not a range, with the reason shown.
  const commit = (text: string): boolean => {
    if (text.trim() === label) {
      finish()
      return true
    }
    if (text.trim() === '') {
      onChange(null)
      finish()
      return true
    }
    const parsed = parseRange(timeline, text, names)
    if ('error' in parsed) {
      setError(strings.practice.rangeErrors[parsed.error])
      return false
    }
    onChange(parsed.range)
    finish()
    return true
  }

  return (
    <div className="flex flex-col">
      <div
        className={cn(
          'inline-flex min-h-11 items-center gap-2 rounded-lg border pe-1.5 text-[15px] font-semibold',
          looping ? cn(loopClass.handleBorder, loopClass.tint, loopClass.soft) : 'border-border bg-surface-2 text-text-soft',
        )}
      >
        <button
          type="button"
          aria-pressed={looping}
          disabled={range === null}
          onClick={() => onToggleLooping(!looping)}
          className="inline-flex min-h-11 items-center gap-2 rounded-lg ps-3 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60"
        >
          <Repeat className="size-[18px]" aria-hidden="true" />
          {strings.practice.loop}
        </button>
        <input
          type="text"
          inputMode="text"
          autoComplete="off"
          aria-label={strings.practice.loopRange}
          aria-invalid={error !== null}
          aria-describedby={error === null ? undefined : errorId}
          value={draft ?? label}
          placeholder={strings.practice.rangePlaceholder}
          size={9}
          onFocus={(event) => {
            setDraft(label)
            event.currentTarget.select()
          }}
          onChange={(event) => {
            setDraft(event.target.value)
            setError(null)
          }}
          onBlur={(event) => {
            if (draft !== null) commit(event.currentTarget.value)
            finish()
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              if (commit(event.currentTarget.value)) event.currentTarget.blur()
            } else if (event.key === 'Escape') {
              finish()
              event.currentTarget.blur()
            }
          }}
          className="h-9 w-24 rounded-md bg-background placeholder:text-text-muted px-3 text-center text-base font-bold text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:ring-2 aria-invalid:ring-foreground"
        />
      </div>
      {error !== null && (
        <p id={errorId} role="alert" className="mt-1 text-sm font-medium text-foreground">
          {error}
        </p>
      )}
    </div>
  )
}
