// @vitest-environment node
import { type PGlite } from '@electric-sql/pglite'
import { beforeEach, describe, expect, it } from 'vitest'
import { asUser, databaseWithMigrations } from '@/test/supabaseStandIn'

const OWNER = '00000000-0000-4000-8000-0000000000a1'
const OTHER = '00000000-0000-4000-8000-0000000000a2'
const JOINER = '00000000-0000-4000-8000-0000000000a3'
const PIECE = '00000000-0000-4000-8000-0000000000f1'
const PIECE2 = '00000000-0000-4000-8000-0000000000f2'

let db: PGlite

type Share = { token: string; enabled: boolean; rights_confirmed_at: string | null }
const make = (user = OWNER, piece = PIECE) => asUser<Share>(db, user, 'select * from public.create_or_get_share($1)', [piece]).then((rows) => rows[0]!)
const turn = (on: boolean, user = OWNER, piece = PIECE) => asUser(db, user, 'select public.set_share_enabled($1, $2)', [piece, on])
const turnConfirming = (on: boolean, user = OWNER, piece = PIECE) => asUser(db, user, 'select public.set_share_enabled($1, $2, true)', [piece, on])
const row = async (piece = PIECE) => (await db.query<Share>('select token, enabled, rights_confirmed_at from public.piece_shares where piece_id = $1', [piece])).rows[0]!

// Migration 0013, the music rule (Decision 2026-11-06): a link is turned on only after the owner confirmed the rights, and
// the time is kept on the share row. Links that were on before it keep working.
beforeEach(async () => {
  db = await databaseWithMigrations()
  await db.exec(`
    insert into auth.users (id, email, email_confirmed_at) values
      ('${OWNER}', 'o@example.com', now()), ('${OTHER}', 'x@example.com', now()), ('${JOINER}', 'j@example.com', now());
    insert into public.pieces (id, owner_id, title) values ('${PIECE}', '${OWNER}', 'Etude'), ('${PIECE2}', '${OWNER}', 'Waltz');
    -- Since 0015 a Trial plan has one shared piece; the owner is a Creator here, so these tests stay about the rights.
    insert into public.plan_emails (email, plan_id) values ('o@example.com', 'creator');
  `)
})

describe('a new share link', () => {
  it('starts off, with no rights time', async () => {
    const share = await make()

    expect(share.enabled).toBe(false)
    expect(share.rights_confirmed_at).toBeNull()
    expect(share.token).toHaveLength(24)
  })

  it('is the same link each time, and its rows are what the owner can read', async () => {
    const first = await make()

    expect(await make()).toEqual(first)
    expect(await asUser(db, OWNER, 'select rights_confirmed_at from public.piece_shares')).toEqual([{ rights_confirmed_at: null }])
    expect(await asUser(db, OTHER, 'select * from public.piece_shares')).toEqual([])
  })
})

describe('turning a link on', () => {
  it('is refused without the confirmation, and the link stays off', async () => {
    await make()

    await expect(turn(true)).rejects.toThrow(/confirm the rights/)
    expect(await row()).toMatchObject({ enabled: false, rights_confirmed_at: null })
  })

  it('works with the confirmation, which saves the time', async () => {
    await make()

    await turnConfirming(true)

    const share = await row()
    expect(share.enabled).toBe(true)
    expect(share.rights_confirmed_at).not.toBeNull()
  })

  it('does not ask again for that piece: off and on later needs no confirmation, and the first time stays', async () => {
    await make()
    await turnConfirming(true)
    const first = (await row()).rights_confirmed_at

    await turn(false)
    await turn(true)
    await turnConfirming(true)

    expect(await row()).toMatchObject({ enabled: true, rights_confirmed_at: first })
  })

  it('asks again for another piece', async () => {
    await make(OWNER, PIECE)
    await make(OWNER, PIECE2)
    await turnConfirming(true, OWNER, PIECE)

    await expect(turn(true, OWNER, PIECE2)).rejects.toThrow(/confirm the rights/)
  })

  it('does not save a confirmation that comes with turning the link off', async () => {
    await make()

    await turnConfirming(false)

    expect(await row()).toMatchObject({ enabled: false, rights_confirmed_at: null })
  })

  it('is for the owner only', async () => {
    await make()

    await expect(turnConfirming(true, OTHER)).rejects.toThrow(/not your piece/)
    expect(await row()).toMatchObject({ enabled: false, rights_confirmed_at: null })
  })

  it('cannot be done by writing the table, with or without the time', async () => {
    await make()

    await expect(asUser(db, OWNER, `update public.piece_shares set enabled = true, rights_confirmed_at = now()`)).rejects.toThrow(/permission denied/)
    await expect(asUser(db, OWNER, `update public.piece_shares set rights_confirmed_at = now()`)).rejects.toThrow(/permission denied/)
    expect(await row()).toMatchObject({ enabled: false, rights_confirmed_at: null })
  })

  it('is refused for any writer, the table owner included, when the row would be on with no time', async () => {
    await make()

    await expect(db.exec(`update public.piece_shares set enabled = true`)).rejects.toThrow(/confirm the rights/)
    await expect(db.exec(`insert into public.piece_shares (piece_id, token, enabled) values ('${PIECE2}', 'weak-token', true)`)).rejects.toThrow(/confirm the rights/)
    // An insert that says nothing about it is off (the column's default), so it needs no time.
    await db.exec(`insert into public.piece_shares (piece_id, token) values ('${PIECE2}', 'other-token')`)
    expect(await row(PIECE2)).toMatchObject({ enabled: false })
  })
})

describe('a link that was on before the rule (no time)', () => {
  beforeEach(async () => {
    // Made as 0007 made them: on, without a time. Written by the table owner, as a migration would have.
    await db.exec(`
      alter table public.piece_shares disable trigger piece_shares_require_rights;
      insert into public.piece_shares (piece_id, token, enabled) values ('${PIECE}', 'old-token-0123456789abc', true);
      alter table public.piece_shares enable trigger piece_shares_require_rights;
    `)
  })

  it('stays on, is read as on with no time, and lets people join', async () => {
    expect(await make()).toEqual({ token: 'old-token-0123456789abc', enabled: true, rights_confirmed_at: null })

    const joined = await asUser<{ status: string }>(db, JOINER, 'select * from public.join_piece($1)', ['old-token-0123456789abc'])
    expect(joined[0]!.status).toBe('joined')
  })

  it('can have its token reset and be turned off, and is still on after the reset', async () => {
    const [{ t }] = await asUser<{ t: string }>(db, OWNER, 'select public.reset_share_token($1) as t', [PIECE]) as [{ t: string }]

    expect(t).not.toBe('old-token-0123456789abc')
    expect(await row()).toMatchObject({ token: t, enabled: true, rights_confirmed_at: null })

    await turn(false)
    expect(await row()).toMatchObject({ enabled: false })
  })

  it('needs the confirmation to be turned on again once the owner has turned it off', async () => {
    await turn(false)

    await expect(turn(true)).rejects.toThrow(/confirm the rights/)
    await turnConfirming(true)
    expect((await row()).rights_confirmed_at).not.toBeNull()
  })

  it('is left on by turning it on again without a confirmation (nothing changes)', async () => {
    await turn(true)

    expect(await row()).toMatchObject({ enabled: true, rights_confirmed_at: null })
  })
})

describe('resetting a link that was never made', () => {
  it('makes it off', async () => {
    await asUser(db, OWNER, 'select public.reset_share_token($1)', [PIECE])

    expect(await row()).toMatchObject({ enabled: false, rights_confirmed_at: null })
  })
})

describe('grants', () => {
  it('piece_shares stays select only for the signed-in role, and the functions are theirs alone', async () => {
    const privileges = async (role: string) =>
      (await db.query<{ p: string }>(`select p from unnest(array['select','insert','update','delete']) p where has_table_privilege('${role}', 'public.piece_shares', p)`)).rows.map((r) => r.p)
    expect(await privileges('authenticated')).toEqual(['select'])
    expect(await privileges('anon')).toEqual([])
    const canRun = async (role: string, fn: string) => (await db.query<{ ok: boolean }>(`select has_function_privilege('${role}', '${fn}', 'execute') as ok`)).rows[0]!.ok
    expect(await canRun('authenticated', 'public.set_share_enabled(uuid, boolean, boolean)')).toBe(true)
    expect(await canRun('anon', 'public.set_share_enabled(uuid, boolean, boolean)')).toBe(false)
    expect(await canRun('anon', 'public.create_or_get_share(uuid)')).toBe(false)
    expect(await canRun('authenticated', 'public.require_share_rights()')).toBe(false)
  })

  it('the old two-argument function is gone', async () => {
    const found = await db.query(`select 1 from pg_proc where proname = 'set_share_enabled' and pronargs = 2`)
    expect(found.rows).toEqual([])
  })
})
