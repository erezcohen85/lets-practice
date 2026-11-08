/**
 * The People list of the admin hub (Erez, 2026-11-08; plans and usage limits): search, filters, sort and counts, all in the
 * browser from `admin_overview()`. Pure; filters never change the draft. Like the other domain modules it holds no copy:
 * `signInText` returns a tagged value that strings.ts words.
 */
import type { Person } from './adminDraft'
import type { PlanId, PlanRow } from './planLimits'

export type PlanFilter = 'all' | PlanId
export type StatusFilter = 'all' | 'signedIn' | 'notSignedIn'
export type UsageFilter = 'all' | 'atLimit' | 'nearLimit'
export type SortKey = 'signInNewest' | 'signInOldest' | 'email' | 'plan'

export interface PeopleQuery {
  search: string
  plan: PlanFilter
  status: StatusFilter
  usage: UsageFilter
  unsavedOnly: boolean
  sort: SortKey
}

const PLAN_ORDER: readonly PlanId[] = ['trial', 'creator', 'unlimited']

/**
 * At a limit: any count limit (pieces created, pieces stored, shared pieces) used up. Near a limit: exactly one left on a count
 * limit of 2 or more (the prototype's rule). The admin is never at or near a limit, and a null limit is never reached.
 */
export function usageState(p: Person, plan: PlanRow): 'atLimit' | 'nearLimit' | 'fine' {
  if (p.is_admin) return 'fine'
  const counts: Array<[used: number, max: number | null]> = [
    [p.pieces_created, plan.pieces_created_max],
    [p.pieces_stored, plan.pieces_stored_max],
    [p.shared_pieces, plan.shared_pieces_max],
  ]
  if (counts.some(([used, max]) => max !== null && used >= max)) return 'atLimit'
  if (counts.some(([used, max]) => max !== null && max >= 2 && used === max - 1)) return 'nearLimit'
  return 'fine'
}

const byText = (a: string, b: string) => {
  const x = a.toLowerCase()
  const y = b.toLowerCase()
  return x < y ? -1 : x > y ? 1 : a < b ? -1 : a > b ? 1 : 0
}

/** Under both sign-in sorts, people who have not signed in yet go last. */
function bySignIn(newestFirst: boolean) {
  return (a: Person, b: Person): number => {
    if (a.last_sign_in_at === null || b.last_sign_in_at === null) {
      if (a.last_sign_in_at === b.last_sign_in_at) return byText(a.email, b.email)
      return a.last_sign_in_at === null ? 1 : -1
    }
    const time = Date.parse(a.last_sign_in_at) - Date.parse(b.last_sign_in_at)
    return time !== 0 ? (newestFirst ? -time : time) : byText(a.email, b.email)
  }
}

const planRank = (id: PlanId) => PLAN_ORDER.indexOf(id)

const COMPARE: Record<SortKey, (a: Person, b: Person) => number> = {
  signInNewest: bySignIn(true),
  signInOldest: bySignIn(false),
  email: (a, b) => byText(a.email, b.email),
  plan: (a, b) => planRank(a.plan_id) - planRank(b.plan_id) || byText(a.email, b.email),
}

/** The people the search and filters show, in the chosen sort. `unsaved` holds the emails with a staged change. */
export function queryPeople(people: Person[], plans: PlanRow[], q: PeopleQuery, unsaved: Set<string>): Person[] {
  const needle = q.search.trim().toLowerCase()
  const planOf = (id: PlanId) => plans.find((plan) => plan.id === id)
  return people
    .filter((p) => {
      if (needle && !p.email.toLowerCase().includes(needle) && !(p.display_name ?? '').toLowerCase().includes(needle)) return false
      if (q.plan !== 'all' && p.plan_id !== q.plan) return false
      if (q.status === 'signedIn' && !p.signed_up) return false
      if (q.status === 'notSignedIn' && p.signed_up) return false
      if (q.unsavedOnly && !unsaved.has(p.email)) return false
      if (q.usage !== 'all') {
        const plan = planOf(p.plan_id)
        if (!plan || usageState(p, plan) !== q.usage) return false
      }
      return true
    })
    .sort(COMPARE[q.sort])
}

/** How many people are on each plan, and in all. */
export function planCounts(people: Person[]): Record<PlanFilter, number> {
  const counts: Record<PlanFilter, number> = { all: people.length, trial: 0, creator: 0, unlimited: 0 }
  for (const p of people) counts[p.plan_id] += 1
  return counts
}

/** The last sign-in in words, as data: strings.ts words it ("Signed in today", "yesterday", "N days ago", "12 Oct", "Not signed in yet"). */
export type SignInText =
  | { kind: 'never' }
  | { kind: 'today' }
  | { kind: 'yesterday' }
  | { kind: 'daysAgo'; n: number }
  | { kind: 'date'; day: number; month: number; year: number }

/** From a week ago on, the date; before that, the days. */
const DAYS_AS_WORDS = 6

const dayNumber = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000

/** Calendar days in the viewer's own time zone, not 24-hour spans. A time later than `now` counts as today. */
export function signInText(at: string | null, now: Date): SignInText {
  if (at === null) return { kind: 'never' }
  const when = new Date(at)
  const days = dayNumber(now) - dayNumber(when)
  if (days <= 0) return { kind: 'today' }
  if (days === 1) return { kind: 'yesterday' }
  if (days <= DAYS_AS_WORDS) return { kind: 'daysAgo', n: days }
  return { kind: 'date', day: when.getDate(), month: when.getMonth() + 1, year: when.getFullYear() }
}
