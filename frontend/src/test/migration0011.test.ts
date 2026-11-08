// @vitest-environment node
import { type PGlite } from '@electric-sql/pglite'
import { beforeEach, describe, expect, it } from 'vitest'
import { asUser, databaseWithMigrations } from '@/test/supabaseStandIn'

const ME = '00000000-0000-4000-8000-0000000000a1'
const FRIEND = '00000000-0000-4000-8000-0000000000a2'
const STRANGER = '00000000-0000-4000-8000-0000000000a3'
const ADMIN = '00000000-0000-4000-8000-0000000000a4'
const THEIR_PIECE = '00000000-0000-4000-8000-0000000000f1'
const STRANGERS_PIECE = '00000000-0000-4000-8000-0000000000f2'
const MY_PIECE = '00000000-0000-4000-8000-0000000000f3'

let db: PGlite

const count = async (sql: string) => Number((await db.query<{ n: string }>(`select count(*) as n from ${sql}`)).rows[0]!.n)
const deleteAccount = (user: string) => asUser(db, user, 'select public.delete_account()')

// Every test gets the same small world: a friend who owns a piece that ME joined, a stranger with a piece, and an admin.
beforeEach(async () => {
  db = await databaseWithMigrations()
  await db.exec(`
    insert into auth.users (id, email, email_confirmed_at) values
      ('${ME}', 'me@example.com', now()), ('${FRIEND}', 'friend@example.com', now()),
      ('${STRANGER}', 'stranger@example.com', now()), ('${ADMIN}', 'admin@example.com', now());
    insert into public.admins (user_id) values ('${ADMIN}');
    insert into public.plan_emails (email, plan_id, added_by) values ('me@example.com', 'creator', '${ME}');
    insert into public.pieces (id, owner_id, title) values
      ('${THEIR_PIECE}', '${FRIEND}', 'Friend''s piece'), ('${STRANGERS_PIECE}', '${STRANGER}', 'Stranger''s piece');
    insert into public.piece_shares (piece_id, token) values ('${THEIR_PIECE}', 'a-token');
    insert into public.piece_members (piece_id, user_id) values ('${THEIR_PIECE}', '${ME}');
    insert into public.piece_practice (piece_id, user_id) values ('${THEIR_PIECE}', '${ME}');
  `)
})

describe('delete_account()', () => {
  it('deletes the caller: the login, the profile, the memberships and the practice memory', async () => {
    await deleteAccount(ME)

    expect(await count(`auth.users where id = '${ME}'`)).toBe(0)
    expect(await count(`public.profiles where id = '${ME}'`)).toBe(0)
    expect(await count(`public.piece_members where user_id = '${ME}'`)).toBe(0)
    expect(await count(`public.piece_practice where user_id = '${ME}'`)).toBe(0)
  })

  it('leaves the piece the caller only joined, its owner and its share link as they were', async () => {
    await deleteAccount(ME)

    expect(await count(`public.pieces where id = '${THEIR_PIECE}'`)).toBe(1)
    expect(await count(`public.piece_shares where piece_id = '${THEIR_PIECE}'`)).toBe(1)
    expect(await count(`auth.users where id = '${FRIEND}'`)).toBe(1)
  })

  it('leaves a stranger, their profile and their pieces untouched', async () => {
    await deleteAccount(ME)

    expect(await count(`auth.users where id = '${STRANGER}'`)).toBe(1)
    expect(await count(`public.profiles where id = '${STRANGER}'`)).toBe(1)
    expect(await count(`public.pieces where id = '${STRANGERS_PIECE}'`)).toBe(1)
  })

  it('keeps the plan entry the caller added, and only forgets who added it', async () => {
    await deleteAccount(ME)

    expect((await db.query<{ added_by: string | null }>(`select added_by from public.plan_emails where email = 'me@example.com'`)).rows).toEqual([{ added_by: null }])
  })

  it('keeps the membership and the shared piece of another member who is still there', async () => {
    await db.exec(`insert into public.piece_members (piece_id, user_id) values ('${THEIR_PIECE}', '${STRANGER}')`)

    await deleteAccount(ME)

    expect(await count(`public.piece_members where piece_id = '${THEIR_PIECE}' and user_id = '${STRANGER}'`)).toBe(1)
    expect(await count(`public.pieces where id = '${THEIR_PIECE}'`)).toBe(1)
  })

  it('refuses a caller who still owns a piece, so no Storage file is left behind, and changes nothing', async () => {
    await db.exec(`insert into public.pieces (id, owner_id, title) values ('${MY_PIECE}', '${ME}', 'Mine')`)

    await expect(deleteAccount(ME)).rejects.toThrow()

    expect(await count(`auth.users where id = '${ME}'`)).toBe(1)
    expect(await count(`public.pieces where id = '${MY_PIECE}'`)).toBe(1)
    expect(await count(`public.piece_members where user_id = '${ME}'`)).toBe(1)
  })

  it('works once the caller has deleted their pieces', async () => {
    await db.exec(`insert into public.pieces (id, owner_id, title) values ('${MY_PIECE}', '${ME}', 'Mine')`)
    await asUser(db, ME, 'delete from public.pieces where id = $1', [MY_PIECE])

    await deleteAccount(ME)

    expect(await count(`auth.users where id = '${ME}'`)).toBe(0)
  })

  it('refuses the admin, with insufficient_privilege, and changes nothing', async () => {
    await expect(deleteAccount(ADMIN)).rejects.toMatchObject({ code: '42501' })

    expect(await count(`auth.users where id = '${ADMIN}'`)).toBe(1)
    expect(await count(`public.admins where user_id = '${ADMIN}'`)).toBe(1)
  })

  it('refuses a caller with no sign-in, and deletes nobody', async () => {
    const before = await count('auth.users')
    await db.exec(`select set_config('request.jwt.claim.sub', '', false); set role authenticated;`)
    try {
      await expect(db.query('select public.delete_account()')).rejects.toThrow()
    } finally {
      await db.exec('reset role;')
    }

    expect(await count('auth.users')).toBe(before)
  })

  it('is not open to anon', async () => {
    await db.exec(`select set_config('request.jwt.claim.sub', '${ME}', false); set role anon;`)
    try {
      await expect(db.query('select public.delete_account()')).rejects.toMatchObject({ code: '42501' })
    } finally {
      await db.exec('reset role;')
    }

    expect(await count(`auth.users where id = '${ME}'`)).toBe(1)
  })

  it('takes no user id: it is a function of no arguments, and only the caller can be deleted', async () => {
    const { rows } = await db.query<{ args: string }>(
      `select pg_get_function_identity_arguments(p.oid) as args from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'delete_account'`,
    )

    expect(rows).toEqual([{ args: '' }])
  })
})
