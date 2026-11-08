import { describe, expect, it } from 'vitest'
import { type LimitKey } from '@/domain/planLimits'
import { createFakes, type Fakes } from '@/lib/fakes'
import { DEMO_USER, OTHER_USER, setPlan, setPlanLimits, signInAs, THIRD_USER } from '@/lib/fakes/store'
import { PlanLimitError } from '@/lib/processorClient'

const recording = () => ({ kind: 'file', file: new File(['x'], 'take.mp3', { type: 'audio/mpeg' }) }) as const
const pdf = (name = 'a.pdf') => new File(['x'], name, { type: 'application/pdf' })

/** The limit a call was refused for, or null when it went through. */
async function refusedFor(call: () => Promise<unknown>): Promise<LimitKey | null> {
  try {
    await call()
    return null
  } catch (error) {
    if (error instanceof PlanLimitError) return error.limit
    throw error
  }
}

/** A Trial user (OTHER_USER) signed in on fresh fakes. */
function trial(): Fakes {
  const fakes = createFakes()
  signInAs(fakes.store, OTHER_USER.id)
  return fakes
}
const makePiece = (fakes: Fakes, title = 'Etude', parts = [{ file: pdf(), name: 'A' }]) => fakes.data.createPiece({ title, recording: recording(), parts })

describe('myPlan', () => {
  it('is Trial for anyone with no assignment, the assigned plan otherwise, and the admin is Unlimited with is_admin', async () => {
    const fakes = createFakes()
    signInAs(fakes.store, OTHER_USER.id)
    expect(await fakes.data.myPlan()).toMatchObject({ is_admin: false, plan: { id: 'trial', name: 'Trial', pieces_created_max: 3 }, usage: { pieces_created: 0, pieces_stored: 0 }, piece: null })
    setPlan(fakes.store, OTHER_USER.email, 'creator')
    expect((await fakes.data.myPlan()).plan.id).toBe('creator')
    signInAs(fakes.store, DEMO_USER.id)
    expect(await fakes.data.myPlan()).toMatchObject({ is_admin: true, plan: { id: 'unlimited' } })
  })

  it('counts pieces made, stored and shared; a deleted piece frees the stored slot and not the made one', async () => {
    const fakes = trial()
    const first = await makePiece(fakes)
    const second = await makePiece(fakes, 'Two')
    await fakes.data.getShare(first.id)
    expect((await fakes.data.myPlan()).usage).toMatchObject({ pieces_created: 2, pieces_stored: 2, shared_pieces: 0 })
    await fakes.data.setShareEnabled(first.id, true, true)
    await fakes.data.deletePiece(second.id)
    expect((await fakes.data.myPlan()).usage).toMatchObject({ pieces_created: 2, pieces_stored: 1, shared_pieces: 1 })
  })

  it('tells the piece\'s parts, realigns and reads again for the user\'s own piece, and null for anyone else\'s', async () => {
    const fakes = trial()
    const piece = await makePiece(fakes)
    const part = piece.parts[0]!
    await fakes.processor.realign(piece.id)
    await fakes.processor.reprocessPart(piece.id, part.id, { boxCheck: false })
    expect((await fakes.data.myPlan(piece.id)).piece).toEqual({ id: piece.id, parts: 1, realigns: 1, read_again_by_part: { [part.id]: 1 } })
    signInAs(fakes.store, THIRD_USER.id)
    expect((await fakes.data.myPlan(piece.id)).piece).toBeNull()
  })

  it('counts the pieces of an account that was deleted (the trial ledger)', async () => {
    const fakes = trial()
    const piece = await makePiece(fakes)
    await fakes.data.deletePiece(piece.id)
    await fakes.data.deleteAccount()
    expect(fakes.store.ledger.get(OTHER_USER.email)).toBe(1)
    fakes.store.users.set(OTHER_USER.id, { ...OTHER_USER }) // the same Google account signs up again
    signInAs(fakes.store, OTHER_USER.id)
    expect((await fakes.data.myPlan()).usage.pieces_created).toBe(1)
  })
})

describe('createPiece', () => {
  it('stops the fourth piece of a Trial user with pieces_created_max, and the admin is never stopped', async () => {
    const fakes = trial()
    for (let made = 0; made < 3; made += 1) await makePiece(fakes, `P${made}`)
    expect(await refusedFor(() => makePiece(fakes))).toBe('pieces_created_max')
    expect(await fakes.data.listPieces()).toHaveLength(3)
    signInAs(fakes.store, DEMO_USER.id)
    for (let made = 0; made < 5; made += 1) await makePiece(fakes, `A${made}`)
    expect(await fakes.data.listPieces()).toHaveLength(5)
  })

  it('stops at pieces_stored_max when pieces made allow it', async () => {
    const fakes = trial()
    setPlanLimits(fakes.store, 'trial', { pieces_created_max: null, pieces_stored_max: 1 })
    await makePiece(fakes)
    expect(await refusedFor(() => makePiece(fakes))).toBe('pieces_stored_max')
  })

  it('names a paused plan before the counts, and the daily cap of all the plan\'s users', async () => {
    const fakes = trial()
    setPlanLimits(fakes.store, 'trial', { new_pieces_paused: true })
    expect(await refusedFor(() => makePiece(fakes))).toBe('new_pieces_paused')
    setPlanLimits(fakes.store, 'trial', { new_pieces_paused: false, new_pieces_per_day: 1 })
    signInAs(fakes.store, THIRD_USER.id)
    await makePiece(fakes) // another Trial user used the day's one
    signInAs(fakes.store, OTHER_USER.id)
    expect(await refusedFor(() => makePiece(fakes))).toBe('new_pieces_per_day')
  })

  it('stops a second part (parts_per_piece_max) and an Advanced Reading tick (advanced_reading) before anything is made', async () => {
    const fakes = trial()
    expect(await refusedFor(() => makePiece(fakes, 'x', [{ file: pdf('a.pdf'), name: 'A' }, { file: pdf('b.pdf'), name: 'B' }]))).toBe('parts_per_piece_max')
    expect(await refusedFor(() => fakes.data.createPiece({ title: 'x', recording: recording(), parts: [{ file: pdf(), name: 'A', boxCheck: true }] }))).toBe('advanced_reading')
    expect(await fakes.data.listPieces()).toEqual([])
    expect((await fakes.data.myPlan()).usage.pieces_created).toBe(0)
  })

  it('lets a Creator make many parts and tick Advanced Reading', async () => {
    const fakes = trial()
    setPlan(fakes.store, OTHER_USER.email, 'creator')
    const piece = await fakes.data.createPiece({ title: 'x', recording: recording(), parts: [{ file: pdf('a.pdf'), name: 'A', boxCheck: true }, { file: pdf('b.pdf'), name: 'B' }] })
    expect(piece.parts).toHaveLength(2)
  })

  it('a split PDF counts its parts too', async () => {
    const fakes = trial()
    const proposal = await refusedFor(() => fakes.processor.proposeSplit(pdf('band.pdf')))
    expect(proposal).toBe('split_pdf')
    setPlan(fakes.store, OTHER_USER.email, 'creator')
    const split = await fakes.processor.proposeSplit(pdf('band.pdf'))
    setPlan(fakes.store, OTHER_USER.email, 'trial')
    expect(await refusedFor(() => fakes.data.createPiece({ title: 'x', recording: recording(), parts: [], split: { splitId: split.splitId, fileName: 'band.pdf', parts: split.parts.map((part) => ({ ...part, skipPages: [] })) } }))).toBe('parts_per_piece_max')
  })
})

describe('storeParts and addParts', () => {
  it('a Trial piece cannot take a second part; a Creator\'s can, and an Advanced Reading tick needs the plan', async () => {
    const fakes = trial()
    const piece = await makePiece(fakes)
    expect(await refusedFor(() => fakes.data.storeParts(piece.id, [{ file: pdf('b.pdf'), name: 'B' }]))).toBe('parts_per_piece_max')
    expect(await refusedFor(() => fakes.processor.addParts(piece.id, [{ file: pdf('b.pdf'), name: 'B' }]))).toBe('parts_per_piece_max')
    expect(await fakes.data.myPlan(piece.id).then((state) => state.piece?.parts)).toBe(1)
    setPlanLimits(fakes.store, 'trial', { parts_per_piece_max: null })
    expect(await refusedFor(() => fakes.data.storeParts(piece.id, [{ file: pdf('b.pdf'), name: 'B', boxCheck: true }]))).toBe('advanced_reading')
    setPlan(fakes.store, OTHER_USER.email, 'creator')
    await fakes.processor.addParts(piece.id, [{ file: pdf('b.pdf'), name: 'B', boxCheck: true }])
    expect((await fakes.data.myPlan()).usage.advanced_reading_parts_this_month).toBe(1)
  })
})

describe('sharing', () => {
  it('turns on one link on Trial; the second is refused with shared_pieces_max; turning one off makes room; the admin has no cap', async () => {
    const fakes = trial()
    const one = await makePiece(fakes, 'One')
    const two = await makePiece(fakes, 'Two')
    for (const piece of [one, two]) await fakes.data.getShare(piece.id)
    await fakes.data.setShareEnabled(one.id, true, true)
    expect(await refusedFor(() => fakes.data.setShareEnabled(two.id, true, true))).toBe('shared_pieces_max')
    expect((await fakes.data.getShare(two.id)).enabled).toBe(false)
    await fakes.data.setShareEnabled(one.id, true) // a link that is already on stays on
    await fakes.data.setShareEnabled(one.id, false)
    await fakes.data.setShareEnabled(two.id, true, true)
    expect((await fakes.data.myPlan()).usage.shared_pieces).toBe(1)
  })
})

describe('the processor', () => {
  it('Advanced Reading: a ticked part on a plan without it is refused at processing, and the refusal gives the piece slot back', async () => {
    const fakes = trial()
    setPlanLimits(fakes.store, 'trial', { advanced_reading: true, advanced_reading_parts_per_month: 0 })
    const piece = await fakes.data.createPiece({ title: 'x', recording: recording(), parts: [{ file: pdf(), name: 'A', boxCheck: true }] })
    expect((await fakes.data.myPlan()).usage.pieces_created).toBe(1)
    expect(await refusedFor(() => fakes.processor.processPiece(piece.id))).toBe('advanced_reading_parts_per_month')
    expect((await fakes.data.myPlan()).usage).toMatchObject({ pieces_created: 0, advanced_reading_parts_this_month: 0 })
  })

  it('counts the ticked parts of a started job against the month', async () => {
    const fakes = trial()
    setPlanLimits(fakes.store, 'trial', { advanced_reading: true, advanced_reading_parts_per_month: 2 })
    const piece = await fakes.data.createPiece({ title: 'x', recording: recording(), parts: [{ file: pdf(), name: 'A', boxCheck: true }] })
    await fakes.processor.processPiece(piece.id)
    expect((await fakes.data.myPlan()).usage.advanced_reading_parts_this_month).toBe(1)
  })

  it('refuses a part with more pages, and a recording longer, than the plan reads', async () => {
    const fakes = trial()
    const piece = await makePiece(fakes)
    fakes.store.parts.forEach((part) => (part.pageCount = 21))
    expect(await refusedFor(() => fakes.processor.processPiece(piece.id))).toBe('pages_per_part_max')
    fakes.store.parts.forEach((part) => (part.pageCount = 20))
    fakes.store.pieces.get(piece.id)!.durationSec = 11 * 60
    expect(await refusedFor(() => fakes.processor.processPiece(piece.id))).toBe('recording_minutes_max')
    fakes.store.pieces.get(piece.id)!.durationSec = 10 * 60
    await fakes.processor.processPiece(piece.id)
  })

  it('realign: 5 on Trial, the sixth is refused with realign_per_piece_max; a Creator has none', async () => {
    const fakes = trial()
    const piece = await makePiece(fakes)
    for (let run = 0; run < 5; run += 1) await fakes.processor.realign(piece.id)
    expect(await refusedFor(() => fakes.processor.realign(piece.id))).toBe('realign_per_piece_max')
    setPlan(fakes.store, OTHER_USER.email, 'creator')
    await fakes.processor.realign(piece.id)
  })

  it('read a part again: 2 per part on Trial, counted per part; the Advanced tick needs the plan', async () => {
    const fakes = trial()
    const piece = await fakes.data.createPiece({ title: 'x', recording: recording(), parts: [{ file: pdf(), name: 'A' }] })
    setPlanLimits(fakes.store, 'trial', { parts_per_piece_max: null })
    const [added] = await fakes.data.storeParts(piece.id, [{ file: pdf('b.pdf'), name: 'B' }])
    const first = piece.parts[0]!.id
    await fakes.processor.reprocessPart(piece.id, first, { boxCheck: false })
    await fakes.processor.reprocessPart(piece.id, first, { boxCheck: false })
    expect(await refusedFor(() => fakes.processor.reprocessPart(piece.id, first, { boxCheck: false }))).toBe('read_again_per_part_max')
    await fakes.processor.reprocessPart(piece.id, added!.id, { boxCheck: false })
    expect(await refusedFor(() => fakes.processor.reprocessPart(piece.id, added!.id, { boxCheck: true }))).toBe('advanced_reading')
  })

  it('suggest a name and split a PDF follow their switches; the admin is never refused', async () => {
    const fakes = trial()
    const piece = await makePiece(fakes)
    expect(await refusedFor(() => fakes.processor.suggestPieceName(piece.id))).toBeNull()
    setPlanLimits(fakes.store, 'trial', { suggest_name: false })
    expect(await refusedFor(() => fakes.processor.suggestPieceName(piece.id))).toBe('suggest_name')
    expect(await refusedFor(() => fakes.processor.suggestNewPieceName({ recording: null, firstPart: pdf() }))).toBe('suggest_name')
    expect(await refusedFor(() => fakes.processor.proposeSplit(pdf('band.pdf')))).toBe('split_pdf')
    signInAs(fakes.store, DEMO_USER.id)
    setPlanLimits(fakes.store, 'unlimited', { suggest_name: false })
    expect(await refusedFor(() => fakes.processor.suggestNewPieceName({ recording: null, firstPart: pdf() }))).toBeNull()
  })
})

describe('the admin hub calls', () => {
  it('adminOverview: three plans with their people and today\'s count, everyone who signed up, and emails with a plan and no account', async () => {
    const fakes = createFakes({ plans: { [OTHER_USER.email]: 'creator', 'later@example.com': 'unlimited' } })
    signInAs(fakes.store, OTHER_USER.id)
    await makePiece(fakes)
    signInAs(fakes.store, DEMO_USER.id)

    const overview = await fakes.data.adminOverview()

    expect(overview.plans.map((plan) => [plan.id, plan.people, plan.new_pieces_today])).toEqual([['trial', 1, 0], ['creator', 1, 1], ['unlimited', 2, 0]])
    const byEmail = Object.fromEntries(overview.people.map((person) => [person.email, person]))
    expect(byEmail[DEMO_USER.email]).toMatchObject({ is_admin: true, plan_id: 'unlimited', assigned: false, signed_up: true })
    expect(byEmail[OTHER_USER.email]).toMatchObject({ plan_id: 'creator', assigned: true, pieces_created: 1, pieces_stored: 1 })
    expect(byEmail[THIRD_USER.email]).toMatchObject({ plan_id: 'trial', assigned: false })
    expect(byEmail['later@example.com']).toMatchObject({ signed_up: false, last_sign_in_at: null, display_name: null, plan_id: 'unlimited', assigned: true })
  })

  it('saveAdminChanges applies plan numbers and assignments, trims and lower-cases emails, and Remove puts the person back on Trial', async () => {
    const fakes = createFakes({ signedIn: true })
    await fakes.data.saveAdminChanges({
      plans: [{ id: 'trial', pieces_created_max: 4, new_pieces_paused: true, recording_minutes_max: 12, shared_pieces_max: null }],
      people: [{ email: '  New@Example.com ', plan_id: 'creator' }, { email: OTHER_USER.email, plan_id: 'unlimited' }],
    })
    expect(fakes.store.plans.get('trial')).toMatchObject({ pieces_created_max: 4, new_pieces_paused: true, recording_minutes_max: 12, shared_pieces_max: null })
    expect(fakes.store.planEmails.get('new@example.com')?.planId).toBe('creator')
    await fakes.data.saveAdminChanges({ plans: [], people: [{ email: OTHER_USER.email, remove: true }] })
    signInAs(fakes.store, OTHER_USER.id)
    expect((await fakes.data.myPlan()).plan.id).toBe('trial')
  })

  it.each([
    ['an unknown key', { plans: [{ id: 'trial', colour: 1 }], people: [] }],
    ['an unknown plan', { plans: [{ id: 'gold', pieces_created_max: 1 }], people: [] }],
    ['a name', { plans: [{ id: 'trial', name: 'X' }], people: [] }],
    ['a switch given a number', { plans: [{ id: 'trial', split_pdf: 1 }], people: [] }],
    ['a count given text', { plans: [{ id: 'trial', pieces_created_max: '4' }], people: [] }],
    ['a fraction', { plans: [{ id: 'trial', pieces_created_max: 1.5 }], people: [] }],
    ['no limit on a column that needs one', { plans: [{ id: 'trial', members_per_piece: null }], people: [] }],
    ['more than a ceiling', { plans: [{ id: 'trial', pages_per_part_max: 101 }], people: [] }],
    ['less than a floor', { plans: [{ id: 'trial', parts_per_piece_max: 0 }], people: [] }],
    ['not an email', { plans: [], people: [{ email: 'nonsense', plan_id: 'creator' }] }],
    ['the admin', { plans: [], people: [{ email: DEMO_USER.email, plan_id: 'trial' }] }],
    ['a person with neither plan nor remove', { plans: [], people: [{ email: 'a@example.com' }] }],
    ['an unknown plan for a person', { plans: [], people: [{ email: 'a@example.com', plan_id: 'gold' }] }],
    ['a stray top-level key', { plans: [], people: [], extra: 1 }],
  ])('saves nothing when the draft holds %s', async (_name, changes) => {
    const fakes = createFakes({ signedIn: true })
    const before = structuredClone([...fakes.store.plans])
    // The first entries are fine: the bad one, later in the draft, must undo them (all or nothing).
    const draft = { plans: [{ id: 'creator', pieces_stored_max: 7 }, ...(changes.plans ?? [])], people: [{ email: 'ok@example.com', plan_id: 'creator' }, ...(changes.people ?? [])], ...('extra' in changes ? { extra: 1 } : {}) }
    await expect(fakes.data.saveAdminChanges(draft as never)).rejects.toThrow()
    expect([...fakes.store.plans]).toEqual(before)
    expect(fakes.store.planEmails.has('ok@example.com')).toBe(false)
  })
})
