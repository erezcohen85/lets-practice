import { describe, expect, it } from 'vitest'
import type { Person } from './adminDraft'
import { planCounts, queryPeople, signInText, usageState, type PeopleQuery } from './peopleList'
import type { PlanRow } from './planLimits'

const TRIAL: PlanRow = {
  id: 'trial',
  name: 'Trial',
  position: 0,
  pieces_created_max: 3,
  pieces_stored_max: 3,
  parts_per_piece_max: 1,
  pages_per_part_max: 20,
  recording_minutes_max: 10,
  advanced_reading: false,
  advanced_reading_parts_per_month: 0,
  split_pdf: false,
  suggest_name: true,
  shared_pieces_max: 1,
  members_per_piece: 30,
  members_per_part: 10,
  read_again_per_part_max: 2,
  realign_per_piece_max: 5,
  new_pieces_per_day: 20,
  new_pieces_paused: false,
}
const CREATOR: PlanRow = { ...TRIAL, id: 'creator', name: 'Creator', position: 1, pieces_created_max: null, pieces_stored_max: 50, shared_pieces_max: null }
const UNLIMITED: PlanRow = { ...CREATOR, id: 'unlimited', name: 'Unlimited', position: 2, pieces_stored_max: null }
const PLANS = [TRIAL, CREATOR, UNLIMITED]

const person = (over: Partial<Person> & { email: string }): Person => ({
  display_name: null,
  signed_up: true,
  last_sign_in_at: '2026-11-01T10:00:00Z',
  plan_id: 'trial',
  assigned: false,
  assigned_plan_id: null,
  is_admin: false,
  added_at: null,
  pieces_created: 0,
  pieces_stored: 0,
  shared_pieces: 0,
  ...over,
})

const ALL: PeopleQuery = { search: '', plan: 'all', status: 'all', usage: 'all', unsavedOnly: false, sort: 'signInNewest' }
const emails = (people: Person[]) => people.map((p) => p.email)

describe('usageState', () => {
  it('is fine with nothing used', () => {
    expect(usageState(person({ email: 'a@x.com' }), TRIAL)).toBe('fine')
  })

  it('is at a limit when any count limit is used up: created, stored or shared', () => {
    expect(usageState(person({ email: 'a@x.com', pieces_created: 3 }), TRIAL)).toBe('atLimit')
    expect(usageState(person({ email: 'a@x.com', pieces_stored: 3 }), TRIAL)).toBe('atLimit')
    expect(usageState(person({ email: 'a@x.com', shared_pieces: 1 }), TRIAL)).toBe('atLimit')
  })

  it('is near a limit with exactly one left on a limit of 2 or more', () => {
    expect(usageState(person({ email: 'a@x.com', pieces_created: 2 }), TRIAL)).toBe('nearLimit')
    expect(usageState(person({ email: 'a@x.com', pieces_stored: 49 }), CREATOR)).toBe('nearLimit')
  })

  it('is not near a limit of 1 with none used (one left of one), and 2 left of 3 is fine', () => {
    expect(usageState(person({ email: 'a@x.com', shared_pieces: 0 }), TRIAL)).toBe('fine')
    expect(usageState(person({ email: 'a@x.com', pieces_created: 1 }), TRIAL)).toBe('fine')
  })

  it('at a limit wins over near another', () => {
    expect(usageState(person({ email: 'a@x.com', pieces_created: 2, shared_pieces: 1 }), TRIAL)).toBe('atLimit')
  })

  it('a person over a limit their plan was lowered to is at the limit', () => {
    expect(usageState(person({ email: 'a@x.com', pieces_stored: 9 }), TRIAL)).toBe('atLimit')
  })

  it('a null limit is never reached', () => {
    expect(usageState(person({ email: 'a@x.com', plan_id: 'unlimited', pieces_created: 900, pieces_stored: 900, shared_pieces: 900 }), UNLIMITED)).toBe('fine')
  })

  it('the admin is always fine', () => {
    expect(usageState(person({ email: 'a@x.com', is_admin: true, pieces_created: 9, pieces_stored: 9, shared_pieces: 9 }), TRIAL)).toBe('fine')
  })

  it('a limit of zero with nothing used is used up', () => {
    expect(usageState(person({ email: 'a@x.com' }), { ...TRIAL, shared_pieces_max: 0 })).toBe('atLimit')
  })
})

describe('planCounts', () => {
  it('counts everyone and each plan, with zero for a plan nobody is on', () => {
    const people = [person({ email: 'a@x.com' }), person({ email: 'b@x.com' }), person({ email: 'c@x.com', plan_id: 'creator' })]
    expect(planCounts(people)).toEqual({ all: 3, trial: 2, creator: 1, unlimited: 0 })
    expect(planCounts([])).toEqual({ all: 0, trial: 0, creator: 0, unlimited: 0 })
  })
})

describe('queryPeople: search and filters', () => {
  const people = [
    person({ email: 'maya@example.com', display_name: 'Maya Levi', pieces_created: 2 }),
    person({ email: 'noam@school.org', display_name: 'Noam', plan_id: 'creator', assigned: true, pieces_stored: 49 }),
    person({ email: 'later@example.com', signed_up: false, last_sign_in_at: null, plan_id: 'creator', assigned: true }),
    person({ email: 'full@example.com', display_name: 'Full Trial', pieces_created: 3 }),
    person({ email: 'boss@example.com', display_name: 'Erez', plan_id: 'unlimited', assigned: true, is_admin: true, pieces_created: 80 }),
  ]
  const run = (over: Partial<PeopleQuery>, unsaved: string[] = []) => emails(queryPeople(people, PLANS, { ...ALL, sort: 'email', ...over }, new Set(unsaved)))

  it('with no filters shows everyone', () => {
    expect(run({})).toHaveLength(5)
  })

  it('searches the email, case-insensitive, and trims the text', () => {
    expect(run({ search: ' SCHOOL.org ' })).toEqual(['noam@school.org'])
    expect(run({ search: 'example' })).toEqual(['boss@example.com', 'full@example.com', 'later@example.com', 'maya@example.com'])
  })

  it('searches the name, case-insensitive', () => {
    expect(run({ search: 'levi' })).toEqual(['maya@example.com'])
    expect(run({ search: 'FULL TRIAL' })).toEqual(['full@example.com'])
  })

  it('a search that matches nothing gives an empty list', () => {
    expect(run({ search: 'zzz' })).toEqual([])
  })

  it('filters by plan', () => {
    expect(run({ plan: 'creator' })).toEqual(['later@example.com', 'noam@school.org'])
    expect(run({ plan: 'unlimited' })).toEqual(['boss@example.com'])
  })

  it('filters by status: signed in or not signed in yet', () => {
    expect(run({ status: 'notSignedIn' })).toEqual(['later@example.com'])
    expect(run({ status: 'signedIn' })).toEqual(['boss@example.com', 'full@example.com', 'maya@example.com', 'noam@school.org'])
  })

  it('filters by usage: at a limit, near a limit (the admin is neither)', () => {
    expect(run({ usage: 'atLimit' })).toEqual(['full@example.com'])
    expect(run({ usage: 'nearLimit' })).toEqual(['maya@example.com', 'noam@school.org'])
  })

  it('filters to unsaved changes only', () => {
    expect(run({ unsavedOnly: true }, ['maya@example.com', 'later@example.com'])).toEqual(['later@example.com', 'maya@example.com'])
    expect(run({ unsavedOnly: true }, [])).toEqual([])
    expect(run({ unsavedOnly: false }, ['maya@example.com'])).toHaveLength(5)
  })

  it('combines every filter: all must match', () => {
    expect(run({ plan: 'trial', usage: 'nearLimit', search: 'maya', status: 'signedIn' })).toEqual(['maya@example.com'])
    expect(run({ plan: 'creator', status: 'notSignedIn', search: 'later' })).toEqual(['later@example.com'])
    expect(run({ plan: 'trial', usage: 'atLimit', search: 'maya' })).toEqual([])
    expect(run({ plan: 'creator', unsavedOnly: true }, ['maya@example.com', 'noam@school.org'])).toEqual(['noam@school.org'])
  })

  it('a person whose plan is not in the list is fine, not a crash', () => {
    const odd = [person({ email: 'z@x.com', pieces_created: 99 })]
    expect(queryPeople(odd, [], { ...ALL, usage: 'atLimit' }, new Set())).toEqual([])
    expect(queryPeople(odd, [], ALL, new Set())).toHaveLength(1)
  })

  it('does not change the list it is given', () => {
    const before = emails(people)
    queryPeople(people, PLANS, { ...ALL, sort: 'email' }, new Set())
    expect(emails(people)).toEqual(before)
  })
})

describe('queryPeople: sorting', () => {
  const people = [
    person({ email: 'b@x.com', last_sign_in_at: '2026-11-02T10:00:00Z', plan_id: 'unlimited' }),
    person({ email: 'never2@x.com', signed_up: false, last_sign_in_at: null, plan_id: 'creator' }),
    person({ email: 'a@x.com', last_sign_in_at: '2026-11-05T10:00:00Z', plan_id: 'creator' }),
    person({ email: 'never1@x.com', signed_up: false, last_sign_in_at: null }),
    person({ email: 'c@x.com', last_sign_in_at: '2026-10-12T10:00:00Z' }),
    person({ email: 'Ab@x.com', last_sign_in_at: '2026-11-05T10:00:00Z', plan_id: 'trial' }),
  ]
  const sorted = (sort: PeopleQuery['sort']) => emails(queryPeople(people, PLANS, { ...ALL, sort }, new Set()))

  it('newest sign-in first, equal times by email, not signed in yet last', () => {
    expect(sorted('signInNewest')).toEqual(['a@x.com', 'Ab@x.com', 'b@x.com', 'c@x.com', 'never1@x.com', 'never2@x.com'])
  })

  it('oldest sign-in first, and still not signed in yet last', () => {
    expect(sorted('signInOldest')).toEqual(['c@x.com', 'b@x.com', 'a@x.com', 'Ab@x.com', 'never1@x.com', 'never2@x.com'])
  })

  it('by email, A to Z, ignoring case', () => {
    expect(sorted('email')).toEqual(['a@x.com', 'Ab@x.com', 'b@x.com', 'c@x.com', 'never1@x.com', 'never2@x.com'])
  })

  it('by plan: trial, creator, unlimited, then email', () => {
    expect(sorted('plan')).toEqual(['Ab@x.com', 'c@x.com', 'never1@x.com', 'a@x.com', 'never2@x.com', 'b@x.com'])
  })

  it('sorts after filtering', () => {
    expect(emails(queryPeople(people, PLANS, { ...ALL, plan: 'creator', sort: 'signInOldest' }, new Set()))).toEqual(['a@x.com', 'never2@x.com'])
  })
})

describe('signInText', () => {
  // A local time: the day is the person's calendar day, not UTC's.
  const now = new Date(2026, 10, 8, 15, 30)
  const at = (y: number, m: number, d: number, h = 9) => new Date(y, m - 1, d, h).toISOString()

  it('never signed in', () => {
    expect(signInText(null, now)).toEqual({ kind: 'never' })
  })

  it('today, whatever the hour', () => {
    expect(signInText(at(2026, 11, 8, 0), now)).toEqual({ kind: 'today' })
    expect(signInText(at(2026, 11, 8, 15), now)).toEqual({ kind: 'today' })
  })

  it('a time later than now (clock difference) is still today', () => {
    expect(signInText(at(2026, 11, 8, 23), now)).toEqual({ kind: 'today' })
    expect(signInText(at(2026, 11, 9, 9), now)).toEqual({ kind: 'today' })
  })

  it('yesterday is the calendar day before, even a few hours ago', () => {
    expect(signInText(at(2026, 11, 7, 23), new Date(2026, 10, 8, 0, 5))).toEqual({ kind: 'yesterday' })
    expect(signInText(at(2026, 11, 7, 1), now)).toEqual({ kind: 'yesterday' })
  })

  it('two to six days ago counts the days', () => {
    expect(signInText(at(2026, 11, 6), now)).toEqual({ kind: 'daysAgo', n: 2 })
    expect(signInText(at(2026, 11, 2), now)).toEqual({ kind: 'daysAgo', n: 6 })
  })

  it('a week or more ago gives the date', () => {
    expect(signInText(at(2026, 11, 1), now)).toEqual({ kind: 'date', day: 1, month: 11, year: 2026 })
    expect(signInText(at(2026, 10, 12), now)).toEqual({ kind: 'date', day: 12, month: 10, year: 2026 })
  })

  it('counts calendar days across a month and a year boundary', () => {
    expect(signInText(at(2026, 10, 31), new Date(2026, 10, 2, 10))).toEqual({ kind: 'daysAgo', n: 2 })
    expect(signInText(at(2025, 12, 30), new Date(2026, 0, 2, 10))).toEqual({ kind: 'daysAgo', n: 3 })
    expect(signInText(at(2025, 12, 12), new Date(2026, 0, 2, 10))).toEqual({ kind: 'date', day: 12, month: 12, year: 2025 })
  })
})
