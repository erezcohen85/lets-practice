import { Hint } from '@/components/ui/hint'
import { Minus, Plus } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { MAX_BARS_IN_BOX } from '@/domain/boxEdits'
import { cn } from '@/lib/utils'
import { strings } from '@/strings'

const t = strings.editor.pieceEditing

/**
 * "Bars in box [−] N [+]" for the selected bar: each press, or a typed number and Enter, is one step. Always on the sheet;
 * with no bar selected (`count` null) it shows 1 and every control is off. More than one bar in the box is shown in teal.
 */
export function BarsInBox({ count: selectedCount, onChange }: { count: number | null; onChange(count: number): void }) {
  const disabled = selectedCount === null
  const count = selectedCount ?? 1
  const [typed, setTyped] = useState<string | null>(null)
  const commit = () => {
    const value = Number(typed)
    setTyped(null)
    if (Number.isInteger(value) && value >= 1 && value <= MAX_BARS_IN_BOX && value !== count) onChange(value)
  }
  return (
    <div role="group" aria-label={t.barsInBox} className="flex shrink-0 items-center gap-1.5 border-s border-border ps-2.5 @max-[412px]:ps-1.5 @max-[412px]:gap-1">
      <span className={cn('text-sm @max-[974px]:sr-only', disabled ? 'text-text-muted' : 'text-text')}>{t.barsInBox}</span>
      <Hint text={t.fewer}>
        <Button variant="outline" size="icon-sm" aria-label={t.fewer} disabled={disabled || count <= 1} onClick={() => onChange(count - 1)}>
          <Minus aria-hidden />
        </Button>
      </Hint>
      <Hint text={t.barsInBoxTip}>
        <input
          type="number"
          min={1}
          max={MAX_BARS_IN_BOX}
          aria-label={t.barsInBox}
          disabled={disabled}
          className={cn('h-8 w-12 @max-[412px]:w-9 rounded-md border border-border bg-surface px-2 text-center text-sm font-semibold tabular-nums disabled:opacity-50', count > 1 && 'text-primary-strong')}
          value={typed ?? count}
          onChange={(event) => setTyped(event.target.value)}
          onBlur={() => setTyped(null)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commit()
            if (event.key === 'Escape') setTyped(null)
          }}
        />
      </Hint>
      <Hint text={t.more}>
        <Button variant="outline" size="icon-sm" aria-label={t.more} disabled={disabled || count >= MAX_BARS_IN_BOX} onClick={() => onChange(count + 1)}>
          <Plus aria-hidden />
        </Button>
      </Hint>
    </div>
  )
}
