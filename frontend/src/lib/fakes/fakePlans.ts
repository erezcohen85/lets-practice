import { normalizeEmail } from '@/domain/access'
import { type AdminChanges, type AdminData, type Person } from '@/domain/adminDraft'
import { PLAN_LIMITS, type PlanId, type PlanRow } from '@/domain/planLimits'
import { newCreatedAt, planStateOf, type FakeStore } from '@/lib/fakes/store'
import { type User } from '@/lib/dataClient'

// The fakes' admin_overview and save_admin_changes (migration 0015): the same shapes, the same refusals, all or nothing.

const PLAN_IDS: readonly PlanId[] = ['trial', 'creator', 'unlimited']

function startOfTodayUtc(): string {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString()
}

/** The three plans with their people and today's new pieces, and everyone who is on a plan or has signed up. */
export function adminOverview(store: FakeStore): AdminData {
  const users = [...store.users.values()]
  const people: Person[] = users.map((user): Person => {
    const state = planStateOf(store, user)
    const assignment = store.planEmails.get(user.email.toLowerCase())
    return {
      email: user.email.toLowerCase(),
      display_name: user.name,
      signed_up: true,
      last_sign_in_at: store.lastSignIn.get(user.id) ?? null,
      plan_id: state.plan.id,
      assigned: assignment !== undefined,
      assigned_plan_id: assignment?.planId ?? null,
      is_admin: state.is_admin,
      added_at: assignment?.addedAt ?? null,
      pieces_created: state.usage.pieces_created,
      pieces_stored: state.usage.pieces_stored,
      shared_pieces: state.usage.shared_pieces,
    }
  })
  for (const [email, assignment] of store.planEmails) {
    if (users.some((user) => user.email.toLowerCase() === email)) continue
    people.push({
      email,
      display_name: null,
      signed_up: false,
      last_sign_in_at: null,
      plan_id: assignment.planId,
      assigned: true,
      assigned_plan_id: assignment.planId,
      is_admin: false,
      added_at: assignment.addedAt,
      pieces_created: store.ledger.get(email) ?? 0,
      pieces_stored: 0,
      shared_pieces: 0,
    })
  }
  const today = startOfTodayUtc()
  const plans = PLAN_IDS.map((id) => {
    const row = store.plans.get(id)!
    return {
      ...row,
      people: people.filter((person) => person.plan_id === id).length,
      new_pieces_today: store.usageEvents.filter((event) => event.kind === 'piece_created' && event.planId === id && event.voidedAt === null && event.at >= today).length,
    }
  })
  return structuredClone({ plans, people })
}

const fail = (message: string): never => {
  throw new Error(message)
}

const DEFS = new Map(PLAN_LIMITS.map((limit) => [limit.key as string, limit]))

/** A staged value that the column accepts, as the column's type and check would; throws the first problem. */
function checkedValue(key: string, value: unknown): number | boolean | null {
  const def = DEFS.get(key)
  if (def === undefined) return fail(`unknown key: ${key}`)
  if (def.kind === 'switch') return typeof value === 'boolean' ? value : fail(`${key} must be true or false`)
  if (value === null) return def.nullable ? null : fail(`${key} cannot be empty`)
  if (typeof value !== 'number' || !Number.isInteger(value)) return fail(`${key} must be a whole number`)
  if (value < def.min || (def.ceiling !== null && value > def.ceiling)) return fail(`${key} is out of bounds`)
  return value
}

/** Applies the whole draft or none of it: everything is checked against a copy first. */
export function saveAdminChanges(store: FakeStore, admin: User, changes: AdminChanges): void {
  const plans = new Map(store.plans)
  const assignments = new Map(store.planEmails)
  const body = changes as unknown as Record<string, unknown>
  if (typeof body !== 'object' || body === null || Array.isArray(body)) fail('changes must be an object')
  for (const key of Object.keys(body)) if (key !== 'plans' && key !== 'people') fail(`unknown key: ${key}`)
  if (body.plans !== undefined && !Array.isArray(body.plans)) fail('plans must be a list')
  if (body.people !== undefined && !Array.isArray(body.people)) fail('people must be a list')

  for (const entry of changes.plans ?? []) {
    const id = (entry as { id?: unknown }).id
    if (typeof id !== 'string') fail('each plan change needs an id')
    const row = plans.get(id as PlanId)
    if (row === undefined) return fail(`unknown plan: ${String(id)}`)
    const next: Record<string, unknown> = { ...row }
    for (const [key, value] of Object.entries(entry)) {
      if (key === 'id') continue
      next[key] = checkedValue(key, value)
    }
    plans.set(row.id, next as unknown as PlanRow)
  }

  const savedAt = newCreatedAt(store)
  for (const entry of changes.people ?? []) {
    const raw = entry as { email?: unknown; plan_id?: unknown; remove?: unknown }
    if (typeof raw.email !== 'string') fail('each person change needs an email')
    for (const key of Object.keys(entry)) if (key !== 'email' && key !== 'plan_id' && key !== 'remove') fail(`unknown key: ${key}`)
    const clean = normalizeEmail(raw.email as string)
    if (clean === null) return fail(`not an email: ${String(raw.email).trim().toLowerCase()}`)
    if ([...store.admins].some((id) => store.users.get(id)?.email.toLowerCase() === clean)) fail('the admin cannot be changed')
    if ((raw.plan_id === undefined) === (raw.remove === undefined)) fail('give a plan_id or remove, not both and not neither')
    if (raw.plan_id !== undefined) {
      if (!PLAN_IDS.includes(raw.plan_id as PlanId)) fail(`unknown plan: ${String(raw.plan_id)}`)
      const before = assignments.get(clean)
      assignments.set(clean, { planId: raw.plan_id as PlanId, addedAt: before?.addedAt ?? savedAt, addedBy: admin.id })
    } else {
      if (raw.remove !== true) fail('remove must be true')
      assignments.delete(clean)
    }
  }

  store.plans = plans
  store.planEmails = assignments
}
