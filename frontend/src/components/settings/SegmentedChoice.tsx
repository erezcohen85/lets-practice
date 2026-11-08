import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

export interface Choice<T extends string> { value: T; label: string }

// A pressed choice is filled with the main colour. The ::after adds 4 px above and below, so the touch target is 48 px
// high while the choice looks 40 px high, as on the board.
const itemClass =
  'relative h-10 rounded-(--lp-radius-sm) px-[18px] text-[15px] text-text-soft after:absolute after:inset-x-0 after:-inset-y-1 aria-pressed:bg-primary aria-pressed:font-semibold aria-pressed:text-on-primary hover:aria-pressed:bg-primary hover:aria-pressed:text-on-primary'

/**
 * Two or three choices in a row, exactly one of them pressed (Base UI toggle group). Pressing the pressed one does
 * nothing: there is no "none".
 */
export function SegmentedChoice<T extends string>({
  value,
  choices,
  onChange,
  labelledBy,
  describedBy,
}: {
  value: T
  choices: readonly Choice<T>[]
  onChange: (value: T) => void
  labelledBy: string
  /** The element that explains the choice (a row's hint), read after the name. */
  describedBy?: string
}) {
  return (
    <ToggleGroup
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      value={[value]}
      onValueChange={([chosen]) => {
        // The group hands back plain strings: take the typed value of the choice that was meant.
        const picked = choices.find((choice) => choice.value === chosen)
        if (picked !== undefined && picked.value !== value) onChange(picked.value)
      }}
      spacing={1}
      className="rounded-lg border border-border bg-background p-1"
    >
      {choices.map((choice) => (
        <ToggleGroupItem key={choice.value} value={choice.value} className={itemClass}>
          {choice.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}
