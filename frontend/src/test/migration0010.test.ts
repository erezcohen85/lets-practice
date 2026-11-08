// @vitest-environment node
import { type PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'
import { databaseWithMigrations } from '@/test/supabaseStandIn'

// The real Dev project was made with these default privileges (read from pg_default_acl on 2026-11-05), so every table
// of 0001 to 0009 arrived with every privilege for anon and authenticated. 0010 has to narrow them from there.
const DEV_DEFAULTS = `
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`
const PRIVILEGES = ['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger']
const OWNER_TABLES = ['pieces', 'score_files', 'score_pages', 'bars', 'audio_sources', 'play_order', 'locators', 'piece_practice']
const EXPECTED: Record<string, string[]> = {
  ...Object.fromEntries(OWNER_TABLES.map((table) => [table, ['select', 'insert', 'update', 'delete']])),
  profiles: ['select'],
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
const SERVICE_TABLES = ['pieces', 'score_files', 'score_pages', 'bars', 'audio_sources', 'play_order', 'locators', 'jobs']

describe('migration 0010, on a database with the default grants Dev has', () => {
  let db: PGlite
  const has = async (role: string, table: string, privilege: string) =>
    (await db.query<{ ok: boolean }>('select has_table_privilege($1, $2, $3) as ok', [role, `public.${table}`, privilege])).rows[0]!.ok

  beforeAll(async () => {
    db = await databaseWithMigrations(DEV_DEFAULTS)
  })

  it.each(Object.entries(EXPECTED))('leaves authenticated exactly %s: %j', async (table, allowed) => {
    const granted = []
    for (const privilege of PRIVILEGES) if (await has('authenticated', table, privilege)) granted.push(privilege)
    expect(granted).toEqual(allowed)
  })

  it('leaves anon nothing on any table', async () => {
    for (const table of Object.keys(EXPECTED)) {
      for (const privilege of PRIVILEGES) expect([table, privilege, await has('anon', table, privilege)]).toEqual([table, privilege, false])
    }
  })

  it('keeps the three updatable columns of profiles', async () => {
    const columns = (await db.query<{ column_name: string }>(`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'profiles'`)).rows
    const updatable = []
    for (const { column_name } of columns) {
      const ok = (await db.query<{ ok: boolean }>(`select has_column_privilege('authenticated', 'public.profiles', $1, 'update') as ok`, [column_name])).rows[0]!.ok
      if (ok) updatable.push(column_name)
    }
    expect(updatable.sort()).toEqual(['accepted_terms_at', 'accepted_terms_version', 'settings'])
  })

  it('does not touch the processor key', async () => {
    for (const table of SERVICE_TABLES) {
      for (const privilege of ['select', 'insert', 'update', 'delete']) expect([table, privilege, await has('service_role', table, privilege)]).toEqual([table, privilege, true])
    }
  })

  it('gives a future table nothing for anon or authenticated unless a migration grants it', async () => {
    await db.exec('create table public.a_future_table (id integer primary key)')
    for (const role of ['anon', 'authenticated']) {
      for (const privilege of PRIVILEGES) expect([role, privilege, await has(role, 'a_future_table', privilege)]).toEqual([role, privilege, false])
    }
    await db.exec('drop table public.a_future_table')
  })
})
