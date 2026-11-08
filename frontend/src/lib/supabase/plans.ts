import { type AdminChanges, type AdminData } from '@/domain/adminDraft'
import { allowed, parseLimitError, type PlanAction, type PlanState } from '@/domain/planLimits'
import { type DataClient, type User } from '@/lib/dataClient'
import { PlanLimitError } from '@/lib/processorClient'
import { fail, type PortError, type SupabasePort } from '@/lib/supabase/port'

/** The plan state, as migration 0015's my_plan() returns it; with a piece id of the user's own it also carries that piece's usage. */
export async function readPlan(port: SupabasePort, pieceId?: string): Promise<PlanState> {
  const { data, error } = await port.rpc<PlanState>('my_plan', pieceId === undefined ? {} : { target_piece: pieceId })
  fail(error)
  if (data === null) throw new Error('plan not found')
  return data
}

/** A row-level-security refusal: no limit is named. (The piece and part triggers of migration 0015 name theirs, `plan_limit:<key>`.) */
export function isRlsRefusal(error: PortError): boolean {
  return error.code === '42501' || /row-level security/i.test(error.message)
}

/**
 * The error for a refused insert. The database triggers say which limit in the error itself (`plan_limit:<key>`), and that is
 * used as it is. A refusal without a key (a policy) makes the plan be read again and the first check that fails says which
 * one (`allowed`, in the order the database checks); when none fails (the plan changed in between) the refusal stays a plain failure.
 */
export async function refusalOf(port: SupabasePort, error: PortError, action: PlanAction, pieceId?: string): Promise<Error> {
  const named = parseLimitError(error.message)
  if (named !== null) return new PlanLimitError(named)
  if (!isRlsRefusal(error)) return new Error(error.message)
  try {
    const verdict = allowed(await readPlan(port, pieceId), action)
    if (!verdict.ok) return new PlanLimitError(verdict.limit)
  } catch {
    // The plan could not be read: the refusal is reported as it came.
  }
  return new Error(error.message)
}

/**
 * The error for a refused part row. The trigger names the limit (`plan_limit:parts_per_piece_max` or `plan_limit:advanced_reading`)
 * and that is used as it is; for a refusal without a key the plan is read again to tell which. (The monthly count of Advanced
 * Reading parts is the processor's.)
 */
export async function partRefusalOf(port: SupabasePort, error: PortError, pieceId: string, ticked: boolean): Promise<Error> {
  const named = parseLimitError(error.message)
  if (named !== null) return new PlanLimitError(named)
  if (!isRlsRefusal(error)) return new Error(error.message)
  try {
    const state = await readPlan(port, pieceId)
    const parts = allowed(state, { type: 'addPart', partsAfter: (state.piece?.parts ?? 0) + 1 })
    if (!parts.ok) return new PlanLimitError(parts.limit)
    if (ticked && !state.is_admin && !state.plan.advanced_reading) return new PlanLimitError('advanced_reading')
  } catch {
    // The plan could not be read: the refusal is reported as it came.
  }
  return new Error(error.message)
}

/** The plan and the admin hub's calls: thin wrappers over my_plan, admin_overview and save_admin_changes (migration 0015). */
export function createPlans(port: SupabasePort, requireUser: () => Promise<User>) {
  return {
    async myPlan(pieceId?: string) {
      await requireUser()
      return readPlan(port, pieceId)
    },
    async adminOverview() {
      await requireUser()
      const { data, error } = await port.rpc<AdminData>('admin_overview')
      fail(error)
      if (data === null) throw new Error('nothing to show')
      return data
    },
    async saveAdminChanges(changes: AdminChanges) {
      await requireUser()
      const { error } = await port.rpc('save_admin_changes', { changes })
      fail(error)
    },
  } satisfies Pick<DataClient, 'myPlan' | 'adminOverview' | 'saveAdminChanges'>
}
