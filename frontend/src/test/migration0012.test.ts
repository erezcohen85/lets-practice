// @vitest-environment node
import { type PGlite } from '@electric-sql/pglite'
import { beforeEach, describe, expect, it } from 'vitest'
import { asService, asUser, databaseWithMigrations } from '@/test/supabaseStandIn'

const OWNER = '00000000-0000-4000-8000-0000000000b1'
const STRANGER = '00000000-0000-4000-8000-0000000000b2'
const PIECE = '00000000-0000-4000-8000-0000000000c1'
const PART = '00000000-0000-4000-8000-0000000000d1'
const OTHER_PART = '00000000-0000-4000-8000-0000000000d2'

let db: PGlite

beforeEach(async () => {
  db = await databaseWithMigrations()
  await db.exec(`
    insert into auth.users (id, email, email_confirmed_at) values
      ('${OWNER}', 'owner@example.com', now()), ('${STRANGER}', 'stranger@example.com', now());
    insert into public.pieces (id, owner_id, title) values ('${PIECE}', '${OWNER}', 'Piece');
    -- Since 0015 the tick needs a plan with Advanced Reading: the owner is a Creator here.
    insert into public.plan_emails (email, plan_id) values ('owner@example.com', 'creator');
  `)
})

const addPart = (user: string, id: string, tick: string) =>
  asUser(db, user, `insert into public.score_files (id, piece_id, storage_path, sha256, name, position${tick === '' ? '' : ', box_check'}) values ('${id}', '${PIECE}', '${OWNER}/${PIECE}/parts/${id}.pdf', 'abc', 'Flute', 0${tick === '' ? '' : `, ${tick}`})`)

describe('score_files.box_check (0012)', () => {
  it('is false for a part added without the tick, and true for one added with it', async () => {
    await addPart(OWNER, PART, '')
    await addPart(OWNER, OTHER_PART, 'true')

    const rows = await asUser<{ id: string; box_check: boolean }>(db, OWNER, 'select id, box_check from public.score_files order by id')
    expect(rows).toEqual([{ id: PART, box_check: false }, { id: OTHER_PART, box_check: true }])
  })

  it('cannot be null', async () => {
    await expect(addPart(OWNER, PART, 'null')).rejects.toThrow()
  })

  it('does not let another user add a part with the tick to the piece, or read it', async () => {
    await expect(addPart(STRANGER, PART, 'true')).rejects.toThrow()
    await addPart(OWNER, OTHER_PART, 'true')

    expect(await asUser(db, STRANGER, 'select box_check from public.score_files')).toEqual([])
  })

  it('is read by the processor, which writes the flags it finds in box_flags', async () => {
    await addPart(OWNER, PART, 'true')

    const rows = await asService<{ box_check: boolean }>(db, `select box_check from public.score_files where id = '${PART}'`)
    expect(rows).toEqual([{ box_check: true }])
    await asService(db, `update public.score_files set box_flags = '[{"bar":2,"verdict":"too-wide","note":"x","suggestedX":null}]'::jsonb where id = '${PART}'`)
    const flags = await asService<{ n: number }>(db, `select jsonb_array_length(box_flags) as n from public.score_files where id = '${PART}'`)
    expect(flags).toEqual([{ n: 1 }])
  })

  it('is not readable by a signed-out caller', async () => {
    await expect(db.exec(`set role anon; select box_check from public.score_files;`)).rejects.toThrow()
    await db.exec('reset role;')
  })
})
