// @vitest-environment node
import { type PGlite } from '@electric-sql/pglite'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { type PlanState } from '@/domain/planLimits'
import { PlanLimitError } from '@/lib/processorClient'
import { fail } from '@/lib/supabase/port'
import { createPlans, isRlsRefusal, partRefusalOf, readPlan, refusalOf } from '@/lib/supabase/plans'
import { createSharing } from '@/lib/supabase/sharing'
import { pgliteSupabase } from '@/test/pgliteSupabase'
import { databaseWithMigrations } from '@/test/supabaseStandIn'

const ADMIN = '00000000-0000-4000-8000-00000000000a'
const TRIAL = '00000000-0000-4000-8000-00000000000b'
const CREATOR = '00000000-0000-4000-8000-00000000000c'
const PIECE = '00000000-0000-4000-8000-0000000000f1'
const PIECE_B = '00000000-0000-4000-8000-0000000000f2'
const PART = '00000000-0000-4000-8000-0000000000f3'

let db: PGlite
let sb: ReturnType<typeof pgliteSupabase>
let currentUser = ADMIN
let plans: ReturnType<typeof createPlans>
let sharing: ReturnType<typeof createSharing>

beforeAll(async () => {
  db = await databaseWithMigrations()
  sb = pgliteSupabase(db)
  const requireUser = async () => {
    sb.signIn(currentUser)
    return { id: currentUser, email: 'x@example.com', name: 'X' }
  }
  plans = createPlans(sb.port, requireUser)
  sharing = createSharing(sb.port, requireUser)
  await db.exec(`
    insert into auth.users (id, email, email_confirmed_at) values ('${ADMIN}', 'a@example.com', now()), ('${TRIAL}', 't@example.com', now()), ('${CREATOR}', 'c@example.com', now());
    insert into public.admins (user_id) values ('${ADMIN}');
    insert into public.plan_emails (email, plan_id) values ('c@example.com', 'creator');
  `)
})

beforeEach(async () => {
  currentUser = TRIAL
  await db.exec(`
    delete from public.pieces;
    delete from public.usage_events;
    update public.plans set new_pieces_paused = false where id = 'trial';
    insert into public.pieces (id, owner_id, title) values ('${PIECE}', '${TRIAL}', 'One'), ('${PIECE_B}', '${TRIAL}', 'Two');
    insert into public.score_files (id, piece_id, storage_path, sha256, name) values ('${PART}', '${PIECE}', 'x', 'x', 'Part');
  `)
})

describe('myPlan', () => {
  it('is the signed-in user\'s plan and usage, and the piece when it is theirs', async () => {
    const state = await plans.myPlan()
    expect(state).toMatchObject({ is_admin: false, plan: { id: 'trial', pieces_created_max: 3 }, usage: { pieces_created: 2, pieces_stored: 2, shared_pieces: 0 }, piece: null })

    const withPiece = await plans.myPlan(PIECE)
    expect(withPiece.piece).toEqual({ id: PIECE, parts: 1, realigns: 0, read_again_by_part: {} })

    currentUser = CREATOR
    expect((await plans.myPlan(PIECE)).piece).toBeNull() // not theirs
    expect((await plans.myPlan()).plan.id).toBe('creator')
    currentUser = ADMIN
    expect(await plans.myPlan()).toMatchObject({ is_admin: true, plan: { id: 'unlimited' } })
  })
})

describe('the admin hub calls', () => {
  it('adminOverview is the admin\'s alone', async () => {
    currentUser = ADMIN
    const overview = await plans.adminOverview()
    expect(overview.plans.map((plan) => plan.id)).toEqual(['trial', 'creator', 'unlimited'])
    expect(overview.people.map((person) => person.email).sort()).toEqual(['a@example.com', 'c@example.com', 't@example.com'])
    currentUser = TRIAL
    await expect(plans.adminOverview()).rejects.toThrow(/admin only/)
  })

  it('saveAdminChanges applies the draft in one go, or none of it', async () => {
    currentUser = ADMIN
    await plans.saveAdminChanges({ plans: [{ id: 'trial', pieces_created_max: 4 }], people: [{ email: 'new@example.com', plan_id: 'creator' }] })
    expect((await plans.adminOverview()).plans[0]).toMatchObject({ pieces_created_max: 4 })
    expect((await plans.adminOverview()).people.find((person) => person.email === 'new@example.com')).toMatchObject({ plan_id: 'creator', signed_up: false })

    await expect(plans.saveAdminChanges({ plans: [{ id: 'trial', pieces_created_max: 9 }], people: [{ email: 'nonsense', plan_id: 'creator' }] })).rejects.toThrow(/not an email/)
    expect((await plans.adminOverview()).plans[0]).toMatchObject({ pieces_created_max: 4 })

    await plans.saveAdminChanges({ plans: [{ id: 'trial', pieces_created_max: 3 }], people: [{ email: 'new@example.com', remove: true }] })
    currentUser = TRIAL
    await expect(plans.saveAdminChanges({ plans: [], people: [] })).rejects.toThrow(/admin only/)
  })
})

describe('plan_limit errors from the database', () => {
  it('turning on a second share link on Trial is a PlanLimitError naming shared_pieces_max', async () => {
    await sharing.getShare(PIECE)
    await sharing.getShare(PIECE_B)
    await sharing.setShareEnabled(PIECE, true, true)
    const error = await sharing.setShareEnabled(PIECE_B, true, true).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(PlanLimitError)
    expect((error as PlanLimitError).limit).toBe('shared_pieces_max')
  })

  it('ticking Advanced Reading on a part of a Trial user (the update trigger) is a PlanLimitError naming advanced_reading', async () => {
    const result = await sb.port.from('score_files').update({ box_check: true }).eq('id', PART)
    expect(() => fail(result.error)).toThrow(PlanLimitError)
    expect(() => fail(result.error)).toThrow('plan_limit:advanced_reading')
  })

  it('any other message stays a plain Error', () => {
    expect(() => fail({ message: 'offline' })).toThrow('offline')
    expect(() => fail({ message: 'offline' })).not.toThrow(PlanLimitError)
    expect(() => fail({ message: 'plan_limit:nothing_like_it' })).not.toThrow(PlanLimitError)
    expect(() => fail(null)).not.toThrow()
  })
})

describe('naming the limit of a refused insert', () => {
  const refusal = { message: 'new row violates row-level security policy for table "pieces"', code: '42501' }

  it('knows a row-level-security refusal by its code or its words', () => {
    expect(isRlsRefusal(refusal)).toBe(true)
    expect(isRlsRefusal({ message: 'new row violates row-level security policy' })).toBe(true)
    expect(isRlsRefusal({ message: 'duplicate key' })).toBe(false)
  })

  // The 0015 triggers name the limit in the error (final review C1), so nothing is re-read; the re-read stays for a refusal without a key.
  it('takes the limit from a plan_limit error without reading the plan again', async () => {
    const deadPort = { ...sb.port, rpc: () => Promise.reject(new Error('the plan must not be read')) } as typeof sb.port
    const error = { message: 'plan_limit:pieces_stored_max', code: '23514' }
    const piece = await refusalOf(deadPort, error, { type: 'createPiece' })
    expect(piece).toBeInstanceOf(PlanLimitError)
    expect((piece as PlanLimitError).limit).toBe('pieces_stored_max')
    const part = await partRefusalOf(deadPort, { message: 'plan_limit:parts_per_piece_max', code: '23514' }, PIECE, false)
    expect(part).toBeInstanceOf(PlanLimitError)
    expect((part as PlanLimitError).limit).toBe('parts_per_piece_max')
  })

  it('a real refused insert (a bulk one past the made limit) arrives as a PlanLimitError naming pieces_created_max', async () => {
    const rows = ['f4', 'f5'].map((n) => ({ id: `00000000-0000-4000-8000-0000000000${n}`, title: 'Bulk' }))
    const { error } = await sb.port.from('pieces').insert(rows)
    expect(error).not.toBeNull()
    const refusal = await refusalOf(sb.port, error!, { type: 'createPiece' })
    expect(refusal).toBeInstanceOf(PlanLimitError)
    expect((refusal as PlanLimitError).limit).toBe('pieces_created_max')
  })

  it('names the first refused check of createPiece from a fresh read of the plan', async () => {
    const limit = async () => ((await refusalOf(sb.port, refusal, { type: 'createPiece' })) as PlanLimitError).limit
    await db.exec(`insert into public.pieces (owner_id, title) values ('${TRIAL}', 'Three')`) // 3 made
    expect(await limit()).toBe('pieces_created_max')
    await db.exec("update public.plans set new_pieces_per_day = 1 where id = 'trial'")
    expect(await limit()).toBe('new_pieces_per_day')
    await db.exec("update public.plans set new_pieces_per_day = 20, new_pieces_paused = true where id = 'trial'")
    expect(await limit()).toBe('new_pieces_paused')
    await db.exec("update public.plans set new_pieces_paused = false where id = 'trial'")
  })

  it('stored comes after made: made allows, stored does not', async () => {
    await db.exec("update public.plans set pieces_created_max = null, pieces_stored_max = 2 where id = 'trial'")
    try {
      expect(((await refusalOf(sb.port, refusal, { type: 'createPiece' })) as PlanLimitError).limit).toBe('pieces_stored_max')
    } finally {
      await db.exec("update public.plans set pieces_created_max = 3, pieces_stored_max = 3 where id = 'trial'")
    }
  })

  it('leaves a refusal that is not the plan\'s, or one the plan now allows, as a plain error', async () => {
    expect(await refusalOf(sb.port, { message: 'offline' }, { type: 'createPiece' })).not.toBeInstanceOf(PlanLimitError)
    currentUser = ADMIN
    const error = await refusalOf(sb.port, refusal, { type: 'createPiece' })
    expect(error).not.toBeInstanceOf(PlanLimitError)
    expect(error.message).toBe(refusal.message)
  })

  it('names parts_per_piece_max for a second part and advanced_reading for a tick', async () => {
    const part = { message: 'new row violates row-level security policy for table "score_files"', code: '42501' }
    expect(((await partRefusalOf(sb.port, part, PIECE, false)) as PlanLimitError).limit).toBe('parts_per_piece_max')
    await db.exec("update public.plans set parts_per_piece_max = 5 where id = 'trial'")
    try {
      expect(((await partRefusalOf(sb.port, part, PIECE, true)) as PlanLimitError).limit).toBe('advanced_reading')
      expect(await partRefusalOf(sb.port, part, PIECE, false)).not.toBeInstanceOf(PlanLimitError)
    } finally {
      await db.exec("update public.plans set parts_per_piece_max = 1 where id = 'trial'")
    }
  })

  it('a plan that cannot be read leaves the refusal as it came', async () => {
    const broken = { ...sb.port, rpc: async () => ({ data: null, error: { message: 'offline' } }) } as unknown as typeof sb.port
    expect((await refusalOf(broken, refusal, { type: 'createPiece' })).message).toBe(refusal.message)
  })
})

describe('readPlan', () => {
  it('sends the piece as target_piece only when given', async () => {
    const seen: Array<Record<string, unknown> | undefined> = []
    const port = { ...sb.port, rpc: async (name: string, args?: Record<string, unknown>) => (seen.push(args), sb.port.rpc<PlanState>(name, args)) } as unknown as typeof sb.port
    await readPlan(port)
    await readPlan(port, PIECE)
    expect(seen).toEqual([{}, { target_piece: PIECE }])
  })
})
