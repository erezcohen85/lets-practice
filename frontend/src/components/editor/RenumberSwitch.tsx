import { useId } from 'react'
import { Switch } from '@/components/ui/switch'
import { type ClickMode } from '@/domain/types'
import { strings } from '@/strings'

/**
 * The "Renumber the bars after" switch, one setting shown where it acts (Decisions 2026-11-03): on the Edit sheet while
 * Edit piece structure is on, beside Structure's Insert / Remove, and on the waveform. 'ripple' is on, 'plain' is off.
 * `dock`: in the waveform's toolbar, which is crowded below 1700 px, it reads by its short label there; the switch is named by the full one.
 */
export function RenumberSwitch({ mode, onChange, compact = false, dock = false }: { mode: ClickMode; onChange(mode: ClickMode): void; compact?: boolean; dock?: boolean }) {
  const tipId = useId()
  return (
    <div className="flex shrink-0 items-center gap-2" title={strings.editor.renumberTip}>
      <span aria-hidden className={compact ? 'text-sm text-text lg:@max-[745px]:hidden' : dock ? 'text-sm text-text max-[1699px]:hidden' : 'text-sm text-text'}>
        {strings.editor.renumber}
      </span>
      {(compact || dock) && (
        <span aria-hidden className={compact ? 'hidden text-sm text-text lg:@max-[745px]:inline' : 'hidden text-sm text-text max-[1699px]:inline'}>
          {strings.editor.renumberShort}
        </span>
      )}
      <Switch
        checked={mode === 'ripple'}
        onCheckedChange={(checked) => onChange(checked ? 'ripple' : 'plain')}
        aria-label={strings.editor.renumber}
        aria-describedby={tipId}
      />
      <span id={tipId} className="sr-only">
        {strings.editor.renumberTip}
      </span>
    </div>
  )
}
