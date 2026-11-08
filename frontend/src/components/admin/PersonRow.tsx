import { NativeSelect } from '@/components/structure/NativeSelect'
import { Button } from '@/components/ui/button'
import { type Person } from '@/domain/adminDraft'
import { usageState, type SignInText } from '@/domain/peopleList'
import { type PlanId, type PlanRow } from '@/domain/planLimits'
import { cn } from '@/lib/utils'
import { strings } from '@/strings'

const text = strings.admin

function signInWords(sign: SignInText, thisYear: number): string | null {
  switch (sign.kind) {
    case 'never':
      return null
    case 'today':
      return text.signedInToday
    case 'yesterday':
      return text.signedInYesterday
    case 'daysAgo':
      return text.signedInDaysAgo(sign.n)
    case 'date':
      return text.signedInOn(sign.day, sign.month, sign.year, thisYear)
  }
}

function usageLine(person: Person, plan: PlanRow): string {
  if (!person.signed_up && person.pieces_created === 0 && person.pieces_stored === 0 && person.shared_pieces === 0) return text.usageNone
  const pieces =
    plan.pieces_created_max !== null
      ? text.usageMade(person.pieces_created, plan.pieces_created_max, plan.name)
      : plan.pieces_stored_max !== null
        ? text.usageStoredOf(person.pieces_stored, plan.pieces_stored_max)
        : text.usageStored(person.pieces_stored)
  return `${pieces}, ${text.usageShared(person.shared_pieces, plan.shared_pieces_max)}`
}

const tagClass = 'rounded-full border px-2 text-xs leading-5 font-semibold'

/**
 * A person: email, what is staged for them in words (New, Plan changed, Will be removed) with Undo, name, last sign-in, usage with an
 * at-limit or near-limit tag, a plan menu and Remove. The admin shows Admin instead of a menu and has no Remove; a person on Trial by
 * default (no assignment) has nothing to remove.
 */
export function PersonRow({
  person,
  state,
  savedPlanName,
  plans,
  plan,
  signIn,
  thisYear,
  onPlan,
  onRemove,
  onUndo,
}: {
  person: Person
  state: 'saved' | 'new' | 'planChanged' | 'willBeRemoved'
  /** The name of the plan the person has saved, for "Plan changed: Creator to Trial". */
  savedPlanName: string
  plans: PlanRow[]
  plan: PlanRow
  signIn: SignInText
  thisYear: number
  onPlan: (plan: PlanId) => void
  onRemove: () => void
  onUndo: () => void
}) {
  const removed = state === 'willBeRemoved'
  const staged = state !== 'saved'
  const usage = removed ? 'fine' : usageState(person, plan)
  const last = signInWords(signIn, thisYear)
  const tag = removed ? text.tagRemoved : state === 'new' ? text.tagNew : state === 'planChanged' ? text.tagPlanChanged(savedPlanName, plan.name) : null
  return (
    <li
      className={cn(
        'flex flex-wrap items-center gap-x-4 gap-y-3 rounded-lg border px-5 py-4',
        removed ? 'border-dashed border-problem-border' : staged ? 'border-primary-strong bg-surface' : 'border-border bg-surface',
      )}
    >
      <div className="min-w-0 flex-1 basis-60">
        <div className="flex flex-wrap items-center gap-2">
          <span dir="ltr" className={cn('text-base leading-[22px] font-semibold [overflow-wrap:anywhere]', removed && 'text-text-soft line-through')}>
            {person.email}
          </span>
          {tag !== null && <span className={cn(tagClass, removed ? 'border-problem' : 'border-primary-strong')}>{tag}</span>}
          {(removed || state === 'planChanged') && (
            <Button type="button" variant="link" size="touch" aria-label={text.undoLabel(person.email)} onClick={onUndo} className="h-8 px-1 underline">
              {text.undo}
            </Button>
          )}
        </div>
        <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-1 text-sm leading-5 text-text-soft">
          <span>{person.signed_up ? (person.display_name ?? text.noName) : text.notSignedIn}</span>
          {last !== null && <span className="text-text-muted">{last}</span>}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-2">
          <span className="text-[13px] leading-[18px] text-text-muted">{usageLine(person, plan)}</span>
          {usage !== 'fine' && (
            <span className="rounded-full border border-warning-border px-2 text-xs leading-[18px] font-semibold text-warning-text">
              {usage === 'atLimit' ? text.atLimit : text.nearLimit}
            </span>
          )}
        </div>
      </div>
      {person.is_admin ? (
        <span className="flex h-11 w-35 shrink-0 items-center px-3 text-[15px] font-semibold">{text.adminPlan}</span>
      ) : (
        <NativeSelect
          aria-label={text.planFor(person.email)}
          value={person.plan_id}
          disabled={removed}
          onChange={(event) => onPlan(event.target.value as PlanId)}
          className="w-35 shrink-0 text-[15px]"
        >
          {plans.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </NativeSelect>
      )}
      {person.assigned && !person.is_admin && !removed ? (
        <Button type="button" variant="outline" size="touch" aria-label={text.removeLabel(person.email)} onClick={onRemove} className="w-24 shrink-0 text-problem">
          {text.remove}
        </Button>
      ) : (
        <span aria-hidden="true" className="hidden w-24 shrink-0 sm:block" />
      )}
    </li>
  )
}
