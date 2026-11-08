// frontend/src/test/supabaseStandIn.ts
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { PGlite } from '@electric-sql/pglite'

const MIGRATIONS = resolve(__dirname, '../../../backend/supabase/migrations')

/**
 * The few parts of Supabase the migrations lean on: the auth and storage schemas, the three roles, and its default
 * privileges on functions. No role gets an automatic table grant: Supabase stopped giving them to new projects (since
 * 2026-05-30, and to new tables on existing ones since 2026-10-30), so a migration must grant anon, authenticated and
 * service_role every table privilege it needs, and every test here then proves the grant. (The storage schema's grants
 * below are the Storage service's own, not the migrations'.)
 * Not a copy of Supabase: Task 11 runs the same checks on the real project.
 */
const STAND_IN = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create schema storage;
  create schema extensions;
  create table auth.users (id uuid primary key, email varchar(255), email_confirmed_at timestamptz, last_sign_in_at timestamptz, raw_user_meta_data jsonb not null default '{}');
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid, unique (bucket_id, name));
  alter table storage.objects enable row level security;
  create function storage.foldername(name text) returns text[] language sql immutable as $$
    select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
  $$;
  grant usage on schema public, auth, storage, extensions to anon, authenticated, service_role;
  grant execute on all functions in schema auth to anon, authenticated;
  grant execute on all functions in schema storage to anon, authenticated;
  grant select, insert, update, delete on all tables in schema storage to authenticated;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
`

const migrationFiles = () => readdirSync(MIGRATIONS).filter((name) => name.endsWith('.sql')).sort()

/**
 * A fresh database with every migration applied. `before` runs after the stand-in and before the migrations: migration
 * 0010's test uses it to start from the default table grants the real Dev project was found to have. `through` stops
 * after the migration with that number ('0014'): a test of a later migration seeds the old world, then calls
 * `applyMigration`, to prove what the migration does to data that already exists.
 */
export async function databaseWithMigrations(before = '', through = ''): Promise<PGlite> {
  const { pgcrypto } = await import('@electric-sql/pglite/contrib/pgcrypto')
  const db = await PGlite.create({ extensions: { pgcrypto } })
  await db.exec(STAND_IN)
  if (before) await db.exec(before)
  for (const file of migrationFiles().filter((name) => !through || name.slice(0, 4) <= through)) {
    await db.exec(readFileSync(join(MIGRATIONS, file), 'utf8'))
  }
  return db
}

/** Applies the one migration with that number ('0015') to a database that stopped before it. */
export async function applyMigration(db: PGlite, number: string): Promise<void> {
  const file = migrationFiles().find((name) => name.startsWith(`${number}_`))
  if (!file) throw new Error(`no migration ${number}`)
  await db.exec(readFileSync(join(MIGRATIONS, file), 'utf8'))
}

/** Runs one statement as a signed-in user, under RLS, then returns to the superuser. Rejects when Postgres refuses it. */
export async function asUser<T = Record<string, unknown>>(db: PGlite, userId: string, sql: string, params: unknown[] = []): Promise<T[]> {
  await db.exec(`select set_config('request.jwt.claim.sub', '${userId}', false); set role authenticated;`)
  try {
    return (await db.query<T>(sql, params)).rows
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`)
  }
}

/** Runs one statement as the processor's service key would: RLS does not apply, and only what is granted to service_role runs. */
export async function asService<T = Record<string, unknown>>(db: PGlite, sql: string, params: unknown[] = []): Promise<T[]> {
  await db.exec('set role service_role;')
  try {
    return (await db.query<T>(sql, params)).rows
  } finally {
    await db.exec('reset role;')
  }
}
