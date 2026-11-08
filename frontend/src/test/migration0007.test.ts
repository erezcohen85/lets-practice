// @vitest-environment node
// frontend/src/test/migration0007.test.ts
import { type PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'
import { asUser, databaseWithMigrations } from '@/test/supabaseStandIn'

const A = '00000000-0000-4000-8000-00000000000a' // the owner and admin
const B = '00000000-0000-4000-8000-00000000000b'
const C = '00000000-0000-4000-8000-00000000000c'
const M = '00000000-0000-4000-8000-00000000000e' // a member from the start, so the stranger reads face a live share
const PIECE = '00000000-0000-4000-8000-0000000000f1'
const PART = '00000000-0000-4000-8000-0000000000f2'
const ORPHAN = '00000000-0000-4000-8000-0000000000f3'
const PIECE2 = '00000000-0000-4000-8000-0000000000f4' // A's, never shared
const GONE = '00000000-0000-4000-8000-0000000000f5' // deleted with its files left behind

/** Every table a member may read, with a harmless update for each. Every one has a row for PIECE in the seed. */
const SHARED: Record<string, string> = {
  pieces: `title = 'x'`,
  score_files: `name = 'x'`,
  score_pages: `width = 1`,
  bars: `w = 1`,
  audio_sources: `url_or_path = 'x'`,
  play_order: `rows = '[{"from":1,"to":2}]'::jsonb`,
  locators: `time_sec = 9`,
  jobs: `progress = 0.5`,
}
/** Tables a stranger, and a member too, must find empty (the owner sees these; a member sees only their own member row). */
const PRIVATE = ['piece_shares', 'piece_members', 'piece_practice']
/** Tables no signed-in role may even select from: only the security definer functions read them (no grant, and no policy). */
const CLOSED = ['plan_emails', 'admins']
/** What Postgres says when a role has no privilege for the statement, which is checked before RLS. */
const NO_PRIVILEGE = /permission denied/

let db: PGlite

async function join(user: string, token: string) {
  return (await asUser<{ piece_id: string | null; status: string }>(db, user, 'select * from public.join_piece($1)', [token]))[0]!
}
async function freshToken(): Promise<string> {
  return (await asUser<{ t: string }>(db, A, 'select public.reset_share_token($1) as t', [PIECE]))[0]!.t
}
/** What the owner sees in every table a member can read, as text, to compare before and after a member's attempts. */
async function ownerSnapshot(): Promise<string> {
  const parts: unknown[] = []
  for (const table of Object.keys(SHARED)) parts.push(await asUser(db, A, `select * from public.${table} order by 1`))
  parts.push(await asUser(db, A, 'select name from storage.objects order by name'))
  parts.push(await asUser(db, A, 'select * from public.piece_shares'))
  return JSON.stringify(parts)
}
async function expectNothingVisible(user: string, label: string, skip: string[] = []) {
  for (const table of [...Object.keys(SHARED), ...PRIVATE].filter((name) => !skip.includes(name))) {
    expect(await asUser(db, user, `select * from public.${table}`), `${label}: ${table}`).toEqual([])
  }
  for (const table of CLOSED.filter((name) => !skip.includes(name))) {
    await expect(asUser(db, user, `select * from public.${table}`), `${label}: ${table}`).rejects.toThrow(NO_PRIVILEGE)
  }
  expect(await asUser(db, user, 'select * from storage.objects'), `${label}: storage`).toEqual([])
}

beforeAll(async () => {
  db = await databaseWithMigrations()
  // The superuser, as a sign-up and the SQL editor line of spec 4.2 would. Everyone has a confirmed email.
  await db.exec(`
    insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
      ('${A}', 'Owner@Example.com', now(), '{"full_name":"Ana Owner"}'),
      ('${B}', 'b@example.com', now(), '{"full_name":"Bo Member"}'),
      ('${C}', 'c@example.com', now(), '{"full_name":"Cy Stranger"}'),
      ('${M}', 'm@example.com', now(), '{"full_name":"Mia Member"}');
    insert into public.admins (user_id) values ('${A}');
    insert into public.pieces (id, owner_id, title) values ('${PIECE}', '${A}', 'Etude'), ('${PIECE2}', '${A}', 'Private');
    insert into public.score_files (id, piece_id, storage_path, sha256, page_count, name)
      values ('${PART}', '${PIECE}', '${A}/${PIECE}/a.pdf', 'x', 1, 'Part');
    insert into public.score_pages (score_file_id, page_index, image_path, width, height) values ('${PART}', 0, 'p.png', 100, 100);
    insert into public.bars (score_file_id, bar_number, page_index, x, y, w, h) values ('${PART}', 1, 0, 0, 0, 10, 10);
    insert into public.audio_sources (piece_id, kind, url_or_path) values ('${PIECE}', 'file', '${A}/${PIECE}/rec.mp3');
    insert into public.play_order (piece_id) values ('${PIECE}');
    insert into public.locators (piece_id, pass_index, bar_number, time_sec) values ('${PIECE}', 0, 1, 1);
    insert into public.jobs (piece_id, kind) values ('${PIECE}', 'process-piece');
    insert into storage.objects (bucket_id, name) values
      ('pieces', '${A}/${PIECE}/a.pdf'),
      ('pieces', '${A}/not-a-uuid/a.pdf');
  `)
  // A live share, a member with their own memory, a listed plan email and the owner's memory all exist
  // before the first stranger read, so a policy that opens any of them to everyone shows up.
  const token = (await asUser<{ token: string }>(db, A, 'select * from public.create_or_get_share($1)', [PIECE]))[0]!.token
  // Since migration 0013 a new link starts off, and the owner confirms the rights to turn it on.
  await asUser(db, A, 'select public.set_share_enabled($1, true, true)', [PIECE])
  await db.exec(`insert into public.plan_emails (email, plan_id) values ('listed@example.com', 'creator')`)
  await asUser(db, A, `insert into public.piece_practice (user_id, piece_id, practice) values ('${A}', '${PIECE}', '{"speed":1}')`)
  expect((await join(M, token)).status).toBe('joined')
  await asUser(db, M, `insert into public.piece_practice (user_id, piece_id, practice) values ('${M}', '${PIECE}', '{"speed":0.7}')`)
}, 60_000)

describe('migration 0007 on a running database', () => {
  it('copies display name and email into a new profile', async () => {
    const rows = await asUser<{ display_name: string; email: string }>(db, B, 'select display_name, email from public.profiles')
    expect(rows).toEqual([{ display_name: 'Bo Member', email: 'b@example.com' }])
  })

  it('does not let a user change the name and email others see', async () => {
    await expect(asUser(db, B, `update public.profiles set display_name = 'The Owner'`)).rejects.toThrow(/permission denied/)
    await expect(asUser(db, B, `update public.profiles set email = 'x@example.com'`)).rejects.toThrow(/permission denied/)
    await asUser(db, B, `update public.profiles set accepted_terms_at = now(), accepted_terms_version = '2026-11-02', settings = '{}'`)
  })

  it('nobody inserts a profile by hand, and nobody calls the sign-up trigger function', async () => {
    const E = '00000000-0000-4000-8000-0000000000e1'
    await db.exec(`insert into auth.users (id, email, email_confirmed_at) values ('${E}', 'e@example.com', now())`)
    expect(await asUser(db, E, 'select id from public.profiles')).toHaveLength(1) // the trigger made it
    await db.exec(`delete from public.profiles where id = '${E}'`) // a user cannot do this; only the superuser here
    await expect(
      asUser(db, E, `insert into public.profiles (id, display_name, email) values ('${E}', 'Erez Cohen', 'erez@example.com')`),
    ).rejects.toThrow(/permission denied/)
    await expect(asUser(db, B, 'select public.handle_new_user()')).rejects.toThrow(/permission denied/)
  })

  it('before joining, strangers read none of A\'s rows or files, with a share, a member and a plan email in place', async () => {
    // Sanity: the owner sees the rows, so an empty answer for a stranger means the policy held, not that the seed is empty.
    for (const table of [...Object.keys(SHARED), 'piece_shares', 'piece_members', 'piece_practice']) {
      expect((await asUser(db, A, `select * from public.${table}`)).length, `owner: ${table}`).toBeGreaterThan(0)
    }
    expect(await asUser(db, B, `select * from public.profiles where id <> '${B}'`)).toEqual([])
    await expectNothingVisible(B, 'B')
    await expectNothingVisible(C, 'C')
  })

  it('a malformed path is a plain false for a storage read, not an error', async () => {
    const seen = await asUser<{ name: string }>(db, A, 'select name from storage.objects order by name')
    expect(seen.map((row) => row.name)).toContain(`${A}/not-a-uuid/a.pdf`) // A's own folder
    expect(await asUser(db, B, 'select name from storage.objects')).toEqual([])
  })

  it('a share token is 24 URL-safe characters, and only the owner can make one', async () => {
    const token = await freshToken()
    expect(token).toMatch(/^[A-Za-z0-9_-]{24}$/)
    await expect(asUser(db, B, 'select * from public.create_or_get_share($1)', [PIECE])).rejects.toThrow(/not your piece/)
    await expect(asUser(db, B, 'select public.reset_share_token($1)', [PIECE])).rejects.toThrow(/not your piece/)
    await expect(asUser(db, B, 'select public.set_share_enabled($1, false)', [PIECE])).rejects.toThrow(/not your piece/)
  })

  it('not even the owner writes a share row directly, so no weak token; the functions still work', async () => {
    const before = (await asUser<{ token: string }>(db, A, 'select token from public.piece_shares'))[0]!.token
    // The owner may read the row and nothing else: no grant to write it, and no policy either.
    await expect(asUser(db, A, `update public.piece_shares set token = 'a' returning piece_id`)).rejects.toThrow(NO_PRIVILEGE)
    await expect(asUser(db, A, 'delete from public.piece_shares returning piece_id')).rejects.toThrow(NO_PRIVILEGE)
    await expect(asUser(db, A, `insert into public.piece_shares (piece_id, token) values ('${PIECE2}', 'weak')`)).rejects.toThrow(NO_PRIVILEGE)
    expect((await asUser<{ token: string }>(db, A, 'select token from public.piece_shares'))[0]!.token).toBe(before)
    expect((await asUser<{ token: string }>(db, A, 'select token from public.create_or_get_share($1)', [PIECE]))[0]!.token).toBe(before)
    expect(await freshToken()).toMatch(/^[A-Za-z0-9_-]{24}$/)
  })

  it('every join status', async () => {
    const token = await freshToken()
    expect((await join(B, 'nope')).status).toBe('not_found')
    expect((await join(A, token)).status).toBe('owner')
    expect(await join(B, token)).toEqual({ piece_id: PIECE, status: 'joined' })
    expect((await join(B, token)).status).toBe('already_member')
  })

  it('a member reads the piece, pages, bars, recording, map and file, and nothing private', async () => {
    for (const table of Object.keys(SHARED)) {
      expect(await asUser(db, B, `select * from public.${table}`), table).toHaveLength(1)
    }
    expect(await asUser<{ name: string }>(db, B, 'select name from storage.objects')).toEqual([{ name: `${A}/${PIECE}/a.pdf` }])
    // The link, the other members, the plan list, the admin list and other people's memory stay closed.
    expect(await asUser(db, B, 'select * from public.piece_shares')).toEqual([])
    await expect(asUser(db, B, 'select * from public.plan_emails')).rejects.toThrow(NO_PRIVILEGE)
    await expect(asUser(db, B, 'select * from public.admins')).rejects.toThrow(NO_PRIVILEGE)
    expect(await asUser(db, B, 'select * from public.piece_practice')).toEqual([])
    expect(await asUser<{ user_id: string }>(db, B, 'select user_id from public.piece_members')).toEqual([{ user_id: B }])
  })

  it('a member\'s every write fails, and the owner still sees the same data', async () => {
    const before = await ownerSnapshot()
    for (const [table, change] of Object.entries(SHARED)) {
      if (table === 'jobs') {
        // The app only reads jobs (the processor writes them): there is no grant to update or delete one.
        await expect(asUser(db, B, `update public.${table} set ${change} returning 1 as hit`), `update ${table}`).rejects.toThrow(NO_PRIVILEGE)
        await expect(asUser(db, B, `delete from public.${table} returning 1 as hit`), `delete ${table}`).rejects.toThrow(NO_PRIVILEGE)
        continue
      }
      expect(await asUser(db, B, `update public.${table} set ${change} returning 1 as hit`), `update ${table}`).toEqual([])
      expect(await asUser(db, B, `delete from public.${table} returning 1 as hit`), `delete ${table}`).toEqual([])
    }
    const inserts = [
      `insert into public.score_files (piece_id, storage_path, sha256, page_count, name) values ('${PIECE}', 'p', 'x', 1, 'n')`,
      `insert into public.score_pages (score_file_id, page_index, image_path, width, height) values ('${PART}', 5, 'p.png', 1, 1)`,
      `insert into public.bars (score_file_id, bar_number, page_index, x, y, w, h) values ('${PART}', 5, 0, 0, 0, 1, 1)`,
      `insert into public.audio_sources (piece_id, kind, url_or_path) values ('${PIECE}', 'file', 'x')`,
      `insert into public.play_order (piece_id) values ('${PIECE}')`,
      `insert into public.locators (piece_id, pass_index, bar_number, time_sec) values ('${PIECE}', 0, 7, 1)`,
      `insert into public.jobs (piece_id, kind) values ('${PIECE}', 'realign')`,
      `insert into storage.objects (bucket_id, name) values ('pieces', '${A}/${PIECE}/x.pdf')`,
    ]
    for (const sql of inserts) {
      await expect(asUser(db, B, sql), sql).rejects.toThrow(sql.startsWith('insert into public.jobs') ? NO_PRIVILEGE : /row-level security/)
    }
    // Storage: a member can neither rename nor remove the owner's files.
    expect(await asUser(db, B, `update storage.objects set name = name || 'x' returning name`)).toEqual([])
    expect(await asUser(db, B, 'delete from storage.objects returning name')).toEqual([])
    await expect(asUser(db, B, `update public.piece_members set user_id = '${C}' returning user_id`)).rejects.toThrow(NO_PRIVILEGE)
    expect(await ownerSnapshot()).toBe(before)
  })

  it('a change the owner makes shows for the member on the next read', async () => {
    await asUser(db, A, `update public.locators set time_sec = 2.5 where piece_id = '${PIECE}'`)
    expect(await asUser<{ time_sec: number }>(db, B, 'select time_sec from public.locators')).toEqual([{ time_sec: 2.5 }])
  })

  it('nobody can add themselves as a member directly', async () => {
    await expect(asUser(db, C, `insert into public.piece_members (piece_id, user_id) values ('${PIECE}', '${C}')`)).rejects.toThrow(NO_PRIVILEGE)
    await expect(asUser(db, A, `insert into public.piece_members (piece_id, user_id) values ('${PIECE}', '${C}')`)).rejects.toThrow(NO_PRIVILEGE)
  })

  it('a member\'s practice memory never touches the owner\'s, and stays on pieces they can read', async () => {
    await asUser(db, B, `insert into public.piece_practice (user_id, piece_id, practice, count_in_bars) values ('${B}', '${PIECE}', '{"speed":0.5}', 2)`)
    await asUser(db, A, `insert into public.piece_practice (user_id, piece_id, practice) values ('${A}', '${PIECE}', '{"speed":1}') on conflict (user_id, piece_id) do update set practice = excluded.practice`)
    await asUser(db, B, `update public.piece_practice set practice = '{"speed":0.25}'`)
    const mine = await asUser<{ practice: { speed: number } }>(db, A, 'select practice from public.piece_practice')
    expect(mine).toEqual([{ practice: { speed: 1 } }])
    expect(await asUser(db, B, 'select practice from public.piece_practice')).toEqual([{ practice: { speed: 0.25 } }])
    await expect(asUser(db, C, `insert into public.piece_practice (user_id, piece_id) values ('${C}', '${PIECE}')`)).rejects.toThrow(/row-level security/)
    // An update may not move the row onto a piece the user cannot read (it would dodge the insert rule).
    await expect(asUser(db, B, `update public.piece_practice set piece_id = '${PIECE2}'`)).rejects.toThrow(/row-level security/)
    expect(await asUser(db, B, 'select piece_id from public.piece_practice')).toEqual([{ piece_id: PIECE }])
  })

  it('names come only through the functions, and only for pieces the caller can read', async () => {
    const asMember = await asUser(db, B, 'select * from public.piece_owner_names($1)', [[PIECE]])
    expect(asMember).toEqual([{ piece_id: PIECE, display_name: 'Ana Owner' }])
    expect(await asUser(db, B, 'select * from public.piece_owner_names($1)', [[PIECE, PIECE2]])).toEqual(asMember)
    expect(await asUser(db, C, 'select * from public.piece_owner_names($1)', [[PIECE]])).toEqual([])
    expect(await asUser(db, B, 'select * from public.list_members($1)', [PIECE])).toEqual([])
    const members = await asUser<{ email: string; display_name: string }>(db, A, 'select * from public.list_members($1)', [PIECE])
    expect(members.map((m) => [m.display_name, m.email]).sort()).toEqual([
      ['Bo Member', 'b@example.com'],
      ['Mia Member', 'm@example.com'],
    ])
  })

  it('turning the link off stops new joins and keeps people who joined', async () => {
    const token = (await asUser<{ token: string }>(db, A, 'select * from public.create_or_get_share($1)', [PIECE]))[0]!.token
    await asUser(db, A, 'select public.set_share_enabled($1, false)', [PIECE])
    expect(await join(C, token)).toEqual({ piece_id: null, status: 'link_off' })
    expect((await join(B, token)).status).toBe('already_member')
    expect((await join(A, token)).status).toBe('owner')
    expect(await asUser(db, B, 'select id from public.pieces')).toHaveLength(1)
    await asUser(db, A, 'select public.set_share_enabled($1, true)', [PIECE])
  })

  it('resetting the link kills the old one', async () => {
    const old = (await asUser<{ token: string }>(db, A, 'select * from public.create_or_get_share($1)', [PIECE]))[0]!.token
    const fresh = await freshToken()
    expect(fresh).not.toBe(old)
    expect((await join(C, old)).status).toBe('not_found')
  })

  it('an owner removes a member, and they read nothing', async () => {
    await asUser(db, A, 'delete from public.piece_members where user_id = $1', [B])
    // Removing a member leaves their own practice row (it is theirs, and it opens nothing); leaving deletes it.
    await expectNothingVisible(B, 'removed B', ['piece_practice'])
  })

  it('a member leaves and loses their memory; an owner calling leave loses nothing', async () => {
    expect((await join(B, await freshToken())).status).toBe('joined')
    await asUser(db, B, 'select public.leave_piece($1)', [PIECE])
    expect(await asUser(db, B, 'select id from public.pieces')).toEqual([])
    expect(await asUser(db, B, 'select * from public.piece_practice')).toEqual([])
    await asUser(db, A, 'select public.leave_piece($1)', [PIECE])
    expect(await asUser(db, A, 'select * from public.piece_practice')).toHaveLength(1)
  })

  it('a Trial user cannot upload a file under a piece that is not theirs (and is no creator by the shim)', async () => {
    // Since 0015 a Trial user may make a piece; what stays refused is a path under a piece they do not own.
    await expect(asUser(db, B, `insert into storage.objects (bucket_id, name) values ('pieces', '${B}/${ORPHAN}/x.pdf')`)).rejects.toThrow(/row-level security/)
    expect((await asUser<{ c: boolean }>(db, B, 'select public.is_creator() as c'))[0]!.c).toBe(false)
  })

  it('the admin functions refuse everyone but the admin, and the tables are unreadable', async () => {
    for (const sql of ['select public.admin_overview()', `select public.save_admin_changes('{}'::jsonb)`]) {
      await expect(asUser(db, B, sql), sql).rejects.toThrow(/admin only/)
    }
    await expect(asUser(db, A, 'select * from public.admins')).rejects.toThrow(NO_PRIVILEGE)
    await expect(asUser(db, A, 'select * from public.plan_emails')).rejects.toThrow(NO_PRIVILEGE)
    expect((await asUser<{ a: boolean }>(db, A, 'select public.is_admin() as a'))[0]!.a).toBe(true)
  })

  it('a plan given by email: before first sign-in, then removed', async () => {
    const LATE = '00000000-0000-4000-8000-00000000000d'
    const people = async () => (await asUser<{ o: { people: { email: string; signed_up: boolean; display_name: string | null; plan_id: string }[] } }>(db, A, 'select public.admin_overview() as o'))[0]!.o.people
    await asUser(db, A, `select public.save_admin_changes('{"people":[{"email":"  Late@Example.COM ","plan_id":"creator"},{"email":"late@example.com","plan_id":"creator"}]}')`) // twice: unchanged, no error
    await expect(asUser(db, A, `select public.save_admin_changes('{"people":[{"email":"nonsense","plan_id":"creator"}]}')`)).rejects.toThrow(/not an email/)
    expect((await people()).find((p) => p.email === 'late@example.com')).toMatchObject({ signed_up: false, display_name: null, plan_id: 'creator' })

    await db.exec(`insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values ('${LATE}', 'late@example.com', now(), '{"full_name":"Late Comer"}')`)
    expect((await people()).find((p) => p.email === 'late@example.com')).toMatchObject({ signed_up: true, display_name: 'Late Comer', plan_id: 'creator' })
    const made = await asUser<{ id: string }>(db, LATE, `insert into public.pieces (title) values ('Late piece') returning id`)
    expect(made).toHaveLength(1)

    await asUser(db, A, `select public.save_admin_changes('{"people":[{"email":"late@example.com","remove":true}]}')`)
    expect((await people()).find((p) => p.email === 'late@example.com')).toMatchObject({ signed_up: true, plan_id: 'trial' })
    expect(await asUser(db, LATE, 'select id from public.pieces')).toHaveLength(1) // their piece stays
  })

  it('a listed email that is not confirmed gets no plan until it is confirmed', async () => {
    const U = '00000000-0000-4000-8000-0000000000d2'
    await asUser(db, A, `select public.save_admin_changes('{"people":[{"email":"unconfirmed@example.com","plan_id":"creator"}]}')`)
    await db.exec(`insert into auth.users (id, email) values ('${U}', 'unconfirmed@example.com')`) // email_confirmed_at stays null
    expect((await asUser<{ c: boolean }>(db, U, 'select public.is_creator() as c'))[0]!.c).toBe(false)
    await db.exec(`update auth.users set email_confirmed_at = now() where id = '${U}'`)
    expect((await asUser<{ c: boolean }>(db, U, 'select public.is_creator() as c'))[0]!.c).toBe(true)
  })

  it('files left behind by a deleted piece do not open for whoever re-creates its id', async () => {
    await db.exec(`
      insert into public.pieces (id, owner_id, title) values ('${GONE}', '${A}', 'Gone');
      insert into storage.objects (bucket_id, name) values ('pieces', '${A}/${GONE}/a.pdf');
    `)
    await asUser(db, A, 'delete from public.pieces where id = $1', [GONE])
    const left = await asUser<{ name: string }>(db, A, 'select name from storage.objects where name like $1', [`%/${GONE}/%`])
    expect(left).toHaveLength(1) // the file is still there, the piece is not
    // C picks the same id for a piece of their own.
    await asUser(db, C, `insert into public.pieces (id, title) values ('${GONE}', 'mine')`)
    expect((await asUser<{ ok: boolean }>(db, C, 'select public.can_read_piece($1) as ok', [GONE]))[0]!.ok).toBe(true)
    expect(await asUser(db, C, 'select name from storage.objects where name like $1', [`%/${GONE}/%`])).toEqual([])
  })

  it('anon has no way in', async () => {
    await db.exec('set role anon')
    try {
      await expect(db.query(`select public.join_piece('x')`)).rejects.toThrow(/permission denied/)
      await expect(db.query('select public.is_creator()')).rejects.toThrow(/permission denied/)
      // No grant on any table: refused before RLS is asked.
      for (const table of [...Object.keys(SHARED), ...PRIVATE, ...CLOSED, 'profiles']) {
        await expect(db.query(`select * from public.${table}`), table).rejects.toThrow(NO_PRIVILEGE)
      }
    } finally {
      await db.exec('reset role')
    }
  })

  // Migration 0008: nobody signed in may store a large value, the cost the creators gate exists to stop.
  describe('size limits (0008)', () => {
    const big = (bytes: number) => JSON.stringify({ pad: 'x'.repeat(bytes) })

    it('what the app really writes passes, and so does a very long practice memory', async () => {
      const settings = JSON.stringify({
        follow: { scroll: 'line', box: true, boxColour: 'teal', line: true, lineColour: 'teal' },
        playback: { countInFade: 'long', showCount: true },
        nightScore: false,
        barNumbers: true,
        barLineMode: 'ripple',
      })
      expect(settings.length).toBeLessThan(400)
      const memory = {
        metronome: { on: true, volume: 0.8, tone: 'wood' },
        musicVolume: 1,
        speed: 0.75,
        loop: { from: 12, to: 20 },
        loopOn: true,
        countInEveryRepeat: false,
        countInMetronome: true,
      }
      // The memory keeps one loop today; 400 loops (about 18 KB) shows the 64 KB limit leaves room to grow.
      const long = { ...memory, loops: Array.from({ length: 400 }, (_, i) => ({ from: 1000 + i, to: 2000 + i, name: 'a loop of the piece' })) }
      expect(JSON.stringify(long).length).toBeGreaterThan(18_000)
      for (const user of [C, M]) {
        await asUser(db, user, `update public.profiles set settings = $1::jsonb, accepted_terms_version = '2026-11-02'`, [settings])
      }
      await asUser(db, M, `update public.piece_practice set practice = $1::jsonb`, [JSON.stringify(memory)])
      await asUser(db, M, `update public.piece_practice set practice = $1::jsonb`, [JSON.stringify(long)])
      expect((await asUser<{ n: number }>(db, M, 'select jsonb_array_length(practice->\'loops\') as n from public.piece_practice'))[0]!.n).toBe(400)
      await asUser(db, M, `update public.piece_practice set practice = '{"speed":0.7}'`) // back to what the seed holds
    })

    it('an oversize settings value is refused for a stranger and for a member, and the old value stays', async () => {
      for (const user of [C, M]) {
        await expect(asUser(db, user, `update public.profiles set settings = $1::jsonb`, [big(20_000)]), user).rejects.toThrow(/profiles_settings_size/)
        await expect(asUser(db, user, `update public.profiles set settings = $1::jsonb`, [big(20_000_000)]), user).rejects.toThrow(/profiles_settings_size/)
        expect((await asUser<{ n: number }>(db, user, 'select octet_length(settings::text) as n from public.profiles'))[0]!.n).toBeLessThan(400)
      }
    })

    it('the terms version holds a date, not a document, counted in bytes', async () => {
      for (const user of [C, M]) {
        await asUser(db, user, `update public.profiles set accepted_terms_version = $1`, ['x'.repeat(32)])
        await expect(asUser(db, user, `update public.profiles set accepted_terms_version = $1`, ['x'.repeat(33)]), user).rejects.toThrow(/profiles_accepted_terms_version_size/)
        // 17 characters, 34 bytes: the limit counts bytes.
        await expect(asUser(db, user, `update public.profiles set accepted_terms_version = $1`, ['é'.repeat(17)]), user).rejects.toThrow(/profiles_accepted_terms_version_size/)
        await asUser(db, user, `update public.profiles set accepted_terms_version = '2026-11-02'`)
      }
    })

    it('an oversize practice memory is refused for a member, and a stranger cannot reach the table at all', async () => {
      await expect(asUser(db, M, `update public.piece_practice set practice = $1::jsonb`, [big(70_000)])).rejects.toThrow(/piece_practice_practice_size/)
      await expect(asUser(db, M, `update public.piece_practice set practice = $1::jsonb`, [big(20_000_000)])).rejects.toThrow(/piece_practice_practice_size/)
      expect(await asUser(db, M, 'select practice from public.piece_practice')).toEqual([{ practice: { speed: 0.7 } }])
      // A stranger's insert is stopped by the read rule first, and an oversize one stays stopped.
      await expect(asUser(db, C, `insert into public.piece_practice (user_id, piece_id, practice) values ('${C}', '${PIECE}', $1::jsonb)`, [big(70_000)])).rejects.toThrow(/row-level security|piece_practice_practice_size/)
      expect(await asUser(db, A, 'select count(*)::int as n from public.piece_practice where octet_length(practice::text) > 65536')).toEqual([{ n: 0 }])
    })
  })

  it('deleting the piece deletes the link, the members and the memory', async () => {
    expect((await join(B, await freshToken())).status).toBe('joined')
    await asUser(db, A, 'delete from public.pieces where id = $1', [PIECE])
    const left = await db.query<{ n: number }>(`
      select (select count(*) from public.piece_shares)::int + (select count(*) from public.piece_members)::int
           + (select count(*) from public.piece_practice where piece_id = '${PIECE}')::int as n`)
    expect(left.rows[0]!.n).toBe(0)
  })
})
