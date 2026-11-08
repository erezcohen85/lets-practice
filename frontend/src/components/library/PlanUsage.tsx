import { type PlanState } from '@/domain/planLimits'
import { piecesMadeOf } from '@/components/library/piecesMade'
import { cn } from '@/lib/utils'
import { strings } from '@/strings'

// Never more than a handful of marks: a plan with a big number is told by the sentence alone.
const MAX_MARKS = 10

/**
 * How much of the plan's pieces is used, under the New piece button: a mark for each piece (filled when made), "N of M trial
 * pieces used." and "Upgrade your plan for more." as plain text for now. The words carry it; the marks only repeat it.
 */
export function PlanUsage({ state }: { state: PlanState | null }) {
  const made = piecesMadeOf(state)
  if (made === null) return null
  const marks = Math.min(made.max, MAX_MARKS)
  return (
    <div className="flex flex-col items-end gap-1 text-end text-sm leading-[1.3] text-text-soft">
      <div className="flex items-center gap-2.5">
        {marks > 0 && made.max <= MAX_MARKS && (
          <span aria-hidden="true" className="flex gap-1">
            {Array.from({ length: marks }, (_, index) => (
              <span key={index} className={cn('block size-3 rounded-[3px] border-2 border-primary-strong', index < made.used ? 'bg-primary-strong' : 'bg-transparent')} />
            ))}
          </span>
        )}
        <span>{strings.plans.usedLine(made.used, made.max, made.plan)}</span>
      </div>
      <span>{strings.plans.upgrade}</span>
    </div>
  )
}
