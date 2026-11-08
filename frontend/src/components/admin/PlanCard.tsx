import { ChevronDown } from 'lucide-react'
import { LimitField } from '@/components/admin/LimitField'
import { limitChanged, type AdminData, type Draft } from '@/domain/adminDraft'
import { LIMIT_GROUPS, PLAN_LIMITS, type LimitKey, type PlanRow } from '@/domain/planLimits'
import { cn } from '@/lib/utils'
import { strings } from '@/strings'

const text = strings.admin

type SavedPlan = AdminData['plans'][number]

/** The line under a plan's name: a few of its limits, from the saved plan. */
function summaryOf(plan: PlanRow): string {
  const line = text.summary
  return [
    line.created(plan.pieces_created_max),
    line.parts(plan.parts_per_piece_max),
    line.advancedReading(plan.advanced_reading),
    line.shared(plan.shared_pieces_max),
    plan.new_pieces_paused ? line.paused : null,
  ]
    .filter((part) => part !== null)
    .join(', ')
}

/**
 * One plan: a header that opens and closes the card (name, people, tag with the plan's unsaved changes, a summary line), and under it
 * every limit, grouped as the limits list is. The header is a button inside the heading.
 */
export function PlanCard({
  saved,
  view,
  draft,
  open,
  problems,
  onToggle,
  onChange,
}: {
  saved: SavedPlan
  view: PlanRow
  draft: Draft
  open: boolean
  /** The limits of this plan that cannot be saved, once Save has looked. */
  problems: Map<LimitKey, 'whole' | 'min' | 'ceiling'>
  onToggle: () => void
  onChange: (update: (draft: Draft) => Draft) => void
}) {
  const changes = PLAN_LIMITS.filter((def) => limitChanged(draft, saved.id, def.key)).length
  const bodyId = `plan-${saved.id}-body`
  return (
    <section className="flex flex-col rounded-card border border-border bg-surface">
      <h2>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={onToggle}
          className="flex w-full items-center justify-between gap-4 rounded-card px-5 py-[18px] text-start outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="text-xl leading-[26px] font-semibold">{saved.name}</span>
              <span className="text-sm font-normal text-text-soft">{text.people(saved.people)}</span>
              {changes > 0 && <span className="rounded-full border border-primary-strong px-2.5 text-[13px] leading-[22px] font-semibold">{text.cardChanges(changes)}</span>}
            </span>
            <span className="text-sm leading-5 font-normal text-text-muted">{summaryOf(saved)}</span>
          </span>
          <span className="flex shrink-0 items-center gap-2 text-sm font-medium text-text-soft">
            {open ? text.cardClose : text.cardEdit}
            <ChevronDown className={cn('size-5 transition-transform motion-reduce:transition-none', open && 'rotate-180')} aria-hidden="true" />
          </span>
        </button>
      </h2>
      {open && (
        <div id={bodyId} className="flex flex-col gap-5 px-5 pt-1 pb-5">
          {LIMIT_GROUPS.map((group) => (
            <div key={group} className="flex flex-col gap-2">
              <h3 className="pt-1 text-[13px] leading-[18px] font-semibold tracking-[0.06em] text-text-muted uppercase">{text.groups[group]}</h3>
              <ul className="flex flex-col gap-2">
                {PLAN_LIMITS.filter((def) => def.group === group).map((def) => (
                  <LimitField
                    key={def.key}
                    def={def}
                    planId={saved.id}
                    draft={draft}
                    view={view}
                    saved={saved}
                    today={saved.new_pieces_today}
                    problem={problems.get(def.key)}
                    onChange={onChange}
                  />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
