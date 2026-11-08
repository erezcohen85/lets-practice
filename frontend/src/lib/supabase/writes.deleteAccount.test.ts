// @vitest-environment node
import { type PGlite } from '@electric-sql/pglite'
import { beforeEach, describe, expect, it } from 'vitest'
import { createWrites } from '@/lib/supabase/writes'
import { pgliteSupabase } from '@/test/pgliteSupabase'
import { databaseWithMigrations } from '@/test/supabaseStandIn'

const OWNER = '00000000-0000-4000-8000-00000000000a'
const MEMBER = '00000000-0000-4000-8000-00000000000b'
const ADMIN = '00000000-0000-4000-8000-00000000000d'
const PIECE = '00000000-0000-4000-8000-0000000000f1'

let db: PGlite
let currentUser = MEMBER
let writes: ReturnType<typeof createWrites>
const count = async (sql: string) => Number((await db.query<{ n: string }>(`select count(*) as n from ${sql}`)).rows[0]!.n)

// The real data client's deleteAccount, on the real schema under real RLS: the same code the app runs.
beforeEach(async () => {
  db = await databaseWithMigrations()
  const sb = pgliteSupabase(db)
  writes = createWrites(sb.port, async () => {
    sb.signIn(currentUser)
    return { id: currentUser, email: 'x@example.com', name: 'X' }
  })
  currentUser = MEMBER
  await db.exec(`
    insert into auth.users (id, email, email_confirmed_at) values
      ('${OWNER}', 'o@example.com', now()), ('${MEMBER}', 'm@example.com', now()), ('${ADMIN}', 'a@example.com', now());
    insert into public.admins (user_id) values ('${ADMIN}');
    insert into public.pieces (id, owner_id, title) values ('${PIECE}', '${OWNER}', 'Etude');
    insert into public.piece_members (piece_id, user_id) values ('${PIECE}', '${MEMBER}');
  `)
})

describe('deleteAccount', () => {
  it('deletes the signed-in user, and leaves the piece they only joined, and its owner', async () => {
    await writes.deleteAccount()

    expect(await count(`auth.users where id = '${MEMBER}'`)).toBe(0)
    expect(await count(`public.piece_members where user_id = '${MEMBER}'`)).toBe(0)
    expect(await count(`public.pieces where id = '${PIECE}'`)).toBe(1)
    expect(await count(`auth.users where id = '${OWNER}'`)).toBe(1)
  })

  it('rejects while the user still owns a piece, and changes nothing', async () => {
    currentUser = OWNER

    await expect(writes.deleteAccount()).rejects.toThrow('delete your pieces first')

    expect(await count(`auth.users where id = '${OWNER}'`)).toBe(1)
    expect(await count(`public.pieces where id = '${PIECE}'`)).toBe(1)
  })

  it('rejects the admin', async () => {
    currentUser = ADMIN

    await expect(writes.deleteAccount()).rejects.toThrow('the admin cannot delete their account')

    expect(await count(`auth.users where id = '${ADMIN}'`)).toBe(1)
  })
})

describe('deleteStagedFiles', () => {
  const objectsOf = async () => (await db.query<{ name: string }>('select name from storage.objects order by name')).rows.map((row) => row.name)

  beforeEach(async () => {
    await db.exec(`
      insert into storage.objects (bucket_id, name) values
        ('pieces', '${MEMBER}/staging/aaaa.pdf'), ('pieces', '${MEMBER}/staging/aaaa.json'),
        ('pieces', '${MEMBER}/${PIECE}/parts/p.pdf'),
        ('pieces', '${OWNER}/staging/bbbb.pdf');
    `)
  })

  it('removes everything under the signed-in user\'s staging folder, and nothing else', async () => {
    await writes.deleteStagedFiles()

    expect(await objectsOf()).toEqual([`${MEMBER}/${PIECE}/parts/p.pdf`, `${OWNER}/staging/bbbb.pdf`].sort())
  })

  it('does nothing, without an error, when nothing is staged', async () => {
    currentUser = ADMIN

    await expect(writes.deleteStagedFiles()).resolves.toBeUndefined()

    expect(await objectsOf()).toHaveLength(4)
  })
})
