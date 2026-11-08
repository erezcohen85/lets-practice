import { usePlan } from '@/lib/plan'
import { strings } from '@/strings'

/**
 * The plan's name in the top bar, right before the Settings gear (Erez, 2026-11-08): small letter-spaced capitals in a thin
 * outline. Not a button. A screen reader hears "Your plan: Trial" instead of the capitals. The admin's reads ADMIN. Nothing
 * shows until the plan has been read.
 */
export function PlanLabel() {
  const { state } = usePlan()
  if (state === null) return null
  const name = state.is_admin ? strings.plans.yourPlan.adminName : state.plan.name
  const badge = state.is_admin ? strings.plans.badge.admin : strings.plans.badge[state.plan.id]
  return (
    <span
      data-slot="plan-label"
      className="inline-flex h-7 shrink-0 items-center rounded-lg border border-border-strong px-2.5 text-xs leading-4 font-semibold tracking-[0.14em] whitespace-nowrap text-text-soft"
    >
      <span aria-hidden="true">{badge}</span>
      <span className="sr-only">{strings.plans.badgeScreenReader(name)}</span>
    </span>
  )
}
