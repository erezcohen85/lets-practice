import { type PlanState } from '@/domain/planLimits'

/** The pieces made out of the pieces the plan allows, or null when there is nothing to count (the admin, a plan without that limit, a plan not read yet). */
export function piecesMadeOf(state: PlanState | null): { used: number; max: number; plan: string } | null {
  if (state === null || state.is_admin || state.plan.pieces_created_max === null) return null
  return { used: state.usage.pieces_created, max: state.plan.pieces_created_max, plan: state.plan.name }
}
