import { PlanCard } from '@/components/admin/PlanCard'
import { viewPlans, type Draft } from '@/domain/adminDraft'
import { type LimitKey, type PlanId } from '@/domain/planLimits'
import { strings } from '@/strings'

/** One card per plan, one open at a time, Trial first (the order of the saved plans). */
export function PlansTab({
  draft,
  openPlan,
  problems,
  onOpen,
  onChange,
}: {
  draft: Draft
  openPlan: PlanId | null
  problems: Array<{ plan: PlanId; key: LimitKey; reason: 'whole' | 'min' | 'ceiling' }>
  onOpen: (plan: PlanId | null) => void
  onChange: (update: (draft: Draft) => Draft) => void
}) {
  const views = viewPlans(draft)
  return (
    <>
      <p className="text-[15px] leading-[22px] text-text-soft">{strings.admin.plansIntro}</p>
      {draft.saved.plans.map((saved) => (
        <PlanCard
          key={saved.id}
          saved={saved}
          view={views.find((plan) => plan.id === saved.id)!}
          draft={draft}
          open={openPlan === saved.id}
          problems={new Map(problems.filter((problem) => problem.plan === saved.id).map((problem) => [problem.key, problem.reason]))}
          onToggle={() => onOpen(openPlan === saved.id ? null : saved.id)}
          onChange={onChange}
        />
      ))}
    </>
  )
}
