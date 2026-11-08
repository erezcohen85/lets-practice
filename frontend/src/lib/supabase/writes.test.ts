// @vitest-environment node
import { type PGlite } from '@electric-sql/pglite'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createReads } from '@/lib/supabase/reads'
import { type SupabasePort } from '@/lib/supabase/port'
import { createWrites } from '@/lib/supabase/writes'
import { pgliteSupabase } from '@/test/pgliteSupabase'
import { asUser, databaseWithMigrations } from '@/test/supabaseStandIn'

const OWNER = '00000000-0000-4000-8000-00000000000a'
const MEMBER = '00000000-0000-4000-8000-00000000000b'
const PIECE = '00000000-0000-4000-8000-0000000000f1'
const PART = '00000000-0000-4000-8000-0000000000f2'
const PART2 = '00000000-0000-4000-8000-0000000000f3'
const STRANGER = '00000000-0000-4000-8000-00000000000c'
const OTHER_PIECE = '00000000-0000-4000-8000-0000000000f4'
const FOLDER = `${OWNER}/${PIECE}`

let db: PGlite
let sb: ReturnType<typeof pgliteSupabase>
let currentUser = OWNER
const requireUser = async () => {
  sb.signIn(currentUser)
  return { id: currentUser, email: 'x@example.com', name: 'X' }
}
let writes: ReturnType<typeof createWrites>
let reads: ReturnType<typeof createReads>

beforeAll(async () => {
  db = await databaseWithMigrations()
  sb = pgliteSupabase(db)
  writes = createWrites(sb.port, requireUser)
  reads = createReads(sb.port, requireUser)
  await db.exec(`
    insert into auth.users (id, email, email_confirmed_at) values ('${OWNER}', 'o@example.com', now()), ('${MEMBER}', 'm@example.com', now()), ('${STRANGER}', 's@example.com', now());
  `)
})

beforeEach(async () => {
  currentUser = OWNER
  await db.exec(`
    delete from public.pieces;
    delete from storage.objects;
    insert into public.pieces (id, owner_id, title) values ('${PIECE}', '${OWNER}', 'Etude');
    insert into public.score_files (id, piece_id, storage_path, sha256, name, position, page_count) values
      ('${PART}', '${PIECE}', '${FOLDER}/parts/a.pdf', 'x', 'Flute', 0, 1), ('${PART2}', '${PIECE}', '${FOLDER}/parts/b.pdf', 'x', 'Oboe', 1, 1);
    insert into public.score_pages (score_file_id, page_index, image_path, width, height) values ('${PART}', 0, '${FOLDER}/${PART}/page-0.webp', 10, 10);
    insert into public.audio_sources (piece_id, kind, url_or_path, stored_path) values ('${PIECE}', 'file', '${FOLDER}/upload/recording.mp3', '${FOLDER}/audio.m4a');
    insert into public.piece_members (piece_id, user_id) values ('${PIECE}', '${MEMBER}');
    insert into storage.objects (bucket_id, name) values
      ('pieces', '${FOLDER}/parts/a.pdf'), ('pieces', '${FOLDER}/parts/b.pdf'), ('pieces', '${FOLDER}/${PART}/page-0.webp'),
      ('pieces', '${FOLDER}/upload/recording.mp3'), ('pieces', '${FOLDER}/audio.m4a'), ('pieces', '${FOLDER}/peaks.json'), ('pieces', '${FOLDER}/beats.json'), ('pieces', '${FOLDER}/beats.npz');
  `)
})

const TIMING = {
  barCount: 2,
  playOrder: [{ from: 0, to: 2 }],
  meters: [{ fromBar: 1, numerator: 6, denominator: 8 }],
  marks: [{ bar: 1, kind: 'fermata' as const }],
  shortBars: [{ bar: 0, units: 1 }],
  locators: [{ bar: 0, passIndex: 0, timeSec: 1, confirmed: true, checked: true, flags: [{ kind: 'pickup' as const, severity: 1 as const, expected: 2, found: 1, factor: null, explainedBy: null, uncertainLine: null }] }],
}

describe('saves', () => {
  it('a timing comes back exactly as it was saved, pickup and flags included', async () => {
    await writes.saveTiming(PIECE, TIMING)
    expect((await reads.getPieceMap(PIECE))?.timing).toEqual(TIMING)
  })

  it('a page layer comes back as saved, and leaves the other part alone', async () => {
    const page = { partId: PART, bars: [{ bar: 0, pageIndex: 0, x: 1, y: 2, w: 3, h: 4 }], rests: [2], boxFlags: [{ bar: 0, verdict: 'starts_late' as const, note: 'n', suggestedX: 5 }] }
    await writes.savePageLayer(PIECE, page)
    const map = await reads.getPieceMap(PIECE)
    expect(map?.pages[0]).toEqual(page)
    expect(map?.pages[1]).toEqual({ partId: PART2, bars: [], rests: [] })
  })

  it('keeps the old edges and the verdicts of Advanced Reading on a flag', async () => {
    const boxFlags = [
      { bar: 0, verdict: 'read_moved' as const, note: 'Advanced Reading moved this bar.', suggestedX: null, previous: { x: 8, w: 40 } },
      { bar: 1, verdict: 'read_count' as const, note: 'Advanced Reading read 3 bars on this line; the first read had 4.', suggestedX: null },
    ]
    const page = { partId: PART, bars: [{ bar: 0, pageIndex: 0, x: 1, y: 2, w: 3, h: 4 }, { bar: 1, pageIndex: 0, x: 5, y: 2, w: 3, h: 4 }], rests: [], boxFlags }
    await writes.savePageLayer(PIECE, page)
    expect((await reads.getPieceMap(PIECE))?.pages[0]).toEqual(page)
  })

  it('refuses a part of another piece', async () => {
    await expect(writes.savePageLayer('00000000-0000-4000-8000-0000000000aa', { partId: PART, bars: [], rests: [] })).rejects.toThrow('part not found')
  })

  it('keeps and clears when the structure was set', async () => {
    await writes.saveStructureSetAt(PIECE, '2026-11-05T10:00:00.000Z')
    expect(new Date((await reads.getPieceMap(PIECE))!.structureSetAt!).toISOString()).toBe('2026-11-05T10:00:00.000Z')
    await writes.saveStructureSetAt(PIECE, null)
    expect((await reads.getPieceMap(PIECE))?.structureSetAt).toBeNull()
  })
})

describe('renames', () => {
  it('a part name set here is the user\'s, so a later job leaves it', async () => {
    await writes.renamePart(PIECE, PART, ' Piccolo ')
    const row = (await asUser<{ name: string; name_source: string }>(db, OWNER, 'select name, name_source from public.score_files where id = $1', [PART]))[0]!
    expect(row).toEqual({ name: 'Piccolo', name_source: 'user' })
  })

  it('renames the piece and the recording', async () => {
    await writes.renamePiece(PIECE, 'New title')
    await writes.renameRecording(PIECE, 'Take 2')
    const detail = await reads.getPiece(PIECE)
    expect(detail?.piece.title).toBe('New title')
    expect(detail?.recordingLabel).toBe('Take 2')
  })

  it('rejects an empty name, as the fake does', async () => {
    await expect(writes.renamePart(PIECE, PART, '  ')).rejects.toThrow()
  })
})

describe('deletes', () => {
  it('deletes a part, its rows and its files, and closes up the positions', async () => {
    await writes.deletePart(PIECE, PART)
    const parts = await asUser<{ id: string; position: number }>(db, OWNER, 'select id, position from public.score_files')
    expect(parts).toEqual([{ id: PART2, position: 0 }])
    const files = await asUser<{ name: string }>(db, OWNER, 'select name from storage.objects order by name')
    expect(files.map((file) => file.name)).not.toContain(`${FOLDER}/parts/a.pdf`)
    expect(files.map((file) => file.name)).not.toContain(`${FOLDER}/${PART}/page-0.webp`)
    expect(files.map((file) => file.name)).toContain(`${FOLDER}/audio.m4a`)
  })

  it('refuses to delete the last part', async () => {
    await writes.deletePart(PIECE, PART)
    await expect(writes.deletePart(PIECE, PART2)).rejects.toThrow('a piece needs at least one part')
  })

  it('deletes the piece and every file it had', async () => {
    await writes.deletePiece(PIECE)
    expect(await asUser(db, OWNER, 'select 1 from public.pieces')).toEqual([])
    expect(await asUser(db, OWNER, 'select name from storage.objects')).toEqual([])
    expect(await db.query('select 1 from public.piece_members')).toMatchObject({ rows: [] })
  })

  it('refuses while a job runs, in a sentence', async () => {
    await db.exec(`insert into public.jobs (piece_id, kind, status) values ('${PIECE}', 'process-piece', 'running')`)
    await expect(writes.deletePiece(PIECE)).rejects.toThrow('still being prepared')
    await expect(writes.deletePart(PIECE, PART)).rejects.toThrow('still being prepared')
  })
})

describe('a member', () => {
  it('can change nothing, and the owner\'s data stays', async () => {
    currentUser = MEMBER
    await expect(writes.saveTiming(PIECE, TIMING)).rejects.toThrow()
    await expect(writes.savePageLayer(PIECE, { partId: PART, bars: [], rests: [] })).rejects.toThrow()
    await expect(writes.saveStructureSetAt(PIECE, null)).rejects.toThrow()
    await expect(writes.renamePiece(PIECE, 'x')).rejects.toThrow()
    await expect(writes.renamePart(PIECE, PART, 'x')).rejects.toThrow()
    await expect(writes.renameRecording(PIECE, 'x')).rejects.toThrow()
    await expect(writes.deletePart(PIECE, PART)).rejects.toThrow()
    await expect(writes.deletePiece(PIECE)).rejects.toThrow()
    currentUser = OWNER
    expect((await reads.getPiece(PIECE))?.parts).toHaveLength(2)
  })
})

describe('a write RLS stops changes no row, so it rejects and leaves the data as it was', () => {
  const untouched = async () => {
    const [piece] = await db.query<{ title: string; structure_set_at: string | null }>('select title, structure_set_at from public.pieces where id = $1', [PIECE]).then((result) => result.rows)
    const parts = (await db.query<{ name: string; name_source: string }>('select name, name_source from public.score_files order by position')).rows
    const [audio] = (await db.query<{ name: string | null }>('select name from public.audio_sources')).rows
    const files = (await db.query<{ name: string }>('select name from storage.objects')).rows
    return { piece, parts, audio, files: files.length }
  }

  it.each([
    ['a member', MEMBER],
    ['a stranger', STRANGER],
  ])('%s: each rename and delete says not found, and nothing changes', async (_who, user) => {
    const before = await untouched()
    currentUser = user
    await expect(writes.renamePiece(PIECE, 'x')).rejects.toThrow('piece not found')
    await expect(writes.renamePart(PIECE, PART, 'x')).rejects.toThrow('part not found')
    await expect(writes.renameRecording(PIECE, 'x')).rejects.toThrow('recording not found')
    await expect(writes.saveStructureSetAt(PIECE, '2026-11-05T10:00:00.000Z')).rejects.toThrow('piece not found')
    await expect(writes.deletePart(PIECE, PART)).rejects.toThrow('piece not found')
    await expect(writes.deletePiece(PIECE)).rejects.toThrow('piece not found')
    currentUser = OWNER
    expect(await untouched()).toEqual(before)
  })

  it('a part of another piece is not renamed or deleted through this piece', async () => {
    await db.exec(`
      insert into public.pieces (id, owner_id, title) values ('${OTHER_PIECE}', '${OWNER}', 'Other');
      insert into public.score_files (piece_id, storage_path, sha256, name, position, page_count) values ('${OTHER_PIECE}', '${OWNER}/${OTHER_PIECE}/parts/z.pdf', 'x', 'Zed', 0, 1), ('${OTHER_PIECE}', '${OWNER}/${OTHER_PIECE}/parts/y.pdf', 'x', 'Why', 1, 1);
    `)
    const foreign = (await db.query<{ id: string }>(`select id from public.score_files where piece_id = '${OTHER_PIECE}' order by position`)).rows[0]!.id
    await expect(writes.renamePart(PIECE, foreign, 'x')).rejects.toThrow('part not found')
    await expect(writes.deletePart(PIECE, foreign)).rejects.toThrow('part not found')
    expect((await db.query('select 1 from public.score_files where piece_id = $1', [OTHER_PIECE])).rows).toHaveLength(2)
  })

  it('an unknown piece or part is not found, not a silent success', async () => {
    const nobody = '00000000-0000-4000-8000-0000000000ee'
    await expect(writes.renamePiece(nobody, 'x')).rejects.toThrow('piece not found')
    await expect(writes.renamePart(PIECE, nobody, 'x')).rejects.toThrow('part not found')
    await expect(writes.renameRecording(nobody, 'x')).rejects.toThrow('recording not found')
    await expect(writes.saveStructureSetAt(nobody, null)).rejects.toThrow('piece not found')
    await expect(writes.deletePiece(nobody)).rejects.toThrow('piece not found')
  })
})

describe('what a delete leaves behind', () => {
  it('deleting a part clears the owner\'s "last part" memory instead of failing', async () => {
    await db.exec(`insert into public.piece_practice (user_id, piece_id, last_part_id) values ('${OWNER}', '${PIECE}', '${PART}')`)
    await writes.deletePart(PIECE, PART)
    expect((await db.query<{ last_part_id: string | null }>('select last_part_id from public.piece_practice')).rows).toEqual([{ last_part_id: null }])
  })

  it('deleting a piece removes its job rows too, once no job is active', async () => {
    await db.exec(`insert into public.jobs (piece_id, kind, status) values ('${PIECE}', 'process-piece', 'done')`)
    await writes.deletePiece(PIECE)
    expect((await db.query('select 1 from public.jobs')).rows).toEqual([])
  })

  it('a queued job also blocks a delete', async () => {
    await db.exec(`insert into public.jobs (piece_id, kind, status) values ('${PIECE}', 'process-piece', 'queued')`)
    await expect(writes.deletePiece(PIECE)).rejects.toThrow('still being prepared')
  })

  it('a delete that was refused leaves every file where it was', async () => {
    await db.exec(`insert into public.jobs (piece_id, kind, status) values ('${PIECE}', 'process-piece', 'running')`)
    await expect(writes.deletePiece(PIECE)).rejects.toThrow()
    expect((await db.query('select 1 from storage.objects')).rows).toHaveLength(8)
  })
})

describe('files the rows do not know about', () => {
  const names = async () => (await db.query<{ name: string }>('select name from storage.objects')).rows.map((row) => row.name).sort()

  it('deleting a part removes its page images that have no score_pages row, and not another part\'s', async () => {
    await db.exec(`insert into storage.objects (bucket_id, name) values ('pieces', '${FOLDER}/${PART}/page-1.webp'), ('pieces', '${FOLDER}/${PART2}/page-0.webp')`)
    await writes.deletePart(PIECE, PART)
    const left = await names()
    expect(left.filter((name) => name.includes(`/${PART}/`))).toEqual([])
    expect(left).not.toContain(`${FOLDER}/parts/a.pdf`)
    expect(left).toContain(`${FOLDER}/${PART2}/page-0.webp`)
    expect(left).toContain(`${FOLDER}/parts/b.pdf`)
  })

  it('deleting a piece removes images of a part the processor never recorded, and a stored recording no row names', async () => {
    await db.exec(`
      delete from public.score_pages;
      update public.audio_sources set stored_path = null;
      insert into storage.objects (bucket_id, name) values ('pieces', '${FOLDER}/${PART2}/page-0.webp'), ('pieces', '${FOLDER}/${PART2}/page-1.webp'), ('pieces', '${FOLDER}/not-in-the-list.bin');
    `)
    await writes.deletePiece(PIECE)
    expect(await names()).toEqual([])
  })

  it('leaves another piece\'s files, and another user\'s, alone', async () => {
    await db.exec(`insert into storage.objects (bucket_id, name) values ('pieces', '${OWNER}/${OTHER_PIECE}/audio.m4a'), ('pieces', '${MEMBER}/${PIECE}/audio.m4a'), ('pieces', '${FOLDER}x/audio.m4a')`)
    await writes.deletePiece(PIECE)
    expect(await names()).toEqual([`${FOLDER}x/audio.m4a`, `${OWNER}/${OTHER_PIECE}/audio.m4a`, `${MEMBER}/${PIECE}/audio.m4a`].sort())
  })

  it('removes more than 1000 files, in calls of at most 1000', async () => {
    await db.exec(`insert into storage.objects (bucket_id, name) select 'pieces', '${FOLDER}/${PART}/p/' || n from generate_series(1, 1100) n`)
    const sizes: number[] = []
    const bucket = sb.port.storage.from('pieces')
    const counting = { ...sb.port, storage: { from: () => ({ ...bucket, remove: (paths: string[]) => { sizes.push(paths.length); return bucket.remove(paths) } }) } } as SupabasePort
    await createWrites(counting, requireUser).deletePiece(PIECE)
    expect(await names()).toEqual([])
    expect(Math.max(...sizes)).toBeLessThanOrEqual(1000)
    expect(sizes.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(1108)
  }, 30_000)
})

describe('once the row is gone the delete has happened', () => {
  const failing = (remove: (paths: string[]) => Promise<{ error: { message: string } | null }>, partOverride?: (values: Record<string, unknown>) => boolean) => {
    const bucket = sb.port.storage.from('pieces')
    return {
      ...sb.port,
      from: (table: string) => {
        const real = sb.port.from(table)
        if (partOverride === undefined || table !== 'score_files') return real
        return { ...real, update: (values: Record<string, unknown>) => (partOverride(values) ? { eq: () => ({ then: (done: (result: unknown) => unknown) => done({ data: null, error: { message: 'renumber boom' } }) }) } : real.update(values)) }
      },
      storage: { from: () => ({ ...bucket, remove }) },
    } as unknown as SupabasePort
  }
  let warn: ReturnType<typeof vi.spyOn>
  beforeEach(() => { warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined) })
  afterEach(() => warn.mockRestore())

  it('a piece whose files cannot be removed is still deleted, resolves, and warns with a count only', async () => {
    const calls: number[] = []
    const writesWithBadStorage = createWrites(failing(async (paths) => { calls.push(paths.length); return { error: { message: `boom ${paths[0]}` } } }), requireUser)
    await expect(writesWithBadStorage.deletePiece(PIECE)).resolves.toBeUndefined()
    expect((await db.query('select 1 from public.pieces')).rows).toEqual([])
    expect(calls).toEqual([8, 8])
    const said = warn.mock.calls.flat().join(' ')
    expect(said).toContain('8')
    expect(said).not.toContain(PIECE)
    expect(said).not.toContain(OWNER)
    expect(said).not.toContain('.pdf')
    expect(said).not.toContain('boom')
  })

  it('tries the removal once more, and says nothing when the second try works', async () => {
    const real = sb.port.storage.from('pieces')
    let tries = 0
    const flaky = createWrites(failing(async (paths) => (++tries === 1 ? { error: { message: 'blip' } } : real.remove(paths))), requireUser)
    await flaky.deletePiece(PIECE)
    expect(tries).toBe(2)
    expect((await db.query('select 1 from storage.objects')).rows).toEqual([])
    expect(warn).not.toHaveBeenCalled()
  })

  it('a part whose renumbering failed still has its files removed, and the delete resolves', async () => {
    const real = sb.port.storage.from('pieces')
    const broken = createWrites(failing((paths) => real.remove(paths), (values) => 'position' in values), requireUser)
    await expect(broken.deletePart(PIECE, PART)).resolves.toBeUndefined()
    expect((await db.query('select 1 from public.score_files where id = $1', [PART])).rows).toEqual([])
    expect((await db.query<{ name: string }>('select name from storage.objects')).rows.map((row) => row.name)).not.toContain(`${FOLDER}/${PART}/page-0.webp`)
    expect(warn.mock.calls.flat().join(' ')).not.toContain(PART)
  })

  it('a part whose files cannot be removed is still deleted and resolves', async () => {
    const broken = createWrites(failing(async () => ({ error: { message: 'boom' } })), requireUser)
    await expect(broken.deletePart(PIECE, PART)).resolves.toBeUndefined()
    expect((await db.query('select 1 from public.score_files where id = $1', [PART])).rows).toEqual([])
  })

  it('a failure before the row is deleted still rejects and removes nothing', async () => {
    const bucket = sb.port.storage.from('pieces')
    const listingFails = { ...sb.port, storage: { from: () => ({ ...bucket, list: async () => ({ data: null, error: { message: 'no list' } }) }) } } as unknown as SupabasePort
    await expect(createWrites(listingFails, requireUser).deletePiece(PIECE)).rejects.toThrow('no list')
    expect((await db.query('select 1 from public.pieces')).rows).toHaveLength(1)
    expect((await db.query('select 1 from storage.objects')).rows).toHaveLength(8)
  })
})
