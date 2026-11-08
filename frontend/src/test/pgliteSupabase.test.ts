// @vitest-environment node
import { type PGlite } from '@electric-sql/pglite'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { listAllFiles, selectAll } from '@/lib/supabase/port'
import { pgliteSupabase } from '@/test/pgliteSupabase'
import { databaseWithMigrations } from '@/test/supabaseStandIn'

const A = '00000000-0000-4000-8000-00000000000a'
const B = '00000000-0000-4000-8000-00000000000b'
const PIECE = '00000000-0000-4000-8000-0000000000f1'
const PART = '00000000-0000-4000-8000-0000000000f2'

let db: PGlite
let sb: ReturnType<typeof pgliteSupabase>

beforeAll(async () => {
  db = await databaseWithMigrations()
  sb = pgliteSupabase(db)
  await db.exec(`
    insert into auth.users (id, email, email_confirmed_at) values ('${A}', 'a@example.com', now()), ('${B}', 'b@example.com', now());
    insert into public.admins (user_id) values ('${A}');
    insert into public.pieces (id, owner_id, title) values ('${PIECE}', '${A}', 'Etude');
    insert into public.score_files (id, piece_id, storage_path, sha256, name) values ('${PART}', '${PIECE}', 'x', 'x', 'Part');
    insert into public.bars (score_file_id, bar_number, page_index, x, y, w, h)
      select '${PART}', n, 0, 0, 0, 1, 1 from generate_series(1, 1200) n;
  `)
})

describe('the adapter behaves as PostgREST does for what the client relies on', () => {
  it('applies RLS to the signed-in user', async () => {
    sb.signIn(B)
    expect((await sb.port.from('pieces').select('id')).data).toEqual([])
    sb.signIn(A)
    expect((await sb.port.from('pieces').select('id')).data).toEqual([{ id: PIECE }])
  })

  it('stays under RLS when calls run at once', async () => {
    sb.signIn(B)
    const reads = await Promise.all([sb.port.from('pieces').select('id'), sb.port.from('score_files').select('id'), sb.port.from('bars').select('id')])
    expect(reads.map((read) => read.data)).toEqual([[], [], []])
  })

  it('cuts a long read at 1000 rows, and selectAll gets them all', async () => {
    sb.signIn(A)
    expect((await sb.port.from('bars').select('id')).data).toHaveLength(1000)
    expect(await selectAll(() => sb.port.from('bars').select<{ id: string }>('id').eq('score_file_id', PART))).toHaveLength(1200)
  })

  it('gives an update RLS stopped no rows and no error', async () => {
    sb.signIn(B)
    const result = await sb.port.from('pieces').update({ title: 'x' }).eq('id', PIECE).select('id')
    expect(result).toEqual({ data: [], error: null })
  })

  it('reports a refused write with its code', async () => {
    sb.signIn(B)
    // B may make a piece of their own since 0015, but not one in A's name.
    const result = await sb.port.from('pieces').insert({ owner_id: A, title: 'x' })
    expect(result.error?.code).toBe('42501')
  })

  it('answers a scalar rpc with the value and a set rpc with rows', async () => {
    sb.signIn(A)
    expect((await sb.port.rpc('is_admin')).data).toBe(true)
    const share = await sb.port.rpc<Array<{ token: string; enabled: boolean }>>('create_or_get_share', { target_piece: PIECE })
    expect(share.data?.[0]?.enabled).toBe(false) // a new link starts off since migration 0013
  })

  it('stores a file only under its policy, and signs only what the user may read', async () => {
    sb.signIn(A)
    const path = `${A}/${PIECE}/x.json`
    expect((await sb.port.storage.from('pieces').upload(path, new Blob(['{}']), { contentType: 'application/json' })).error).toBeNull()
    const signed = await sb.port.storage.from('pieces').createSignedUrls([path], 60)
    expect(signed.data?.[0]?.signedUrl).toContain('e=60')
    sb.signIn(B)
    expect((await sb.port.storage.from('pieces').download(path)).error?.statusCode).toBe('404')
    expect((await sb.port.storage.from('pieces').upload(`${A}/${PIECE}/y.json`, new Blob(['{}']), { contentType: 'application/json' })).error).not.toBeNull()
  })
})

describe('the bucket refuses what migration 0009 says it refuses', () => {
  const upload = (blob: Blob, name: string) => sb.port.storage.from('pieces').upload(`${A}/${PIECE}/limits/${name}`, blob, { contentType: 'application/json' })
  afterEach(() => db.exec(`delete from storage.objects where name like '%/limits/%'`))

  it('takes the listed types, by the Blob\'s own type, and an empty type as octet-stream', async () => {
    sb.signIn(A)
    for (const [index, type] of ['application/pdf', 'audio/ogg', 'audio/x-m4a', 'image/webp', 'application/json', ''].entries()) {
      expect((await upload(new Blob(['x'], { type }), `t${index}`)).error).toBeNull()
    }
  })

  it('refuses a type that is not listed with a 415, whatever the contentType option says', async () => {
    sb.signIn(A)
    for (const [index, type] of ['video/ogg', 'text/plain', 'image/png'].entries()) {
      expect((await upload(new Blob(['x'], { type }), `bad${index}`)).error).toMatchObject({ status: 415 })
    }
    expect(await db.query(`select 1 from storage.objects where name like '%/limits/bad%'`)).toMatchObject({ rows: [] })
  })

  it('refuses a file over the bucket\'s size limit with a 413, and takes one of exactly that size', async () => {
    sb.signIn(A)
    const [{ size }] = (await db.query<{ size: number }>(`select file_size_limit::float8 as size from storage.buckets where id = 'pieces'`)).rows as [{ size: number }]
    expect(size).toBe(50 * 1024 * 1024)
    expect((await upload(new Blob([new Uint8Array(size + 1)]), 'big')).error).toMatchObject({ status: 413 })
    expect((await upload(new Blob([new Uint8Array(size)]), 'full')).error).toBeNull()
  })
})

describe('results and errors are encoded as PostgREST and Storage encode them', () => {
  const upload = (path: string, text: string, upsert?: boolean) =>
    sb.port.storage.from('pieces').upload(path, new Blob([text]), { contentType: 'application/json', ...(upsert === undefined ? {} : { upsert }) })
  const rowCount = async (path: string) => (await db.query<{ n: number }>(`select count(*)::int as n from storage.objects where bucket_id = 'pieces' and name = $1`, [path])).rows[0]!.n

  it('gives a timestamp as a string, as JSON carries it', async () => {
    sb.signIn(A)
    const read = await sb.port.from('pieces').select<{ created_at: unknown }>('created_at')
    expect(typeof read.data?.[0]?.created_at).toBe('string')
    const written = await sb.port.from('piece_practice').upsert({ user_id: A, piece_id: PIECE, count_in_bars: 2 }, { onConflict: 'user_id,piece_id' }).select('updated_at')
    expect(typeof written.data?.[0]?.updated_at).toBe('string')
  })

  it('answers maybeSingle on more than one row with PGRST116 and no data, and on none with null', async () => {
    sb.signIn(A)
    const rows = [{ piece_id: PIECE, kind: 'file', url_or_path: 'a' }, { piece_id: PIECE, kind: 'file', url_or_path: 'b' }]
    expect((await sb.port.from('audio_sources').insert(rows)).error).toBeNull()
    const many = await sb.port.from('audio_sources').select('url_or_path').eq('piece_id', PIECE).maybeSingle()
    expect(many.data).toBeNull()
    expect(many.error?.code).toBe('PGRST116')
    const one = await sb.port.from('audio_sources').select<{ url_or_path: string }>('url_or_path').eq('piece_id', PIECE).order('url_or_path').limit(1).maybeSingle()
    expect(one).toEqual({ data: { url_or_path: 'a' }, error: null })
    const none = await sb.port.from('audio_sources').select('url_or_path').eq('url_or_path', 'zzz').maybeSingle()
    expect(none).toEqual({ data: null, error: null })
  })

  it('compares in() as the column type: a malformed uuid is 22P02, an uppercase one matches', async () => {
    sb.signIn(A)
    expect((await sb.port.from('pieces').select('id').in('id', ['xyz'])).error?.code).toBe('22P02')
    expect((await sb.port.from('pieces').select('id').eq('id', 'xyz')).error?.code).toBe('22P02')
    expect((await sb.port.from('pieces').select('id').in('id', [PIECE.toUpperCase()])).data).toEqual([{ id: PIECE }])
    expect((await sb.port.from('pieces').select('id').in('id', [])).data).toEqual([])
  })

  it('limits a read', async () => {
    sb.signIn(A)
    expect((await sb.port.from('bars').select('id').eq('score_file_id', PART).limit(5)).data).toHaveLength(5)
  })

  it('deletes only what the filter and RLS allow, and reports the deleted rows', async () => {
    sb.signIn(A)
    const made = await sb.port.from('audio_sources').insert({ piece_id: PIECE, kind: 'file', url_or_path: 'gone' }).select('id')
    const id = made.data?.[0]?.id as string
    sb.signIn(B)
    expect((await sb.port.from('audio_sources').delete().eq('id', id).select('id')).data).toEqual([])
    sb.signIn(A)
    expect((await sb.port.from('audio_sources').delete().eq('id', id).select('id')).data).toEqual([{ id }])
    expect((await sb.port.from('audio_sources').delete().eq('id', id).select('id')).data).toEqual([])
  })

  it('upserts: inserts, then updates the row for the same key', async () => {
    sb.signIn(A)
    await sb.port.from('piece_practice').upsert({ user_id: A, piece_id: PIECE, count_in_bars: 1 }, { onConflict: 'user_id,piece_id' })
    await sb.port.from('piece_practice').upsert({ user_id: A, piece_id: PIECE, count_in_bars: 3 }, { onConflict: 'user_id,piece_id' })
    const read = await sb.port.from('piece_practice').select('count_in_bars').eq('piece_id', PIECE)
    expect(read.data).toEqual([{ count_in_bars: 3 }])
  })

  it('refuses a second upload to a path with a 409, and keeps one row and the old bytes', async () => {
    sb.signIn(A)
    const path = `${A}/${PIECE}/dup.json`
    expect((await upload(path, 'first')).error).toBeNull()
    const again = await upload(path, 'second')
    expect(again.error?.statusCode).toBe('409')
    expect(await rowCount(path)).toBe(1)
    expect(await (await sb.port.storage.from('pieces').download(path)).data?.text()).toBe('first')
  })

  it('replaces the file on upsert', async () => {
    sb.signIn(A)
    const path = `${A}/${PIECE}/replace.json`
    await upload(path, 'first')
    expect((await upload(path, 'second', true)).error).toBeNull()
    expect(await rowCount(path)).toBe(1)
    expect(await (await sb.port.storage.from('pieces').download(path)).data?.text()).toBe('second')
  })

  it('keeps the file when an upsert is refused', async () => {
    sb.signIn(A)
    const path = `${A}/${PIECE}/kept.json`
    await upload(path, 'mine')
    sb.signIn(B)
    expect((await upload(path, 'theirs', true)).error).not.toBeNull()
    sb.signIn(A)
    expect(await rowCount(path)).toBe(1)
    expect(await (await sb.port.storage.from('pieces').download(path)).data?.text()).toBe('mine')
  })

  it('removes only what the user may, and a removed file reads as missing', async () => {
    sb.signIn(A)
    const path = `${A}/${PIECE}/rm.json`
    await upload(path, 'x')
    sb.signIn(B)
    await sb.port.storage.from('pieces').remove([path])
    expect(await rowCount(path)).toBe(1)
    sb.signIn(A)
    expect((await sb.port.storage.from('pieces').remove([path])).error).toBeNull()
    expect(await rowCount(path)).toBe(0)
    expect((await sb.port.storage.from('pieces').download(path)).error?.statusCode).toBe('404')
  })

  it('lists one level of a folder as Storage does: files have an id, folders have none, paged by limit and offset', async () => {
    sb.signIn(A)
    const root = `${A}/${PIECE}/ls`
    for (const name of ['a.json', 'b.json', 'c.json', 'sub/d.json', 'sub/deep/e.json']) await upload(`${root}/${name}`, 'x')
    const bucket = sb.port.storage.from('pieces')
    const first = await bucket.list(root, { limit: 2, offset: 0 })
    const second = await bucket.list(root, { limit: 2, offset: 2 })
    expect(first.error).toBeNull()
    expect([...(first.data ?? []), ...(second.data ?? [])].map((entry) => [entry.name, entry.id === null])).toEqual([['a.json', false], ['b.json', false], ['c.json', false], ['sub', true]])
    expect((await bucket.list(`${root}/sub`, { limit: 100, offset: 0 })).data?.map((entry) => entry.name)).toEqual(['d.json', 'deep'])
  })

  it('lists nothing of a folder the user may not read, and walks every folder, in pages, with listAllFiles', async () => {
    sb.signIn(A)
    const root = `${A}/${PIECE}/walk`
    const names = Array.from({ length: 205 }, (_, index) => `f${String(index).padStart(3, '0')}.webp`)
    for (const name of names.slice(0, 3)) await upload(`${root}/${name}`, 'x')
    await sb.putFile(`${root}/x/y/z.json`, 'x')
    await db.exec(`insert into storage.objects (bucket_id, name) select 'pieces', '${root}/p/' || n from generate_series(1, 202) n`)
    const all = await listAllFiles(sb.port.storage.from('pieces'), root)
    expect(all).toHaveLength(3 + 1 + 202)
    expect(all).toContain(`${root}/x/y/z.json`)
    expect(all).toContain(`${root}/p/202`)
    sb.signIn(B)
    expect(await listAllFiles(sb.port.storage.from('pieces'), root)).toEqual([])
  })

  it('gives a null signedUrl and an error for a file the user may not read', async () => {
    sb.signIn(A)
    const path = `${A}/${PIECE}/sign.json`
    await upload(path, 'x')
    sb.signIn(B)
    const signed = await sb.port.storage.from('pieces').createSignedUrls([path], 60)
    expect(signed.data?.[0]?.signedUrl).toBeNull()
    expect(signed.data?.[0]?.error).not.toBeNull()
  })

  it('stores a file put there by the import, readable by its owner', async () => {
    const path = `${A}/${PIECE}/put.json`
    await sb.putFile(path, 'imported')
    sb.signIn(A)
    expect(await (await sb.port.storage.from('pieces').download(path)).data?.text()).toBe('imported')
  })
})
