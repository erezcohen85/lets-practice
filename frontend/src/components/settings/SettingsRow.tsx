import { useId, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

export interface RowIds { labelId: string; hintId: string | undefined }

/**
 * A card with a label (and a hint under it) at the start and a control at the end (or under them, when stacked). The control is built by a function
 * that gets the ids of the label and the hint, so it can be named and described by what the player reads.
 */
export function SettingsRow({
  label,
  hint,
  stacked = false,
  children,
}: {
  label: string
  hint?: string
  /** The control goes under the label instead of beside it, for a control too wide to share the line. 'narrow' does so on a phone only. */
  stacked?: boolean | 'narrow'
  children: (ids: RowIds) => ReactNode
}) {
  const id = useId()
  const ids: RowIds = { labelId: `${id}-label`, hintId: hint === undefined ? undefined : `${id}-hint` }
  return (
    <div
      className={cn(
        'flex gap-4 rounded-lg border border-border bg-surface px-5 py-4',
        stacked === 'narrow' ? 'flex-col items-start sm:flex-row sm:items-center sm:justify-between' : stacked ? 'flex-col items-start' : 'items-center justify-between',
      )}
    >
      <div className="min-w-0">
        <div id={ids.labelId} className="text-[17px] leading-[1.3] font-medium">
          {label}
        </div>
        {hint !== undefined && (
          <div id={ids.hintId} className="mt-0.5 text-sm leading-[1.3] text-text-muted">
            {hint}
          </div>
        )}
      </div>
      {children(ids)}
    </div>
  )
}
