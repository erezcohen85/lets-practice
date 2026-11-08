// @vitest-environment node
import { type PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'
import { asService, asUser, databaseWithMigrations } from '@/test/supabaseStandIn'

const OWNER = '00000000-0000-4000-8000-00000000000a'
const MEMBER = '00000000-0000-4000-8000-00000000000b'
const STRANGER = '00000000-0000-4000-8000-00000000000c'
const LISTED = '00000000-0000-4000-8000-00000000000d'
const UNCONFIRMED = '00000000-0000-4000-8000-00000000000e'
const PIECE = '00000000-0000-4000-8000-0000000000f1'
const PART = '00000000-0000-4000-8000-0000000000f2'

let db: PGlite

const saveTiming = (user: string, locators: unknown[]) =>
  asUser(db, user, 'select public.save_timing($1, 8, $2, $3, $4, $5, $6)', [
    PIECE,
    JSON.stringify([{ from: 1, to: 8 }]),
    JSON.stringify([{ from_bar: 1, numerator: 4, denominator: 4 }]),
    JSON.stringify([{ bar: 2, kind: 'fermata' }]),
    JSON.stringify([]),
    JSON.stringify(locators),
  ])
const locator = (bar: number, time: number, confirmed = false) => ({ pass_index: 0, bar_number: bar, time_sec: time, confirmed, flags: [], checked: false })
const box = (bar: number) => ({ bar_number: bar, page_index: 0, x: 1, y: 2, w: 3, h: 4 })

beforeAll(async () => {
  db = await databaseWithMigrations()
  await db.exec(`
    insert into auth.users (id, email, email_confirmed_at) values
      ('${OWNER}', 'owner@example.com', now()), ('${MEMBER}', 'member@example.com', now()), ('${STRANGER}', 'stranger@example.com', now()),
      ('${LISTED}', 'Listed@Example.com', now()), ('${UNCONFIRMED}', 'unconfirmed@example.com', null);
    insert into public.admins (user_id) values ('${OWNER}');
    insert into public.plan_emails (email, plan_id) values ('listed@example.com', 'creator'), ('unconfirmed@example.com', 'creator');
    insert into public.pieces (id, owner_id, title) values ('${PIECE}', '${OWNER}', 'Etude');
    insert into public.score_files (id, piece_id, storage_path, sha256, name) values ('${PART}', '${PIECE}', 'x', 'x', 'Part');
    insert into public.piece_members (piece_id, user_id) values ('${PIECE}', '${MEMBER}');
  `)
})

describe('schema', () => {
  it('holds a pickup, a part not read yet, a part with rests', async () => {
    expect((await db.query<{ page_count: number }>(`select page_count from public.score_files where id = '${PART}'`)).rows[0]!.page_count).toBe(0)
    await db.exec(`insert into public.bars (score_file_id, bar_number, page_index, x, y, w, h) values ('${PART}', 0, 0, 0, 0, 1, 1); delete from public.bars;`)
    await db.exec(`insert into public.locators (piece_id, pass_index, bar_number, time_sec) values ('${PIECE}', 0, 0, 0); delete from public.locators;`)
    await db.exec(`update public.score_files set rests = '{3,4}' where id = '${PART}'; update public.score_files set rests = '{}' where id = '${PART}';`)
  })

  it('allows one active job per piece, and another once it has ended', async () => {
    const add = () => db.query(`insert into public.jobs (piece_id, kind) values ('${PIECE}', 'realign') returning id`)
    const first = (await add()).rows[0] as { id: string }
    await expect(add()).rejects.toMatchObject({ code: '23505' })
    await db.query(`update public.jobs set status = 'done' where id = $1`, [first.id])
    const second = (await add()).rows[0] as { id: string }
    await db.query('delete from public.jobs where id = any($1)', [[first.id, second.id]])
  })

  it('caps the bucket', async () => {
    const row = (await db.query<{ file_size_limit: string; allowed_mime_types: string[] }>(`select * from storage.buckets where id = 'pieces'`)).rows[0]!
    expect(Number(row.file_size_limit)).toBe(52428800)
    expect(row.allowed_mime_types).toEqual(expect.arrayContaining(['application/pdf', 'audio/*', 'image/webp', 'application/json', 'application/octet-stream']))
  })
})

describe('save_timing', () => {
  it('replaces the timing for the owner', async () => {
    await saveTiming(OWNER, [locator(1, 1), locator(2, 2, true)])
    await saveTiming(OWNER, [locator(1, 5)])
    const rows = await asUser<{ time_sec: number }>(db, OWNER, 'select time_sec from public.locators where piece_id = $1', [PIECE])
    expect(rows.map((row) => row.time_sec)).toEqual([5])
    const order = (await asUser<{ bar_count: number; marks: unknown[] }>(db, OWNER, 'select bar_count, marks from public.play_order where piece_id = $1', [PIECE]))[0]!
    expect(order).toEqual({ bar_count: 8, marks: [{ bar: 2, kind: 'fermata' }] })
  })

  it('leaves the old map whole when the new one is refused', async () => {
    await saveTiming(OWNER, [locator(1, 7)])
    await expect(saveTiming(OWNER, [locator(1, 1), locator(2, -1)])).rejects.toThrow()
    const rows = await asUser<{ time_sec: number }>(db, OWNER, 'select time_sec from public.locators where piece_id = $1', [PIECE])
    expect(rows.map((row) => row.time_sec)).toEqual([7])
  })

  it.each([['a member', MEMBER], ['a stranger', STRANGER]])('refuses %s', async (_, user) => {
    await expect(saveTiming(user, [])).rejects.toMatchObject({ code: '42501' })
    expect(await asUser(db, OWNER, 'select 1 from public.locators where piece_id = $1', [PIECE])).toHaveLength(1)
  })
})

describe('save_page_layer', () => {
  const save = (user: string, bars: unknown[]) => asUser(db, user, 'select public.save_page_layer($1, $2, $3, $4)', [PART, [3], JSON.stringify([]), JSON.stringify(bars)])

  it('replaces the boxes and the rests for the owner, and leaves the pages', async () => {
    await db.exec(`insert into public.score_pages (score_file_id, page_index, image_path, width, height) values ('${PART}', 0, 'p', 10, 10) on conflict do nothing`)
    await save(OWNER, [box(1), box(2)])
    await save(OWNER, [box(1)])
    expect(await asUser(db, OWNER, 'select bar_number from public.bars where score_file_id = $1', [PART])).toEqual([{ bar_number: 1 }])
    expect((await asUser<{ rests: number[] }>(db, OWNER, 'select rests from public.score_files where id = $1', [PART]))[0]!.rests).toEqual([3])
    expect(await asUser(db, OWNER, 'select 1 from public.score_pages where score_file_id = $1', [PART])).toHaveLength(1)
  })

  it.each([['a member', MEMBER], ['a stranger', STRANGER]])('refuses %s', async (_, user) => {
    await expect(save(user, [])).rejects.toMatchObject({ code: '42501' })
  })
})

describe('service functions', () => {
  it.each(['service_is_creator($1::uuid)', 'service_replace_unconfirmed_locators($1::uuid, \'[]\'::jsonb)', 'service_save_page_layer($1::uuid, \'[]\'::jsonb, \'[]\'::jsonb, \'{}\'::int[])'])(
    'a signed-in user cannot call %s',
    async (call) => {
      await expect(asUser(db, OWNER, `select public.${call}`, [PIECE])).rejects.toMatchObject({ code: '42501' })
    },
  )

  it.each([[OWNER, true], [LISTED, true], [UNCONFIRMED, false], [STRANGER, false]])('service_is_creator agrees with is_creator for %s', async (user, expected) => {
    const own = (await asUser<{ is_creator: boolean }>(db, user, 'select public.is_creator()'))[0]!.is_creator
    const service = (await asService<{ service_is_creator: boolean }>(db, 'select public.service_is_creator($1)', [user]))[0]!.service_is_creator
    expect(service).toBe(own)
    expect(service).toBe(expected)
  })

  it('never touches a confirmed locator', async () => {
    await saveTiming(OWNER, [locator(1, 1, true), locator(2, 2)])
    await asService(db, 'select public.service_replace_unconfirmed_locators($1, $2)', [PIECE, JSON.stringify([locator(2, 9), locator(3, 10)])])
    const rows = await asUser<{ bar_number: number; time_sec: number }>(db, OWNER, 'select bar_number, time_sec from public.locators where piece_id = $1 order by bar_number', [PIECE])
    expect(rows).toEqual([{ bar_number: 1, time_sec: 1 }, { bar_number: 2, time_sec: 9 }, { bar_number: 3, time_sec: 10 }])
    await expect(asService(db, 'select public.service_replace_unconfirmed_locators($1, $2)', [PIECE, JSON.stringify([locator(1, 5)])])).rejects.toMatchObject({ code: '23505' })
  })

  it('writes the pages, boxes, rests and page count together', async () => {
    await asService(db, 'select public.service_save_page_layer($1, $2, $3, $4)', [
      PART,
      JSON.stringify([{ page_index: 0, image_path: 'a', width: 5, height: 6 }, { page_index: 1, image_path: 'b', width: 5, height: 6 }]),
      JSON.stringify([box(0), box(1)]),
      [1],
    ])
    expect(await asUser(db, OWNER, 'select image_path from public.score_pages where score_file_id = $1 order by page_index', [PART])).toEqual([{ image_path: 'a' }, { image_path: 'b' }])
    expect((await asUser<{ page_count: number }>(db, OWNER, 'select page_count from public.score_files where id = $1', [PART]))[0]!.page_count).toBe(2)
    expect(await asUser(db, OWNER, 'select bar_number from public.bars where score_file_id = $1 order by bar_number', [PART])).toEqual([{ bar_number: 0 }, { bar_number: 1 }])
  })
})

describe('what service_role is granted', () => {
  // Supabase stops giving service_role a grant on each new table, so 0009 must grant the tables the processor uses.
  const TABLES = ['pieces', 'score_files', 'score_pages', 'bars', 'audio_sources', 'play_order', 'locators', 'jobs']

  it.each(TABLES)('service_role can read and write %s', async (table) => {
    for (const privilege of ['select', 'insert', 'update', 'delete']) {
      const rows = await db.query<{ ok: boolean }>('select has_table_privilege($1, $2, $3) as ok', ['service_role', `public.${table}`, privilege])
      expect([table, privilege, rows.rows[0]!.ok]).toEqual([table, privilege, true])
    }
  })

  it('reads and writes a table directly, as the processor does for jobs', async () => {
    const [job] = await asService<{ id: string }>(db, `insert into public.jobs (piece_id, kind, status) values ($1, 'realign', 'done') returning id`, [PIECE])
    expect(await asService(db, 'select 1 from public.jobs where id = $1', [job!.id])).toHaveLength(1)
    await asService(db, 'delete from public.jobs where id = $1', [job!.id])
  })

  it('gives service_role nothing on the sharing tables, and no table-wide read of profiles', async () => {
    const check = async (role: string, table: string) =>
      (await db.query<{ ok: boolean }>('select has_table_privilege($1, $2, $3) as ok', [role, `public.${table}`, 'select'])).rows[0]!.ok
    expect(await check('service_role', 'piece_shares')).toBe(false)
    expect(await check('service_role', 'profiles')).toBe(false)
  })

  it('looks an owner up by email in profiles (the import), and sees no other column', async () => {
    const found = await asService<{ id: string }>(db, 'select id from public.profiles where email = $1', ['owner@example.com'])
    expect(found).toEqual([{ id: OWNER }])
    await expect(asService(db, 'select settings from public.profiles where email = $1', ['owner@example.com'])).rejects.toMatchObject({ code: '42501' })
    await expect(asService(db, `update public.profiles set display_name = 'x' where id = $1`, [OWNER])).rejects.toMatchObject({ code: '42501' })
  })
})

describe('what authenticated and anon are granted', () => {
  // Supabase no longer grants a new table to any role, and the stand-in grants none either, so these are the migrations' own
  // grants: exactly what the policies of 0001 to 0009 allow and the app uses, and no privilege more.
  const PRIVILEGES = ['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger']
  const OWNER_TABLES = ['pieces', 'score_files', 'score_pages', 'bars', 'audio_sources', 'play_order', 'locators', 'piece_practice']
  const EXPECTED: Record<string, string[]> = {
    ...Object.fromEntries(OWNER_TABLES.map((table) => [table, ['select', 'insert', 'update', 'delete']])),
    profiles: ['select'], // the update is only the three columns of 0007, checked below; no insert
    jobs: ['select'],
    piece_shares: ['select'],
    piece_members: ['select', 'delete'],
    admins: [],
    plans: [],
    plan_emails: [],
    usage_events: [],
    trial_ledger: [],
    sample_piece: [],
    private_settings: [],
  }
  const has = async (role: string, table: string, privilege: string) =>
    (await db.query<{ ok: boolean }>('select has_table_privilege($1, $2, $3) as ok', [role, `public.${table}`, privilege])).rows[0]!.ok

  it.each(Object.entries(EXPECTED))('gives authenticated exactly %s: %j', async (table, allowed) => {
    const granted = []
    for (const privilege of PRIVILEGES) if (await has('authenticated', table, privilege)) granted.push(privilege)
    expect(granted).toEqual(allowed)
  })

  it('names every table of the public schema, so a new table cannot slip past this list', async () => {
    const tables = (await db.query<{ tablename: string }>(`select tablename from pg_tables where schemaname = 'public' order by 1`)).rows.map((row) => row.tablename)
    expect(tables).toEqual(Object.keys(EXPECTED).sort())
  })

  it('gives anon nothing on any table, in any privilege', async () => {
    for (const table of Object.keys(EXPECTED)) for (const privilege of PRIVILEGES) expect([table, privilege, await has('anon', table, privilege)]).toEqual([table, privilege, false])
  })

  it('keeps the column-level narrowing of profiles: three columns to update, no insert, nothing table-wide', async () => {
    expect(await has('authenticated', 'profiles', 'update')).toBe(false)
    expect(await has('authenticated', 'profiles', 'insert')).toBe(false)
    const columns = (await db.query<{ column_name: string }>(`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'profiles' order by ordinal_position`)).rows
    const updatable = []
    for (const { column_name } of columns) {
      const ok = (await db.query<{ ok: boolean }>(`select has_column_privilege('authenticated', 'public.profiles', $1, 'update') as ok`, [column_name])).rows[0]!.ok
      if (ok) updatable.push(column_name)
    }
    expect(updatable.sort()).toEqual(['accepted_terms_at', 'accepted_terms_version', 'settings'])
    await expect(asUser(db, OWNER, `update public.profiles set display_name = 'Someone else' where id = $1`, [OWNER])).rejects.toMatchObject({ code: '42501' })
    expect(await asUser(db, OWNER, `update public.profiles set settings = '{}' where id = $1 returning id`, [OWNER])).toHaveLength(1)
  })

  it('lets the owner write a piece and its rows, with only those grants', async () => {
    const [made] = await asUser<{ id: string }>(db, OWNER, `insert into public.pieces (title) values ('Granted') returning id`)
    await asUser(db, OWNER, `update public.pieces set title = 'Granted too' where id = $1`, [made!.id])
    expect(await asUser(db, OWNER, 'delete from public.pieces where id = $1 returning id', [made!.id])).toHaveLength(1)
  })

  it('still refuses a member and a stranger every write on the owner\'s piece', async () => {
    for (const user of [MEMBER, STRANGER]) {
      expect(await asUser(db, user, `update public.pieces set title = 'Mine now' where id = $1 returning id`, [PIECE]), 'update').toEqual([])
      expect(await asUser(db, user, 'delete from public.pieces where id = $1 returning id', [PIECE]), 'delete').toEqual([])
      expect(await asUser(db, user, `update public.score_files set name = 'x' where piece_id = $1 returning id`, [PIECE]), 'update part').toEqual([])
      await expect(asUser(db, user, `insert into public.score_files (piece_id, storage_path, sha256, name) values ($1, 'p', 'x', 'n')`, [PIECE])).rejects.toThrow(/row-level security/)
      await expect(asUser(db, user, `insert into public.locators (piece_id, pass_index, bar_number, time_sec) values ($1, 0, 9, 1)`, [PIECE])).rejects.toThrow(/row-level security/)
    }
    expect((await db.query<{ title: string }>(`select title from public.pieces where id = $1`, [PIECE])).rows[0]!.title).toBe('Etude')
  })
})

describe('a null argument', () => {
  const count = async (sql: string, id: string) => Number((await db.query<{ n: string }>(sql, [id])).rows[0]!.n)
  const locators = () => count('select count(*) as n from public.locators where piece_id = $1', PIECE)
  const bars = () => count('select count(*) as n from public.bars where score_file_id = $1', PART)

  const timing = (nulled: number) => {
    const args: unknown[] = [PIECE, 8, '[]', '[]', '[]', '[]', JSON.stringify([locator(1, 3)])]
    args[nulled] = null
    return args
  }

  it.each([1, 2, 3, 4, 5, 6])('save_timing refuses a null argument %i and keeps the map', async (nulled) => {
    const before = await locators()
    expect(before).toBeGreaterThan(0)
    await expect(
      asUser(db, OWNER, 'select public.save_timing($1::uuid, $2::int, $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb)', timing(nulled)),
    ).rejects.toMatchObject({ code: '22004' })
    expect(await locators()).toBe(before)
  })

  it.each([1, 2, 3])('save_page_layer refuses a null argument %i and keeps the boxes', async (nulled) => {
    const before = await bars()
    expect(before).toBeGreaterThan(0)
    const args: unknown[] = [PART, [3], '[]', JSON.stringify([box(5)])]
    args[nulled] = null
    await expect(asUser(db, OWNER, 'select public.save_page_layer($1::uuid, $2::int[], $3::jsonb, $4::jsonb)', args)).rejects.toMatchObject({ code: '22004' })
    expect(await bars()).toBe(before)
  })

  it('save_page_layer refuses a JSON value that is not an array', async () => {
    const before = await bars()
    await expect(asUser(db, OWNER, 'select public.save_page_layer($1::uuid, $2::int[], $3::jsonb, $4::jsonb)', [PART, [3], '[]', '{}'])).rejects.toMatchObject({ code: '22004' })
    expect(await bars()).toBe(before)
  })

  it('service_replace_unconfirmed_locators refuses a null list and keeps the rows', async () => {
    const before = await locators()
    await expect(asService(db, 'select public.service_replace_unconfirmed_locators($1::uuid, $2::jsonb)', [PIECE, null])).rejects.toMatchObject({ code: '22004' })
    expect(await locators()).toBe(before)
  })

  it.each([1, 2, 3])('service_save_page_layer refuses a null argument %i and keeps the part', async (nulled) => {
    const before = await bars()
    const args: unknown[] = [PART, JSON.stringify([{ page_index: 0, image_path: 'z', width: 1, height: 1 }]), JSON.stringify([box(7)]), [1]]
    args[nulled] = null
    await expect(asService(db, 'select public.service_save_page_layer($1::uuid, $2::jsonb, $3::jsonb, $4::int[])', args)).rejects.toMatchObject({ code: '22004' })
    expect(await bars()).toBe(before)
    expect(await count('select count(*) as n from public.score_pages where score_file_id = $1', PART)).toBe(2)
  })
})
