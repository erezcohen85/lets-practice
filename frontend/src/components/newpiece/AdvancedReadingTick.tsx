import { Checkbox } from '@/components/ui/checkbox'
import { cn } from '@/lib/utils'
import { strings } from '@/strings'

const t = strings.boxCheck

/**
 * The "Advanced Reading" tick in the row of a part (New piece and Add part): the part is read again line by line by vision
 * models, a judge accepts or rejects each box they would move, the accepted moves are applied at read time, and the box
 * check looks at the final boxes. The Review Queue lists every move (with Put back) and every box the check found wrong.
 * The explanation is the native title, Erez's wording. On a phone the row wraps it under the name; the label is a 44 px target.
 */
export function AdvancedReadingTick({ checked, onToggle, className }: { checked: boolean; onToggle: () => void; className?: string }) {
  return (
    <label title={t.advancedReadingHint} className={cn('flex min-h-11 shrink-0 cursor-pointer items-center gap-2 text-sm leading-5 font-medium text-text-soft', className)}>
      <Checkbox checked={checked} onCheckedChange={onToggle} className="size-[18px]" />
      {t.advancedReading}
    </label>
  )
}
