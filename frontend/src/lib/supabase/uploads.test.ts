// @vitest-environment node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { type PGlite } from '@electric-sql/pglite'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { SPLIT_EXPIRED } from '@/domain/splitEdits'
import { PlanLimitError, SentenceError, sentenceOf } from '@/lib/processorClient'
import { type CutPart, type CutSplit } from '@/lib/supabase/splitting'
import { createUploads, RECORDING_SUFFIXES } from '@/lib/supabase/uploads'
import { pgliteSupabase } from '@/test/pgliteSupabase'
import { asUser, databaseWithMigrations } from '@/test/supabaseStandIn'

const CREATOR = '00000000-0000-4000-8000-00000000000a'
/** A Trial user: not the admin, no plan assignment. */
const STRANGER = '00000000-0000-4000-8000-00000000000b'
const OTHER_CREATOR = '00000000-0000-4000-8000-00000000000c'
const MAX = 50 * 1024 * 1024

let db: PGlite
let sb: ReturnType<typeof pgliteSupabase>
let currentUser = CREATOR
let uploads: ReturnType<typeof createUploads>

/**
 * Stands in for the processor's cut route: it writes one PDF per part into the piece's folder, as the real one does, and says
 * what it wrote. `next` can make it refuse; `calls` is what it was asked.
 */
const cut = {
  calls: [] as Array<{ pieceId: string; splitId: string; parts: CutPart[] }>,
  refuse: null as Error | null,
  run: (async (pieceId, splitId, parts) => {
    cut.calls.push({ pieceId, splitId, parts })
    for (const part of parts) {
      const body = new File(['%PDF cut'], 'x.pdf', { type: 'application/pdf' })
      await sb.port.storage.from('pieces').upload(`${currentUser}/${pieceId}/parts/${part.id}.pdf`, body, { contentType: 'application/pdf' })
    }
    if (cut.refuse !== null) throw cut.refuse
    return parts.map((part) => ({ id: part.id, sha256: 'ab'.repeat(32) }))
  }) as CutSplit,
}
const range = (name: string, fromPage: number, toPage: number, skipPages: number[] = []) => ({ name, fromPage, toPage, skipPages })

const pdf = (name = 'Flute part.pdf') => new File(['%PDF'], name, { type: 'application/pdf' })
const audio = (name = 'take.mp3', size = 3, type = 'audio/mpeg') => new File([new Uint8Array(size)], name, { type })
const RECORDING = { kind: 'file', file: audio() } as const
const objects = async () => (await asUser<{ name: string }>(db, CREATOR, 'select name from storage.objects order by name')).map((row) => row.name)

/** The bucket's upload, with the `nth` call (from 1) answering an error and the others really storing. */
function failUploadNumber(nth: number) {
  const bucket = sb.port.storage.from('pieces')
  const real = bucket.upload.bind(bucket)
  let calls = 0
  return vi.spyOn(bucket, 'upload').mockImplementation(async (path, body, options) => {
    calls += 1
    return calls === nth ? { error: { message: 'no room' } } : real(path, body, options)
  })
}

beforeAll(async () => {
  db = await databaseWithMigrations()
  sb = pgliteSupabase(db)
  uploads = createUploads(
    sb.port,
    async () => {
      sb.signIn(currentUser)
      return { id: currentUser, email: 'x@example.com', name: 'X' }
    },
    (...args) => cut.run(...args),
  )
  await db.exec(`
    insert into auth.users (id, email, email_confirmed_at) values ('${CREATOR}', 'c@example.com', now()), ('${STRANGER}', 's@example.com', now()), ('${OTHER_CREATOR}', 'o@example.com', now());
    insert into public.admins (user_id) values ('${CREATOR}'), ('${OTHER_CREATOR}');
  `)
})

beforeEach(async () => {
  currentUser = CREATOR
  cut.calls = []
  cut.refuse = null
  vi.restoreAllMocks()
  await db.exec('delete from public.pieces; delete from storage.objects; delete from public.usage_events;')
})

describe('RECORDING_SUFFIXES', () => {
  it('equals the list the processor refuses by, so a name passed here is not refused there', () => {
    const python = readFileSync(resolve(__dirname, '../../../../backend/processor/app/pipeline/audio_ingest.py'), 'utf8')
    const listed = /^RECORDING_SUFFIXES\s*=\s*frozenset\(\{([^}]*)\}\)/m.exec(python)?.[1]
    expect(listed).toBeDefined()
    const processor = [...listed!.matchAll(/"(\.[a-z0-9]+)"/g)].map((match) => match[1]!)
    expect([...RECORDING_SUFFIXES].sort()).toEqual([...processor].sort())
  })
})

describe('createPiece', () => {
  it('stores the files under names made from ids, whatever the file is called', async () => {
    const piece = await uploads.createPiece({ title: 'Etude', recording: { kind: 'file', file: audio('Take #1?.mp3') }, parts: [{ file: pdf('Etude #1 ../x.pdf'), name: '' }] })
    const names = await objects()
    const [part] = await asUser<{ id: string; storage_path: string; name: string; name_source: string; page_count: number; sha256: string; position: number }>(db, CREATOR, 'select * from public.score_files')
    expect(names).toEqual([`${CREATOR}/${piece.id}/parts/${part!.id}.pdf`, `${CREATOR}/${piece.id}/upload/recording.mp3`])
    expect(part).toMatchObject({ storage_path: names[0], name_source: 'file', page_count: 0, position: 0 })
    expect(part!.sha256).toMatch(/^[0-9a-f]{64}$/)
  })

  it('keeps a typed name as the user\'s, and the recording its real name', async () => {
    const piece = await uploads.createPiece({ title: 'Etude', recording: { kind: 'file', file: audio('Take 1.mp3') }, parts: [{ file: pdf(), name: 'Piccolo' }] })
    expect(piece.parts[0]).toMatchObject({ name: 'Piccolo', pageCount: 0 })
    expect((await asUser(db, CREATOR, 'select name_source from public.score_files'))[0]).toEqual({ name_source: 'user' })
    const recording = (await asUser<{ kind: string; name: string; url_or_path: string }>(db, CREATOR, 'select * from public.audio_sources'))[0]!
    expect(recording).toMatchObject({ kind: 'file', name: 'Take 1', url_or_path: `${CREATOR}/${piece.id}/upload/recording.mp3` })
    expect(piece.recording?.urlOrPath).toBe('Take 1')
  })

  it.each([
    ['mp3', 'audio/mpeg', 'audio/mpeg'],
    ['m4a', '', 'audio/mp4'],
    ['ogg', 'video/ogg', 'audio/ogg'],
    ['opus', '', 'audio/ogg'],
    ['WAV', 'application/octet-stream', 'audio/wav'],
  ])('sends a .%s recording the browser calls "%s" as %s: the type of the body itself, which is what storage-js sends', async (suffix, browserType, sent) => {
    const upload = vi.spyOn(sb.port.storage.from('pieces'), 'upload')
    await uploads.createPiece({ title: 'Etude', recording: { kind: 'file', file: audio(`take.${suffix}`, 3, browserType) }, parts: [{ file: pdf(), name: '' }] })
    const bodies = upload.mock.calls.map(([, body]) => body)
    expect(bodies.map((body) => body.type).sort()).toEqual([sent, 'application/pdf'].sort())
    expect(upload.mock.calls.map(([, , options]) => options.contentType).sort()).toEqual([sent, 'application/pdf'].sort())
    // The browser's File would carry its real name into the multipart form; the body is a nameless Blob.
    expect(bodies.some((body) => body instanceof File || 'name' in body)).toBe(false)
    expect(await objects()).toHaveLength(2) // and the bucket (its types and size are read from migration 0009) took both
  })

  it('sends a PDF the browser typed as something else as application/pdf', async () => {
    const upload = vi.spyOn(sb.port.storage.from('pieces'), 'upload')
    await uploads.createPiece({ title: 'Etude', recording: RECORDING, parts: [{ file: new File(['%PDF'], 'part.pdf', { type: 'text/plain' }), name: '' }] })
    expect(upload.mock.calls.map(([, body]) => body.type).sort()).toEqual(['application/pdf', 'audio/mpeg'])
    expect(await objects()).toHaveLength(2) // the part and the recording
  })

  it.each([
    ['a recording over 50 MB', { file: audio('big.mp3', MAX + 1) }, 'big.mp3 is larger than 50 MB.'],
    ['a type we do not read', { file: audio('list.m3u8') }, 'This file is not a recording we can read.'],
    ['a name with no suffix', { file: audio('recording') }, 'This file is not a recording we can read.'],
  ])('refuses %s in a sentence and makes nothing', async (_, recording, sentence) => {
    const error = await uploads.createPiece({ title: 'Etude', recording: { kind: 'file', file: recording.file }, parts: [{ file: pdf(), name: '' }] }).catch((caught: unknown) => caught)
    expect(sentenceOf(error)).toBe(sentence)
    expect(await asUser(db, CREATOR, 'select 1 from public.pieces')).toEqual([])
    expect(await objects()).toEqual([])
  })

  it('refuses a PDF over 50 MB in a sentence, before anything is made', async () => {
    const big = new File([new Uint8Array(MAX + 1)], 'big.pdf')
    const error = await uploads.createPiece({ title: 'Etude', recording: RECORDING, parts: [{ file: big, name: '' }] }).catch((caught: unknown) => caught)
    expect(sentenceOf(error)).toBe('big.pdf is larger than 50 MB.')
    expect(await asUser(db, CREATOR, 'select 1 from public.pieces')).toEqual([])
  })

  it('refuses an empty file, recording or part, in a sentence, before anything is made', async () => {
    const emptyPart = await uploads.createPiece({ title: 'Etude', recording: RECORDING, parts: [{ file: new File([], 'blank.pdf', { type: 'application/pdf' }), name: '' }] }).catch((caught: unknown) => caught)
    expect(sentenceOf(emptyPart)).toBe('blank.pdf is empty.')
    const emptyRecording = await uploads.createPiece({ title: 'Etude', recording: { kind: 'file', file: audio('silent.mp3', 0) }, parts: [{ file: pdf(), name: '' }] }).catch((caught: unknown) => caught)
    expect(sentenceOf(emptyRecording)).toBe('silent.mp3 is empty.')
    expect(await asUser(db, CREATOR, 'select 1 from public.pieces')).toEqual([])
    expect(await objects()).toEqual([])
  })

  it('hashes a part before any file moves', async () => {
    const digest = vi.spyOn(crypto.subtle, 'digest').mockRejectedValue(new Error('no secure context'))
    const upload = vi.spyOn(sb.port.storage.from('pieces'), 'upload')
    await expect(uploads.createPiece({ title: 'Etude', recording: RECORDING, parts: [{ file: pdf(), name: '' }] })).rejects.toThrow('no secure context')
    digest.mockRestore()
    expect(upload).not.toHaveBeenCalled()
    expect(await asUser(db, CREATOR, 'select 1 from public.pieces')).toEqual([])
  })

  it('takes a file of exactly 50 MB: the limit is the bucket\'s own', async () => {
    const piece = await uploads.createPiece({ title: 'Etude', recording: RECORDING, parts: [{ file: new File([new Uint8Array(MAX)], 'full.pdf', { type: 'application/pdf' }), name: '' }] })
    expect(piece.parts).toHaveLength(1)
  })

  it('takes a PDF the browser gives no type for, by its name, and refuses a file that is neither', async () => {
    await uploads.createPiece({ title: 'Etude', recording: RECORDING, parts: [{ file: new File(['%PDF'], 'part.PDF'), name: '' }] })
    const error = await uploads.createPiece({ title: 'Etude 2', recording: RECORDING, parts: [{ file: new File(['x'], 'notes.txt', { type: 'text/plain' }), name: '' }] }).catch((caught: unknown) => caught)
    expect(sentenceOf(error)).toBe('This file is not a PDF.')
    expect(await asUser(db, CREATOR, 'select title from public.pieces')).toEqual([{ title: 'Etude' }])
  })

  it('takes back everything when the recording will not upload: no piece, no row, no file', async () => {
    failUploadNumber(2) // the part goes up, the recording does not
    await expect(uploads.createPiece({ title: 'Etude', recording: { kind: 'file', file: audio() }, parts: [{ file: pdf(), name: '' }] })).rejects.toThrow('no room')
    expect(await asUser(db, CREATOR, 'select 1 from public.pieces')).toEqual([])
    expect(await asUser(db, CREATOR, 'select 1 from public.score_files')).toEqual([])
    expect(await objects()).toEqual([])
  })

  it('takes back the first part when the second will not upload', async () => {
    failUploadNumber(2)
    await expect(uploads.createPiece({ title: 'Etude', recording: RECORDING, parts: [{ file: pdf('a.pdf'), name: '' }, { file: pdf('b.pdf'), name: '' }] })).rejects.toThrow('no room')
    expect(await asUser(db, CREATOR, 'select 1 from public.pieces')).toEqual([])
    expect(await objects()).toEqual([])
  })

  it('takes back the files when the recording row is refused', async () => {
    const real = sb.port.from.bind(sb.port)
    vi.spyOn(sb.port, 'from').mockImplementation((table) => {
      const query = real(table)
      return table === 'audio_sources' ? { ...query, insert: () => Promise.resolve({ data: null, error: { message: 'refused' } }) as never } : query
    })
    await expect(uploads.createPiece({ title: 'Etude', recording: { kind: 'file', file: audio() }, parts: [{ file: pdf(), name: '' }] })).rejects.toThrow('refused')
    vi.restoreAllMocks()
    expect(await asUser(db, CREATOR, 'select 1 from public.pieces')).toEqual([])
    expect(await objects()).toEqual([])
  })

  it('still throws the first failure when taking back fails too', async () => {
    failUploadNumber(2)
    const bucket = sb.port.storage.from('pieces')
    vi.spyOn(bucket, 'remove').mockRejectedValue(new Error('offline'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    await expect(uploads.createPiece({ title: 'Etude', recording: RECORDING, parts: [{ file: pdf('a.pdf'), name: '' }, { file: pdf('b.pdf'), name: '' }] })).rejects.toThrow('no room')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('left 2 files in storage'))
  })

  it('stops a Trial user at a second part, names the limit, and leaves no piece or file behind', async () => {
    currentUser = STRANGER
    const error = await uploads.createPiece({ title: 'Etude', recording: RECORDING, parts: [{ file: pdf('a.pdf'), name: '' }, { file: pdf('b.pdf'), name: '' }] }).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(PlanLimitError)
    expect((error as PlanLimitError).limit).toBe('parts_per_piece_max')
    expect(await db.query('select 1 from public.pieces')).toMatchObject({ rows: [] })
    expect(await db.query('select 1 from storage.objects')).toMatchObject({ rows: [] })
  })

  it('refuses before anything is made, so a refused part does not cost a Trial user a piece', async () => {
    currentUser = STRANGER
    const insert = vi.spyOn(sb.port, 'from')
    const error = await uploads.createPiece({ title: 'Etude', recording: RECORDING, parts: [{ file: pdf('a.pdf'), name: '' }, { file: pdf('b.pdf'), name: '' }] }).catch((caught: unknown) => caught)
    expect((error as PlanLimitError).limit).toBe('parts_per_piece_max')
    const ticked = await uploads.createPiece({ title: 'Etude', recording: RECORDING, parts: [{ file: pdf('a.pdf'), name: '', boxCheck: true }] }).catch((caught: unknown) => caught)
    expect((ticked as PlanLimitError).limit).toBe('advanced_reading')
    expect(insert).not.toHaveBeenCalled() // no row of any table was touched
    expect(await db.query('select 1 from public.usage_events')).toMatchObject({ rows: [] }) // no piece_created event: the slot is kept
    expect(await db.query('select 1 from storage.objects')).toMatchObject({ rows: [] })
  })

  it('a split counts its parts and ticks in the same early check', async () => {
    currentUser = STRANGER
    const split = { splitId: '11111111-1111-4111-8111-111111111111', fileName: 'Band.pdf', parts: [range('Flute', 1, 2), range('Oboe', 3, 3)], boxChecks: [false, false] }
    const error = await uploads.createPiece({ title: 'Etude', recording: RECORDING, parts: [], split }).catch((caught: unknown) => caught)
    expect((error as PlanLimitError).limit).toBe('parts_per_piece_max')
    expect(cut.calls).toEqual([])
    expect(await db.query('select 1 from public.usage_events')).toMatchObject({ rows: [] })
  })

  it('when the plan cannot be read first, the policies still refuse and name the limit', async () => {
    currentUser = STRANGER
    const real = sb.port.rpc.bind(sb.port)
    let calls = 0
    vi.spyOn(sb.port, 'rpc').mockImplementation(((name: string, args?: Record<string, unknown>) => {
      calls += 1
      return calls === 1 ? Promise.resolve({ data: null, error: { message: 'offline' } }) : real(name, args)
    }) as typeof sb.port.rpc)
    const error = await uploads.createPiece({ title: 'Etude', recording: RECORDING, parts: [{ file: pdf('a.pdf'), name: '' }, { file: pdf('b.pdf'), name: '' }] }).catch((caught: unknown) => caught)
    expect((error as PlanLimitError).limit).toBe('parts_per_piece_max')
    expect(await db.query('select 1 from public.pieces')).toMatchObject({ rows: [] })
  })

  it('stops a Trial user at the Advanced Reading tick, naming Advanced Reading', async () => {
    currentUser = STRANGER
    const error = await uploads.createPiece({ title: 'Etude', recording: RECORDING, parts: [{ file: pdf('a.pdf'), name: '', boxCheck: true }] }).catch((caught: unknown) => caught)
    expect((error as PlanLimitError).limit).toBe('advanced_reading')
    expect(await db.query('select 1 from public.pieces')).toMatchObject({ rows: [] })
  })

  it('stops a Trial user who has made the 3 pieces, naming the limit from a fresh read of the plan, and uploads nothing', async () => {
    currentUser = STRANGER
    for (let made = 0; made < 3; made += 1) await db.exec(`insert into public.pieces (owner_id, title) values ('${STRANGER}', 'Old ${made}')`)
    const error = await uploads.createPiece({ title: 'Etude', recording: RECORDING, parts: [{ file: pdf(), name: '' }] }).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(PlanLimitError)
    expect((error as PlanLimitError).limit).toBe('pieces_created_max')
    expect(await db.query('select 1 from storage.objects')).toMatchObject({ rows: [] })
  })

  it('names the paused plan before the counts', async () => {
    currentUser = STRANGER
    await db.exec("update public.plans set new_pieces_paused = true where id = 'trial'")
    try {
      const error = await uploads.createPiece({ title: 'Etude', recording: RECORDING, parts: [] }).catch((caught: unknown) => caught)
      expect((error as PlanLimitError).limit).toBe('new_pieces_paused')
    } finally {
      await db.exec("update public.plans set new_pieces_paused = false where id = 'trial'")
    }
  })

  it('a refusal that is not the plan stays a plain error', async () => {
    failUploadNumber(1)
    const error = await uploads.createPiece({ title: 'Etude', recording: RECORDING, parts: [{ file: pdf('a.pdf'), name: '' }] }).catch((caught: unknown) => caught)
    expect(error).not.toBeInstanceOf(PlanLimitError)
  })

  it('saves the Advanced Reading tick with the part it was set on', async () => {
    await uploads.createPiece({ title: 'Etude', recording: RECORDING, parts: [{ file: pdf('a.pdf'), name: 'A', boxCheck: true }, { file: pdf('b.pdf'), name: 'B' }] })
    const rows = await asUser(db, CREATOR, 'select name, box_check from public.score_files order by position')
    expect(rows).toEqual([{ name: 'A', box_check: true }, { name: 'B', box_check: false }])
  })

  describe('with a split PDF', () => {
    const split = { splitId: '11111111-1111-4111-8111-111111111111', fileName: 'Band.pdf', parts: [range('Flute', 1, 2), range('  Oboe  ', 3, 3, []), range('Clarinet', 4, 6, [5])], boxChecks: [false, true, false] }

    it('has the processor write the kept parts into the piece\'s folder and adds a row for each, named as the user named them', async () => {
      const piece = await uploads.createPiece({ title: 'Etude', recording: RECORDING, parts: [], split })
      expect(cut.calls).toHaveLength(1)
      expect(cut.calls[0]).toMatchObject({ pieceId: piece.id, splitId: split.splitId })
      expect(cut.calls[0]!.parts.map(({ name, fromPage, toPage, skipPages }) => ({ name, fromPage, toPage, skipPages }))).toEqual(split.parts)
      const rows = await asUser<{ id: string; storage_path: string; name: string; name_source: string; position: number; box_check: boolean; sha256: string }>(db, CREATOR, 'select * from public.score_files order by position')
      expect(rows.map((row) => [row.name, row.name_source, row.position, row.box_check])).toEqual([['Flute', 'user', 0, false], ['Oboe', 'user', 1, true], ['Clarinet', 'user', 2, false]])
      expect(rows.map((row) => row.id)).toEqual(cut.calls[0]!.parts.map((part) => part.id))
      for (const row of rows) expect(row.storage_path).toBe(`${CREATOR}/${piece.id}/parts/${row.id}.pdf`)
      expect(rows[0]!.sha256).toBe('ab'.repeat(32))
      expect(piece.parts.map((part) => part.name)).toEqual(['Flute', 'Oboe', 'Clarinet'])
      expect(await objects()).toEqual([...rows.map((row) => row.storage_path), `${CREATOR}/${piece.id}/upload/recording.mp3`].sort())
    })

    it('puts the parts of a split after the part files sent with it', async () => {
      await uploads.createPiece({ title: 'Etude', recording: RECORDING, parts: [{ file: pdf('Cover.pdf'), name: 'Cover' }], split })
      const rows = await asUser(db, CREATOR, 'select name, position from public.score_files order by position')
      expect(rows.map((row) => (row as { name: string }).name)).toEqual(['Cover', 'Flute', 'Oboe', 'Clarinet'])
    })

    it('makes no piece when the processor says the split has expired, and leaves no file', async () => {
      cut.refuse = new SentenceError(SPLIT_EXPIRED)
      const error = await uploads.createPiece({ title: 'Etude', recording: RECORDING, parts: [], split }).catch((caught: unknown) => caught)
      expect(sentenceOf(error)).toBe(SPLIT_EXPIRED)
      expect(await asUser(db, CREATOR, 'select 1 from public.pieces')).toEqual([])
      expect(await objects()).toEqual([]) // the PDFs the processor wrote before it failed are taken back
    })

    it('does not ask the processor for anything when the piece itself cannot be made', async () => {
      currentUser = STRANGER
      for (let made = 0; made < 3; made += 1) await db.exec(`insert into public.pieces (owner_id, title) values ('${STRANGER}', 'Old ${made}')`)
      await expect(uploads.createPiece({ title: 'Etude', recording: RECORDING, parts: [], split })).rejects.toThrow()
      expect(cut.calls).toEqual([])
    })

    it('takes back the PDFs when a part row is refused', async () => {
      const real = sb.port.from.bind(sb.port)
      vi.spyOn(sb.port, 'from').mockImplementation((table) => {
        const query = real(table)
        return table === 'score_files' ? { ...query, insert: () => Promise.resolve({ data: null, error: { message: 'refused' } }) as never } : query
      })
      await expect(uploads.createPiece({ title: 'Etude', recording: RECORDING, parts: [], split })).rejects.toThrow('refused')
      vi.restoreAllMocks()
      expect(await asUser(db, CREATOR, 'select 1 from public.pieces')).toEqual([])
      expect(await objects()).toEqual([])
    })

    it('adds the parts of a split to a piece after the parts it has, and not to a piece that is not the user\'s', async () => {
      const piece = await uploads.createPiece({ title: 'Etude', recording: RECORDING, parts: [{ file: pdf(), name: 'Cover' }] })
      const added = await uploads.storeParts(piece.id, [], split)
      expect(added.map((part) => part.name)).toEqual(['Flute', 'Oboe', 'Clarinet'])
      const rows = await asUser(db, CREATOR, 'select name, position from public.score_files order by position')
      expect(rows.map((row) => (row as { position: number }).position)).toEqual([0, 1, 2, 3])

      currentUser = STRANGER
      cut.calls = []
      await expect(uploads.storeParts(piece.id, [], split)).rejects.toThrow('piece not found')
      expect(cut.calls).toEqual([])
    })

    it('takes back only the PDFs of this call when an add fails', async () => {
      const piece = await uploads.createPiece({ title: 'Etude', recording: RECORDING, parts: [{ file: pdf(), name: 'Cover' }] })
      cut.refuse = new SentenceError(SPLIT_EXPIRED)
      await expect(uploads.storeParts(piece.id, [], split)).rejects.toThrow()
      expect(await asUser(db, CREATOR, 'select name from public.score_files')).toEqual([{ name: 'Cover' }])
      expect(await objects()).toHaveLength(2) // the cover and the recording
    })
  })
})

describe('storeParts', () => {
  it('adds after the parts the piece has', async () => {
    const piece = await uploads.createPiece({ title: 'Etude', recording: RECORDING, parts: [{ file: pdf(), name: '' }] })
    const added = await uploads.storeParts(piece.id, [{ file: pdf('b.pdf'), name: 'Oboe' }])
    expect(added[0]).toMatchObject({ name: 'Oboe', pageCount: 0 })
    const rows = await asUser<{ position: number }>(db, CREATOR, 'select position from public.score_files order by position')
    expect(rows.map((row) => row.position)).toEqual([0, 1])
  })

  it('refuses a file that is too large or not a PDF before storing any of them', async () => {
    const piece = await uploads.createPiece({ title: 'Etude', recording: RECORDING, parts: [{ file: pdf(), name: '' }] })
    const big = new File([new Uint8Array(MAX + 1)], 'big.pdf', { type: 'application/pdf' })
    const tooLarge = await uploads.storeParts(piece.id, [{ file: pdf('ok.pdf'), name: '' }, { file: big, name: '' }]).catch((caught: unknown) => caught)
    expect(sentenceOf(tooLarge)).toBe('big.pdf is larger than 50 MB.')
    const notPdf = await uploads.storeParts(piece.id, [{ file: new File(['x'], 'a.txt', { type: 'text/plain' }), name: '' }]).catch((caught: unknown) => caught)
    expect(sentenceOf(notPdf)).toBe('This file is not a PDF.')
    expect(await objects()).toHaveLength(2) // the first part and the recording
    expect(await asUser(db, CREATOR, 'select 1 from public.score_files')).toHaveLength(1)
  })

  it('takes back the parts of this call when one fails, and keeps the parts the piece had', async () => {
    const piece = await uploads.createPiece({ title: 'Etude', recording: RECORDING, parts: [{ file: pdf(), name: '' }] })
    failUploadNumber(2) // the first new part goes up, the second does not
    await expect(uploads.storeParts(piece.id, [{ file: pdf('b.pdf'), name: '' }, { file: pdf('c.pdf'), name: '' }])).rejects.toThrow('no room')
    expect(await asUser(db, CREATOR, 'select 1 from public.score_files')).toHaveLength(1)
    expect(await objects()).toHaveLength(2) // the first part and the recording
  })

  it('refuses a creator who does not own the piece before any file moves', async () => {
    const piece = await uploads.createPiece({ title: 'Etude', recording: RECORDING, parts: [{ file: pdf(), name: '' }] })
    currentUser = OTHER_CREATOR
    const upload = vi.spyOn(sb.port.storage.from('pieces'), 'upload')
    await expect(uploads.storeParts(piece.id, [{ file: pdf('b.pdf'), name: '' }])).rejects.toThrow('piece not found')
    expect(upload).not.toHaveBeenCalled()
    expect(await objects()).toHaveLength(2) // the first part and the recording
    expect(await asUser(db, CREATOR, 'select 1 from public.score_files')).toHaveLength(1)
  })

  it('refuses an empty part in a sentence', async () => {
    const piece = await uploads.createPiece({ title: 'Etude', recording: RECORDING, parts: [{ file: pdf(), name: '' }] })
    const error = await uploads.storeParts(piece.id, [{ file: new File([], 'blank.pdf', { type: 'application/pdf' }), name: '' }]).catch((caught: unknown) => caught)
    expect(sentenceOf(error)).toBe('blank.pdf is empty.')
  })

  it('stops a stranger at the database and leaves no file behind', async () => {
    const piece = await uploads.createPiece({ title: 'Etude', recording: RECORDING, parts: [{ file: pdf(), name: '' }] })
    currentUser = STRANGER
    await expect(uploads.storeParts(piece.id, [{ file: pdf('b.pdf'), name: '' }])).rejects.toThrow()
    expect((await db.query('select 1 from storage.objects')).rows).toHaveLength(2) // the first part and the recording
    expect(await db.query('select 1 from public.score_files')).toMatchObject({ rows: [expect.anything()] })
  })
})
