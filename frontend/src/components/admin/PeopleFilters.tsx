import { Download, Search } from 'lucide-react'
import { StateSwitch } from '@/components/admin/StateSwitch'
import { NativeSelect } from '@/components/structure/NativeSelect'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { type PeopleQuery, type PlanFilter, type SortKey } from '@/domain/peopleList'
import { type PlanId } from '@/domain/planLimits'
import { cn } from '@/lib/utils'
import { strings } from '@/strings'

const text = strings.admin

const SORTS: readonly SortKey[] = ['signInNewest', 'signInOldest', 'email', 'plan']

/** One row of buttons, exactly one pressed. */
function FilterGroup<T extends string>({ label, value, options, onPick }: { label: string; value: T; options: Array<{ value: T; text: string }>; onPick: (value: T) => void }) {
  return (
    <div role="group" aria-label={label} className="flex flex-col gap-2">
      <span className="text-[13px] leading-[18px] font-semibold tracking-[0.06em] text-text-muted uppercase">{label}</span>
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={option.value === value}
            onClick={() => onPick(option.value)}
            className={cn(
              'flex h-10 items-center rounded-[10px] border px-3.5 text-sm whitespace-nowrap outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
              option.value === value ? 'border-primary-strong bg-surface-2 font-semibold text-foreground' : 'border-border font-medium text-text-soft hover:bg-surface',
            )}
          >
            {option.text}
          </button>
        ))}
      </div>
    </div>
  )
}

/**
 * Search, the filters, Unsaved changes only, Sort, the "Showing X of N" line, the export and Clear filters. They only choose which
 * rows to show: none of them touches the draft.
 */
export function PeopleFilters({
  query,
  onQuery,
  counts,
  plans,
  shown,
  total,
  exportCount,
  hasUnsaved,
  exportedMessage,
  onExport,
  onClear,
}: {
  query: PeopleQuery
  onQuery: (change: Partial<PeopleQuery>) => void
  counts: Record<PlanFilter, number>
  plans: Array<{ id: PlanId; name: string }>
  shown: number
  total: number
  exportCount: number
  hasUnsaved: boolean
  exportedMessage: string | null
  onExport: () => void
  onClear: () => void
}) {
  const noFilters = query.search.trim() === '' && query.plan === 'all' && query.status === 'all' && query.usage === 'all' && !query.unsavedOnly
  return (
    <section aria-label={text.searchLabel} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <label htmlFor="people-search" className="text-sm leading-[18px] font-semibold tracking-[0.04em] text-text-soft uppercase">
          {text.searchLabel}
        </label>
        <div className="relative">
          <Search className="pointer-events-none absolute start-3.5 top-1/2 size-5 -translate-y-1/2 text-text-muted" aria-hidden="true" />
          <Input
            id="people-search"
            type="search"
            value={query.search}
            placeholder={text.searchPlaceholder}
            onChange={(event) => onQuery({ search: event.target.value })}
            className="h-12 rounded-lg bg-surface ps-11 pe-4 text-base md:text-base"
          />
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
        <FilterGroup
          label={text.filterPlan}
          value={query.plan}
          options={[{ value: 'all', text: `${text.all} ${counts.all}` }, ...plans.map((plan) => ({ value: plan.id, text: `${plan.name} ${counts[plan.id]}` }))]}
          onPick={(plan) => onQuery({ plan })}
        />
        <FilterGroup
          label={text.filterStatus}
          value={query.status}
          options={[
            { value: 'all', text: text.all },
            { value: 'signedIn', text: text.signedIn },
            { value: 'notSignedIn', text: text.notSignedIn },
          ]}
          onPick={(status) => onQuery({ status })}
        />
        <FilterGroup
          label={text.filterUsage}
          value={query.usage}
          options={[
            { value: 'all', text: text.all },
            { value: 'atLimit', text: text.atLimit },
            { value: 'nearLimit', text: text.nearLimit },
          ]}
          onPick={(usage) => onQuery({ usage })}
        />
        <div className="flex flex-col gap-2">
          <span id="only-unsaved-label" className="text-[13px] leading-[18px] font-semibold tracking-[0.06em] text-text-muted uppercase">
            {text.unsavedOnly}
          </span>
          <StateSwitch className="flex h-10 items-center gap-2.5" checked={query.unsavedOnly} labelledBy="only-unsaved-label" onChange={(unsavedOnly) => onQuery({ unsavedOnly })} />
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor="people-sort" className="text-[13px] leading-[18px] font-semibold tracking-[0.06em] text-text-muted uppercase">
            {text.sortLabel}
          </label>
          <NativeSelect id="people-sort" value={query.sort} onChange={(event) => onQuery({ sort: event.target.value as SortKey })} className="h-10 w-60 text-sm">
            {SORTS.map((sort) => (
              <option key={sort} value={sort}>
                {text.sorts[sort]}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
          <span role="status" className="text-sm font-medium text-text-soft">
            {text.showing(shown, total)}
          </span>
          <div className="flex flex-wrap gap-2.5">
            <Button type="button" variant="outline" size="touch" onClick={onExport}>
              <Download aria-hidden="true" />
              {text.exportLabel(exportCount)}
            </Button>
            <Button type="button" variant="outline" size="touch" disabled={noFilters} onClick={onClear}>
              {text.clearFilters}
            </Button>
          </div>
        </div>
        {hasUnsaved && <p className="text-end text-[13px] leading-[18px] text-text-soft">{text.exportNote}</p>}
        {exportedMessage !== null && (
          <p role="status" className="text-end text-[13px] leading-[18px] font-semibold">
            {exportedMessage}
          </p>
        )}
      </div>
    </section>
  )
}
