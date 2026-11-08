import { describe, expect, it } from 'vitest'
import {
  addPerson,
  changeCount,
  confirmNeeded,
  removePerson,
  rowState,
  limitChanged,
  rawText,
  setLimit,
  setPersonPlan,
  setRaw,
  startDraft,
  toChanges,
  undoPerson,
  validate,
  viewPeople,
  viewPlans,
  type AdminData,
  type Draft,
  type Person,
} from './adminDraft'
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
const CREATOR: PlanRow = { ...TRIAL, id: 'creator', name: 'Creator', position: 1, pieces_created_max: null, pieces_stored_max: 50, parts_per_piece_max: null, pages_per_part_max: 100, recording_minutes_max: 20, advanced_reading: true, advanced_reading_parts_per_month: 30, split_pdf: true, shared_pieces_max: null, read_again_per_part_max: 10, realign_per_piece_max: null, new_pieces_per_day: null }
const UNLIMITED: PlanRow = { ...CREATOR, id: 'unlimited', name: 'Unlimited', position: 2, pieces_stored_max: null, advanced_reading_parts_per_month: null, read_again_per_part_max: null }

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

const DATA: AdminData = {
  plans: [
    { ...TRIAL, people: 3, new_pieces_today: 7 },
    { ...CREATOR, people: 1, new_pieces_today: 0 },
    { ...UNLIMITED, people: 0, new_pieces_today: 0 },
  ],
  people: [
    person({ email: 'erez@example.com', is_admin: true, plan_id: 'unlimited', assigned: true }),
    person({ email: 'maya@example.com', display_name: 'Maya' }),
    person({ email: 'noam@example.com', plan_id: 'creator', assigned: true, added_at: '2026-10-20T08:00:00Z' }),
    person({ email: 'later@example.com', signed_up: false, last_sign_in_at: null, plan_id: 'creator', assigned: true, added_at: '2026-11-02T08:00:00Z' }),
    // A creator assignment whose email is not confirmed yet: the plan that counts is Trial, the row on the list says Creator.
    person({ email: 'pending@example.com', plan_id: 'trial', assigned: true, assigned_plan_id: 'creator', added_at: '2026-11-03T08:00:00Z' }),
  ],
}

// The list shows each person on the plan of their row, so the unconfirmed creator reads Creator, not Trial.
const LISTED = DATA.people.map((p) => (p.assigned_plan_id === null ? p : { ...p, plan_id: p.assigned_plan_id }))
const fresh = () => startDraft(DATA)
const nothing = { plans: [], people: [] }

describe('a draft with no edits', () => {
  it('has no changes', () => {
    expect(changeCount(fresh())).toBe(0)
    expect(toChanges(fresh())).toEqual(nothing)
    expect(validate(fresh())).toEqual([])
    expect(confirmNeeded(fresh())).toEqual({ removes: 0, pauses: [] })
  })

  it('shows the saved people and plans as they are', () => {
    expect(viewPeople(fresh())).toEqual(LISTED)
    expect(viewPlans(fresh())).toEqual(DATA.plans)
    expect(rowState(fresh(), 'maya@example.com')).toBe('saved')
  })

  it('does not change the data it was started from', () => {
    const before = structuredClone(DATA)
    let d = setLimit(fresh(), 'trial', 'pieces_created_max', 9)
    d = addPerson(d, 'x@example.com', 'creator') as Draft
    d = removePerson(d, 'noam@example.com')
    expect(changeCount(d)).toBe(3)
    expect(DATA).toEqual(before)
  })
})

describe('plan limits', () => {
  it('stages a changed number as one change, listing only that column', () => {
    const d = setLimit(fresh(), 'trial', 'pieces_created_max', 4)
    expect(changeCount(d)).toBe(1)
    expect(toChanges(d)).toEqual({ plans: [{ id: 'trial', pieces_created_max: 4 }], people: [] })
    expect(viewPlans(d)[0]!.pieces_created_max).toBe(4)
  })

  it('stages No limit as null, and a switch as a boolean', () => {
    let d = setLimit(fresh(), 'trial', 'pieces_created_max', null)
    d = setLimit(d, 'trial', 'new_pieces_paused', true)
    expect(toChanges(d).plans).toEqual([{ id: 'trial', pieces_created_max: null, new_pieces_paused: true }])
    expect(changeCount(d)).toBe(2)
  })

  it('a value set back to the saved one is not a change', () => {
    let d = setLimit(fresh(), 'trial', 'pieces_created_max', 4)
    d = setLimit(d, 'trial', 'pieces_created_max', 3)
    expect(changeCount(d)).toBe(0)
    expect(toChanges(d)).toEqual(nothing)
  })

  it('a saved No limit set back to No limit is not a change', () => {
    const d = setLimit(fresh(), 'creator', 'pieces_created_max', null)
    expect(changeCount(d)).toBe(0)
  })

  it('keeps plans apart and lists the plans and their columns in the contract order', () => {
    let d = setLimit(fresh(), 'creator', 'realign_per_piece_max', 9)
    d = setLimit(d, 'trial', 'suggest_name', false)
    d = setLimit(d, 'trial', 'pieces_created_max', 1)
    expect(toChanges(d).plans).toEqual([
      { id: 'trial', pieces_created_max: 1, suggest_name: false },
      { id: 'creator', realign_per_piece_max: 9 },
    ])
  })

  it('ignores a value of the wrong kind: null on a limit that cannot be empty, a number on a switch, a boolean on a count', () => {
    let d = setLimit(fresh(), 'trial', 'members_per_piece', null)
    d = setLimit(d, 'trial', 'split_pdf', 1 as unknown as boolean)
    d = setLimit(d, 'trial', 'pieces_created_max', true)
    d = setLimit(d, 'trial', 'suggest_name', null)
    expect(changeCount(d)).toBe(0)
  })

  it('does not touch the data of another plan', () => {
    const d = setLimit(fresh(), 'trial', 'pieces_stored_max', 8)
    expect(viewPlans(d)[1]).toEqual(DATA.plans[1])
  })
})

describe('what a field shows: setRaw', () => {
  it('valid text stages the number', () => {
    const d = setRaw(fresh(), 'trial', 'pieces_created_max', '5')
    expect(toChanges(d).plans).toEqual([{ id: 'trial', pieces_created_max: 5 }])
    expect(validate(d)).toEqual([])
  })

  it('trims the text, and text equal to the saved number is no change', () => {
    expect(changeCount(setRaw(fresh(), 'trial', 'pieces_created_max', ' 3 '))).toBe(0)
  })

  it('text that is not a whole number is invalid: "whole"', () => {
    for (const text of ['', ' ', 'abc', '1.5', '1,5', '4x', '1e2']) {
      const d = setRaw(fresh(), 'trial', 'pieces_created_max', text)
      expect(validate(d)).toEqual([{ plan: 'trial', key: 'pieces_created_max', reason: 'whole' }])
    }
  })

  it('a number under the minimum is "min", over the ceiling is "ceiling"', () => {
    expect(validate(setRaw(fresh(), 'trial', 'parts_per_piece_max', '0'))).toEqual([{ plan: 'trial', key: 'parts_per_piece_max', reason: 'min' }])
    expect(validate(setRaw(fresh(), 'trial', 'pieces_created_max', '-1'))).toEqual([{ plan: 'trial', key: 'pieces_created_max', reason: 'min' }])
    expect(validate(setRaw(fresh(), 'trial', 'pages_per_part_max', '101'))).toEqual([{ plan: 'trial', key: 'pages_per_part_max', reason: 'ceiling' }])
    expect(validate(setRaw(fresh(), 'trial', 'recording_minutes_max', '21'))).toEqual([{ plan: 'trial', key: 'recording_minutes_max', reason: 'ceiling' }])
  })

  it('the ceiling itself and the minimum itself are valid', () => {
    let d = setRaw(fresh(), 'trial', 'pages_per_part_max', '100')
    d = setRaw(d, 'trial', 'recording_minutes_max', '20')
    d = setRaw(d, 'trial', 'parts_per_piece_max', '1')
    d = setRaw(d, 'trial', 'members_per_part', '0')
    expect(validate(d)).toEqual([])
  })

  it('an invalid field is counted as a change, and toChanges leaves it out (validate is the gate)', () => {
    const d = setRaw(fresh(), 'trial', 'pieces_created_max', 'abc')
    expect(changeCount(d)).toBe(1)
    expect(toChanges(d)).toEqual(nothing)
  })

  it('bad text after a valid number replaces it: the field is what counts, and nothing valid is staged', () => {
    let d = setRaw(fresh(), 'trial', 'pieces_created_max', '5')
    d = setRaw(d, 'trial', 'pieces_created_max', '5x')
    expect(changeCount(d)).toBe(1)
    expect(validate(d)).toHaveLength(1)
    expect(toChanges(d)).toEqual(nothing)
  })

  it('typing a valid number again clears the problem; setting the saved text clears the change', () => {
    let d = setRaw(fresh(), 'trial', 'pieces_created_max', 'abc')
    d = setRaw(d, 'trial', 'pieces_created_max', '3')
    expect(validate(d)).toEqual([])
    expect(changeCount(d)).toBe(0)
  })

  it('setLimit after bad text replaces the field', () => {
    let d = setRaw(fresh(), 'trial', 'pieces_created_max', 'abc')
    d = setLimit(d, 'trial', 'pieces_created_max', null)
    expect(validate(d)).toEqual([])
    expect(toChanges(d).plans).toEqual([{ id: 'trial', pieces_created_max: null }])
  })

  it('a number outside the bounds set with setLimit is also caught by validate', () => {
    const d = setLimit(fresh(), 'trial', 'pages_per_part_max', 101)
    expect(validate(d)).toEqual([{ plan: 'trial', key: 'pages_per_part_max', reason: 'ceiling' }])
    expect(validate(setLimit(fresh(), 'trial', 'pages_per_part_max', 2.5))).toEqual([{ plan: 'trial', key: 'pages_per_part_max', reason: 'whole' }])
  })

  it('lists every invalid field, in plan and limit order', () => {
    let d = setRaw(fresh(), 'creator', 'realign_per_piece_max', 'x')
    d = setRaw(d, 'trial', 'pages_per_part_max', '500')
    d = setRaw(d, 'trial', 'pieces_created_max', '')
    expect(validate(d)).toEqual([
      { plan: 'trial', key: 'pieces_created_max', reason: 'whole' },
      { plan: 'trial', key: 'pages_per_part_max', reason: 'ceiling' },
      { plan: 'creator', key: 'realign_per_piece_max', reason: 'whole' },
    ])
  })

  it('while the text is invalid the view of the plan shows the saved number, and rawText gives what the field shows', () => {
    let d = setRaw(fresh(), 'trial', 'pieces_created_max', '5')
    expect(rawText(d, 'trial', 'pieces_created_max')).toBeUndefined()
    d = setRaw(d, 'trial', 'pieces_created_max', '5x')
    expect(viewPlans(d)[0]!.pieces_created_max).toBe(3)
    expect(rawText(d, 'trial', 'pieces_created_max')).toBe('5x')
    expect(rawText(setRaw(d, 'trial', 'pieces_created_max', '4'), 'trial', 'pieces_created_max')).toBeUndefined()
  })

  // save_admin_changes accepts whole numbers of at most 9 digits, so the draft must refuse what the database would (final review M1).
  it('a number past what save_admin_changes accepts (9 digits) is invalid even where the plan has no ceiling', () => {
    expect(validate(setRaw(fresh(), 'trial', 'pieces_created_max', '999999999'))).toEqual([])
    expect(validate(setRaw(fresh(), 'trial', 'pieces_created_max', '1000000000'))).toEqual([{ plan: 'trial', key: 'pieces_created_max', reason: 'ceiling' }])
    expect(validate(setLimit(fresh(), 'trial', 'pieces_created_max', 1000000000))).toEqual([{ plan: 'trial', key: 'pieces_created_max', reason: 'ceiling' }])
  })

  it('text for a switch is ignored', () => {
    expect(changeCount(setRaw(fresh(), 'trial', 'split_pdf', 'abc'))).toBe(0)
  })

  it('limitChanged says which fields differ from the saved plan, including a field with bad text', () => {
    let d = setLimit(fresh(), 'trial', 'pieces_created_max', 4)
    d = setRaw(d, 'trial', 'pieces_stored_max', 'x')
    expect(limitChanged(d, 'trial', 'pieces_created_max')).toBe(true)
    expect(limitChanged(d, 'trial', 'pieces_stored_max')).toBe(true)
    expect(limitChanged(d, 'trial', 'realign_per_piece_max')).toBe(false)
    expect(limitChanged(d, 'creator', 'pieces_created_max')).toBe(false)
  })
})

describe('people', () => {
  it('adds a person: trimmed, lower case, listed last as new', () => {
    const d = addPerson(fresh(), '  New.Person@Example.COM ', 'creator') as Draft
    expect(rowState(d, 'new.person@example.com')).toBe('new')
    expect(toChanges(d).people).toEqual([{ email: 'new.person@example.com', plan_id: 'creator' }])
    expect(changeCount(d)).toBe(1)
    const view = viewPeople(d)
    expect(view).toHaveLength(DATA.people.length + 1)
    expect(view[view.length - 1]).toMatchObject({ email: 'new.person@example.com', plan_id: 'creator', assigned: true, signed_up: false, last_sign_in_at: null, is_admin: false, display_name: null, pieces_created: 0, pieces_stored: 0, shared_pieces: 0 })
  })

  it('refuses a bad email: invalid', () => {
    for (const text of ['', 'nobody', 'a@b', 'a b@c.com', '@x.com']) expect(addPerson(fresh(), text, 'trial')).toEqual({ error: 'invalid' })
  })

  it('refuses an email already in the list or already staged, whatever its case: duplicate', () => {
    expect(addPerson(fresh(), 'MAYA@example.com', 'creator')).toEqual({ error: 'duplicate' })
    expect(addPerson(fresh(), 'later@example.com', 'creator')).toEqual({ error: 'duplicate' })
    const d = addPerson(fresh(), 'x@example.com', 'creator') as Draft
    expect(addPerson(d, ' X@example.com', 'unlimited')).toEqual({ error: 'duplicate' })
  })

  it('changes the plan of a saved person: planChanged, one change', () => {
    const d = setPersonPlan(fresh(), 'maya@example.com', 'creator')
    expect(rowState(d, 'maya@example.com')).toBe('planChanged')
    expect(toChanges(d).people).toEqual([{ email: 'maya@example.com', plan_id: 'creator' }])
    expect(changeCount(d)).toBe(1)
    expect(viewPeople(d).find((p) => p.email === 'maya@example.com')!.plan_id).toBe('creator')
  })

  it('a plan set back to the saved one is not a change', () => {
    const d = setPersonPlan(setPersonPlan(fresh(), 'noam@example.com', 'unlimited'), 'noam@example.com', 'creator')
    expect(rowState(d, 'noam@example.com')).toBe('saved')
    expect(changeCount(d)).toBe(0)
    expect(toChanges(d)).toEqual(nothing)
  })

  it('an unassigned person set to Trial stays unchanged (they are on Trial already)', () => {
    expect(changeCount(setPersonPlan(fresh(), 'maya@example.com', 'trial'))).toBe(0)
  })

  it('an assigned person moved to Trial is a change that saves the Trial assignment', () => {
    const d = setPersonPlan(fresh(), 'noam@example.com', 'trial')
    expect(toChanges(d).people).toEqual([{ email: 'noam@example.com', plan_id: 'trial' }])
  })

  it('changes the plan of a staged new person without making a second change', () => {
    let d = addPerson(fresh(), 'x@example.com', 'creator') as Draft
    d = setPersonPlan(d, 'x@example.com', 'unlimited')
    expect(rowState(d, 'x@example.com')).toBe('new')
    expect(toChanges(d).people).toEqual([{ email: 'x@example.com', plan_id: 'unlimited' }])
    expect(changeCount(d)).toBe(1)
  })

  it('removes a saved assigned person: willBeRemoved, and the row stays in the view with its plan', () => {
    const d = removePerson(fresh(), 'noam@example.com')
    expect(rowState(d, 'noam@example.com')).toBe('willBeRemoved')
    expect(toChanges(d).people).toEqual([{ email: 'noam@example.com', remove: true }])
    expect(changeCount(d)).toBe(1)
    expect(viewPeople(d).find((p) => p.email === 'noam@example.com')!.plan_id).toBe('creator')
    const gone = removePerson(fresh(), 'later@example.com')
    expect(rowState(gone, 'later@example.com')).toBe('willBeRemoved')
  })

  it('removing a staged new person drops it and leaves no change', () => {
    let d = addPerson(fresh(), 'x@example.com', 'creator') as Draft
    d = removePerson(d, 'x@example.com')
    expect(changeCount(d)).toBe(0)
    expect(toChanges(d)).toEqual(nothing)
    expect(viewPeople(d)).toEqual(LISTED)
  })

  it('removing a person with a staged plan change turns it into the removal alone', () => {
    const d = removePerson(setPersonPlan(fresh(), 'noam@example.com', 'unlimited'), 'noam@example.com')
    expect(toChanges(d).people).toEqual([{ email: 'noam@example.com', remove: true }])
    expect(changeCount(d)).toBe(1)
  })

  it('undo puts a removed or changed person back as saved', () => {
    const removed = undoPerson(removePerson(fresh(), 'noam@example.com'), 'noam@example.com')
    expect(rowState(removed, 'noam@example.com')).toBe('saved')
    expect(changeCount(removed)).toBe(0)
    const changed = undoPerson(setPersonPlan(fresh(), 'maya@example.com', 'creator'), 'maya@example.com')
    expect(rowState(changed, 'maya@example.com')).toBe('saved')
    expect(viewPeople(changed).find((p) => p.email === 'maya@example.com')!.plan_id).toBe('trial')
  })

  it('undo on a staged new person drops it; undo on an untouched person does nothing', () => {
    const added = undoPerson(addPerson(fresh(), 'x@example.com', 'creator') as Draft, 'x@example.com')
    expect(changeCount(added)).toBe(0)
    expect(viewPeople(added)).toEqual(LISTED)
    expect(changeCount(undoPerson(fresh(), 'maya@example.com'))).toBe(0)
  })

  it('a person who is not on Trial by assignment (no row) cannot be removed: they have no plan assignment', () => {
    const d = removePerson(fresh(), 'maya@example.com')
    expect(rowState(d, 'maya@example.com')).toBe('saved')
    expect(changeCount(d)).toBe(0)
  })

  it('the admin cannot change plan or be removed', () => {
    let d = setPersonPlan(fresh(), 'erez@example.com', 'trial')
    d = removePerson(d, 'erez@example.com')
    expect(rowState(d, 'erez@example.com')).toBe('saved')
    expect(changeCount(d)).toBe(0)
    expect(toChanges(d)).toEqual(nothing)
  })

  it('the admin email cannot be added again, whatever its case', () => {
    expect(addPerson(fresh(), 'EREZ@example.com', 'trial')).toEqual({ error: 'duplicate' })
  })

  it('an email that is not in the draft has the saved state and changes nothing', () => {
    const d = setPersonPlan(removePerson(fresh(), 'ghost@example.com'), 'ghost@example.com', 'creator')
    expect(rowState(d, 'ghost@example.com')).toBe('saved')
    expect(changeCount(d)).toBe(0)
  })

  it('lists people changes after the plans, in the order of the people list then the new ones', () => {
    let d = addPerson(fresh(), 'zed@example.com', 'creator') as Draft
    d = removePerson(d, 'later@example.com')
    d = setPersonPlan(d, 'maya@example.com', 'unlimited')
    expect(toChanges(d).people).toEqual([
      { email: 'maya@example.com', plan_id: 'unlimited' },
      { email: 'later@example.com', remove: true },
      { email: 'zed@example.com', plan_id: 'creator' },
    ])
  })
})

describe('the count, the confirmation and the whole draft', () => {
  it('counts one per changed limit and one per person change', () => {
    let d = setLimit(fresh(), 'trial', 'pieces_created_max', 4)
    d = setLimit(d, 'trial', 'suggest_name', false)
    d = setRaw(d, 'creator', 'realign_per_piece_max', 'x')
    d = addPerson(d, 'x@example.com', 'creator') as Draft
    d = removePerson(d, 'noam@example.com')
    d = setPersonPlan(d, 'maya@example.com', 'creator')
    expect(changeCount(d)).toBe(6)
  })

  it('confirms removals, and plans whose pause turns on', () => {
    let d = removePerson(fresh(), 'noam@example.com')
    d = removePerson(d, 'later@example.com')
    d = setLimit(d, 'trial', 'new_pieces_paused', true)
    d = setLimit(d, 'creator', 'new_pieces_paused', true)
    expect(confirmNeeded(d)).toEqual({ removes: 2, pauses: ['trial', 'creator'] })
  })

  it('does not confirm a pause that turns off, or a removed new person', () => {
    const paused: AdminData = { ...DATA, plans: DATA.plans.map((p) => (p.id === 'trial' ? { ...p, new_pieces_paused: true } : p)) }
    let d = setLimit(startDraft(paused), 'trial', 'new_pieces_paused', false)
    d = removePerson(addPerson(d, 'x@example.com', 'creator') as Draft, 'x@example.com')
    expect(confirmNeeded(d)).toEqual({ removes: 0, pauses: [] })
  })

  it('a pause switched on and off again needs no confirmation', () => {
    const d = setLimit(setLimit(fresh(), 'trial', 'new_pieces_paused', true), 'trial', 'new_pieces_paused', false)
    expect(confirmNeeded(d)).toEqual({ removes: 0, pauses: [] })
  })

  it('an already paused plan left paused is not a new pause', () => {
    const paused: AdminData = { ...DATA, plans: DATA.plans.map((p) => (p.id === 'trial' ? { ...p, new_pieces_paused: true } : p)) }
    expect(confirmNeeded(setLimit(startDraft(paused), 'trial', 'new_pieces_paused', true))).toEqual({ removes: 0, pauses: [] })
  })
})

describe('a person whose assigned plan is not the plan that counts yet (final review M5)', () => {
  it('compares with the assigned plan: choosing Trial for an unconfirmed creator is a change, choosing Creator is none', () => {
    const toTrial = setPersonPlan(fresh(), 'pending@example.com', 'trial')
    expect(rowState(toTrial, 'pending@example.com')).toBe('planChanged')
    expect(toChanges(toTrial).people).toEqual([{ email: 'pending@example.com', plan_id: 'trial' }])
    expect(changeCount(setPersonPlan(fresh(), 'pending@example.com', 'creator'))).toBe(0)
  })

  it('lists the row with its assigned plan, then with the staged one', () => {
    const row = (d: Draft) => viewPeople(d).find((p) => p.email === 'pending@example.com')!
    expect(row(fresh()).plan_id).toBe('creator')
    expect(row(setPersonPlan(fresh(), 'pending@example.com', 'unlimited')).plan_id).toBe('unlimited')
    expect(viewPeople(fresh()).find((p) => p.email === 'maya@example.com')!.plan_id).toBe('trial')
  })
})
