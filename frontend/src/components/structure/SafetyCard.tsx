import { useId } from 'react'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { strings } from '@/strings'

const text = strings.structure.safety

/**
 * The card on every Piece tab: Edit piece structure, the same state as the toolbar's switch. Off, the tab is locked and
 * the card says so in amber; on, the border and the line turn red (and the words say it too). Turning on asks first.
 */
export function SafetyCard({ on, onRequestOn, onRequestOff }: { on: boolean; onRequestOn?(): void; onRequestOff?(): void }) {
  const id = useId()
  return (
    <div
      data-slot="safety-card"
      data-on={on}
      className={cn('flex items-center justify-between gap-4 rounded-xl border bg-background px-5 py-4', on ? 'border-danger-bright' : 'border-border')}
    >
      <div className="flex min-w-0 flex-col gap-1">
        <span id={`${id}-title`} className="text-[17px] font-semibold text-text">
          {text.title}
        </span>
        <p id={`${id}-note`} className={cn('text-sm', on ? 'text-problem' : 'text-warning-text')}>
          {on ? text.on : text.locked}
        </p>
      </div>
      <Switch
        tone="danger"
        checked={on}
        onCheckedChange={(checked) => (checked ? onRequestOn?.() : onRequestOff?.())}
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-note`}
        className="data-[size=default]:h-[30px] data-[size=default]:w-[52px] [&_[data-slot=switch-thumb]]:size-6! [&_[data-slot=switch-thumb]]:data-checked:translate-x-[calc(100%-2px)]"
      />
    </div>
  )
}
