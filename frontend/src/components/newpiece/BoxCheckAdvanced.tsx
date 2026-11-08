import { ChevronDown, ChevronUp } from 'lucide-react'
import { useId, useState } from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import { strings } from '@/strings'

const t = strings.boxCheck

/**
 * The collapsed "Advanced" section of New piece and Add part: a tick per part for the box check (a vision model looks at the
 * part's bar boxes and flags the wrong ones in the Review Queue). Off for every part. `key` is the part's row (or its index in a split); `checked` holds the ticked keys.
 */
export function BoxCheckAdvanced({
  entries,
  checked,
  onToggle,
}: {
  entries: Array<{ key: number; name: string }>
  checked: ReadonlySet<number>
  onToggle: (key: number) => void
}) {
  const [open, setOpen] = useState(false)
  const ids = useId()
  const Chevron = open ? ChevronUp : ChevronDown
  if (entries.length === 0) return null

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={`${ids}-box-check`}
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-10 items-center gap-1.5 self-start rounded-md text-sm font-medium text-text-soft outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        {t.advanced}
        <Chevron aria-hidden="true" className="size-4" strokeWidth={2} />
      </button>
      {open && (
        <div id={`${ids}-box-check`} className="flex flex-col gap-3 rounded-lg border border-border bg-surface px-4 py-3">
          <ul aria-label={t.list} className="flex flex-col gap-2">
            {entries.map((entry) => (
              <li key={entry.key}>
                <label className="flex min-h-10 items-center gap-3 text-base">
                  <Checkbox checked={checked.has(entry.key)} onCheckedChange={() => onToggle(entry.key)} />
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{entry.name}</span>
                    <span className="block text-sm text-text-soft">{t.tick}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
