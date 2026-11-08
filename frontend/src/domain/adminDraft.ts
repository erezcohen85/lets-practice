/**
 * The admin hub's staged draft (Erez, 2026-11-08; plans and usage limits): every change on Plans and People is held here, in
 * memory, and applied by one Save changes (`save_admin_changes`, all or nothing). Pure and immutable: each function returns a new
 * draft. The draft is opaque to callers; they read it through the functions below. Saved data is never changed.
 */
import { normalizeEmail } from './access'
import { PLAN_LIMITS, type LimitDef, type LimitKey, type PlanId, type PlanRow } from './planLimits'

export interface Person {
  email: string
  display_name: string | null
  signed_up: boolean
  last_sign_in_at: string | null
  plan_id: PlanId
  assigned: boolean
  /** The plan on the person's plan_emails row (null when there is none). It differs from plan_id for an email that is not confirmed yet. */
  assigned_plan_id: PlanId | null
  is_admin: boolean
  added_at: string | null
  pieces_created: number
  pieces_stored: number
  shared_pieces: number
}

/** What `admin_overview()` returns. */
export interface AdminData {
  plans: Array<PlanRow & { people: number; new_pieces_today: number }>
  people: Person[]
}

/** What `save_admin_changes()` takes: only what differs from the saved data. */
export interface AdminChanges {
  plans: Array<{ id: PlanId } & Partial<Record<LimitKey, number | boolean | null>>>
  people: Array<{ email: string; plan_id: PlanId } | { email: string; remove: true }>
}

type LimitValue = number | boolean | null
type Staged<T> = Partial<Record<PlanId, Partial<Record<LimitKey, T>>>>
type PersonStage = { kind: 'plan'; plan: PlanId } | { kind: 'remove' }

/** Opaque to callers. `values` holds only staged values that differ from the saved ones; `raws` the field texts that are not valid. */
export interface Draft {
  readonly saved: AdminData
  readonly values: Staged<LimitValue>
  readonly raws: Staged<string>
  readonly stages: Readonly<Record<string, PersonStage>>
  readonly added: ReadonlyArray<{ email: string; plan: PlanId }>
}

export function startDraft(data: AdminData): Draft {
  return { saved: data, values: {}, raws: {}, stages: {}, added: [] }
}

/** The largest number save_admin_changes accepts (a whole number of at most 9 digits); the limit for counts that have no ceiling of their own. */
const COLUMN_MAX = 999999999

const defOf = (key: LimitKey): LimitDef => PLAN_LIMITS.find((limit) => limit.key === key)!
const savedPlan = (d: Draft, plan: PlanId) => d.saved.plans.find((p) => p.id === plan)

function withEntry<T>(map: Staged<T>, plan: PlanId, key: LimitKey, value: T | undefined): Staged<T> {
  const row = { ...map[plan] }
  if (value === undefined) delete row[key]
  else row[key] = value
  const next = { ...map }
  if (Object.keys(row).length === 0) delete next[plan]
  else next[plan] = row
  return next
}

function acceptsValue(def: LimitDef, value: LimitValue): boolean {
  if (def.kind === 'switch') return typeof value === 'boolean'
  return typeof value === 'number' || (value === null && def.nullable)
}

/** Stages a value (a number, No limit as null, or a switch). Back to the saved value is no change. A value of the wrong kind is ignored. */
export function setLimit(d: Draft, plan: PlanId, key: LimitKey, value: LimitValue): Draft {
  const saved = savedPlan(d, plan)
  if (!saved || !acceptsValue(defOf(key), value)) return d
  const same = saved[key] === value
  return { ...d, values: withEntry(d.values, plan, key, same ? undefined : value), raws: withEntry(d.raws, plan, key, undefined) }
}

type Reason = 'whole' | 'min' | 'ceiling'

function checkNumber(def: LimitDef, n: number): Reason | null {
  if (!Number.isInteger(n)) return 'whole'
  if (n < def.min) return 'min'
  if (n > (def.ceiling ?? COLUMN_MAX)) return 'ceiling'
  return null
}

/** What the number field shows. Valid text stages the number; invalid text is kept (and counted) until it is fixed. */
export function setRaw(d: Draft, plan: PlanId, key: LimitKey, text: string): Draft {
  const def = defOf(key)
  if (def.kind !== 'count' || !savedPlan(d, plan)) return d
  const trimmed = text.trim()
  const n = /^-?\d+$/.test(trimmed) ? Number(trimmed) : Number.NaN
  if (checkNumber(def, n) === null) return setLimit(d, plan, key, n)
  return { ...d, values: withEntry(d.values, plan, key, undefined), raws: withEntry(d.raws, plan, key, text) }
}

/** The text of a field that is not valid, or undefined when the field shows a good value. */
export function rawText(d: Draft, plan: PlanId, key: LimitKey): string | undefined {
  return d.raws[plan]?.[key]
}

/** True when the field differs from the saved plan (a staged value, or text that is not valid yet). */
export function limitChanged(d: Draft, plan: PlanId, key: LimitKey): boolean {
  return d.values[plan]?.[key] !== undefined || d.raws[plan]?.[key] !== undefined
}

/** The plans as the draft would leave them (invalid fields show their saved value). */
export function viewPlans(d: Draft): AdminData['plans'] {
  // A staged value always has the kind of its column (setLimit refuses the others), so the spread keeps the row's type.
  return d.saved.plans.map((plan) => ({ ...plan, ...(d.values[plan.id] as Partial<PlanRow>) }))
}

const savedPerson = (d: Draft, email: string) => d.saved.people.find((p) => p.email === email)
/** The plan on the person's row: the assigned one, else the plan that counts (Trial for someone with no row). */
export const planOnRow = (person: Person): PlanId => person.assigned_plan_id ?? person.plan_id
const keyOf = (email: string) => email.trim().toLowerCase()

/** A new person on a plan, staged. The email is trimmed and lower-cased; one already listed or staged is a duplicate. */
export function addPerson(d: Draft, email: string, plan: PlanId): Draft | { error: 'invalid' | 'duplicate' } {
  const normal = normalizeEmail(email)
  if (normal === null) return { error: 'invalid' }
  if (savedPerson(d, normal) || d.added.some((a) => a.email === normal)) return { error: 'duplicate' }
  return { ...d, added: [...d.added, { email: normal, plan }] }
}

function withStage(d: Draft, email: string, stage: PersonStage | undefined): Draft {
  const stages = { ...d.stages }
  if (stage === undefined) delete stages[email]
  else stages[email] = stage
  return { ...d, stages }
}

/** Moves a person to a plan. The admin cannot be moved. Back to the saved plan is no change. */
export function setPersonPlan(d: Draft, email: string, plan: PlanId): Draft {
  const key = keyOf(email)
  if (d.added.some((a) => a.email === key)) return { ...d, added: d.added.map((a) => (a.email === key ? { ...a, plan } : a)) }
  const saved = savedPerson(d, key)
  if (!saved || saved.is_admin) return d
  return withStage(d, key, planOnRow(saved) === plan ? undefined : { kind: 'plan', plan })
}

/** Removes a person's plan assignment. A staged new person is dropped. The admin and people with no assignment cannot be removed. */
export function removePerson(d: Draft, email: string): Draft {
  const key = keyOf(email)
  if (d.added.some((a) => a.email === key)) return { ...d, added: d.added.filter((a) => a.email !== key) }
  const saved = savedPerson(d, key)
  if (!saved || saved.is_admin || !saved.assigned) return d
  return withStage(d, key, { kind: 'remove' })
}

/** Takes back whatever is staged for the person; for a staged new person that means dropping it. */
export function undoPerson(d: Draft, email: string): Draft {
  const key = keyOf(email)
  if (d.added.some((a) => a.email === key)) return { ...d, added: d.added.filter((a) => a.email !== key) }
  return withStage(d, key, undefined)
}

export function rowState(d: Draft, email: string): 'saved' | 'new' | 'planChanged' | 'willBeRemoved' {
  const key = keyOf(email)
  if (d.added.some((a) => a.email === key)) return 'new'
  const stage = d.stages[key]
  if (!stage || !savedPerson(d, key)) return 'saved'
  return stage.kind === 'remove' ? 'willBeRemoved' : 'planChanged'
}

/** One per changed limit (a field with text that is not valid counts too) and one per person change. */
export function changeCount(d: Draft): number {
  let n = d.added.length + Object.keys(d.stages).length
  for (const row of [...Object.values(d.values), ...Object.values(d.raws)]) n += Object.keys(row).length
  return n
}

/** Every field that cannot be saved, in plan and limit order. Call this before `toChanges`. */
export function validate(d: Draft): Array<{ plan: PlanId; key: LimitKey; reason: Reason }> {
  const problems: Array<{ plan: PlanId; key: LimitKey; reason: Reason }> = []
  for (const plan of d.saved.plans) {
    for (const def of PLAN_LIMITS) {
      const raw = d.raws[plan.id]?.[def.key]
      const staged = d.values[plan.id]?.[def.key]
      if (raw !== undefined) {
        const trimmed = raw.trim()
        const n = /^-?\d+$/.test(trimmed) ? Number(trimmed) : Number.NaN
        problems.push({ plan: plan.id, key: def.key, reason: checkNumber(def, n) ?? 'whole' })
      } else if (typeof staged === 'number') {
        const reason = checkNumber(def, staged)
        if (reason) problems.push({ plan: plan.id, key: def.key, reason })
      }
    }
  }
  return problems
}

/** What differs from the saved data, ready for `save_admin_changes`. Fields with invalid text are left out; `validate` is the gate. */
export function toChanges(d: Draft): AdminChanges {
  const plans: AdminChanges['plans'] = []
  for (const plan of d.saved.plans) {
    const staged = d.values[plan.id]
    if (!staged) continue
    const entry: AdminChanges['plans'][number] = { id: plan.id }
    for (const def of PLAN_LIMITS) {
      const value = staged[def.key]
      if (value !== undefined) entry[def.key] = value
    }
    plans.push(entry)
  }
  const people: AdminChanges['people'] = []
  for (const person of d.saved.people) {
    const stage = d.stages[person.email]
    if (stage?.kind === 'plan') people.push({ email: person.email, plan_id: stage.plan })
    else if (stage?.kind === 'remove') people.push({ email: person.email, remove: true })
  }
  for (const added of d.added) people.push({ email: added.email, plan_id: added.plan })
  return { plans, people }
}

/** What Save must ask about first: people removed, and plans whose pause turns on. */
export function confirmNeeded(d: Draft): { removes: number; pauses: PlanId[] } {
  const removes = Object.values(d.stages).filter((stage) => stage.kind === 'remove').length
  const pauses = d.saved.plans.filter((plan) => !plan.new_pieces_paused && d.values[plan.id]?.new_pieces_paused === true).map((plan) => plan.id)
  return { removes, pauses }
}

/** The saved people, then the staged new people; plan_id is the plan on the row (the staged one when there is one). A person to be removed stays in the list. */
export function viewPeople(d: Draft): Person[] {
  const saved = d.saved.people.map((person) => {
    const stage = d.stages[person.email]
    return { ...person, plan_id: stage?.kind === 'plan' ? stage.plan : planOnRow(person) }
  })
  const added = d.added.map<Person>((a) => ({
    email: a.email,
    display_name: null,
    signed_up: false,
    last_sign_in_at: null,
    plan_id: a.plan,
    assigned: true,
    assigned_plan_id: a.plan,
    is_admin: false,
    added_at: null,
    pieces_created: 0,
    pieces_stored: 0,
    shared_pieces: 0,
  }))
  return [...saved, ...added]
}
