import { StateSwitch } from '@/components/admin/StateSwitch'
import { Input } from '@/components/ui/input'
import { limitChanged, rawText, setLimit, setRaw, type Draft } from '@/domain/adminDraft'
import { type LimitDef, type PlanId, type PlanRow } from '@/domain/planLimits'
import { cn } from '@/lib/utils'
import { strings } from '@/strings'

const text = strings.admin

/** What "was" reads as in the Changed tag: a number, no limit, on or off. */
function wasText(value: number | boolean | null): string {
  if (value === null) return text.wasNoLimit
  if (typeof value === 'boolean') return value ? text.wasOn : text.wasOff
  return String(value)
}

/**
 * One limit of one plan: its label, hint and tag on the left; on the right a number field with a No limit switch (a count), or an
 * On/Off switch. A count with a ceiling (pages, minutes, members) has no No limit switch: its hint names the ceiling. `view` is the
 * plan as the draft would leave it, `saved` the plan as it is stored.
 */
export function LimitField({
  def,
  planId,
  draft,
  view,
  saved,
  today,
  problem,
  onChange,
}: {
  def: LimitDef
  planId: PlanId
  draft: Draft
  view: PlanRow
  saved: PlanRow
  /** New pieces made today on this plan, for the daily limit's hint. */
  today: number
  /** Why the number cannot be saved, once Save has looked. */
  problem: 'whole' | 'min' | 'ceiling' | undefined
  onChange: (update: (draft: Draft) => Draft) => void
}) {
  const copy = text.limits[def.key]
  const label = copy.label
  const value = view[def.key]
  const was = saved[def.key]
  const changed = limitChanged(draft, planId, def.key)
  const raw = rawText(draft, planId, def.key)
  const hint = def.key === 'new_pieces_per_day' ? text.newPiecesToday(today, saved.new_pieces_per_day) : ('hint' in copy ? copy.hint : undefined)
  const errorId = `limit-${planId}-${def.key}-error`

  let controls
  if (def.kind === 'switch') {
    controls = <StateSwitch checked={value === true} onChange={(on) => onChange((d) => setLimit(d, planId, def.key, on))} label={label} />
  } else {
    const hasSwitch = def.nullable && def.ceiling === null
    const noLimit = raw === undefined && value === null
    const shown = raw ?? (value === null ? '' : String(value))
    controls = (
      <>
        <Input
          type="text"
          inputMode="numeric"
          aria-label={label}
          aria-invalid={problem !== undefined}
          aria-describedby={problem === undefined ? undefined : errorId}
          value={shown}
          placeholder={noLimit ? text.noLimitPlaceholder : undefined}
          disabled={noLimit}
          onChange={(event) => onChange((d) => setRaw(d, planId, def.key, event.target.value))}
          className={cn('h-11 w-22 rounded-[10px] bg-surface px-3 text-end text-base tabular-nums md:text-base', noLimit && 'border-dashed bg-transparent')}
        />
        {hasSwitch && (
          <div className="flex items-center gap-2.5">
            <span className="text-sm font-medium whitespace-nowrap text-text-soft">{text.noLimit}</span>
            <StateSwitch
              checked={noLimit}
              label={text.noLimitFor(label)}
              onChange={(on) =>
                onChange((d) => setLimit(d, planId, def.key, on ? null : was !== null ? was : Math.max(def.min, 1)))
              }
            />
          </div>
        )}
      </>
    )
  }

  const fixText = problem === undefined ? '' : text.fix(def.ceiling === null ? text.fixMin(def.min) : text.fixRange(def.min, def.ceiling))
  return (
    <li className={cn('flex flex-col gap-3 rounded-lg border bg-background px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4', changed ? 'border-primary-strong' : 'border-border')}>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-base leading-[22px] font-medium">{label}</span>
          {changed && <span className="rounded-full border border-primary-strong px-2 text-xs leading-5 font-semibold">{text.changedWas(wasText(was))}</span>}
        </div>
        {hint !== undefined && <div className="mt-0.5 text-[13px] leading-[18px] text-text-muted">{hint}</div>}
        {problem !== undefined && (
          <div id={errorId} className="mt-1 text-[13px] leading-[18px] font-semibold text-problem">
            {fixText}
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-4">{controls}</div>
    </li>
  )
}
