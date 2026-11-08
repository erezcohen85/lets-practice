import { LayoutGrid, List } from 'lucide-react'
import { type LibraryView } from '@/lib/dataClient'
import { cn } from '@/lib/utils'
import { strings } from '@/strings'

const segmentClass =
  'inline-flex h-10 w-11 items-center justify-center rounded-[10px] outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 aria-pressed:bg-surface-2 aria-pressed:text-foreground text-text-muted hover:text-foreground'

/** The Cards / List switch at the end of the section heading: two 44 by 40 px buttons in a bordered holder, the pressed one raised. */
export function ViewToggle({ value, onChange }: { value: LibraryView; onChange(view: LibraryView): void }) {
  const choices = [
    { view: 'cards', label: strings.library.viewCards, Icon: LayoutGrid },
    { view: 'list', label: strings.library.viewList, Icon: List },
  ] as const
  return (
    <div role="group" aria-label={strings.library.viewLabel} className="inline-flex shrink-0 gap-0.5 rounded-xl border border-border bg-surface p-0.5">
      {choices.map(({ view, label, Icon }) => (
        <button
          key={view}
          type="button"
          aria-label={label}
          title={label}
          aria-pressed={value === view}
          className={cn(segmentClass)}
          onClick={() => onChange(view)}
        >
          <Icon className="size-[18px]" strokeWidth={2} aria-hidden="true" />
        </button>
      ))}
    </div>
  )
}
