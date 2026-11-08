import { useId } from 'react'
import { type CursorColour, LOOP_COLOURS } from '@/lib/dataClient'
import { cn } from '@/lib/utils'
import { strings } from '@/strings'

// Each swatch paints with its --lp-cursor-* variable (tokens.ts, cursorColours). The Record makes the compiler check
// that every colour the settings can store has a swatch.
const swatchColour: Record<CursorColour, string> = {
  // Violet is the loop's own colour (--lp-loop), not a --lp-cursor-* one.
  violet: 'bg-(--lp-loop)',
  teal: 'bg-(--lp-cursor-teal)',
  amber: 'bg-(--lp-cursor-amber)',
  pink: 'bg-(--lp-cursor-pink)',
  blue: 'bg-(--lp-cursor-blue)',
}

/**
 * A radio group of colour squares. Each radio is a real, visually hidden input named by the colour, so the arrow keys
 * move through the colours. Each choice is a 44 px square target (2 px apart, as on the board) holding a 32 px square
 * that shows a ring when chosen. A dimmed group still works: the choice is kept for when the feature is switched on
 * again. Every row offers the same five colours, in the same order.
 */
export function ColourSwatches({ label, value, onChange, dimmed = false }: { label: string; value: CursorColour; onChange: (colour: CursorColour) => void; dimmed?: boolean }) {
  const name = useId()
  return (
    <div role="radiogroup" aria-label={label} className={cn('inline-flex gap-0.5 transition-opacity', dimmed && 'opacity-50')}>
      {LOOP_COLOURS.map((colour) => (
        <label
          key={colour}
          className="relative flex size-11 cursor-pointer items-center justify-center"
        >
          <input
            type="radio"
            name={name}
            value={colour}
            checked={value === colour}
            onChange={() => onChange(colour)}
            aria-label={strings.settings.colourNames[colour]}
            className="peer sr-only"
          />
          <span
            aria-hidden="true"
            className={cn(
              'block size-8 rounded-(--lp-radius-sm) border-2 border-transparent transition-colors peer-checked:border-foreground peer-focus-visible:ring-3 peer-focus-visible:ring-ring/50',
              swatchColour[colour],
            )}
          />
        </label>
      ))}
    </div>
  )
}
