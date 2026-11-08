// @vitest-environment node
import { type PGlite } from '@electric-sql/pglite'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { asUser, databaseWithMigrations } from '@/test/supabaseStandIn'

const ADMIN = '00000000-0000-4000-8000-0000000000a0'
const OWNER = '00000000-0000-4000-8000-0000000000a1'
const STRANGER = '00000000-0000-4000-8000-0000000000a2'
const PIECE = '00000000-0000-4000-8000-0000000000f1'
const OTHER_PIECE = '00000000-0000-4000-8000-0000000000f2'
/** People who join; in every seed below M[0] joined first, then M[1], and so on. */
const M = Array.from({ length: 5 }, (_, i) => `00000000-0000-4000-8000-0000000001${String(i).padStart(2, '0')}`)
const partId = (i: number) => `00000000-0000-4000-8000-0000000002${String(i).padStart(2, '0')}`

let db: PGlite

// Migration 0014, the member limit (Erez, 2026-11-07): a piece admits the larger of members_per_piece and members_per_part
// times its parts (defaults 30 and 10). The newest joiners over the limit are on hold: still members, with no read access,
// until there is room again. Nothing about the hold is stored. Since migration 0015 the two numbers belong to the owner's
// plan (Trial for the owner here), not to a row per creator; the per-creator functions and their tests are gone with it.
// One database with the migrations and the seed; each test works on a copy of it, which is much quicker than migrating again.
let base: PGlite
beforeAll(async () => {
  base = await databaseWithMigrations()
  await base.exec(`
    insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
      ('${ADMIN}', 'admin@example.com', now(), '{"full_name":"The Admin"}'),
      ('${OWNER}', 'Owner@Example.com', now(), '{"full_name":"Ana Owner"}'),
      ('${STRANGER}', 's@example.com', now(), '{}'),
      ${M.map((id, i) => `('${id}', 'm${i}@example.com', now(), '{"full_name":"Member ${i}"}')`).join(',\n      ')};
    insert into public.admins (user_id) values ('${ADMIN}');
    insert into public.pieces (id, owner_id, title) values ('${PIECE}', '${OWNER}', 'Etude'), ('${OTHER_PIECE}', '${OWNER}', 'Waltz');
    insert into public.score_files (id, piece_id, storage_path, sha256, page_count, name)
      values ('${partId(0)}', '${PIECE}', '${OWNER}/${PIECE}/a.pdf', 'x', 1, 'Part'),
             ('${partId(90)}', '${OTHER_PIECE}', '${OWNER}/${OTHER_PIECE}/a.pdf', 'x', 1, 'Part');
    insert into public.score_pages (score_file_id, page_index, image_path, width, height) values ('${partId(0)}', 0, 'p.png', 100, 100);
    insert into public.bars (score_file_id, bar_number, page_index, x, y, w, h) values ('${partId(0)}', 1, 0, 0, 0, 10, 10);
    insert into storage.objects (bucket_id, name) values ('pieces', '${OWNER}/${PIECE}/a.pdf');
  `)
}, 120_000)
beforeEach(async () => {
  db = (await base.clone()) as PGlite
})
afterEach(async () => {
  await db.close()
})

const limitOf = async (piece = PIECE) => (await db.query<{ n: number }>('select public.piece_member_limit($1) as n', [piece])).rows[0]!.n
/** More parts for the piece, after the ones it has: partId(1), partId(2) and so on. */
async function addParts(count: number) {
  const { n } = (await db.query<{ n: number }>('select count(*)::int as n from public.score_files where piece_id = $1', [PIECE])).rows[0]!
  for (let i = 0; i < count; i += 1) {
    await db.query(`insert into public.score_files (id, piece_id, storage_path, sha256, name) values ($1, $2, 'p', 'x', 'Part')`, [partId(n + i), PIECE])
  }
}
/** The owner's plan numbers, as the admin would set them: the owner is on Trial. */
async function setLimits(perPiece: number, perPart: number) {
  await db.query(`update public.plans set members_per_piece = $1, members_per_part = $2 where id = 'trial'`, [perPiece, perPart])
}
/** The first `count` people as members, one second apart, oldest first. */
async function seedMembers(count: number, piece = PIECE) {
  for (let i = 0; i < count; i += 1) {
    await db.query(`insert into public.piece_members (piece_id, user_id, joined_at) values ($1, $2, $3)`, [piece, M[i], new Date(Date.UTC(2026, 10, 1, 10, 0, i)).toISOString()])
  }
}
/** How many of the piece's rows and files the user can read, table by table. */
async function reads(user: string) {
  const count = async (sql: string) => (await asUser<{ n: number }>(db, user, sql, [PIECE]))[0]!.n
  return {
    pieces: await count('select count(*)::int as n from public.pieces where id = $1'),
    score_files: await count('select count(*)::int as n from public.score_files where piece_id = $1'),
    score_pages: await count(`select count(*)::int as n from public.score_pages where score_file_id = '${partId(0)}' and $1::uuid is not null`),
    bars: await count(`select count(*)::int as n from public.bars where score_file_id = '${partId(0)}' and $1::uuid is not null`),
    storage: await count(`select count(*)::int as n from storage.objects where name like '%' || $1 || '%'`),
  }
}
const EVERYTHING = { pieces: 1, score_files: 1, score_pages: 1, bars: 1, storage: 1 }
const NOTHING = { pieces: 0, score_files: 0, score_pages: 0, bars: 0, storage: 0 }

async function linkOn(piece = PIECE): Promise<string> {
  const [share] = await asUser<{ token: string }>(db, OWNER, 'select * from public.create_or_get_share($1)', [piece])
  await asUser(db, OWNER, 'select public.set_share_enabled($1, true, true)', [piece])
  return share!.token
}
const join = async (user: string, token: string) => (await asUser<{ piece_id: string | null; status: string }>(db, user, 'select * from public.join_piece($1)', [token]))[0]!

describe('the limit of a piece', () => {
  it('is 30 for one part and for three, 40 for four and 140 for fourteen, on the owner\'s Trial plan', async () => {
    expect(await limitOf()).toBe(30)
    await addParts(2)
    expect(await limitOf()).toBe(30)
    await addParts(1)
    expect(await limitOf()).toBe(40)
    await addParts(10)
    expect(await limitOf()).toBe(140)
  })

  it('takes the owner\'s plan, matched by email whatever its case', async () => {
    await setLimits(5, 2)
    expect(await limitOf()).toBe(5)
    await addParts(2)
    expect(await limitOf()).toBe(6)
    await setLimits(50, 0)
    expect(await limitOf()).toBe(50)
    // Owner@Example.com is given the Creator plan by an email typed in lower case.
    await db.exec(`insert into public.plan_emails (email, plan_id) values ('owner@example.com', 'creator')`)
    expect(await limitOf()).toBe(30)
    await addParts(1) // four parts: 4 x 10
    expect(await limitOf()).toBe(40)
    await db.exec(`update public.plans set members_per_piece = 7, members_per_part = 9 where id = 'creator'`)
    expect(await limitOf()).toBe(36)
  })

  it('a plan the admin assigns starts at the defaults', async () => {
    await asUser(db, ADMIN, `select public.save_admin_changes('{"people":[{"email":"owner@example.com","plan_id":"creator"}]}')`)
    expect(await limitOf()).toBe(30)
    await addParts(3)
    expect(await limitOf()).toBe(40)
  })
})

describe('joining', () => {
  it('is refused with full at the limit; members still get already_member, the owner owner; a leaver makes room', async () => {
    await setLimits(2, 0)
    const token = await linkOn()
    expect(await join(M[0]!, token)).toEqual({ piece_id: PIECE, status: 'joined' })
    expect(await join(M[1]!, token)).toEqual({ piece_id: PIECE, status: 'joined' })

    expect(await join(M[2]!, token)).toEqual({ piece_id: null, status: 'full' })
    expect(await join(M[0]!, token)).toEqual({ piece_id: PIECE, status: 'already_member' })
    expect(await join(OWNER, token)).toEqual({ piece_id: PIECE, status: 'owner' })
    expect(await asUser(db, OWNER, 'select user_id from public.piece_members where user_id = $1', [M[2]])).toEqual([])

    await asUser(db, M[1]!, 'select public.leave_piece($1)', [PIECE])
    expect(await join(M[2]!, token)).toEqual({ piece_id: PIECE, status: 'joined' })
  })

  it('says link_off before full: a link that is off is the reason nobody new can join', async () => {
    await setLimits(1, 0)
    const token = await linkOn()
    await join(M[0]!, token)
    await asUser(db, OWNER, 'select public.set_share_enabled($1, false)', [PIECE])

    expect((await join(M[1]!, token)).status).toBe('link_off')
  })

  it('a held member opening the link again is still already_member', async () => {
    const token = await linkOn()
    await seedMembers(3)
    await setLimits(2, 0)

    expect(await join(M[2]!, token)).toEqual({ piece_id: PIECE, status: 'already_member' })
  })
})

describe('a lowered limit', () => {
  beforeEach(async () => {
    await seedMembers(4)
    await setLimits(2, 0)
  })

  it('puts exactly the newest joiners on hold: they read nothing, the older members everything, the owner everything', async () => {
    expect(await reads(M[0]!)).toEqual(EVERYTHING)
    expect(await reads(M[1]!)).toEqual(EVERYTHING)
    expect(await reads(M[2]!)).toEqual(NOTHING)
    expect(await reads(M[3]!)).toEqual(NOTHING)
    expect(await reads(OWNER)).toEqual(EVERYTHING)
  })

  it('a held member keeps their member row, gets no owner name, and cannot write a practice memory', async () => {
    expect(await asUser(db, M[3]!, 'select user_id from public.piece_members')).toEqual([{ user_id: M[3] }])
    expect(await asUser(db, M[3]!, 'select * from public.piece_owner_names($1)', [[PIECE]])).toEqual([])
    await expect(asUser(db, M[3]!, `insert into public.piece_practice (user_id, piece_id) values ($1, $2)`, [M[3], PIECE])).rejects.toThrow(/row-level security/)
    await asUser(db, M[0]!, `insert into public.piece_practice (user_id, piece_id) values ($1, $2)`, [M[0], PIECE])
  })

  it('lets them in again when the limit rises', async () => {
    await setLimits(3, 0)
    expect(await reads(M[2]!)).toEqual(EVERYTHING)
    expect(await reads(M[3]!)).toEqual(NOTHING)
    await setLimits(4, 0)
    expect(await reads(M[3]!)).toEqual(EVERYTHING)
  })

  it('removing an older member lifts the hold of the next one only', async () => {
    await asUser(db, OWNER, 'delete from public.piece_members where piece_id = $1 and user_id = $2', [PIECE, M[0]])

    expect(await reads(M[1]!)).toEqual(EVERYTHING)
    expect(await reads(M[2]!)).toEqual(EVERYTHING)
    expect(await reads(M[3]!)).toEqual(NOTHING)
    expect(await reads(M[0]!)).toEqual(NOTHING)
  })

  it('a held member who leaves frees nobody else\'s place', async () => {
    await asUser(db, M[2]!, 'select public.leave_piece($1)', [PIECE])

    expect(await reads(M[3]!)).toEqual(NOTHING)
    expect(await asUser(db, M[2]!, 'select * from public.piece_members')).toEqual([])
  })
})

describe('deleting a part', () => {
  it('lowers the limit, and the newest joiner over it goes on hold', async () => {
    await setLimits(1, 1)
    await addParts(2) // three parts: room for three
    await seedMembers(3)
    expect(await reads(M[2]!)).toEqual({ ...EVERYTHING, score_files: 3 })

    await asUser(db, OWNER, 'delete from public.score_files where id = $1', [partId(2)])

    expect(await limitOf()).toBe(2)
    expect(await reads(M[1]!)).toEqual({ ...EVERYTHING, score_files: 2 })
    expect(await reads(M[2]!)).toEqual(NOTHING)
  })
})

describe('the join order', () => {
  it('breaks a tie in the join time by user id, so the hold is always the same people', async () => {
    await setLimits(1, 0)
    const at = '2026-11-01T10:00:00Z'
    // Inserted the other way round, so the order is the ids', not the insertion's.
    await db.query(`insert into public.piece_members (piece_id, user_id, joined_at) values ($1, $2, $4), ($1, $3, $4)`, [PIECE, M[1], M[0], at])

    expect(await reads(M[0]!)).toEqual(EVERYTHING)
    expect(await reads(M[1]!)).toEqual(NOTHING)
  })

  it('a race that overfills the piece only puts the extra person on hold', async () => {
    await setLimits(1, 0)
    const token = await linkOn()
    await join(M[0]!, token)
    // As if a second join had passed the full check at the same moment: its row is added after the first.
    await db.query(`insert into public.piece_members (piece_id, user_id, joined_at) values ($1, $2, now() + interval '1 second')`, [PIECE, M[1]])

    expect(await reads(M[0]!)).toEqual(EVERYTHING)
    expect(await reads(M[1]!)).toEqual(NOTHING)
  })
})

describe('list_members', () => {
  it('marks who is on hold, newest first, for the owner; [] for a member and a stranger', async () => {
    await seedMembers(3)
    await setLimits(2, 0)

    const members = await asUser<{ user_id: string; on_hold: boolean; email: string; display_name: string }>(db, OWNER, 'select * from public.list_members($1)', [PIECE])

    expect(members.map((m) => [m.user_id, m.on_hold])).toEqual([
      [M[2], true],
      [M[1], false],
      [M[0], false],
    ])
    expect(members[0]).toMatchObject({ email: 'm2@example.com', display_name: 'Member 2' })
    expect(await asUser(db, M[0]!, 'select * from public.list_members($1)', [PIECE])).toEqual([])
    expect(await asUser(db, STRANGER, 'select * from public.list_members($1)', [PIECE])).toEqual([])
  })
})

describe('share_member_limit', () => {
  it('gives the owner the limit and the number of members, the held ones counted', async () => {
    await seedMembers(3)
    await setLimits(2, 0)

    expect(await asUser(db, OWNER, 'select * from public.share_member_limit($1)', [PIECE])).toEqual([{ member_limit: 2, member_count: 3 }])
    expect(await asUser(db, OWNER, 'select * from public.share_member_limit($1)', [OTHER_PIECE])).toEqual([{ member_limit: 2, member_count: 0 }])
  })

  it('is refused to a member and a stranger', async () => {
    await seedMembers(1)
    for (const user of [M[0]!, STRANGER]) {
      await expect(asUser(db, user, 'select * from public.share_member_limit($1)', [PIECE]), user).rejects.toThrow(/not your piece/)
    }
  })
})

describe('my_held_pieces', () => {
  it('lists only the caller\'s own held pieces, with the title, the owner\'s name and the join time', async () => {
    await seedMembers(3)
    await seedMembers(3, OTHER_PIECE)
    await setLimits(2, 0)
    await asUser(db, OWNER, 'delete from public.piece_members where piece_id = $1 and user_id = $2', [OTHER_PIECE, M[0]]) // room on the Waltz

    const held = await asUser<{ piece_id: string; title: string; owner_name: string; joined_at: string }>(db, M[2]!, 'select * from public.my_held_pieces()')

    expect(held).toHaveLength(1)
    expect(held[0]).toMatchObject({ piece_id: PIECE, title: 'Etude', owner_name: 'Ana Owner' })
    expect(new Date(held[0]!.joined_at).toISOString()).toBe('2026-11-01T10:00:02.000Z')
    expect(await asUser(db, M[0]!, 'select * from public.my_held_pieces()')).toEqual([])
    expect(await asUser(db, STRANGER, 'select * from public.my_held_pieces()')).toEqual([])
    expect(await asUser(db, OWNER, 'select * from public.my_held_pieces()')).toEqual([])
  })
})

describe('grants', () => {
  const canRun = async (role: string, fn: string) => (await db.query<{ ok: boolean }>(`select has_function_privilege('${role}', '${fn}', 'execute') as ok`)).rows[0]!.ok
  const CALLABLE = [
    'public.can_read_piece(uuid)',
    'public.join_piece(text)',
    'public.list_members(uuid)',
    'public.share_member_limit(uuid)',
    'public.my_held_pieces()',
  ]
  const INTERNAL = ['public.piece_member_limit(uuid)', 'public.member_has_room(uuid, uuid)']

  it('the signed-in role runs the functions the app calls, and not the two helpers; anon runs none', async () => {
    for (const fn of CALLABLE) {
      expect([fn, await canRun('authenticated', fn)]).toEqual([fn, true])
      expect([fn, await canRun('anon', fn)]).toEqual([fn, false])
    }
    for (const fn of INTERNAL) {
      expect([fn, await canRun('authenticated', fn)]).toEqual([fn, false])
      expect([fn, await canRun('anon', fn)]).toEqual([fn, false])
    }
    await expect(asUser(db, OWNER, 'select public.piece_member_limit($1)', [PIECE])).rejects.toThrow(/permission denied/)
  })

  it('anon cannot join, even a piece with room', async () => {
    const token = await linkOn()
    await db.exec('set role anon')
    try {
      await expect(db.query('select * from public.join_piece($1)', [token])).rejects.toThrow(/permission denied/)
      await expect(db.query('select * from public.my_held_pieces()')).rejects.toThrow(/permission denied/)
    } finally {
      await db.exec('reset role')
    }
  })

  it('list_members has one form', async () => {
    const forms = await db.query<{ proname: string }>(`select proname from pg_proc where proname = 'list_members'`)
    expect(forms.rows.map((row) => row.proname)).toEqual(['list_members'])
  })
})
