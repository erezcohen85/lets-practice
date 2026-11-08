// @vitest-environment node
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { type PGlite } from '@electric-sql/pglite'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { applyMigration, asService, asUser, databaseWithMigrations } from '@/test/supabaseStandIn'

const ADMIN = '00000000-0000-4000-8000-0000000000a0'
const U1 = '00000000-0000-4000-8000-0000000000a1'
const U2 = '00000000-0000-4000-8000-0000000000a2'
const U3 = '00000000-0000-4000-8000-0000000000a3'
const MASTER = '00000000-0000-4000-8000-0000000000f0'
const MASTER_PART = '00000000-0000-4000-8000-0000000000e0'
const NEW = '00000000-0000-4000-8000-0000000000f1'
const pieceId = (n: number) => `00000000-0000-4000-8000-0000000003${String(n).padStart(2, '0')}`

let db: PGlite

// Migration 0017, the fixes of the final review that were first written into 0015. 0015 and 0016 were applied on the Dev
// project before the review, so the fixes live in a migration of their own. migration0015.test.ts runs the plan behaviour over
// 0015 + 0016 + 0017; this file holds what is only about 0017: the sample copy meeting the new triggers, the keyed hash, and
// what the migration removed. One database with every migration and a master piece; each test works on a copy.
let base: PGlite
beforeAll(async () => {
  base = await databaseWithMigrations()
  await base.exec(`
    insert into auth.users (id, email, email_confirmed_at) values
      ('${ADMIN}', 'admin@example.com', now()),
      ('${U1}', 'U1@Example.com', now()),
      ('${U2}', 'u2@example.com', now()),
      ('${U3}', 'u3@example.com', now());
    insert into public.admins (user_id) values ('${ADMIN}');
    insert into public.pieces (id, owner_id, title) values ('${MASTER}', '${ADMIN}', 'Gondola Song');
    insert into public.score_files (id, piece_id, storage_path, sha256, page_count, name, position)
      values ('${MASTER_PART}', '${MASTER}', '${ADMIN}/${MASTER}/score.pdf', 'abc', 1, 'Piano', 0);
    select public.service_set_sample_piece('${MASTER}', '[]'::jsonb);
  `)
}, 120_000)
beforeEach(async () => {
  db = (await base.clone()) as PGlite
})
afterEach(async () => {
  await db.close()
})

const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows
const one = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await q<T>(sql, params))[0]!
const makePiece = (user: string, id: string) => asUser(db, user, `insert into public.pieces (id, title) values ($1, 'Piece')`, [id])
const copy = (user = U1, piece = NEW) => asService(db, 'select public.service_copy_sample_piece($1, $2) as r', [user, piece])
const myUsage = (user: string) => asUser<{ p: { usage: Record<string, number> } }>(db, user, 'select public.my_plan() as p').then((rows) => rows[0]!.p.usage)
const refusedFor = (key: string) => new RegExp(`plan_limit:${key}`)
const setPlan = (id: string, set: string) => db.exec(`update public.plans set ${set} where id = '${id}'`)

describe('the applied text of 0015', () => {
  it('is the text that was applied on Dev (commit 21f309a): an applied migration never changes', () => {
    const text = readFileSync(join(__dirname, '../../../backend/supabase/migrations/0015_plans.sql'))
    expect(createHash('sha256').update(text).digest('hex')).toBe('d100db69ef307ae63e9bde717d3be9df5a4554cd532b1441c31908ea5012f588')
  })
})

describe('what 0017 removes and adds', () => {
  it('drops the policy helpers and the after-insert log trigger, and adds the two before-insert triggers', async () => {
    expect(await q(`select proname from pg_proc where pronamespace = 'public'::regnamespace and proname in ('can_create_piece', 'can_add_part', 'log_piece_created')`)).toEqual([])
    expect(await q(`select tgname from pg_trigger where tgname = 'pieces_log_created'`)).toEqual([])
    const triggers = await q<{ tgname: string; before: boolean }>(
      `select tgname, (tgtype & 2) = 2 as before from pg_trigger where tgname in ('pieces_enforce_limits', 'score_files_enforce_limits') order by tgname`,
    )
    expect(triggers).toEqual([
      { tgname: 'pieces_enforce_limits', before: true },
      { tgname: 'score_files_enforce_limits', before: true },
    ])
  })

  it('leaves the two insert policies as plain ownership checks', async () => {
    const rows = await q<{ policyname: string; with_check: string }>(
      `select policyname, with_check from pg_policies where policyname in ('pieces_insert_own', 'score_files_insert_own') order by policyname`,
    )
    expect(rows).toHaveLength(2)
    for (const row of rows) expect(row.with_check).not.toMatch(/can_|plan/)
  })

  it('closes the new functions to authenticated and opens the two service ones to service_role only', async () => {
    for (const fn of ['enforce_piece_limits()', 'enforce_part_limits()', 'email_hash(text)']) {
      expect((await one<{ ok: boolean }>(`select has_function_privilege('authenticated', 'public.${fn}', 'execute') as ok`)).ok).toBe(false)
    }
    for (const fn of ['service_claim_piece(uuid)', 'service_use_advanced_reading(uuid, uuid, uuid[])']) {
      expect((await one<{ ok: boolean }>(`select has_function_privilege('authenticated', 'public.${fn}', 'execute') as ok`)).ok).toBe(false)
      expect((await one<{ ok: boolean }>(`select has_function_privilege('service_role', 'public.${fn}', 'execute') as ok`)).ok).toBe(true)
    }
  })
})

describe('the sample copy and the triggers', () => {
  it('goes in whatever the plan says: paused, the daily cap full, stored maximum used up (the service role is not checked)', async () => {
    await setPlan('trial', 'new_pieces_paused = true, new_pieces_per_day = 0, pieces_stored_max = 0, pieces_created_max = 0')
    await copy()
    expect(await q('select owner_id, sample_of from public.pieces where id = $1', [NEW])).toEqual([{ owner_id: U1, sample_of: MASTER }])
  })

  it('has its created event written by the trigger and marked is_sample by the copy, and counts as created and stored', async () => {
    await copy()
    expect(await q('select kind, plan_id, is_sample, voided_at from public.usage_events where piece_id = $1', [NEW])).toEqual([
      { kind: 'piece_created', plan_id: 'trial', is_sample: true, voided_at: null },
    ])
    expect(await myUsage(U1)).toMatchObject({ pieces_created: 1, pieces_stored: 1, new_pieces_today_on_plan: 0 })
  })

  it('is not counted in the daily cap of the plan: with a cap of 1, one sample leaves room for one ordinary piece, and the second is refused', async () => {
    await setPlan('trial', 'new_pieces_per_day = 1')
    await copy(U1, NEW)
    await copy(U2, '00000000-0000-4000-8000-0000000000f2')
    await makePiece(U3, pieceId(1))
    await expect(makePiece(U1, pieceId(2))).rejects.toThrow(refusedFor('new_pieces_per_day'))
    // The refused one left nothing behind, and the samples and the one piece are what the account shows.
    expect(await q(`select 1 from public.usage_events where piece_id = $1`, [pieceId(2)])).toEqual([])
    expect((await myUsage(U3)).new_pieces_today_on_plan).toBe(1)
  })

  it('is counted in pieces created: a Trial user who was given the sample has two ordinary pieces left of three', async () => {
    await copy()
    await makePiece(U1, pieceId(1))
    await makePiece(U1, pieceId(2))
    await expect(makePiece(U1, pieceId(3))).rejects.toThrow(refusedFor('pieces_created_max'))
    expect(await myUsage(U1)).toMatchObject({ pieces_created: 3 })
  })

  it('is left out of the admin hub new pieces today, and the hub says which plan an unconfirmed email is assigned', async () => {
    await copy()
    await asUser(db, U2, `insert into public.pieces (id, title) values ($1, 'x')`, [pieceId(1)])
    const overview = (await asUser<{ o: { plans: { id: string; new_pieces_today: number }[]; people: { email: string; plan_id: string; assigned: boolean; assigned_plan_id: string | null }[] } }>(
      db,
      ADMIN,
      'select public.admin_overview() as o',
    ))[0]!.o
    expect(overview.plans.find((plan) => plan.id === 'trial')!.new_pieces_today).toBe(1)
    await db.exec(`update auth.users set email_confirmed_at = null where id = '${U3}'`)
    await db.exec(`insert into public.plan_emails (email, plan_id) values ('u3@example.com', 'creator'), ('nobody@example.com', 'unlimited')`)
    const again = (await asUser<{ o: { people: { email: string; plan_id: string; assigned: boolean; assigned_plan_id: string | null }[] } }>(db, ADMIN, 'select public.admin_overview() as o'))[0]!.o.people
    const by = (email: string) => again.find((person) => person.email === email)!
    expect(by('u3@example.com')).toMatchObject({ plan_id: 'trial', assigned: true, assigned_plan_id: 'creator' })
    expect(by('nobody@example.com')).toMatchObject({ plan_id: 'unlimited', assigned: true, assigned_plan_id: 'unlimited' })
    expect(by('u2@example.com')).toMatchObject({ plan_id: 'trial', assigned: false, assigned_plan_id: null })
  })

  it('does not ask the daily cap when a voided sample is claimed', async () => {
    await copy()
    await asService(db, 'select public.service_void_piece_created($1)', [NEW])
    // Someone else fills the plan-wide cap; a sample owes it nothing.
    await setPlan('trial', 'new_pieces_per_day = 1')
    await makePiece(U2, pieceId(1))
    expect(await asService(db, 'select public.service_claim_piece($1) as r', [NEW])).toEqual([{ r: null }])
    expect(await q('select voided_at from public.usage_events where piece_id = $1', [NEW])).toEqual([{ voided_at: null }])
  })

  it('still asks the daily cap for an ordinary voided piece of today, and pieces created for a sample', async () => {
    await makePiece(U3, pieceId(2))
    await asService(db, 'select public.service_void_piece_created($1)', [pieceId(2)])
    await makePiece(U2, pieceId(1))
    await setPlan('trial', 'new_pieces_per_day = 1')
    expect(await asService(db, 'select public.service_claim_piece($1) as r', [pieceId(2)])).toEqual([{ r: 'new_pieces_per_day' }])
    expect(await q('select voided_at is not null as voided from public.usage_events where piece_id = $1', [pieceId(2)])).toEqual([{ voided: true }])

    await copy()
    await asService(db, 'select public.service_void_piece_created($1)', [NEW])
    await setPlan('trial', 'new_pieces_per_day = null, pieces_created_max = 0')
    expect(await asService(db, 'select public.service_claim_piece($1) as r', [NEW])).toEqual([{ r: 'pieces_created_max' }])
  })
})

describe('the keyed email hash', () => {
  const plain = (email: string) => createHash('sha256').update(email.toLowerCase(), 'utf8').digest('hex')
  const hashOf = async (email: string) => (await one<{ h: string }>('select public.email_hash($1) as h', [email])).h

  it('is not the plain sha256 of the email, and has the shape of one', async () => {
    const h = await hashOf('trial@example.com')
    expect(h).toMatch(/^[0-9a-f]{64}$/)
    expect(h).not.toBe(plain('trial@example.com'))
  })

  it('is stable for one address, whatever its case and spaces, and differs between addresses', async () => {
    const h = await hashOf('trial@example.com')
    expect(await hashOf('trial@example.com')).toBe(h)
    expect(await hashOf('  Trial@Example.COM ')).toBe(h)
    expect(await hashOf('other@example.com')).not.toBe(h)
  })

  it('is sha256(pepper || ":" || the address), with a 64 hex pepper made at apply time', async () => {
    const pepper = (await one<{ value: string }>(`select value from public.private_settings where key = 'trial_ledger_pepper'`)).value
    expect(pepper).toMatch(/^[0-9a-f]{64}$/)
    expect(await hashOf('trial@example.com')).toBe(createHash('sha256').update(`${pepper}:trial@example.com`, 'utf8').digest('hex'))
  })

  it('changes with the pepper, so a ledger row of another pepper does not match', async () => {
    const before = await hashOf('trial@example.com')
    await db.exec(`update public.private_settings set value = repeat('a', 64) where key = 'trial_ledger_pepper'`)
    expect(await hashOf('trial@example.com')).not.toBe(before)
  })

  it('has a different pepper in every database', async () => {
    const other = await databaseWithMigrations()
    try {
      const mine = (await one<{ value: string }>(`select value from public.private_settings`)).value
      const theirs = (await other.query<{ value: string }>(`select value from public.private_settings`)).rows[0]!.value
      expect(theirs).not.toBe(mine)
    } finally {
      await other.close()
    }
  }, 60_000)

  it('keeps the pepper out of reach: private_settings is closed to anon and authenticated, and so is the hash function', async () => {
    await expect(asUser(db, U1, 'select * from public.private_settings')).rejects.toThrow(/permission denied/)
    await expect(asUser(db, U1, `insert into public.private_settings (key, value) values ('x', 'y')`)).rejects.toThrow(/permission denied/)
    await expect(asUser(db, U1, `select public.email_hash('a@b.c')`)).rejects.toThrow(/permission denied/)
    await db.exec('set role anon')
    try {
      await expect(db.query('select * from public.private_settings')).rejects.toThrow(/permission denied/)
      await expect(db.query(`select public.email_hash('a@b.c')`)).rejects.toThrow(/permission denied/)
    } finally {
      await db.exec('reset role')
    }
    expect((await one<{ rls: boolean }>(`select relrowsecurity as rls from pg_class where oid = 'public.private_settings'::regclass`)).rls).toBe(true)
    expect(await q(`select 1 from pg_policies where tablename = 'private_settings'`)).toEqual([])
  })

  it('keeps the pepper out of reach of the service key too, even where new tables default to service_role (as on Supabase)', async () => {
    const real = await databaseWithMigrations(`alter default privileges in schema public grant all on tables to service_role;`)
    try {
      await expect(asService(real, 'select * from public.private_settings')).rejects.toThrow(/permission denied/)
      await expect(asService(real, `delete from public.private_settings`)).rejects.toThrow(/permission denied/)
      await expect(asService(real, `update public.private_settings set value = 'x'`)).rejects.toThrow(/permission denied/)
    } finally {
      await real.close()
    }
  }, 60_000)

  it('refuses instead of returning null when the pepper is missing', async () => {
    await db.exec(`delete from public.private_settings where key = 'trial_ledger_pepper'`)
    await expect(db.query(`select public.email_hash('a@b.c')`)).rejects.toThrow(/trial_ledger_pepper missing/)
    await expect(makePiece(U1, pieceId(1))).rejects.toThrow(/trial_ledger_pepper missing/)
  })

  it('gives the browser nothing of it through my_plan or the admin hub', async () => {
    const pepper = (await one<{ value: string }>(`select value from public.private_settings`)).value
    const mine = JSON.stringify(await asUser(db, U1, 'select public.my_plan() as p'))
    const hub = JSON.stringify(await asUser(db, ADMIN, 'select public.admin_overview() as o'))
    expect(mine).not.toContain(pepper)
    expect(hub).not.toContain(pepper)
  })

  it('still carries the count over when an account is deleted and the email comes back, in any letter case', async () => {
    await makePiece(U1, pieceId(1))
    await makePiece(U1, pieceId(2))
    await asUser(db, U1, 'delete from public.pieces where owner_id = $1', [U1])
    await asUser(db, U1, 'select public.delete_account()')

    expect(await q('select email_hash, pieces_created from public.trial_ledger')).toEqual([{ email_hash: await hashOf('u1@example.com'), pieces_created: 2 }])
    const back = '00000000-0000-4000-8000-0000000000b1'
    await db.query(`insert into auth.users (id, email, email_confirmed_at) values ($1, 'u1@EXAMPLE.com', now())`, [back])
    expect((await myUsage(back)).pieces_created).toBe(2)
    await makePiece(back, pieceId(3))
    await expect(makePiece(back, pieceId(4))).rejects.toThrow(refusedFor('pieces_created_max'))
  })
})

describe('the guard at the top of 0017', () => {
  it('refuses to run when the ledger already has rows hashed without the pepper', async () => {
    const old = await databaseWithMigrations('', '0016')
    try {
      await old.exec(`insert into public.trial_ledger (email_hash, pieces_created) values ('abc', 1)`)
      await expect(applyMigration(old, '0017')).rejects.toThrow(/trial_ledger has rows/)
    } finally {
      await old.close()
    }
  }, 60_000)
})
