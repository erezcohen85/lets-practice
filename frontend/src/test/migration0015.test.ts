// @vitest-environment node
import { type PGlite } from '@electric-sql/pglite'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PLAN_LIMITS } from '@/domain/planLimits'
import { applyMigration, asService, asUser, databaseWithMigrations } from '@/test/supabaseStandIn'

const ADMIN = '00000000-0000-4000-8000-0000000000a0'
const TRIAL = '00000000-0000-4000-8000-0000000000a1'
const CREATOR = '00000000-0000-4000-8000-0000000000a2'
const UNCONFIRMED = '00000000-0000-4000-8000-0000000000a3'
const TRIAL_TWO = '00000000-0000-4000-8000-0000000000a4'
const LEGACY = '00000000-0000-4000-8000-0000000000a5'
const STRAY = '00000000-0000-4000-8000-0000000000a6'
const M = Array.from({ length: 3 }, (_, i) => `00000000-0000-4000-8000-0000000001${String(i).padStart(2, '0')}`)
const pieceId = (n: number) => `00000000-0000-4000-8000-0000000003${String(n).padStart(2, '0')}`
const partId = (n: number) => `00000000-0000-4000-8000-0000000004${String(n).padStart(2, '0')}`
const LEGACY_PIECES = [pieceId(90), pieceId(91)]
const STRAY_PIECE = pieceId(92)

let db: PGlite

// Migration 0015, plans and usage limits (Erez, 2026-11-08): every user is on a named plan, Trial by default, and the plan's
// numbers decide what the database accepts. The base is the world as 0014 left it (a creator list, three pieces), migrated
// once; each test works on a copy of it.
let base: PGlite
beforeAll(async () => {
  base = await databaseWithMigrations('', '0014')
  await base.exec(`
    insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
      ('${ADMIN}', 'admin@example.com', now(), '{"full_name":"The Admin"}'),
      ('${TRIAL}', 'Trial@Example.com', now(), '{"full_name":"Tess Trial"}'),
      ('${CREATOR}', 'creator@example.com', now(), '{"full_name":"Cleo Creator"}'),
      ('${UNCONFIRMED}', 'unconfirmed@example.com', null, '{}'),
      ('${TRIAL_TWO}', 'trial2@example.com', now(), '{}'),
      ('${LEGACY}', 'legacy@example.com', now(), '{}'),
      ('${STRAY}', 'stray@example.com', now(), '{}'),
      ${M.map((id, i) => `('${id}', 'm${i}@example.com', now(), '{}')`).join(',\n      ')};
    insert into public.admins (user_id) values ('${ADMIN}');
    insert into public.creator_emails (email, added_by, added_at) values
      ('creator@example.com', '${ADMIN}', '2026-10-01T10:00:00Z'),
      ('unconfirmed@example.com', '${ADMIN}', '2026-10-02T10:00:00Z'),
      ('legacy@example.com', '${ADMIN}', '2026-10-03T10:00:00Z');
    insert into public.pieces (id, owner_id, title, created_at) values
      ('${LEGACY_PIECES[0]}', '${LEGACY}', 'Etude', '2026-09-01T10:00:00Z'),
      ('${LEGACY_PIECES[1]}', '${LEGACY}', 'Waltz', '2026-09-02T10:00:00Z'),
      ('${STRAY_PIECE}', '${STRAY}', 'Prelude', '2026-09-03T10:00:00Z');
  `)
  await applyMigration(base, '0015')
  await applyMigration(base, '0016')
  await applyMigration(base, '0017')
  await base.exec(`insert into public.plan_emails (email, plan_id) values ('later@example.com', 'creator')`)
}, 120_000)
beforeEach(async () => {
  db = (await base.clone()) as PGlite
})
afterEach(async () => {
  await db.close()
})

const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows
const one = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await q<T>(sql, params))[0]!

/** One piece for a user, through their own login and so through the policies. */
const makePiece = (user: string, id: string, title = 'Piece') => asUser(db, user, 'insert into public.pieces (id, title) values ($1, $2)', [id, title])
const makePart = (user: string, piece: string, id: string, ticked = false) =>
  asUser(
    db,
    user,
    `insert into public.score_files (id, piece_id, storage_path, sha256, page_count, name, box_check) values ($1, $2, 'p', 'x', 1, 'Part', $3)`,
    [id, piece, ticked],
  )
const linkOn = async (user: string, piece: string) => {
  await asUser(db, user, 'select * from public.create_or_get_share($1)', [piece])
  await asUser(db, user, 'select public.set_share_enabled($1, true, true)', [piece])
}
const myPlan = (user: string, piece: string | null = null) => asUser<{ p: PlanState }>(db, user, 'select public.my_plan($1) as p', [piece]).then((rows) => rows[0]!.p)
const setPlan = (id: string, set: string) => db.exec(`update public.plans set ${set} where id = '${id}'`)
const REFUSED = /row-level security/
/** A plan refusal from the database names its limit: 'plan_limit:<key>' (the triggers of 0015). */
const refusedFor = (key: string) => new RegExp(`plan_limit:${key}`)

type PlanState = {
  is_admin: boolean
  plan: Record<string, unknown> & { id: string }
  usage: Record<string, number>
  piece: { id: string; parts: number; realigns: number; read_again_by_part: Record<string, number> } | null
}
type Overview = {
  plans: (Record<string, unknown> & { id: string; people: number; new_pieces_today: number })[]
  people: { email: string; display_name: string | null; signed_up: boolean; last_sign_in_at: string | null; plan_id: string; assigned: boolean; assigned_plan_id: string | null; is_admin: boolean; added_at: string | null; pieces_created: number; pieces_stored: number; shared_pieces: number }[]
}

describe('the plans and what 0014 left behind', () => {
  it('has the three plans with the seed values', async () => {
    const none = null
    expect(await q('select * from public.plans order by position')).toEqual([
      {
        id: 'trial', name: 'Trial', position: 0, pieces_created_max: 3, pieces_stored_max: 3, parts_per_piece_max: 1, pages_per_part_max: 20,
        recording_minutes_max: 10, advanced_reading: false, advanced_reading_parts_per_month: 0, split_pdf: false, suggest_name: true,
        shared_pieces_max: 1, members_per_piece: 30, members_per_part: 10, read_again_per_part_max: 2, realign_per_piece_max: 5,
        new_pieces_per_day: 20, new_pieces_paused: false,
      },
      {
        id: 'creator', name: 'Creator', position: 1, pieces_created_max: none, pieces_stored_max: 50, parts_per_piece_max: none, pages_per_part_max: 100,
        recording_minutes_max: 20, advanced_reading: true, advanced_reading_parts_per_month: 30, split_pdf: true, suggest_name: true,
        shared_pieces_max: none, members_per_piece: 30, members_per_part: 10, read_again_per_part_max: 10, realign_per_piece_max: none,
        new_pieces_per_day: none, new_pieces_paused: false,
      },
      {
        id: 'unlimited', name: 'Unlimited', position: 2, pieces_created_max: none, pieces_stored_max: none, parts_per_piece_max: none, pages_per_part_max: 100,
        recording_minutes_max: 20, advanced_reading: true, advanced_reading_parts_per_month: none, split_pdf: true, suggest_name: true,
        shared_pieces_max: none, members_per_piece: 30, members_per_part: 10, read_again_per_part_max: none, realign_per_piece_max: none,
        new_pieces_per_day: none, new_pieces_paused: false,
      },
    ])
  })

  it('moved the creator list to plan_emails as creator rows, dropped it and its four functions, and gave every piece one event', async () => {
    expect(await q('select email, plan_id, added_by from public.plan_emails where email <> $1 order by email', ['later@example.com'])).toEqual([
      { email: 'creator@example.com', plan_id: 'creator', added_by: ADMIN },
      { email: 'legacy@example.com', plan_id: 'creator', added_by: ADMIN },
      { email: 'unconfirmed@example.com', plan_id: 'creator', added_by: ADMIN },
    ])
    expect((await one<{ at: string }>(`select added_at::text as at from public.plan_emails where email = 'creator@example.com'`)).at).toMatch(/^2026-10-01 10:00:00/)
    expect((await one<{ t: string | null }>(`select to_regclass('public.creator_emails')::text as t`)).t).toBeNull()
    expect(await q(`select proname from pg_proc where proname in ('list_creators', 'add_creator', 'remove_creator', 'set_creator_limits')`)).toEqual([])

    const events = await q('select user_id, kind, plan_id, piece_id, at::text as at, voided_at from public.usage_events order by piece_id')
    expect(events).toHaveLength(3)
    expect(events.map((e) => [e.user_id, e.kind, e.plan_id, e.piece_id, e.voided_at])).toEqual([
      [LEGACY, 'piece_created', 'creator', LEGACY_PIECES[0], null],
      [LEGACY, 'piece_created', 'creator', LEGACY_PIECES[1], null],
      [STRAY, 'piece_created', 'trial', STRAY_PIECE, null],
    ])
    expect(events[0]!.at).toMatch(/^2026-09-01 10:00:00/)
  })

  it('logs a piece_created event for each new piece, with the owner\'s plan', async () => {
    await makePiece(TRIAL, pieceId(1))
    await makePiece(CREATOR, pieceId(2))
    expect(await q(`select user_id, plan_id from public.usage_events where piece_id in ($1, $2) order by plan_id`, [pieceId(1), pieceId(2)])).toEqual([
      { user_id: CREATOR, plan_id: 'creator' },
      { user_id: TRIAL, plan_id: 'trial' },
    ])
  })
})

describe('my_plan', () => {
  it('for a Trial user: the plan, usage after 2 pieces and 1 shared, and the piece block counting parts, realigns and read-agains', async () => {
    await makePiece(TRIAL, pieceId(1))
    await makePiece(TRIAL, pieceId(2))
    await linkOn(TRIAL, pieceId(1))
    await makePart(TRIAL, pieceId(1), partId(1))
    await asService(db, `select public.service_record_usage($1, 'realign', $2, null, 2)`, [TRIAL, pieceId(1)])
    await asService(db, `select public.service_record_usage($1, 'read_again', $2, $3, 1)`, [TRIAL, pieceId(1), partId(1)])
    await asService(db, `select public.service_record_usage($1, 'read_again', $2, $3, 1)`, [TRIAL, pieceId(1), partId(2)])
    await asService(db, `select public.service_record_usage($1, 'realign', $2, null, 1)`, [TRIAL, pieceId(2)])

    const state = await myPlan(TRIAL, pieceId(1))

    expect(state.is_admin).toBe(false)
    expect(state.plan).toEqual((await one('select * from public.plans where id = $1', ['trial'])))
    expect(state.usage).toEqual({
      pieces_created: 2,
      pieces_stored: 2,
      shared_pieces: 1,
      advanced_reading_parts_this_month: 0,
      new_pieces_today_on_plan: 2,
    })
    expect(state.piece).toEqual({ id: pieceId(1), parts: 1, realigns: 2, read_again_by_part: { [partId(1)]: 1, [partId(2)]: 1 } })
    expect((await myPlan(TRIAL)).piece).toBeNull()
  })

  it('gives piece: null for another user\'s piece and for an unknown one', async () => {
    await makePiece(CREATOR, pieceId(1))
    expect((await myPlan(TRIAL, pieceId(1))).piece).toBeNull()
    expect((await myPlan(TRIAL, pieceId(77))).piece).toBeNull()
  })

  it('is Creator for a confirmed creator email, Trial for an unconfirmed one, and Unlimited with is_admin for the admin', async () => {
    expect(await myPlan(CREATOR)).toMatchObject({ is_admin: false, plan: { id: 'creator', name: 'Creator' } })
    expect(await myPlan(UNCONFIRMED)).toMatchObject({ is_admin: false, plan: { id: 'trial' } })
    expect(await myPlan(ADMIN)).toMatchObject({ is_admin: true, plan: { id: 'unlimited' } })
    await db.exec(`insert into public.plan_emails (email, plan_id) values ('admin@example.com', 'trial')`)
    expect(await myPlan(ADMIN)).toMatchObject({ is_admin: true, plan: { id: 'unlimited' } })
  })

  it('counts Advanced Reading parts from the 1st of this UTC month and ignores older ones', async () => {
    await asService(db, `select public.service_record_usage($1, 'advanced_reading_part', null, null, 3)`, [CREATOR])
    await db.query(`insert into public.usage_events (user_id, kind, plan_id, at) values ($1, 'advanced_reading_part', 'creator', now() - interval '40 days')`, [CREATOR])
    expect((await myPlan(CREATOR)).usage.advanced_reading_parts_this_month).toBe(3)
  })

  it('is refused to anon', async () => {
    await db.exec('set role anon')
    try {
      await expect(db.query('select public.my_plan()')).rejects.toThrow(/permission denied/)
    } finally {
      await db.exec('reset role')
    }
  })
})

describe('creating pieces', () => {
  it('lets a Trial user make 3 pieces and refuses the 4th; deleting one does not let a 4th in', async () => {
    for (const n of [1, 2, 3]) await makePiece(TRIAL, pieceId(n))
    await expect(makePiece(TRIAL, pieceId(4))).rejects.toThrow(refusedFor('pieces_created_max'))

    await asUser(db, TRIAL, 'delete from public.pieces where id = $1', [pieceId(1)])

    expect((await myPlan(TRIAL)).usage).toMatchObject({ pieces_created: 3, pieces_stored: 2 })
    await expect(makePiece(TRIAL, pieceId(4))).rejects.toThrow(refusedFor('pieces_created_max'))
  })

  it('counts pieces stored: a Creator with a stored maximum of 2 is refused a 3rd, and may add again after deleting one', async () => {
    await setPlan('creator', 'pieces_stored_max = 2')
    await makePiece(CREATOR, pieceId(1))
    await makePiece(CREATOR, pieceId(2))
    await expect(makePiece(CREATOR, pieceId(3))).rejects.toThrow(refusedFor('pieces_stored_max'))

    await asUser(db, CREATOR, 'delete from public.pieces where id = $1', [pieceId(1)])

    await makePiece(CREATOR, pieceId(3))
  })

  it('refuses a Trial user while new pieces are paused on Trial, and not a Creator', async () => {
    await setPlan('trial', 'new_pieces_paused = true')
    await expect(makePiece(TRIAL, pieceId(1))).rejects.toThrow(refusedFor('new_pieces_paused'))
    await makePiece(CREATOR, pieceId(2))
  })

  it('caps the plan per UTC day: a second Trial user is refused after the cap, and a voided event does not count', async () => {
    await setPlan('trial', 'new_pieces_per_day = 1')
    await makePiece(TRIAL, pieceId(1))
    await expect(makePiece(TRIAL_TWO, pieceId(2))).rejects.toThrow(refusedFor('new_pieces_per_day'))
    // The first processing was refused, so the slot comes back.
    await asService(db, 'select public.service_void_piece_created($1)', [pieceId(1)])

    await makePiece(TRIAL_TWO, pieceId(2))
    expect((await myPlan(TRIAL)).usage).toMatchObject({ pieces_created: 0, new_pieces_today_on_plan: 1 })
  })

  it('does not count a piece made on an earlier UTC day against the daily cap', async () => {
    await setPlan('trial', 'new_pieces_per_day = 1')
    await db.query(`insert into public.usage_events (user_id, kind, plan_id, at) values ($1, 'piece_created', 'trial', now() - interval '1 day 1 hour')`, [TRIAL_TWO])
    await makePiece(TRIAL, pieceId(1))
  })

  it('lets the admin past every limit, paused included', async () => {
    await db.exec(`update public.plans set pieces_created_max = 0, pieces_stored_max = 0, new_pieces_per_day = 0, new_pieces_paused = true`)
    for (const n of [1, 2, 3, 4]) await makePiece(ADMIN, pieceId(n))
    await expect(makePiece(TRIAL, pieceId(5))).rejects.toThrow(refusedFor('new_pieces_paused'))
  })

  it('a piece cannot be made for someone else', async () => {
    await expect(asUser(db, TRIAL, 'insert into public.pieces (id, owner_id, title) values ($1, $2, $3)', [pieceId(1), CREATOR, 'x'])).rejects.toThrow(REFUSED)
    expect(await q('select 1 from public.usage_events where piece_id = $1', [pieceId(1)])).toEqual([])
  })

  // C1 of the final review: a policy that asks a stable function sees the counts from the start of the statement, so one
  // multi-row INSERT got past every limit. The checks are a before-insert trigger now, which sees the rows already written.
  const bulk = (user: string, ids: string[]) =>
    asUser(db, user, `insert into public.pieces (id, title) values ${ids.map((_, i) => `($${i + 1}, 'Bulk')`).join(', ')}`, ids)
  const rowsOf = (user: string) => q<{ n: number }>('select (select count(*) from public.pieces where owner_id = $1)::int as n, (select count(*) from public.usage_events where user_id = $1 and kind = $2)::int as e', [user, 'piece_created'])

  it('refuses a 4-row insert by a Trial user whole: no piece and no event', async () => {
    await expect(bulk(TRIAL, [1, 2, 3, 4].map(pieceId))).rejects.toThrow(refusedFor('pieces_created_max'))
    expect(await rowsOf(TRIAL)).toEqual([{ n: 0, e: 0 }])
  })

  it('lets a 3-row insert by a Trial user through and counts all three', async () => {
    await bulk(TRIAL, [1, 2, 3].map(pieceId))
    expect(await rowsOf(TRIAL)).toEqual([{ n: 3, e: 3 }])
    expect((await myPlan(TRIAL)).usage).toMatchObject({ pieces_created: 3, pieces_stored: 3, new_pieces_today_on_plan: 3 })
  })

  it('refuses a bulk insert that passes the made limit with one piece already there', async () => {
    await makePiece(TRIAL, pieceId(1))
    await expect(bulk(TRIAL, [2, 3, 4].map(pieceId))).rejects.toThrow(refusedFor('pieces_created_max'))
    expect(await rowsOf(TRIAL)).toEqual([{ n: 1, e: 1 }])
  })

  it('refuses a bulk insert past pieces stored (a Creator maximum of 2), and past the plan-wide daily cap', async () => {
    await setPlan('creator', 'pieces_stored_max = 2')
    await expect(bulk(CREATOR, [1, 2, 3].map(pieceId))).rejects.toThrow(refusedFor('pieces_stored_max'))
    await setPlan('trial', 'new_pieces_per_day = 2')
    await makePiece(TRIAL_TWO, pieceId(4))
    await expect(bulk(TRIAL, [5, 6].map(pieceId))).rejects.toThrow(refusedFor('new_pieces_per_day'))
    expect(await rowsOf(TRIAL)).toEqual([{ n: 0, e: 0 }])
  })

  it('lets the admin and a Creator without limits insert many at once', async () => {
    await db.exec(`update public.plans set pieces_created_max = 0, pieces_stored_max = 0, new_pieces_per_day = 0, new_pieces_paused = true`)
    await bulk(ADMIN, [1, 2, 3, 4, 5].map(pieceId))
    await db.exec(`update public.plans set pieces_created_max = null, pieces_stored_max = null, new_pieces_per_day = null, new_pieces_paused = false where id = 'creator'`)
    await bulk(CREATOR, [6, 7, 8, 9, 10].map(pieceId))
  })

  it('writes no event for an insert that does nothing (on conflict do nothing on an id that exists)', async () => {
    await makePiece(TRIAL, pieceId(1))
    await asUser(db, TRIAL, `insert into public.pieces (id, title) values ($1, 'again') on conflict do nothing`, [pieceId(1)])
    expect(await rowsOf(TRIAL)).toEqual([{ n: 1, e: 1 }])
  })

  // PGlite is one connection in one process, so two transactions at once cannot be run here. What can be checked is that
  // the checks take the per-user lock (and, for the daily cap, the per-plan lock) that makes a second transaction wait.
  it('takes the per-user lock before counting, and the per-plan lock for the daily cap (a second transaction waits its turn)', async () => {
    const source = async (name: string) => (await one<{ src: string }>(`select prosrc as src from pg_proc where proname = $1`, [name])).src
    const piece = await source('enforce_piece_limits')
    expect(piece).toContain("pg_advisory_xact_lock(hashtextextended('plan-user:'")
    expect(piece).toContain("pg_advisory_xact_lock(hashtextextended('plan-day:'")
    expect(piece.indexOf('plan-user:')).toBeLessThan(piece.indexOf('count('))
    expect(await source('enforce_part_limits')).toMatch(/for no key update/)
    expect(await source('set_share_enabled')).toContain("pg_advisory_xact_lock(hashtextextended('plan-user:'")
  })
})

describe('parts', () => {
  beforeEach(async () => {
    await makePiece(TRIAL, pieceId(1))
    await makePiece(CREATOR, pieceId(2))
  })

  it('lets a Trial user add 1 part to a piece, not 2; a Creator has no maximum', async () => {
    await makePart(TRIAL, pieceId(1), partId(1))
    await expect(makePart(TRIAL, pieceId(1), partId(2))).rejects.toThrow(refusedFor('parts_per_piece_max'))
    for (const n of [1, 2, 3, 4]) await makePart(CREATOR, pieceId(2), partId(10 + n))
  })

  const partRow = (n: number, piece: string) => `('${partId(n)}', '${piece}', 'p', 'x', 1, 'Part', false)`
  const bulkParts = (user: string, rows: string[]) =>
    asUser(db, user, `insert into public.score_files (id, piece_id, storage_path, sha256, page_count, name, box_check) values ${rows.join(', ')}`)

  it('refuses a 2-row insert of parts on a Trial piece whole (one insert used to put 5 on it), and a Creator piece takes several', async () => {
    await expect(bulkParts(TRIAL, [partRow(1, pieceId(1)), partRow(2, pieceId(1))])).rejects.toThrow(refusedFor('parts_per_piece_max'))
    expect(await q('select 1 from public.score_files')).toEqual([])
    await bulkParts(CREATOR, [1, 2, 3, 4, 5].map((n) => partRow(10 + n, pieceId(2))))
  })

  it('refuses a ticked part in a bulk insert for Trial, naming advanced_reading', async () => {
    await expect(makePart(TRIAL, pieceId(1), partId(1), true)).rejects.toThrow(refusedFor('advanced_reading'))
  })

  it('refuses moving a part to another piece for a signed-in user; the service role may', async () => {
    await makePiece(TRIAL, pieceId(3))
    await makePart(TRIAL, pieceId(1), partId(1))
    await makePart(TRIAL, pieceId(3), partId(3))
    await expect(asUser(db, TRIAL, 'update public.score_files set piece_id = $1 where id = $2', [pieceId(1), partId(3)])).rejects.toThrow(/cannot be moved/)
    await makePiece(CREATOR, pieceId(4))
    await makePart(CREATOR, pieceId(2), partId(5))
    await expect(asUser(db, CREATOR, 'update public.score_files set piece_id = $1 where id = $2', [pieceId(4), partId(5)])).rejects.toThrow(/cannot be moved/)
    expect(await q('select piece_id from public.score_files where id = $1', [partId(3)])).toEqual([{ piece_id: pieceId(3) }])
    // Anything else on the part is still theirs to change, and setting piece_id to what it is is no move.
    await asUser(db, TRIAL, `update public.score_files set name = 'Renamed', piece_id = $1 where id = $2`, [pieceId(3), partId(3)])
    await db.exec('set role service_role')
    try {
      await db.query('update public.score_files set piece_id = $1 where id = $2', [pieceId(1), partId(3)])
    } finally {
      await db.exec('reset role')
    }
    expect(await q('select piece_id from public.score_files where id = $1', [partId(3)])).toEqual([{ piece_id: pieceId(1) }])
  })

  it('refuses a ticked Advanced Reading part for Trial and allows it for a Creator', async () => {
    await expect(makePart(TRIAL, pieceId(1), partId(1), true)).rejects.toThrow(refusedFor('advanced_reading'))
    await makePart(CREATOR, pieceId(2), partId(2), true)
  })

  it('refuses a part in a piece that is not the caller\'s', async () => {
    await expect(makePart(TRIAL, pieceId(2), partId(1))).rejects.toThrow(REFUSED)
  })

  it('refuses turning the tick on for Trial and allows it for a Creator; unticking is always allowed', async () => {
    await makePart(TRIAL, pieceId(1), partId(1))
    await makePart(CREATOR, pieceId(2), partId(2))
    await expect(asUser(db, TRIAL, 'update public.score_files set box_check = true where id = $1', [partId(1)])).rejects.toThrow(refusedFor('advanced_reading'))
    await asUser(db, CREATOR, 'update public.score_files set box_check = true where id = $1', [partId(2)])
    await asUser(db, CREATOR, 'update public.score_files set box_check = false where id = $1', [partId(2)])
    expect(await q('select box_check from public.score_files where id = $1', [partId(1)])).toEqual([{ box_check: false }])
  })

  it('does not check the service role, which has no login', async () => {
    await makePart(TRIAL, pieceId(1), partId(1))
    await db.exec(`update public.score_files set box_check = true where id = '${partId(1)}'`)
    expect(await q('select box_check from public.score_files where id = $1', [partId(1)])).toEqual([{ box_check: true }])
  })
})

describe('storage', () => {
  const upload = (user: string, name: string) => asUser(db, user, `insert into storage.objects (bucket_id, name, owner) values ('pieces', $1, $2)`, [name, user])
  const seedObjects = (user: string, count: number) =>
    db.query(`insert into storage.objects (bucket_id, name, owner) select 'pieces', $1 || '/staging/seed-' || i, $1::uuid from generate_series(1, $2::int) i`, [user, count])

  beforeEach(async () => {
    await makePiece(TRIAL, pieceId(1))
    await makePiece(CREATOR, pieceId(2))
    await makePiece(ADMIN, pieceId(3))
  })

  it('lets a Trial user upload under their own piece and under staging', async () => {
    await upload(TRIAL, `${TRIAL}/${pieceId(1)}/parts/a.pdf`)
    await upload(TRIAL, `${TRIAL}/staging/b.pdf`)
  })

  it('refuses another user\'s folder, a piece the user does not own, an unknown piece and a path without a second folder', async () => {
    await expect(upload(TRIAL, `${CREATOR}/staging/x.pdf`)).rejects.toThrow(REFUSED)
    await expect(upload(TRIAL, `${TRIAL}/${pieceId(2)}/x.pdf`)).rejects.toThrow(REFUSED)
    await expect(upload(TRIAL, `${TRIAL}/${pieceId(99)}/x.pdf`)).rejects.toThrow(REFUSED)
    await expect(upload(TRIAL, `${TRIAL}/not-a-piece/x.pdf`)).rejects.toThrow(REFUSED)
    await expect(upload(TRIAL, `${TRIAL}/x.pdf`)).rejects.toThrow(REFUSED)
  })

  it('refuses the 501st object the user uploaded; objects without an owner (the processor\'s) do not count', async () => {
    await seedObjects(TRIAL, 499)
    await db.query(`insert into storage.objects (bucket_id, name) select 'pieces', $1 || '/' || $2 || '/page-' || i || '.png' from generate_series(1, 50) i`, [TRIAL, pieceId(1)])
    await upload(TRIAL, `${TRIAL}/${pieceId(1)}/parts/500th.pdf`)
    await expect(upload(TRIAL, `${TRIAL}/${pieceId(1)}/parts/501st.pdf`)).rejects.toThrow(REFUSED)
    await upload(CREATOR, `${CREATOR}/${pieceId(2)}/parts/a.pdf`)
  })

  it('lets the admin upload past 500', async () => {
    await seedObjects(ADMIN, 500)
    await upload(ADMIN, `${ADMIN}/${pieceId(3)}/parts/a.pdf`)
  })

  it('still lets a user read and delete only their own folder', async () => {
    await upload(TRIAL, `${TRIAL}/staging/b.pdf`)
    await upload(CREATOR, `${CREATOR}/staging/c.pdf`)
    expect(await asUser(db, TRIAL, 'select name from storage.objects')).toEqual([{ name: `${TRIAL}/staging/b.pdf` }])
  })
})

describe('sharing', () => {
  beforeEach(async () => {
    for (const n of [1, 2, 3]) {
      await makePiece(TRIAL, pieceId(n))
      await asUser(db, TRIAL, 'select * from public.create_or_get_share($1)', [pieceId(n)])
    }
  })
  const turn = (piece: string, on: boolean, user = TRIAL) => asUser(db, user, 'select public.set_share_enabled($1, $2, true)', [piece, on])

  it('lets a Trial user turn on one link; the second raises plan_limit:shared_pieces_max', async () => {
    await turn(pieceId(1), true)
    await expect(turn(pieceId(2), true)).rejects.toThrow(/plan_limit:shared_pieces_max/)
    expect(await q('select piece_id from public.piece_shares where enabled')).toEqual([{ piece_id: pieceId(1) }])
  })

  it('works for the second after the first is turned off; and turning an already-on link on again does not count twice', async () => {
    await turn(pieceId(1), true)
    await turn(pieceId(1), true)
    await turn(pieceId(1), false)
    await turn(pieceId(2), true)
    await turn(pieceId(2), true)
    await expect(turn(pieceId(3), true)).rejects.toThrow(/plan_limit:shared_pieces_max/)
  })

  it('turning a link off is never refused', async () => {
    await turn(pieceId(1), true)
    await setPlan('trial', 'shared_pieces_max = 0')
    await turn(pieceId(1), false)
  })

  it('is unlimited for the admin', async () => {
    for (const n of [4, 5, 6]) {
      await makePiece(ADMIN, pieceId(n))
      await asUser(db, ADMIN, 'select * from public.create_or_get_share($1)', [pieceId(n)])
      await turn(pieceId(n), true, ADMIN)
    }
    expect(await q('select piece_id from public.piece_shares where enabled order by piece_id')).toEqual([4, 5, 6].map((n) => ({ piece_id: pieceId(n) })))
  })

  it('still asks for the rights confirmation (0013) and still refuses a piece that is not the caller\'s', async () => {
    await expect(asUser(db, TRIAL, 'select public.set_share_enabled($1, true)', [pieceId(1)])).rejects.toThrow(/confirm the rights/)
    await expect(turn(pieceId(1), true, CREATOR)).rejects.toThrow(/not your piece/)
  })
})

describe('the member limit', () => {
  it('follows the owner\'s plan: with 2 members per piece on Trial the third joiner gets full', async () => {
    await setPlan('trial', 'members_per_piece = 2')
    await makePiece(TRIAL, pieceId(1))
    await linkOn(TRIAL, pieceId(1))
    const token = (await one<{ token: string }>('select token from public.piece_shares where piece_id = $1', [pieceId(1)])).token
    const join = async (user: string) => (await asUser<{ status: string }>(db, user, 'select * from public.join_piece($1)', [token]))[0]!.status

    expect(await join(M[0]!)).toBe('joined')
    expect(await join(M[1]!)).toBe('joined')
    expect(await join(M[2]!)).toBe('full')
  })

  it('is the larger of members_per_piece and members_per_part times the parts, from the owner\'s plan', async () => {
    await setPlan('creator', 'members_per_piece = 5, members_per_part = 4')
    await makePiece(CREATOR, pieceId(1))
    expect((await one<{ n: number }>('select public.piece_member_limit($1) as n', [pieceId(1)])).n).toBe(5)
    await makePart(CREATOR, pieceId(1), partId(1))
    await makePart(CREATOR, pieceId(1), partId(2))
    expect((await one<{ n: number }>('select public.piece_member_limit($1) as n', [pieceId(1)])).n).toBe(8)
  })
})

describe('delete_account', () => {
  // The hash is keyed since 0017 (a pepper in private_settings), so the test asks the database for it.
  const hashOf = async (email: string) => (await one<{ h: string }>('select public.email_hash($1) as h', [email])).h

  it('leaves a trial_ledger row with the email\'s hash and the pieces made; a new user on the same email starts there', async () => {
    await makePiece(TRIAL, pieceId(1))
    await makePiece(TRIAL, pieceId(2))
    // The app deletes the pieces first.
    await asUser(db, TRIAL, 'delete from public.pieces where owner_id = $1', [TRIAL])

    await asUser(db, TRIAL, 'select public.delete_account()')

    expect(await q('select email_hash, pieces_created from public.trial_ledger')).toEqual([{ email_hash: await hashOf('trial@example.com'), pieces_created: 2 }])
    expect(await q('select 1 from public.usage_events where user_id = $1', [TRIAL])).toEqual([])
    const again = '00000000-0000-4000-8000-0000000000b1'
    await db.query(`insert into auth.users (id, email, email_confirmed_at) values ($1, 'TRIAL@example.com', now())`, [again])
    expect((await myPlan(again)).usage.pieces_created).toBe(2)
    await expect(makePiece(again, pieceId(3))).resolves.toBeDefined()
    await expect(makePiece(again, pieceId(4))).rejects.toThrow(refusedFor('pieces_created_max'))
  })

  it('adds to an earlier ledger count the second time round, and writes nothing for an account that made no piece', async () => {
    await asUser(db, TRIAL_TWO, 'select public.delete_account()')
    expect(await q('select * from public.trial_ledger')).toEqual([])

    await db.query(`insert into public.trial_ledger (email_hash, pieces_created) values ($1, 1)`, [await hashOf('trial@example.com')])
    await makePiece(TRIAL, pieceId(1))
    await asUser(db, TRIAL, 'delete from public.pieces where owner_id = $1', [TRIAL])
    await asUser(db, TRIAL, 'select public.delete_account()')

    expect(await q('select pieces_created from public.trial_ledger')).toEqual([{ pieces_created: 2 }])
  })

  it('does not count a voided piece', async () => {
    await makePiece(TRIAL, pieceId(1))
    await asService(db, 'select public.service_void_piece_created($1)', [pieceId(1)])
    await asUser(db, TRIAL, 'delete from public.pieces where owner_id = $1', [TRIAL])
    await asUser(db, TRIAL, 'select public.delete_account()')
    expect(await q('select * from public.trial_ledger')).toEqual([])
  })

  it('still refuses while the caller owns a piece, and the admin', async () => {
    await makePiece(TRIAL, pieceId(1))
    await expect(asUser(db, TRIAL, 'select public.delete_account()')).rejects.toThrow(/delete your pieces first/)
    await expect(asUser(db, ADMIN, 'select public.delete_account()')).rejects.toThrow(/admin cannot delete/)
  })
})

describe('admin_overview', () => {
  const overview = () => asUser<{ o: Overview }>(db, ADMIN, 'select public.admin_overview() as o').then((rows) => rows[0]!.o)

  it('is refused to people who are not the admin', async () => {
    for (const user of [TRIAL, CREATOR]) {
      await expect(asUser(db, user, 'select public.admin_overview()'), user).rejects.toThrow(/admin only/)
    }
  })

  it('lists the three plans with people counts and today\'s new pieces', async () => {
    await makePiece(TRIAL, pieceId(1))
    await makePiece(TRIAL_TWO, pieceId(2))
    await makePiece(CREATOR, pieceId(3))

    const { plans } = await overview()

    expect(plans.map((p) => p.id)).toEqual(['trial', 'creator', 'unlimited'])
    expect(plans[0]).toMatchObject({ name: 'Trial', pieces_created_max: 3, people: 7, new_pieces_today: 2 })
    // creator, legacy, and later@example.com who has not signed up
    expect(plans[1]).toMatchObject({ name: 'Creator', people: 3, new_pieces_today: 1 })
    expect(plans[2]).toMatchObject({ name: 'Unlimited', people: 1, new_pieces_today: 0 })
  })

  it('lists people: everyone signed up, and a plan_emails email nobody signed up with yet', async () => {
    await db.exec(`update auth.users set last_sign_in_at = '2026-11-08T06:12:00Z' where id = '${TRIAL}'`)
    await makePiece(TRIAL, pieceId(1))
    await linkOn(TRIAL, pieceId(1))

    const { people } = await overview()
    const by = (email: string) => people.find((p) => p.email === email)

    expect(people).toHaveLength(11)
    expect(by('trial@example.com')).toMatchObject({
      display_name: 'Tess Trial', signed_up: true, plan_id: 'trial', assigned: false, assigned_plan_id: null, is_admin: false, added_at: null,
      pieces_created: 1, pieces_stored: 1, shared_pieces: 1,
    })
    expect(new Date(by('trial@example.com')!.last_sign_in_at!).toISOString()).toBe('2026-11-08T06:12:00.000Z')
    expect(by('creator@example.com')).toMatchObject({ plan_id: 'creator', assigned: true, assigned_plan_id: 'creator', signed_up: true })
    expect(by('admin@example.com')).toMatchObject({ plan_id: 'unlimited', is_admin: true })
    expect(by('unconfirmed@example.com')).toMatchObject({ plan_id: 'trial', assigned: true, assigned_plan_id: 'creator' })
    expect(by('later@example.com')).toEqual({
      email: 'later@example.com', display_name: null, signed_up: false, last_sign_in_at: null, plan_id: 'creator', assigned: true, assigned_plan_id: 'creator',
      is_admin: false, added_at: expect.any(String), pieces_created: 0, pieces_stored: 0, shared_pieces: 0,
    })
  })
})

describe('save_admin_changes', () => {
  const save = (changes: unknown, user = ADMIN) => asUser(db, user, 'select public.save_admin_changes($1::jsonb)', [JSON.stringify(changes)])
  const trialMax = async () => (await one<{ n: number | null }>(`select pieces_created_max as n from public.plans where id = 'trial'`)).n
  const emails = async () => (await q<{ email: string; plan_id: string }>('select email, plan_id from public.plan_emails order by email'))

  it('applies plan numbers and people together', async () => {
    await save({
      plans: [
        { id: 'trial', pieces_created_max: 4, new_pieces_paused: true },
        { id: 'creator', realign_per_piece_max: 7, advanced_reading_parts_per_month: null },
      ],
      people: [
        { email: '  New@Example.com ', plan_id: 'unlimited' },
        { email: 'creator@example.com', plan_id: 'trial' },
        { email: 'later@example.com', remove: true },
      ],
    })

    expect(await one('select pieces_created_max, new_pieces_paused, pieces_stored_max from public.plans where id = $1', ['trial'])).toEqual({ pieces_created_max: 4, new_pieces_paused: true, pieces_stored_max: 3 })
    expect(await one('select realign_per_piece_max, advanced_reading_parts_per_month, pieces_stored_max from public.plans where id = $1', ['creator'])).toEqual({ realign_per_piece_max: 7, advanced_reading_parts_per_month: null, pieces_stored_max: 50 })
    expect((await emails()).map((e) => [e.email, e.plan_id])).toEqual([
      ['creator@example.com', 'trial'],
      ['legacy@example.com', 'creator'],
      ['new@example.com', 'unlimited'],
      ['unconfirmed@example.com', 'creator'],
    ])
    expect(await one('select added_by from public.plan_emails where email = $1', ['new@example.com'])).toEqual({ added_by: ADMIN })
    expect((await myPlan(CREATOR)).plan.id).toBe('trial')
  })

  it('saves nothing at all when one value is invalid, people included', async () => {
    const before = await emails()
    await expect(
      save({
        plans: [{ id: 'trial', pieces_created_max: 9 }, { id: 'creator', pages_per_part_max: 101 }],
        people: [{ email: 'fresh@example.com', plan_id: 'creator' }, { email: 'legacy@example.com', remove: true }],
      }),
    ).rejects.toThrow(/pages_per_part_max/)
    expect(await trialMax()).toBe(3)
    expect(await emails()).toEqual(before)
    // And a bad person after good plan numbers undoes the plan numbers too.
    await expect(save({ plans: [{ id: 'trial', pieces_created_max: 9 }], people: [{ email: 'nonsense', plan_id: 'creator' }] })).rejects.toThrow(/not an email/)
    expect(await trialMax()).toBe(3)
  })

  it.each([
    ['an unknown key', { plans: [{ id: 'trial', bogus: 1 }] }, /unknown key: bogus/],
    ['an unknown top-level key', { planz: [] }, /unknown key: planz/],
    ['an unknown plan', { plans: [{ id: 'gold', pieces_created_max: 1 }] }, /unknown plan: gold/],
    ['a new name', { plans: [{ id: 'trial', name: 'Free' }] }, /unknown key: name/],
    ['a new position', { plans: [{ id: 'trial', position: 5 }] }, /unknown key: position/],
    ['a plan change without an id', { plans: [{ pieces_created_max: 1 }] }, /needs an id/],
    ['a number given as text', { plans: [{ id: 'trial', pieces_created_max: '4' }] }, /whole number/],
    ['a fraction', { plans: [{ id: 'trial', pieces_created_max: 2.5 }] }, /whole number/],
    ['a switch given as a number', { plans: [{ id: 'trial', advanced_reading: 1 }] }, /true or false/],
    ['empty where a value is required', { plans: [{ id: 'trial', members_per_piece: null }] }, /cannot be empty/],
    ['a number below its column\'s bound', { plans: [{ id: 'trial', parts_per_piece_max: 0 }] }, /parts_per_piece_max/],
    ['a bad email', { people: [{ email: 'nonsense', plan_id: 'creator' }] }, /not an email/],
    ['an unknown plan for a person', { people: [{ email: 'a@example.com', plan_id: 'gold' }] }, /unknown plan: gold/],
    ['an unknown key for a person', { people: [{ email: 'a@example.com', plan_id: 'creator', admin: true }] }, /unknown key: admin/],
    ['both a plan and remove', { people: [{ email: 'a@example.com', plan_id: 'creator', remove: true }] }, /not both/],
    ['neither a plan nor remove', { people: [{ email: 'a@example.com' }] }, /not both and not neither/],
    ['the admin\'s own email assigned', { people: [{ email: 'Admin@Example.com', plan_id: 'trial' }] }, /admin cannot be changed/],
    ['the admin\'s own email removed', { people: [{ email: 'admin@example.com', remove: true }] }, /admin cannot be changed/],
  ])('refuses %s', async (_name, changes, message) => {
    const before = await emails()
    await expect(save(changes)).rejects.toThrow(message)
    expect(await trialMax()).toBe(3)
    expect(await emails()).toEqual(before)
  })

  it('keeps the member numbers of 0014 inside their bounds: 1 to 500 per piece, 0 to 100 per part', async () => {
    await save({ plans: [{ id: 'trial', members_per_piece: 1, members_per_part: 0 }, { id: 'creator', members_per_piece: 500, members_per_part: 100 }] })
    for (const change of [{ members_per_piece: 0 }, { members_per_piece: 501 }, { members_per_part: -1 }, { members_per_part: 101 }]) {
      await expect(save({ plans: [{ id: 'trial', ...change }] }), JSON.stringify(change)).rejects.toThrow(/check constraint/)
    }
    expect(await one('select members_per_piece, members_per_part from public.plans where id = $1', ['trial'])).toEqual({ members_per_piece: 1, members_per_part: 0 })
  })

  it('remove deletes the row; an email with no row is left as it is', async () => {
    await save({ people: [{ email: 'legacy@example.com', remove: true }, { email: 'nobody@example.com', remove: true }] })
    expect((await emails()).map((e) => e.email)).toEqual(['creator@example.com', 'later@example.com', 'unconfirmed@example.com'])
  })

  it('is refused to people who are not the admin, and changes nothing', async () => {
    for (const user of [TRIAL, CREATOR]) {
      await expect(save({ plans: [{ id: 'trial', pieces_created_max: 99 }] }, user), user).rejects.toThrow(/admin only/)
    }
    expect(await trialMax()).toBe(3)
  })
})

describe('the processor\'s functions', () => {
  it('service_plan_state equals my_plan for that user, with and without a piece', async () => {
    await makePiece(TRIAL, pieceId(1))
    await makePart(TRIAL, pieceId(1), partId(1))
    await asService(db, `select public.service_record_usage($1, 'read_again', $2, $3)`, [TRIAL, pieceId(1), partId(1)])

    for (const piece of [null, pieceId(1), pieceId(2)]) {
      const service = (await asService<{ s: PlanState }>(db, 'select public.service_plan_state($1, $2) as s', [TRIAL, piece]))[0]!.s
      expect(service).toEqual(await myPlan(TRIAL, piece))
    }
    const own = (await asService<{ s: PlanState }>(db, 'select public.service_plan_state($1) as s', [TRIAL]))[0]!.s
    expect(own.piece).toBeNull()
    const admin = (await asService<{ s: PlanState }>(db, 'select public.service_plan_state($1) as s', [ADMIN]))[0]!.s
    expect(admin).toMatchObject({ is_admin: true, plan: { id: 'unlimited' } })
  })

  it('service_plan_state gives no piece block for a piece that is another user\'s', async () => {
    await makePiece(CREATOR, pieceId(1))
    const s = (await asService<{ s: PlanState }>(db, 'select public.service_plan_state($1, $2) as s', [TRIAL, pieceId(1)]))[0]!.s
    expect(s.piece).toBeNull()
  })

  it('service_record_usage adds n events with the plan id of the user, one by default', async () => {
    await asService(db, `select public.service_record_usage($1, 'realign', $2, null, 3)`, [CREATOR, pieceId(1)])
    await asService(db, `select public.service_record_usage($1, 'advanced_reading_part', $2, $3)`, [TRIAL, pieceId(1), partId(1)])

    expect(await q(`select user_id, kind, plan_id, piece_id, part_id from public.usage_events where kind <> 'piece_created' order by kind`)).toEqual([
      { user_id: TRIAL, kind: 'advanced_reading_part', plan_id: 'trial', piece_id: pieceId(1), part_id: partId(1) },
      { user_id: CREATOR, kind: 'realign', plan_id: 'creator', piece_id: pieceId(1), part_id: null },
      { user_id: CREATOR, kind: 'realign', plan_id: 'creator', piece_id: pieceId(1), part_id: null },
      { user_id: CREATOR, kind: 'realign', plan_id: 'creator', piece_id: pieceId(1), part_id: null },
    ])
    await expect(asService(db, `select public.service_record_usage($1, 'nonsense', null, null)`, [TRIAL])).rejects.toThrow(/check constraint/)
  })

  it('service_void_piece_created voids that piece\'s event only', async () => {
    await makePiece(TRIAL, pieceId(1))
    await makePiece(TRIAL, pieceId(2))

    await asService(db, 'select public.service_void_piece_created($1)', [pieceId(1)])

    expect(await q('select piece_id, voided_at is not null as voided from public.usage_events where piece_id in ($1, $2) order by piece_id', [pieceId(1), pieceId(2)])).toEqual([
      { piece_id: pieceId(1), voided: true },
      { piece_id: pieceId(2), voided: false },
    ])
    expect((await myPlan(TRIAL)).usage.pieces_created).toBe(1)
  })

  describe('service_use_advanced_reading', () => {
    const use = (user: string, piece: string | null, parts: string[]) =>
      asService<{ r: string | null }>(db, 'select public.service_use_advanced_reading($1, $2, $3::uuid[]) as r', [user, piece, `{${parts.join(',')}}`]).then((rows) => rows[0]!.r)
    const events = () => q<{ part_id: string; piece_id: string; plan_id: string }>(`select part_id, piece_id, plan_id from public.usage_events where kind = 'advanced_reading_part' order by id`)

    it('records one event per part, in order, and returns null', async () => {
      expect(await use(CREATOR, pieceId(1), [partId(2), partId(1), partId(3)])).toBeNull()
      expect(await events()).toEqual([partId(2), partId(1), partId(3)].map((part_id) => ({ part_id, piece_id: pieceId(1), plan_id: 'creator' })))
    })

    it('refuses a plan without Advanced Reading, recording nothing', async () => {
      expect(await use(TRIAL, pieceId(1), [partId(1)])).toBe('advanced_reading')
      expect(await events()).toEqual([])
    })

    it('refuses past the month in one piece: 30 used, 2 more is refused whole, 1 more is taken', async () => {
      await asService(db, `select public.service_record_usage($1, 'advanced_reading_part', null, null, 29)`, [CREATOR])
      expect(await use(CREATOR, pieceId(1), [partId(1), partId(2)])).toBe('advanced_reading_parts_per_month')
      expect(await q('select 1 from public.usage_events where kind = $1', ['advanced_reading_part'])).toHaveLength(29)
      expect(await use(CREATOR, pieceId(1), [partId(1)])).toBeNull()
      expect(await use(CREATOR, pieceId(1), [partId(2)])).toBe('advanced_reading_parts_per_month')
    })

    it('counts the month from the 1st (UTC): older events do not count', async () => {
      await db.query(`insert into public.usage_events (user_id, kind, plan_id, at) select $1, 'advanced_reading_part', 'creator', now() - interval '40 days' from generate_series(1, 30)`, [CREATOR])
      expect(await use(CREATOR, pieceId(1), [partId(1)])).toBeNull()
    })

    it('never refuses the admin, takes an empty list as nothing to do, and is closed to the signed-in role', async () => {
      await db.exec(`update public.plans set advanced_reading_parts_per_month = 0 where id = 'unlimited'`)
      expect(await use(ADMIN, pieceId(1), [partId(1)])).toBeNull()
      expect(await use(CREATOR, pieceId(1), [])).toBeNull()
      expect(await events()).toHaveLength(1)
      await expect(asUser(db, CREATOR, `select public.service_use_advanced_reading('${CREATOR}', null, '{}')`)).rejects.toThrow(/permission denied/)
    })
  })

  // Option (b) of final review I2: a job-time refusal voids the piece's created event and keeps the piece; the next
  // process-piece claims the slot again (un-voids it) when the plan still has room.
  describe('service_claim_piece', () => {
    const claim = (piece: string) => asService<{ r: string | null }>(db, 'select public.service_claim_piece($1) as r', [piece]).then((rows) => rows[0]!.r)
    const voided = async (piece: string) => (await one<{ v: boolean }>(`select bool_and(voided_at is not null) as v from public.usage_events where piece_id = $1 and kind = 'piece_created'`, [piece])).v
    const give = (piece: string) => asService(db, 'select public.service_void_piece_created($1)', [piece])

    it('un-voids the event when there is room: the piece counts again', async () => {
      await makePiece(TRIAL, pieceId(1))
      await give(pieceId(1))
      expect((await myPlan(TRIAL)).usage.pieces_created).toBe(0)
      expect(await claim(pieceId(1))).toBeNull()
      expect(await voided(pieceId(1))).toBe(false)
      expect((await myPlan(TRIAL)).usage.pieces_created).toBe(1)
    })

    it('answers the limit key and leaves the event voided when pieces made ever is used up meanwhile', async () => {
      await setPlan('trial', 'pieces_stored_max = 10')
      for (const n of [1, 2, 3]) await makePiece(TRIAL, pieceId(n))
      await give(pieceId(1))
      await makePiece(TRIAL, pieceId(4)) // the freed slot is taken
      expect(await claim(pieceId(1))).toBe('pieces_created_max')
      expect(await voided(pieceId(1))).toBe(true)
      expect((await myPlan(TRIAL)).usage.pieces_created).toBe(3)
    })

    it('checks the plan-wide daily cap against the event\'s own day, and not pieces stored', async () => {
      await setPlan('trial', 'new_pieces_per_day = 1')
      await makePiece(TRIAL, pieceId(1))
      await give(pieceId(1))
      await makePiece(TRIAL_TWO, pieceId(2)) // today's cap is taken by someone else
      expect(await claim(pieceId(1))).toBe('new_pieces_per_day')
      // A piece made on an earlier day does not count towards today.
      await db.query(`update public.usage_events set at = now() - interval '2 days' where piece_id = $1`, [pieceId(1)])
      expect(await claim(pieceId(1))).toBeNull()
      // Stored is not asked: the piece already exists.
      await makePiece(CREATOR, pieceId(5))
      await give(pieceId(5))
      await setPlan('creator', 'pieces_stored_max = 1')
      expect(await claim(pieceId(5))).toBeNull()
    })

    it('does nothing for an event that is not voided, a piece with no event, or an unknown piece', async () => {
      await makePiece(TRIAL, pieceId(1))
      expect(await claim(pieceId(1))).toBeNull()
      expect(await voided(pieceId(1))).toBe(false)
      expect(await q('select 1 from public.usage_events where piece_id = $1', [pieceId(1)])).toHaveLength(1)
      expect(await claim(pieceId(99))).toBeNull()
    })

    it('never refuses the admin', async () => {
      await db.exec(`update public.plans set pieces_created_max = 0, new_pieces_per_day = 0`)
      await makePiece(ADMIN, pieceId(1))
      await give(pieceId(1))
      expect(await claim(pieceId(1))).toBeNull()
      expect(await voided(pieceId(1))).toBe(false)
    })

    it('is closed to the signed-in role', async () => {
      await expect(asUser(db, TRIAL, `select public.service_claim_piece('${pieceId(1)}')`)).rejects.toThrow(/permission denied/)
    })
  })

  it('refuses all three to the signed-in role', async () => {
    for (const sql of [
      `select public.service_plan_state('${TRIAL}')`,
      `select public.service_record_usage('${TRIAL}', 'realign', null, null)`,
      `select public.service_void_piece_created('${pieceId(1)}')`,
      `select public.service_is_creator('${TRIAL}')`,
    ]) {
      await expect(asUser(db, TRIAL, sql), sql).rejects.toThrow(/permission denied/)
      await expect(asUser(db, ADMIN, sql), sql).rejects.toThrow(/permission denied/)
    }
  })
})

describe('the shims of ruling 7', () => {
  it('is_creator() is false for Trial, true for a Creator and the admin; false for an unconfirmed email', async () => {
    const isCreator = async (user: string) => (await asUser<{ c: boolean }>(db, user, 'select public.is_creator() as c'))[0]!.c
    expect(await isCreator(TRIAL)).toBe(false)
    expect(await isCreator(UNCONFIRMED)).toBe(false)
    expect(await isCreator(CREATOR)).toBe(true)
    expect(await isCreator(ADMIN)).toBe(true)
  })

  it('service_is_creator agrees', async () => {
    for (const [user, expected] of [[TRIAL, false], [UNCONFIRMED, false], [CREATOR, true], [ADMIN, true]] as const) {
      expect([user, (await asService<{ c: boolean }>(db, 'select public.service_is_creator($1) as c', [user]))[0]!.c]).toEqual([user, expected])
    }
  })
})

describe('a smaller plan keeps what exists', () => {
  it('a Creator with 4 pieces and 2 links on, moved to Trial, keeps all of them and is refused a new piece and a third link', async () => {
    for (const n of [1, 2, 3, 4]) await makePiece(CREATOR, pieceId(n))
    await makePart(CREATOR, pieceId(1), partId(1), true)
    await makePart(CREATOR, pieceId(1), partId(2))
    await linkOn(CREATOR, pieceId(1))
    await linkOn(CREATOR, pieceId(2))
    await asUser(db, CREATOR, 'select * from public.create_or_get_share($1)', [pieceId(3)])

    await asUser(db, ADMIN, `select public.save_admin_changes('{"people":[{"email":"creator@example.com","plan_id":"trial"}]}')`)

    expect(await q('select id from public.pieces where owner_id = $1 order by id', [CREATOR])).toHaveLength(4)
    expect(await q('select piece_id from public.piece_shares where enabled order by piece_id')).toEqual([{ piece_id: pieceId(1) }, { piece_id: pieceId(2) }])
    expect(await q('select id from public.score_files order by id')).toHaveLength(2)
    expect((await myPlan(CREATOR)).usage).toMatchObject({ pieces_created: 4, pieces_stored: 4, shared_pieces: 2 })
    await expect(makePiece(CREATOR, pieceId(5))).rejects.toThrow(refusedFor('pieces_created_max'))
    await expect(asUser(db, CREATOR, 'select public.set_share_enabled($1, true, true)', [pieceId(3)])).rejects.toThrow(/plan_limit:shared_pieces_max/)
    // The part that was ticked stays editable, and a link that is on can be turned off and back on... only if there is room.
    await asUser(db, CREATOR, `update public.score_files set name = 'Renamed' where id = $1`, [partId(1)])
    await asUser(db, CREATOR, 'select public.set_share_enabled($1, false)', [pieceId(1)])
  })
})

describe('grants', () => {
  const canRun = async (role: string, fn: string) => (await one<{ ok: boolean }>(`select has_function_privilege('${role}', '${fn}', 'execute') as ok`)).ok

  it('anon and authenticated cannot select from, or write to, the four tables', async () => {
    for (const table of ['plans', 'plan_emails', 'usage_events', 'trial_ledger']) {
      for (const role of ['anon', 'authenticated']) {
        await db.exec(`set role ${role}`)
        try {
          await expect(db.query(`select * from public.${table}`), `${role} ${table}`).rejects.toThrow(/permission denied/)
          await expect(db.query(`delete from public.${table}`), `${role} ${table}`).rejects.toThrow(/permission denied/)
        } finally {
          await db.exec('reset role')
        }
      }
    }
    await expect(asUser(db, ADMIN, 'select * from public.plans')).rejects.toThrow(/permission denied/)
  })

  it('has row level security on the four tables, with no policy', async () => {
    const tables = ['plans', 'plan_emails', 'usage_events', 'trial_ledger']
    expect(await q(`select relname, relrowsecurity from pg_class where relname = any($1) and relkind = 'r' order by relname`, [tables])).toEqual(
      [...tables].sort().map((relname) => ({ relname, relrowsecurity: true })),
    )
    expect(await q(`select tablename from pg_policies where tablename = any($1)`, [tables])).toEqual([])
  })

  it('the signed-in role runs the functions the app calls and the storage policy helper; anon runs none of them', async () => {
    for (const fn of [
      'public.my_plan(uuid)', 'public.set_share_enabled(uuid, boolean, boolean)', 'public.delete_account()', 'public.admin_overview()',
      'public.save_admin_changes(jsonb)', 'public.is_creator()', 'public.can_upload_object(text)',
    ]) {
      expect([fn, await canRun('authenticated', fn)]).toEqual([fn, true])
      expect([fn, await canRun('anon', fn)]).toEqual([fn, false])
    }
  })

  it('the helpers and the processor\'s functions are closed to the signed-in role, and the processor\'s open to service_role only', async () => {
    for (const fn of ['public.email_hash(text)', 'public.plan_row_of(uuid)', 'public.plan_state_of(uuid, uuid)', 'public.enforce_piece_limits()', 'public.enforce_part_limits()', 'public.require_advanced_reading()', 'public.piece_member_limit(uuid)']) {
      for (const role of ['anon', 'authenticated']) expect([fn, role, await canRun(role, fn)]).toEqual([fn, role, false])
    }
    for (const fn of ['public.service_plan_state(uuid, uuid)', 'public.service_record_usage(uuid, text, uuid, uuid, integer)', 'public.service_void_piece_created(uuid)', 'public.service_is_creator(uuid)', 'public.service_use_advanced_reading(uuid, uuid, uuid[])', 'public.service_claim_piece(uuid)']) {
      expect([fn, await canRun('service_role', fn)]).toEqual([fn, true])
      for (const role of ['anon', 'authenticated']) expect([fn, role, await canRun(role, fn)]).toEqual([fn, role, false])
    }
    await expect(asUser(db, TRIAL, 'select public.plan_row_of($1)', [TRIAL])).rejects.toThrow(/permission denied/)
  })

  it('every function of the migration sets an empty search_path', async () => {
    const rows = await q<{ proname: string; proconfig: string[] | null }>(
      `select proname, proconfig from pg_proc where pronamespace = 'public'::regnamespace
         and proname in ('email_hash', 'plan_row_of', 'plan_state_of', 'can_upload_object', 'enforce_piece_limits', 'enforce_part_limits', 'require_advanced_reading',
                         'my_plan', 'admin_overview', 'save_admin_changes', 'service_plan_state', 'service_record_usage', 'service_void_piece_created', 'service_use_advanced_reading', 'service_claim_piece')`,
    )
    expect(rows).toHaveLength(15)
    for (const row of rows) expect([row.proname, row.proconfig]).toEqual([row.proname, ['search_path=""']])
  })
})

// The safety net for the next plan column (final review I4): these run on a database with EVERY migration applied, not 0015
// alone, so a later migration that adds a column to plans fails them until planLimits.ts (and save_admin_changes) know it.
describe('over every migration', () => {
  let everything: PGlite
  beforeAll(async () => {
    everything = await databaseWithMigrations()
    await everything.exec(`
      insert into auth.users (id, email, email_confirmed_at) values ('${ADMIN}', 'admin@example.com', now());
      insert into public.admins (user_id) values ('${ADMIN}');
    `)
  }, 120_000)
  afterAll(async () => {
    await everything.close()
  })

  const limitColumns = async () =>
    (
      await everything.query<{ column_name: string }>(
        `select column_name from information_schema.columns where table_schema = 'public' and table_name = 'plans' order by ordinal_position`,
      )
    ).rows
      .map((column) => column.column_name)
      .filter((name) => !['id', 'name', 'position'].includes(name))

  it('the frontend limit list is the plans columns minus id, name and position, in order', async () => {
    expect(PLAN_LIMITS.map((limit) => limit.key)).toEqual(await limitColumns())
  })

  it('save_admin_changes round-trips every limit column: what is sent is what is stored, and null where the column allows it', async () => {
    const save = (changes: unknown) => asUser(everything, ADMIN, 'select public.save_admin_changes($1::jsonb)', [JSON.stringify(changes)])
    const row = async () => (await everything.query<Record<string, unknown>>(`select * from public.plans where id = 'trial'`)).rows[0]!
    const before = await row()

    // A different value for every column at once: 7 is inside every column's bounds, a switch is flipped.
    const sent: Record<string, number | boolean> = {}
    for (const limit of PLAN_LIMITS) sent[limit.key] = limit.kind === 'switch' ? !before[limit.key] : 7
    await save({ plans: [{ id: 'trial', ...sent }] })
    const stored = await row()
    for (const limit of PLAN_LIMITS) expect([limit.key, stored[limit.key]]).toEqual([limit.key, sent[limit.key]])

    // And the other way: null wherever the column may be empty, the switches back.
    const empty: Record<string, number | boolean | null> = {}
    for (const limit of PLAN_LIMITS) empty[limit.key] = limit.kind === 'switch' ? before[limit.key] === true : limit.nullable ? null : 7
    await save({ plans: [{ id: 'trial', ...empty }] })
    const cleared = await row()
    for (const limit of PLAN_LIMITS) expect([limit.key, cleared[limit.key]]).toEqual([limit.key, empty[limit.key]])

    // The largest number the admin draft allows (9 digits) is stored.
    await save({ plans: [{ id: 'trial', pieces_created_max: 999999999 }] })
    expect((await row()).pieces_created_max).toBe(999999999)
  })
})
