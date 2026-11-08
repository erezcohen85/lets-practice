// @vitest-environment node
import { type PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'
import { type SupabasePort } from '@/lib/supabase/port'
import { createReads, SIGNED_URL_SECONDS } from '@/lib/supabase/reads'
import { pgliteSupabase } from '@/test/pgliteSupabase'
import { databaseWithMigrations } from '@/test/supabaseStandIn'

const OWNER = '00000000-0000-4000-8000-00000000000a'
const MEMBER = '00000000-0000-4000-8000-00000000000b'
const STRANGER = '00000000-0000-4000-8000-00000000000c'
const PIECE = '00000000-0000-4000-8000-0000000000f1'
const PART = '00000000-0000-4000-8000-0000000000f2'
const FOLDER = `${OWNER}/${PIECE}`
const MASTER = '00000000-0000-4000-8000-0000000000e1'
const COPY = '00000000-0000-4000-8000-0000000000e2'
const BAD_COPY = '00000000-0000-4000-8000-0000000000e3'
const MASTER_GONE = '00000000-0000-4000-8000-0000000000e4'
const ORPHAN = '00000000-0000-4000-8000-0000000000e5'
const CREDITS = [{ what: 'Recording', who: 'X', licence: 'CC BY 3.0', source: 'https://x.example/rec', title: 'A take' }]

let db: PGlite
let sb: ReturnType<typeof pgliteSupabase>
let currentUser = OWNER
let reads: ReturnType<typeof createReads>

beforeAll(async () => {
  db = await databaseWithMigrations()
  sb = pgliteSupabase(db)
  reads = createReads(sb.port, async () => {
    sb.signIn(currentUser)
    return { id: currentUser, email: 'x@example.com', name: 'X' }
  })
  await db.exec(`
    insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
      ('${OWNER}', 'o@example.com', now(), '{"full_name":"Ana Owner"}'), ('${MEMBER}', 'm@example.com', now(), '{"full_name":"Mia"}'), ('${STRANGER}', 's@example.com', now(), '{}');
    insert into public.pieces (id, owner_id, title) values ('${PIECE}', '${OWNER}', 'Etude');
    insert into public.pieces (id, owner_id, title, created_at) values ('${MASTER}', '${OWNER}', 'Master', '2020-01-01T00:00:00Z');
    insert into public.pieces (id, owner_id, title, created_at, sample_of, sample_credits) values
      ('${COPY}', '${MEMBER}', 'Sample copy', '2020-01-02T00:00:00Z', '${MASTER}', '${JSON.stringify(CREDITS)}'::jsonb),
      ('${BAD_COPY}', '${MEMBER}', 'Sample, bad credits', '2020-01-03T00:00:00Z', '${MASTER}', '[{"what":"Recording"}]'::jsonb);
    insert into public.pieces (id, owner_id, title, created_at) values ('${MASTER_GONE}', '${OWNER}', 'Master 2', '2020-01-01T00:00:00Z');
    insert into public.pieces (id, owner_id, title, created_at, sample_of, sample_credits) values
      ('${ORPHAN}', '${MEMBER}', 'Sample orphan', '2020-01-04T00:00:00Z', '${MASTER_GONE}', '${JSON.stringify(CREDITS)}'::jsonb);
    update public.profiles set sample_given_at = '2026-11-08T10:00:00Z', sample_given = true where id = '${MEMBER}';
    insert into public.score_files (id, piece_id, storage_path, sha256, name, page_count, rests) values ('${PART}', '${PIECE}', '${FOLDER}/parts/a.pdf', 'x', 'Flute', 1, '{3}');
    insert into public.score_pages (score_file_id, page_index, image_path, width, height) values ('${PART}', 0, '${FOLDER}/${PART}/page-0.webp', 100, 200);
    insert into public.bars (score_file_id, bar_number, page_index, x, y, w, h) select '${PART}', n, 0, n, 0, 1, 1 from generate_series(0, 1099) n;
    insert into public.audio_sources (piece_id, kind, url_or_path, duration, stored_path, name) values ('${PIECE}', 'file', '${FOLDER}/audio.m4a', 12.5, '${FOLDER}/audio.m4a', 'Take 1');
    insert into public.play_order (piece_id, bar_count, rows, meters, marks) values ('${PIECE}', 1099, '[{"from":0,"to":1099}]', '[{"from_bar":1,"numerator":4,"denominator":4}]', '[]');
    insert into public.locators (piece_id, pass_index, bar_number, time_sec, flags, checked) values
      ('${PIECE}', 0, 1, 1, '[{"kind":"crowded","severity":2,"expected":2,"found":1,"factor":0.5,"explained_by":null,"uncertain_line":null}]', false);
    insert into public.jobs (piece_id, kind, status, progress, error, failed_parts) values ('${PIECE}', 'realign', 'error', 0.5, 'a private reason', '[{"id":"a","name":"Tuba","error":"private"}]');
    insert into public.piece_members (piece_id, user_id, joined_at) values ('${PIECE}', '${MEMBER}', '2026-11-01T00:00:00Z');
    insert into public.piece_practice (user_id, piece_id, practice, count_in_bars, last_part_id) values ('${MEMBER}', '${PIECE}', '{"speed":0.5}', 3, '${PART}');
    insert into storage.objects (bucket_id, name) values ('pieces', '${FOLDER}/${PART}/page-0.webp'), ('pieces', '${FOLDER}/audio.m4a');
  `)
  await sb.putFile(`${FOLDER}/peaks.json`, JSON.stringify({ version: 2, data: [0, 127] }))
  await sb.putFile(`${FOLDER}/beats.json`, JSON.stringify([{ t: 1, downbeat: 0.9 }]))
})

function as(user: string) {
  currentUser = user
}

describe('the owner', () => {
  it('lists the piece with its review count, recording and latest job', async () => {
    as(OWNER)
    const [piece] = await reads.listPieces()
    expect(piece).toMatchObject({ id: PIECE, title: 'Etude', role: 'owner', ownerName: 'Ana Owner', partCount: 1, pageCount: 1, durationSec: 12.5, joinedAt: null })
    expect(piece!.job).toMatchObject({ kind: 'realign', status: 'error', error: 'a private reason' })
    expect(piece!.review.total).toBeGreaterThan(0)
  })

  it('reads the job with its reason and failed parts', async () => {
    as(OWNER)
    const detail = await reads.getPiece(PIECE)
    const job = await reads.getJob(detail!.job!.id)
    expect(job?.error).toBe('a private reason')
    expect(job?.parts?.[0]).toMatchObject({ name: 'Tuba', state: 'failed' })
  })
})

describe('a member', () => {
  it('sees the piece as a viewer, with the owner name and their own memory', async () => {
    as(MEMBER)
    const detail = await reads.getPiece(PIECE)
    expect(detail?.piece).toMatchObject({ role: 'viewer', ownerName: 'Ana Owner', countInBars: 3, lastPartId: PART })
    expect(detail?.piece.practice.speed).toBe(0.5)
    expect(detail?.recordingLabel).toBe('Take 1')
    expect((await reads.listPieces())[0]).toMatchObject({ role: 'viewer', joinedAt: expect.stringContaining('2026-11-01') })
  })

  it('never selects the job reason or the failed parts', async () => {
    as(MEMBER)
    const [piece] = await reads.listPieces()
    expect(piece!.job).toMatchObject({ kind: 'realign', status: 'error', error: null })
    expect(piece!.job).not.toHaveProperty('parts')
    expect((await reads.getJob(piece!.job!.id))?.error).toBeNull()
  })

  it('reads the whole map, past the 1000 rows PostgREST would stop at', async () => {
    as(MEMBER)
    const map = await reads.getPieceMap(PIECE)
    expect(map?.pages[0]?.bars).toHaveLength(1100)
    expect(map?.pages[0]?.bars[0]?.bar).toBe(0)
    expect(map?.pages[0]?.rests).toEqual([3])
    expect(map?.timing.locators[0]?.flags?.[0]).toMatchObject({ kind: 'crowded', explainedBy: null })
  })

  it('gets signed page and audio addresses of the set life, and the peaks and beats', async () => {
    as(MEMBER)
    const [page] = await reads.getPartPages(PIECE, PART)
    expect(page).toMatchObject({ pageIndex: 0, width: 100, height: 200 })
    expect(page!.url).toContain(`e=${SIGNED_URL_SECONDS}`)
    expect(await reads.getAudioUrl(PIECE)).toContain(`e=${SIGNED_URL_SECONDS}`)
    expect(await reads.getPeaks(PIECE)).toEqual([0, 1])
    expect(await reads.getBeats(PIECE)).toEqual([{ t: 1, downbeat: 0.9 }])
  })
})

describe('someone else', () => {
  it('finds nothing', async () => {
    as(STRANGER)
    expect(await reads.listPieces()).toEqual([])
    expect(await reads.getPiece(PIECE)).toBeNull()
    expect(await reads.getPieceMap(PIECE)).toBeNull()
    expect(await reads.getPartPages(PIECE, PART)).toEqual([])
    expect(await reads.getAudioUrl(PIECE)).toBeNull()
    expect(await reads.getPeaks(PIECE)).toBeNull()
    expect(await reads.getBeats(PIECE)).toBeNull()
  })

  it('gets null, not a failure, for an address that is no uuid', async () => {
    as(OWNER)
    expect(await reads.getPiece('xyz')).toBeNull()
    expect(await reads.getPieceMap('xyz')).toBeNull()
    expect(await reads.getJob('xyz')).toBeNull()
    expect(await reads.getPartPages('xyz', 'abc')).toEqual([])
  })

  it('reads as null a piece with no peaks or beats stored yet', async () => {
    as(OWNER)
    await db.exec(`insert into public.pieces (id, owner_id, title) values ('00000000-0000-4000-8000-0000000000f9', '${OWNER}', 'New')`)
    expect(await reads.getPeaks('00000000-0000-4000-8000-0000000000f9')).toBeNull()
    expect(await reads.getBeats('00000000-0000-4000-8000-0000000000f9')).toBeNull()
    expect(await reads.getAudioUrl('00000000-0000-4000-8000-0000000000f9')).toBeNull()
  })
})

describe('an address the storage cannot give', () => {
  it('is refused, never returned as null', async () => {
    as(OWNER)
    const storage = sb.port.storage.from('pieces')
    const refusing: SupabasePort = {
      ...sb.port,
      storage: { from: () => ({ ...storage, createSignedUrls: async (paths) => ({ data: paths.map((path) => ({ path, signedUrl: null, error: null })), error: null }) }) },
    }
    const odd = createReads(refusing, async () => ({ id: OWNER, email: 'x@example.com', name: 'X' }))
    await expect(odd.getAudioUrl(PIECE)).rejects.toThrow('no address')
    await expect(odd.getPartPages(PIECE, PART)).rejects.toThrow('no address')
  })
})

describe('odd but possible data', () => {
  it('answers with one address when a piece holds two recordings (maybeSingle would refuse many rows)', async () => {
    as(OWNER)
    const two = '00000000-0000-4000-8000-0000000000fa'
    await db.exec(`
      insert into public.pieces (id, owner_id, title) values ('${two}', '${OWNER}', 'Two takes');
      insert into public.audio_sources (piece_id, kind, url_or_path, stored_path) values ('${two}', 'file', '${OWNER}/${two}/a.m4a', '${OWNER}/${two}/a.m4a'), ('${two}', 'file', '${OWNER}/${two}/b.m4a', '${OWNER}/${two}/b.m4a');
      insert into storage.objects (bucket_id, name) values ('pieces', '${OWNER}/${two}/a.m4a'), ('pieces', '${OWNER}/${two}/b.m4a');
    `)
    expect(await reads.getAudioUrl(two)).toContain(`e=${SIGNED_URL_SECONDS}`)
  })

  it('still reads a piece whose recording was made from a YouTube link before the music rule: list, hub and playback', async () => {
    as(OWNER)
    const old = '00000000-0000-4000-8000-0000000000fb'
    const oldPart = '00000000-0000-4000-8000-0000000000fc'
    await db.exec(`
      insert into public.pieces (id, owner_id, title) values ('${old}', '${OWNER}', 'From a link');
      insert into public.score_files (id, piece_id, storage_path, sha256, name, page_count) values ('${oldPart}', '${old}', '${OWNER}/${old}/parts/a.pdf', 'x', 'Oboe', 1);
      insert into public.audio_sources (piece_id, kind, url_or_path, duration, stored_path) values ('${old}', 'youtube', 'https://youtu.be/abc', 30, '${OWNER}/${old}/audio.m4a');
      insert into storage.objects (bucket_id, name) values ('pieces', '${OWNER}/${old}/audio.m4a');
    `)
    expect((await reads.listPieces()).find((piece) => piece.id === old)).toMatchObject({ title: 'From a link', durationSec: 30 })
    const detail = await reads.getPiece(old)
    expect(detail?.recordingLabel).toBe('https://youtu.be/abc')
    expect(detail?.piece.recording).toMatchObject({ kind: 'youtube', urlOrPath: 'https://youtu.be/abc' })
    expect(await reads.getAudioUrl(old)).toContain(`e=${SIGNED_URL_SECONDS}`)
  })

  it('gives no pages for a part asked for under another piece', async () => {
    as(OWNER)
    expect(await reads.getPartPages('00000000-0000-4000-8000-0000000000f9', PART)).toEqual([])
  })
})

describe('the sample piece', () => {
  it('marks a copy in the list, and an ordinary piece not', async () => {
    as(MEMBER)
    const pieces = await reads.listPieces()
    expect(pieces.find((piece) => piece.id === COPY)).toMatchObject({ isSample: true, role: 'owner' })
    expect(pieces.find((piece) => piece.id === BAD_COPY)?.isSample).toBe(true)
    expect(pieces.find((piece) => piece.id === PIECE)?.isSample).toBe(false)
  })

  it('reads the copy\'s own credits on its hub, and null on an ordinary piece', async () => {
    as(MEMBER)
    expect((await reads.getPiece(COPY))?.sampleCredits).toEqual(CREDITS)
    expect((await reads.getPiece(PIECE))?.sampleCredits).toBeNull()
    as(OWNER)
    expect((await reads.getPiece(PIECE))?.sampleCredits).toBeNull()
    expect((await reads.getPiece(MASTER))?.sampleCredits).toBeNull()
  })

  it('reads credits that cannot be shown as null, and the piece still opens', async () => {
    as(MEMBER)
    const detail = await reads.getPiece(BAD_COPY)
    expect(detail?.sampleCredits).toBeNull()
    expect(detail?.piece.title).toBe('Sample, bad credits')
  })

  it('still reads a copy as a sample, with its credits, after its master is deleted', async () => {
    await db.exec(`delete from public.pieces where id = '${MASTER_GONE}'`)
    as(MEMBER)
    expect((await reads.listPieces()).find((piece) => piece.id === ORPHAN)?.isSample).toBe(true)
    expect((await reads.getPiece(ORPHAN))?.sampleCredits).toEqual(CREDITS)
  })

  it('shows a copy to nobody but its owner', async () => {
    as(STRANGER)
    expect(await reads.getPiece(COPY)).toBeNull()
  })
})
