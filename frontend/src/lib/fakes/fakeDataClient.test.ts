import { expandPlayOrder } from '@/domain/playOrder'
import { DEFAULT_PRACTICE_MEMORY, type Job, type TimingLayer } from '@/domain/types'
import { DEFAULT_SETTINGS, type DataClient, type NewPieceInput, type User, type UserSettings } from '@/lib/dataClient'
import { createFakes, type FakeStage } from '@/lib/fakes'
import { clickTrackUrl } from '@/lib/fakes/clickTrack'
import { addSeedPiece } from '@/lib/fakes/seed'
import { applyReviewItems, DEMO_REVIEW_ITEMS, uncheckedItems } from '@/lib/fakes/reviewSeed'
import { DEMO_SPEC, recordingPeaks, syntheticTiming } from '@/lib/fakes/syntheticPiece'
import { DEMO_USER, OTHER_USER } from '@/lib/fakes/store'

function file(name: string, content = 'data'): File {
  return new File([content], name)
}

function newPieceInput(overrides: Partial<NewPieceInput> = {}): NewPieceInput {
  return {
    title: 'Spring Overture',
    recording: { kind: 'file', file: new File(['x'], 'take.mp3', { type: 'audio/mpeg' }) },
    parts: [
      { file: file('clar.pdf'), name: 'Clarinet' },
      { file: file('flute.pdf'), name: 'Flute' },
      { file: file('oboe.pdf'), name: 'Oboe' },
    ],
    ...overrides,
  }
}

/** Reads a job `count` times and returns what each read showed. */
async function readJob(data: DataClient, jobId: string, count: number): Promise<Job[]> {
  const seen: Job[] = []
  for (let i = 0; i < count; i++) {
    const job = await data.getJob(jobId)
    if (job === null) throw new Error(`job ${jobId} not found`)
    seen.push(job)
  }
  return seen
}

const STAGES_AND_PROGRESS: Array<[Job['status'], number]> = [
  ['running', 0.2],
  ['running', 0.35],
  ['running', 0.55],
  ['running', 0.65],
  ['running', 0.8],
  ['running', 0.95],
  ['done', 1],
]

describe('FakeDataClient sign-in', () => {
  it('starts signed out by default', async () => {
    const { data } = createFakes()

    expect(await data.getUser()).toBeNull()
  })

  it('starts signed in as the demo user when asked', async () => {
    const { data } = createFakes({ signedIn: true })

    expect(await data.getUser()).toEqual({ id: 'user-demo', email: 'demo@example.com', name: 'Demo' })
  })

  it('signs the demo user in and tells the listeners', async () => {
    const { data } = createFakes()
    const heard: Array<User | null> = []
    data.onUserChange((user) => heard.push(user))

    const user = await data.signInWithGoogle()

    expect(user).toEqual(DEMO_USER)
    expect(await data.getUser()).toEqual(DEMO_USER)
    expect(heard).toEqual([DEMO_USER])
  })

  it('signs out and tells the listeners', async () => {
    const { data } = createFakes({ signedIn: true })
    const heard: Array<User | null> = []
    data.onUserChange((user) => heard.push(user))

    await data.signOut()

    expect(await data.getUser()).toBeNull()
    expect(heard).toEqual([null])
  })

  it('stops telling a listener once it unsubscribes', async () => {
    const { data } = createFakes()
    const heard: Array<User | null> = []
    const unsubscribe = data.onUserChange((user) => heard.push(user))

    unsubscribe()
    await data.signInWithGoogle()

    expect(heard).toEqual([])
  })

  it('has a second user in the store', () => {
    const { store } = createFakes()

    expect(store.users.get(DEMO_USER.id)).toEqual(DEMO_USER)
    expect(store.users.get(OTHER_USER.id)).toEqual(OTHER_USER)
    expect(OTHER_USER.id).not.toBe(DEMO_USER.id)
  })
})

describe('FakeDataClient while signed out', () => {
  const calls: Array<[string, (data: DataClient) => Promise<unknown>]> = [
    ['signOut', (data) => data.signOut()],
    ['getProfile', (data) => data.getProfile()],
    ['acceptTerms', (data) => data.acceptTerms()],
    ['saveSettings', (data) => data.saveSettings(DEFAULT_SETTINGS)],
    ['listPieces', (data) => data.listPieces()],
    ['getPiece', (data) => data.getPiece('piece-clark-county')],
    ['createPiece', (data) => data.createPiece(newPieceInput())],
    ['renamePiece', (data) => data.renamePiece('piece-clark-county', 'New')],
    ['renamePart', (data) => data.renamePart('piece-clark-county', 'part-1', 'New')],
    ['renameRecording', (data) => data.renameRecording('piece-clark-county', 'New')],
    ['deletePiece', (data) => data.deletePiece('piece-clark-county')],
    ['setCountInBars', (data) => data.setCountInBars('piece-clark-county', 2)],
    ['setLastPart', (data) => data.setLastPart('piece-clark-county', 'part-1')],
    ['storeParts', (data) => data.storeParts('piece-clark-county', [{ file: file('oboe.pdf'), name: 'Oboe' }])],
    ['savePracticeMemory', (data) => data.savePracticeMemory('piece-clark-county', DEFAULT_PRACTICE_MEMORY)],
    ['getPeaks', (data) => data.getPeaks('piece-clark-county')],
    ['getBeats', (data) => data.getBeats('piece-clark-county')],
    ['getJob', (data) => data.getJob('job-1')],
    ['getPieceMap', (data) => data.getPieceMap('piece-clark-county')],
    ['getPartPages', (data) => data.getPartPages('piece-clark-county', 'part-1')],
    ['saveTiming', (data) => data.saveTiming('piece-clark-county', syntheticTiming(DEMO_SPEC))],
    ['savePageLayer', (data) => data.savePageLayer('piece-clark-county', { partId: 'part-1', bars: [], rests: [] })],
  ]

  it.each(calls)('%s rejects with "not signed in"', async (_name, call) => {
    const { data } = createFakes({ seed: 'demo', signedIn: false })

    await expect(call(data)).rejects.toThrow('not signed in')
  })
})

describe('FakeDataClient profile', () => {
  it('starts with the default settings and no accepted terms', async () => {
    const { data } = createFakes({ signedIn: true })

    expect(await data.getProfile()).toEqual({
      acceptedTermsAt: null,
      acceptedTermsVersion: null,
      settings: DEFAULT_SETTINGS,
      isAdmin: true,
      displayName: DEMO_USER.name,
      email: DEMO_USER.email,
      sampleGivenAt: null,
    })
  })

  it('has the documented default settings', () => {
    expect(DEFAULT_SETTINGS).toEqual({
      follow: { scroll: 'line', box: true, boxColour: 'teal', line: true, lineColour: 'teal' },
      playback: { countInFade: 'pre-roll', showCount: true },
      nightScore: false,
      barNumbers: true,
      barLineMode: 'ripple',
      continueMode: 'ask',
      autoRegrid: false,
      loop: { colour: 'violet', show: true },
      libraryView: 'cards',
      theme: 'dark',
    })
  })

  it('starts with the terms accepted when asked', async () => {
    const { data } = createFakes({ signedIn: true, termsAccepted: true })

    expect((await data.getProfile()).acceptedTermsAt).not.toBeNull()
  })

  it('records the time the terms were accepted and keeps it', async () => {
    const { data } = createFakes({ signedIn: true })

    const profile = await data.acceptTerms()

    expect(profile.acceptedTermsAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect((await data.getProfile()).acceptedTermsAt).toBe(profile.acceptedTermsAt)
  })

  it('keeps the terms accepted across a sign-out and a new sign-in', async () => {
    const { data } = createFakes({ signedIn: true })
    await data.acceptTerms()

    await data.signOut()
    await data.signInWithGoogle()

    expect((await data.getProfile()).acceptedTermsAt).not.toBeNull()
  })

  it('saves settings and reads them back', async () => {
    const { data } = createFakes({ signedIn: true })
    const settings: UserSettings = {
      follow: { scroll: 'page', box: false, boxColour: 'amber', line: true, lineColour: 'pink' },
      playback: { countInFade: 'under-clicks', showCount: false },
      nightScore: true,
      barNumbers: false,
      barLineMode: 'plain',
      continueMode: 'auto',
      autoRegrid: true,
      loop: { colour: 'teal', show: false },
      libraryView: 'list',
      theme: 'light',
    }

    const saved = await data.saveSettings(settings)

    expect(saved.settings).toEqual(settings)
    expect((await data.getProfile()).settings).toEqual(settings)
  })

  it('reads a profile saved before the Editing settings existed with Ask me and the fix off', async () => {
    const { data } = createFakes({ signedIn: true })
    const old: Record<string, unknown> = { ...DEFAULT_SETTINGS, nightScore: true }
    delete old.continueMode
    delete old.autoRegrid

    await data.saveSettings(old as unknown as UserSettings)

    expect((await data.getProfile()).settings).toEqual({ ...DEFAULT_SETTINGS, nightScore: true, continueMode: 'ask', autoRegrid: false })
  })

  it('does not let a caller change the stored profile through what it passed or got back', async () => {
    const { data } = createFakes({ signedIn: true })
    const settings: UserSettings = {
      follow: { ...DEFAULT_SETTINGS.follow },
      playback: { ...DEFAULT_SETTINGS.playback },
      nightScore: false,
      barNumbers: true,
      barLineMode: 'ripple',
      continueMode: 'ask',
      autoRegrid: false,
      loop: { ...DEFAULT_SETTINGS.loop },
      libraryView: 'cards',
      theme: 'dark',
    }
    await data.saveSettings(settings)

    settings.nightScore = true
    settings.follow.box = false
    const profile = await data.getProfile()
    profile.settings.follow.lineColour = 'pink'

    expect((await data.getProfile()).settings).toEqual(DEFAULT_SETTINGS)
  })

  it('never changes DEFAULT_SETTINGS when settings are saved', async () => {
    const { data } = createFakes({ signedIn: true })

    await data.saveSettings({ ...DEFAULT_SETTINGS, nightScore: true })

    expect(DEFAULT_SETTINGS.nightScore).toBe(false)
  })
})

describe('FakeDataClient createPiece', () => {
  it('stores the parts in the given order with their names and positions', async () => {
    const { data } = createFakes({ signedIn: true, termsAccepted: true })

    const piece = await data.createPiece(newPieceInput())
    const detail = await data.getPiece(piece.id)

    expect(piece.parts.map((part) => part.name)).toEqual(['Clarinet', 'Flute', 'Oboe'])
    expect(detail?.parts.map((part) => [part.name, part.position])).toEqual([
      ['Clarinet', 0],
      ['Flute', 1],
      ['Oboe', 2],
    ])
  })

  it('returns the piece with its title, a fresh id, no job and a count-in of one bar', async () => {
    const { data } = createFakes({ signedIn: true })

    const piece = await data.createPiece(newPieceInput())
    const detail = await data.getPiece(piece.id)

    expect(piece.title).toBe('Spring Overture')
    expect(piece.id).not.toBe('')
    expect(piece.countInBars).toBe(1)
    expect(piece.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(detail?.piece).toEqual(piece)
    expect(detail?.job).toBeNull()
    expect(detail?.review).toEqual({ checked: 0, total: 0 })
  })

  it('gives every piece its own id and every part its own id', async () => {
    const { data } = createFakes({ signedIn: true })

    const first = await data.createPiece(newPieceInput())
    const second = await data.createPiece(newPieceInput())

    expect(second.id).not.toBe(first.id)
    const ids = [...first.parts, ...second.parts].map((part) => part.id)
    expect(new Set(ids).size).toBe(6)
  })

  it('keeps a file only as its name and size', async () => {
    const { data, store } = createFakes({ signedIn: true })

    const piece = await data.createPiece(
      newPieceInput({
        recording: { kind: 'file', file: file('take-3.mp3', 'abcdef') },
        parts: [{ file: file('clar.pdf', 'xyz'), name: 'Clarinet' }],
      }),
    )

    expect(store.recordings.get(piece.id)).toEqual({ kind: 'file', name: 'take-3.mp3', size: 6, title: 'take-3' })
    expect([...store.parts.values()].map((part) => part.file)).toEqual([{ name: 'clar.pdf', size: 3 }])
    expect(piece.recording).toEqual({ kind: 'file', urlOrPath: 'take-3.mp3', durationSec: null })
  })

  it('names a file recording after its file, without the extension', async () => {
    const { data } = createFakes({ signedIn: true })

    const piece = await data.createPiece(newPieceInput({ recording: { kind: 'file', file: file('take-3.mp3') } }))

    expect((await data.getPiece(piece.id))?.recordingLabel).toBe('take-3')
  })

  it('names a part that was given no name after its file, and keeps a name that was given', async () => {
    const { data } = createFakes({ signedIn: true })

    const piece = await data.createPiece(
      newPieceInput({ parts: [{ file: file('CCC_clar1-final.pdf'), name: '' }, { file: file('flute.pdf'), name: '  My flute ' }] }),
    )

    expect((await data.getPiece(piece.id))?.parts.map((part) => part.name)).toEqual(['CCC clar1 final', 'My flute'])
  })

  it('does not start a job', async () => {
    const { data, store } = createFakes({ signedIn: true })

    await data.createPiece(newPieceInput())

    expect(store.jobs.size).toBe(0)
  })

  it('puts the new piece first in the list, newest first', async () => {
    const { data } = createFakes({ seed: 'demo' })
    await data.signInWithGoogle()

    const piece = await data.createPiece(newPieceInput())
    const list = await data.listPieces()

    expect(list).toHaveLength(6)
    expect(list[0]).toMatchObject({ id: piece.id, title: 'Spring Overture', partCount: 3, durationSec: null, job: null })
  })

  it('does not share its parts array with the store', async () => {
    const { data } = createFakes({ signedIn: true })
    const piece = await data.createPiece(newPieceInput())

    piece.parts.pop()
    piece.title = 'Changed'

    const detail = await data.getPiece(piece.id)
    expect(detail?.parts).toHaveLength(3)
    expect(detail?.piece.title).toBe('Spring Overture')
  })
})

describe('FakeDataClient jobs', () => {
  it('moves a job one stage on at every read, with the progress of the processor', async () => {
    const { data, processor } = createFakes({ signedIn: true })
    const piece = await data.createPiece(newPieceInput())
    const queued = await processor.processPiece(piece.id)

    const seen = await readJob(data, queued.id, 7)

    expect(queued).toMatchObject({ pieceId: piece.id, kind: 'process-piece', status: 'queued', progress: 0, error: null })
    expect(seen.map((job): [Job['status'], number] => [job.status, job.progress])).toEqual(STAGES_AND_PROGRESS)
    expect(seen.every((job) => job.error === null && job.id === queued.id)).toBe(true)
  })

  it('stops moving a job once it is done', async () => {
    const { data, processor } = createFakes({ signedIn: true })
    const piece = await data.createPiece(newPieceInput())
    const queued = await processor.processPiece(piece.id)

    const seen = await readJob(data, queued.id, 10)

    expect(seen.slice(6).map((job) => [job.status, job.progress])).toEqual([
      ['done', 1],
      ['done', 1],
      ['done', 1],
      ['done', 1],
    ])
  })

  it('moves the job on when it is read through getPiece and through listPieces', async () => {
    const { data, processor } = createFakes({ signedIn: true })
    const piece = await data.createPiece(newPieceInput())
    const queued = await processor.processPiece(piece.id)

    const fromPiece = (await data.getPiece(piece.id))?.job
    const fromList = (await data.listPieces())[0].job
    const fromJob = await data.getJob(queued.id)

    expect(fromPiece?.progress).toBe(0.2)
    expect(fromList?.progress).toBe(0.35)
    expect(fromJob?.progress).toBe(0.55)
  })

  it('moves only the job that a read returns', async () => {
    const { data, processor } = createFakes({ signedIn: true })
    const first = await data.createPiece(newPieceInput({ title: 'First' }))
    const second = await data.createPiece(newPieceInput({ title: 'Second' }))
    const firstJob = await processor.processPiece(first.id)
    const secondJob = await processor.processPiece(second.id)

    await data.getPiece(first.id)

    expect((await data.getJob(secondJob.id))?.progress).toBe(0.2)
    expect((await data.getJob(firstJob.id))?.progress).toBe(0.35)
  })

  it('shows a piece\'s latest job in the list', async () => {
    const { data, processor } = createFakes({ signedIn: true })
    const piece = await data.createPiece(newPieceInput())
    await processor.processPiece(piece.id)
    const latest = await processor.processPiece(piece.id)

    const [summary] = await data.listPieces()

    expect(summary.job?.id).toBe(latest.id)
  })

  it('returns a job nobody else can change', async () => {
    const { data, processor } = createFakes({ signedIn: true })
    const piece = await data.createPiece(newPieceInput())
    const queued = await processor.processPiece(piece.id)

    queued.progress = 0.9
    queued.status = 'done'

    expect((await data.getJob(queued.id))?.progress).toBe(0.2)
  })

  it('returns null for a job that does not exist', async () => {
    const { data } = createFakes({ signedIn: true })

    expect(await data.getJob('job-nope')).toBeNull()
  })

  it.each<[FakeStage, number]>([
    ['audio', 0],
    ['pages', 0.2],
    ['omr', 0.35],
    ['play order', 0.55],
    ['downbeats', 0.65],
    ['align', 0.8],
  ])('ends in an error when it reaches the %s stage', async (stage, progressBefore) => {
    const { data, processor } = createFakes({ signedIn: true, failStage: stage })
    const piece = await data.createPiece(newPieceInput())
    const queued = await processor.processPiece(piece.id)

    const seen = await readJob(data, queued.id, 10)
    const last = seen[seen.length - 1]

    expect(last).toMatchObject({ status: 'error', progress: progressBefore, error: `${stage} failed: fake failure` })
    expect(seen.filter((job) => job.status === 'error').length).toBeGreaterThan(1)
    expect(seen.some((job) => job.status === 'done')).toBe(false)
  })

  it('fails only the first job at the failing stage, so a retry can finish', async () => {
    const { data, processor, store } = createFakes({ signedIn: true, failStage: 'omr' })
    const piece = await data.createPiece(newPieceInput())
    const failed = await processor.processPiece(piece.id)
    await readJob(data, failed.id, 5)
    expect(store.failStage).toBeUndefined()

    const retry = await processor.processPiece(piece.id)
    const seen = await readJob(data, retry.id, 7)

    expect(seen[seen.length - 1]).toMatchObject({ status: 'done', progress: 1, error: null })
    expect((await data.getJob(failed.id))?.status).toBe('error')
  })

  it('can be told to fail again by setting failStage on the store', async () => {
    const { data, processor, store } = createFakes({ signedIn: true })
    const piece = await data.createPiece(newPieceInput())
    store.failStage = 'align'

    const job = await processor.processPiece(piece.id)
    const seen = await readJob(data, job.id, 8)

    expect(seen[seen.length - 1]).toMatchObject({ status: 'error', error: 'align failed: fake failure' })
  })

  it('gives the detected beats after the job is done, a downbeat first in each bar, and none before', async () => {
    const { data, processor } = createFakes({ signedIn: true })
    const piece = await data.createPiece(newPieceInput())
    expect(await data.getBeats(piece.id)).toBeNull()
    const queued = await processor.processPiece(piece.id)
    await readJob(data, queued.id, 7)

    const beats = await data.getBeats(piece.id)

    expect(beats?.length).toBeGreaterThan(100)
    expect(beats?.every((beat, index) => index === 0 || beat.t > beats[index - 1].t)).toBe(true)
    expect(beats?.[0].downbeat).toBeGreaterThan(0.5)
    expect(beats?.[1].downbeat).toBeLessThan(0.5)
    expect(await data.getBeats('piece-nope')).toBeNull()
  })

  it('gives peaks and a review status only after the job is done', async () => {
    const { data, processor } = createFakes({ signedIn: true })
    const piece = await data.createPiece(newPieceInput())
    expect(await data.getPeaks(piece.id)).toBeNull()
    const queued = await processor.processPiece(piece.id)

    // Five reads reach 0.8; this read of the piece is the sixth stage (0.95), so the job is not done yet.
    await readJob(data, queued.id, 5)
    expect(await data.getPeaks(piece.id)).toBeNull()
    const before = await data.getPiece(piece.id)
    expect(before?.job).toMatchObject({ status: 'running', progress: 0.95 })
    expect(await data.getPeaks(piece.id)).toBeNull()
    expect(before?.review).toEqual({ checked: 0, total: 0 })
    expect(before?.parts.map((part) => part.review)).toEqual([
      { checked: 0, total: 0 },
      { checked: 0, total: 0 },
      { checked: 0, total: 0 },
    ])

    await readJob(data, queued.id, 1)
    const peaks = await data.getPeaks(piece.id)
    const after = await data.getPiece(piece.id)

    expect(peaks).toHaveLength(10840)
    expect(peaks?.every((peak) => peak >= 0 && peak <= 1)).toBe(true)
    expect(new Set(peaks).size).toBeGreaterThan(200)
    // The map has the board's twelve flags, none checked, and every part has all its bars: the parts and the piece share them.
    expect(after?.parts.map((part) => part.review)).toEqual([
      { checked: 0, total: 12 },
      { checked: 0, total: 12 },
      { checked: 0, total: 12 },
    ])
    expect(after?.review).toEqual({ checked: 0, total: 12 })
  })

  it('makes the same peaks for every piece', async () => {
    const { data, processor } = createFakes({ signedIn: true })
    const first = await data.createPiece(newPieceInput())
    const second = await data.createPiece(newPieceInput())
    for (const piece of [first, second]) {
      const job = await processor.processPiece(piece.id)
      await readJob(data, job.id, 7)
    }

    expect(await data.getPeaks(first.id)).toEqual(await data.getPeaks(second.id))
  })

  it('knows the duration once the audio stage is done', async () => {
    const { data, processor } = createFakes({ signedIn: true })
    const piece = await data.createPiece(newPieceInput())
    expect((await data.listPieces())[0].durationSec).toBeNull()
    const queued = await processor.processPiece(piece.id)

    await readJob(data, queued.id, 1)

    const [summary] = await data.listPieces()
    const detail = await data.getPiece(piece.id)
    expect(summary.durationSec).toBeGreaterThan(0)
    expect(detail?.piece.recording?.durationSec).toBe(summary.durationSec)
  })

  it('does not change the review or the peaks when a job fails', async () => {
    const { data, processor } = createFakes({ signedIn: true, failStage: 'align' })
    const piece = await data.createPiece(newPieceInput())
    const job = await processor.processPiece(piece.id)

    await readJob(data, job.id, 8)

    expect(await data.getPeaks(piece.id)).toBeNull()
    expect((await data.getPiece(piece.id))?.review).toEqual({ checked: 0, total: 0 })
  })

  it('gives a new job of a piece a new review once it is done', async () => {
    const { data, processor } = createFakes({ signedIn: true })
    const piece = await data.createPiece(newPieceInput({ parts: [{ file: file('a.pdf'), name: 'A' }] }))
    const first = await processor.processPiece(piece.id)
    await readJob(data, first.id, 7)

    const again = await processor.processPiece(piece.id)
    await readJob(data, again.id, 7)

    expect((await data.getPiece(piece.id))?.review).toEqual({ checked: 0, total: 12 })
  })
})

describe('FakeDataClient piece edits', () => {
  it('renames a piece', async () => {
    const { data } = createFakes({ signedIn: true })
    const piece = await data.createPiece(newPieceInput())

    await data.renamePiece(piece.id, 'Autumn Overture')

    expect((await data.getPiece(piece.id))?.piece.title).toBe('Autumn Overture')
    expect((await data.listPieces())[0].title).toBe('Autumn Overture')
  })

  it('renames a part, in the hub list and in the piece', async () => {
    const { data } = createFakes({ signedIn: true })
    const piece = await data.createPiece(newPieceInput())
    const flute = piece.parts[1]

    await data.renamePart(piece.id, flute.id, '  Flute 1  ')

    const detail = await data.getPiece(piece.id)
    expect(detail?.parts.map((part) => part.name)).toEqual(['Clarinet', 'Flute 1', 'Oboe'])
    expect(detail?.piece.parts.map((part) => part.name)).toEqual(['Clarinet', 'Flute 1', 'Oboe'])
    expect((await data.getPieceMap(piece.id))?.piece.parts[1].name).toBe('Flute 1')
  })

  it.each([
    ['an empty name', '', 'empty'],
    ['a name of spaces', '   ', 'empty'],
    ['a name over 80 characters', 'p'.repeat(81), 'too long'],
  ])('refuses %s for a part', async (_label, name, reason) => {
    const { data } = createFakes({ signedIn: true })
    const piece = await data.createPiece(newPieceInput())

    await expect(data.renamePart(piece.id, piece.parts[0].id, name)).rejects.toThrow(reason === 'empty' ? 'is empty' : 'is too long')

    expect((await data.getPiece(piece.id))?.parts[0].name).toBe('Clarinet')
  })

  it('refuses a part the piece does not have', async () => {
    const { data } = createFakes({ signedIn: true })
    const piece = await data.createPiece(newPieceInput())

    await expect(data.renamePart(piece.id, 'part-nope', 'New')).rejects.toThrow('part not found')
  })

  it('renames the recording', async () => {
    const { data } = createFakes({ signedIn: true })
    const piece = await data.createPiece(newPieceInput({ recording: { kind: 'file', file: file('take-3.mp3') } }))

    await data.renameRecording(piece.id, ' Los Banditos band performance march 2019 ')

    expect((await data.getPiece(piece.id))?.recordingLabel).toBe('Los Banditos band performance march 2019')
  })

  it('names a recording and keeps the file name as what the piece records', async () => {
    const { data } = createFakes({ signedIn: true })
    const piece = await data.createPiece(newPieceInput())
    expect((await data.getPiece(piece.id))?.recordingLabel).toBe('take')

    await data.renameRecording(piece.id, 'Concert')

    expect((await data.getPiece(piece.id))?.recordingLabel).toBe('Concert')
    expect(piece.recording?.urlOrPath).toBe('take.mp3')
  })

  it.each([
    ['an empty name', '', 'empty'],
    ['a name over 120 characters', 'r'.repeat(121), 'too long'],
  ])('refuses %s for the recording', async (_label, name, reason) => {
    const { data } = createFakes({ signedIn: true })
    const piece = await data.createPiece(newPieceInput())

    await expect(data.renameRecording(piece.id, name)).rejects.toThrow(reason === 'empty' ? 'is empty' : 'is too long')
  })

  it('deletes a piece with its parts, job, recording and peaks', async () => {
    const { data, processor, store } = createFakes({ signedIn: true })
    const piece = await data.createPiece(newPieceInput())
    const job = await processor.processPiece(piece.id)
    await readJob(data, job.id, 7)

    await data.deletePiece(piece.id)

    expect(await data.getPiece(piece.id)).toBeNull()
    expect(await data.listPieces()).toEqual([])
    expect(await data.getPeaks(piece.id)).toBeNull()
    expect(await data.getJob(job.id)).toBeNull()
    expect(store.pieces.size).toBe(0)
    expect(store.parts.size).toBe(0)
    expect(store.recordings.size).toBe(0)
    expect(store.jobs.size).toBe(0)
    expect(store.peaks.size).toBe(0)
  })

  it('changes the count-in length of a piece and keeps it', async () => {
    const { data } = createFakes({ signedIn: true })
    const piece = await data.createPiece(newPieceInput())
    expect((await data.getPiece(piece.id))?.piece.countInBars).toBe(1)

    await data.setCountInBars(piece.id, 3)
    expect((await data.getPiece(piece.id))?.piece.countInBars).toBe(3)

    await data.setCountInBars(piece.id, 0)
    expect((await data.getPiece(piece.id))?.piece.countInBars).toBe(0)
  })

  it('remembers the last opened part of a piece, none before one is opened', async () => {
    const { data } = createFakes({ signedIn: true })
    const piece = await data.createPiece(newPieceInput())
    expect((await data.getPiece(piece.id))?.piece.lastPartId).toBeNull()
    const [first, second] = piece.parts

    await data.setLastPart(piece.id, second.id)
    expect((await data.getPiece(piece.id))?.piece.lastPartId).toBe(second.id)
    expect((await data.getPieceMap(piece.id))?.piece.lastPartId).toBe(second.id)

    await data.setLastPart(piece.id, first.id)
    expect((await data.getPiece(piece.id))?.piece.lastPartId).toBe(first.id)
  })

  it('stores the files of new parts after the parts the piece has, and gives back the parts', async () => {
    const { data, store } = createFakes({ seed: 'demo' })
    const before = (await data.getPiece('piece-clark-county'))!.parts

    const added = await data.storeParts('piece-clark-county', [
      { file: file('oboe.pdf'), name: 'Oboe 1' },
      { file: file('horn.pdf'), name: 'Horn in F' },
    ])

    expect(added.map((part) => part.name)).toEqual(['Oboe 1', 'Horn in F'])
    const detail = (await data.getPiece('piece-clark-county'))!
    expect(detail.parts.map((part) => part.name)).toEqual([...before.map((part) => part.name), 'Oboe 1', 'Horn in F'])
    expect(detail.parts.map((part) => part.position)).toEqual([0, 1, 2, 3, 4])
    expect(detail.parts[3].pageCount).toBe(0)
    expect(store.parts.get(added[0].id)?.file).toEqual({ name: 'oboe.pdf', size: 4 })
    expect(detail.piece.parts.map((part) => part.id)).toEqual(detail.parts.map((part) => part.id))
  })

  it('refuses a part that is not a part of the piece', async () => {
    const { data } = createFakes({ seed: 'demo' })
    const other = (await data.getPiece('piece-concert-march'))!.parts[0]

    await expect(data.setLastPart('piece-clark-county', 'part-nope')).rejects.toThrow('part not found')
    await expect(data.setLastPart('piece-clark-county', other.id)).rejects.toThrow('part not found')
  })

  it('gives a new piece the default practice memory', async () => {
    const { data } = createFakes({ signedIn: true })

    const piece = await data.createPiece(newPieceInput())

    expect(piece.practice).toEqual(DEFAULT_PRACTICE_MEMORY)
    expect((await data.getPiece(piece.id))?.piece.practice).toEqual(DEFAULT_PRACTICE_MEMORY)
  })

  it('saves the practice memory on the piece and reads it back', async () => {
    const { data } = createFakes({ signedIn: true })
    const piece = await data.createPiece(newPieceInput())
    const memory = {
      metronome: { on: true, volume: 0.4, tone: 'click' as const },
      musicVolume: 0.5,
      speed: 0.75,
      loop: { startPosition: 12, endPosition: 23 },
      loopOn: false,
      countInEveryRepeat: true,
      countInMetronome: false,
    }

    await data.savePracticeMemory(piece.id, memory)

    expect((await data.getPiece(piece.id))?.piece.practice).toEqual(memory)
    expect((await data.getPieceMap(piece.id))?.piece.practice).toEqual(memory)
  })

  it('hands out a copy of the practice memory, and keeps a copy of what it was given', async () => {
    const { data } = createFakes({ signedIn: true })
    const piece = await data.createPiece(newPieceInput())
    const memory = { ...DEFAULT_PRACTICE_MEMORY, metronome: { ...DEFAULT_PRACTICE_MEMORY.metronome } }

    await data.savePracticeMemory(piece.id, memory)
    memory.metronome.on = true
    const read = (await data.getPiece(piece.id))!.piece.practice
    read.metronome.volume = 0.1

    expect((await data.getPiece(piece.id))?.piece.practice.metronome).toEqual({ on: false, volume: 0.8, tone: 'wood' })
  })

  it('fills a partly stored practice memory with the defaults', async () => {
    const { data, store } = createFakes({ signedIn: true })
    const piece = await data.createPiece(newPieceInput())
    store.pieces.get(piece.id)!.practice = { speed: 1.5, metronome: { tone: 'cowbell', on: true } }

    expect((await data.getPiece(piece.id))?.piece.practice).toEqual({
      ...DEFAULT_PRACTICE_MEMORY,
      speed: 1.5,
      metronome: { on: true, volume: 0.8, tone: 'wood' },
    })
  })

  it('returns null for a piece that does not exist', async () => {
    const { data } = createFakes({ signedIn: true })

    expect(await data.getPiece('piece-nope')).toBeNull()
    expect(await data.getPeaks('piece-nope')).toBeNull()
  })

  it.each([
    ['renamePiece', (data: DataClient) => data.renamePiece('piece-nope', 'New')],
    ['renamePart', (data: DataClient) => data.renamePart('piece-nope', 'part-1', 'New')],
    ['renameRecording', (data: DataClient) => data.renameRecording('piece-nope', 'New')],
    ['deletePiece', (data: DataClient) => data.deletePiece('piece-nope')],
    ['setCountInBars', (data: DataClient) => data.setCountInBars('piece-nope', 2)],
    ['setLastPart', (data: DataClient) => data.setLastPart('piece-nope', 'part-1')],
    ['storeParts', (data: DataClient) => data.storeParts('piece-nope', [{ file: file('oboe.pdf'), name: 'Oboe' }])],
    ['savePracticeMemory', (data: DataClient) => data.savePracticeMemory('piece-nope', DEFAULT_PRACTICE_MEMORY)],
  ])('%s rejects for a piece that does not exist', async (_name, call) => {
    const { data } = createFakes({ signedIn: true })

    await expect(call(data)).rejects.toThrow('piece not found')
  })
})

describe('FakeDataClient isolation between users', () => {
  function withOthersPiece() {
    const fakes = createFakes({ seed: 'demo' })
    addSeedPiece(fakes.store, {
      id: 'piece-others',
      ownerId: OTHER_USER.id,
      title: 'Not Yours',
      createdAt: '2026-10-29T08:00:00.000Z',
      recording: { kind: 'file', name: 'secret.mp3' },
      durationSec: 100,
      parts: [{ name: 'Secret part' }],
      job: 'done',
    })
    return fakes
  }

  it('keeps another user\'s piece out of the list', async () => {
    const { data, store } = withOthersPiece()

    const titles = (await data.listPieces()).map((piece) => piece.title)

    expect(store.pieces.has('piece-others')).toBe(true)
    expect(titles).toHaveLength(5)
    expect(titles).not.toContain('Not Yours')
  })

  it('treats another user\'s piece as missing', async () => {
    const { data, store } = withOthersPiece()
    const jobId = [...store.jobs.values()].find((stored) => stored.job.pieceId === 'piece-others')?.job.id as string

    expect(await data.getPiece('piece-others')).toBeNull()
    expect(await data.getPeaks('piece-others')).toBeNull()
    expect(await data.getJob(jobId)).toBeNull()
  })

  it('refuses to change or delete another user\'s piece', async () => {
    const { data, store } = withOthersPiece()

    await expect(data.renamePiece('piece-others', 'Mine now')).rejects.toThrow('piece not found')
    await expect(data.renamePart('piece-others', 'part-1', 'Mine now')).rejects.toThrow('piece not found')
    await expect(data.renameRecording('piece-others', 'Mine now')).rejects.toThrow('piece not found')
    await expect(data.deletePiece('piece-others')).rejects.toThrow('piece not found')
    await expect(data.setCountInBars('piece-others', 4)).rejects.toThrow('piece not found')
    await expect(data.setLastPart('piece-others', 'part-1')).rejects.toThrow('piece not found')
    await expect(data.storeParts('piece-others', [{ file: file('oboe.pdf'), name: 'Oboe' }])).rejects.toThrow('piece not found')
    expect([...store.parts.values()].filter((part) => part.pieceId === 'piece-others')).toHaveLength(1)
    await expect(data.savePracticeMemory('piece-others', { ...DEFAULT_PRACTICE_MEMORY, speed: 2 })).rejects.toThrow('piece not found')
    expect(store.pieces.get('piece-others')?.title).toBe('Not Yours')
  })

  it('keeps a profile for each user', async () => {
    const { data, store } = createFakes({ signedIn: true })

    await data.saveSettings({ ...DEFAULT_SETTINGS, nightScore: true })

    expect(store.profiles.get(OTHER_USER.id)?.settings.nightScore).toBe(false)
  })
})

describe('FakeDataClient demo seed', () => {
  it('starts signed in with the terms accepted', async () => {
    const { data } = createFakes({ seed: 'demo' })

    expect(await data.getUser()).toEqual(DEMO_USER)
    expect((await data.getProfile()).acceptedTermsAt).not.toBeNull()
  })

  it('can be signed out or without accepted terms on request', async () => {
    const signedOut = createFakes({ seed: 'demo', signedIn: false })
    const noTerms = createFakes({ seed: 'demo', termsAccepted: false })

    expect(await signedOut.data.getUser()).toBeNull()
    expect((await noTerms.data.getProfile()).acceptedTermsAt).toBeNull()
  })

  it('lists the five pieces of the Library board, in its order', async () => {
    const { data } = createFakes({ seed: 'demo' })

    const list = await data.listPieces()

    expect(list.map((piece) => [piece.title, piece.partCount, piece.durationSec])).toEqual([
      ['Clark County Celebration', 3, 271],
      ['Concert March', 2, 192],
      ['Slow Waltz in G', 1, 302],
      ['Etude No. 4', 1, 168],
      ['Jazz Combo Chart', 4, 380],
    ])
  })

  it('gives the pieces the review status of the board', async () => {
    const { data } = createFakes({ seed: 'demo' })

    const list = await data.listPieces()

    // Clark County: the twelve shared items, seven checked, and Trumpet's bar-count problem once (Decision 2026-10-29).
    expect(list.map((piece) => piece.review)).toEqual([
      { checked: 7, total: 13 },
      { checked: 9, total: 9 },
      { checked: 0, total: 0 },
      { checked: 6, total: 6 },
      { checked: 0, total: 9 },
    ])
  })

  it('has four finished pieces and one processing at 0.55, which the reads then advance', async () => {
    const { data } = createFakes({ seed: 'demo' })

    const first = await data.listPieces()
    const waltz = first.find((piece) => piece.title === 'Slow Waltz in G')
    const others = first.filter((piece) => piece.title !== 'Slow Waltz in G')

    expect(others.every((piece) => piece.job?.status === 'done' && piece.job.progress === 1)).toBe(true)
    expect(waltz?.job).toMatchObject({ status: 'running', progress: 0.65 })
  })

  it('shows 0.55 before the first read moves the processing job', async () => {
    const { store } = createFakes({ seed: 'demo' })

    const waltz = [...store.jobs.values()].find((stored) => stored.job.pieceId === 'piece-slow-waltz')

    expect(waltz?.job).toMatchObject({ kind: 'process-piece', status: 'running', progress: 0.55 })
  })

  it('finishes the processing piece after the remaining stages', async () => {
    const { data } = createFakes({ seed: 'demo' })

    for (let i = 0; i < 4; i++) await data.listPieces()
    const waltz = (await data.listPieces()).find((piece) => piece.title === 'Slow Waltz in G')

    expect(waltz?.job).toMatchObject({ status: 'done', progress: 1 })
    expect(waltz?.review.total).toBeGreaterThan(0)
    expect(await data.getPeaks('piece-slow-waltz')).toHaveLength(10840)
  })

  it('shows Clark County Celebration as on the Hub board', async () => {
    const { data } = createFakes({ seed: 'demo' })

    const detail = await data.getPiece('piece-clark-county')

    expect(detail?.piece.title).toBe('Clark County Celebration')
    expect(detail?.parts.map((part) => part.name)).toEqual(['Clarinet in B♭ 1', 'Trumpet in B♭ 2', 'Flute 1'])
    expect(detail?.parts.map((part) => part.position)).toEqual([0, 1, 2])
    expect(detail?.recordingLabel).toBe('clark-county-celebration.mp3')
    expect(detail?.review).toEqual({ checked: 7, total: 13 })
    expect(detail?.job).toMatchObject({ status: 'done' })
  })

  it('gives the parts of Clark County the shared 7 of 12, and Trumpet one more for its bar-count problem', async () => {
    const { data } = createFakes({ seed: 'demo' })

    const detail = await data.getPiece('piece-clark-county')

    expect(detail?.parts.map((part) => part.review)).toEqual([
      { checked: 7, total: 12 },
      { checked: 7, total: 13 },
      { checked: 7, total: 12 },
    ])
  })

  it('shows the other review wordings on the other demo pieces: none checked, and all checked', async () => {
    const { data } = createFakes({ seed: 'demo' })

    const jazz = await data.getPiece('piece-jazz-combo')
    const march = await data.getPiece('piece-concert-march')
    const waltz = await data.getPiece('piece-slow-waltz')

    expect(jazz?.parts.map((part) => part.review)).toEqual(Array(4).fill({ checked: 0, total: 9 }))
    expect(march?.parts.map((part) => part.review)).toEqual(Array(2).fill({ checked: 9, total: 9 }))
    expect(waltz?.parts.map((part) => part.review)).toEqual([{ checked: 0, total: 0 }])
  })

  it('has peaks for the finished pieces', async () => {
    const { data } = createFakes({ seed: 'demo' })

    expect(await data.getPeaks('piece-clark-county')).toHaveLength(10840)
    expect(await data.getPeaks('piece-jazz-combo')).toHaveLength(380 * 40)
  })

  it('counts in one bar in every demo piece', async () => {
    const { data } = createFakes({ seed: 'demo' })

    const details = await Promise.all(
      (await data.listPieces()).map((summary) => data.getPiece(summary.id)),
    )

    expect(details.map((detail) => detail?.piece.countInBars)).toEqual([1, 1, 1, 1, 1])
  })

  it('starts the empty seed with no pieces', async () => {
    const { data } = createFakes({ signedIn: true })

    expect(await data.listPieces()).toEqual([])
  })
})

describe('FakeDataClient piece maps', () => {
  const CLARK = 'piece-clark-county'

  async function partIds(data: DataClient, pieceId: string): Promise<string[]> {
    return ((await data.getPiece(pieceId))?.parts ?? []).map((part) => part.id)
  }

  it('gives the demo map for Clark County: the demo timing and one page layer per part, in part order', async () => {
    const { data } = createFakes({ seed: 'demo' })

    const map = await data.getPieceMap(CLARK)

    expect(map?.piece.id).toBe(CLARK)
    expect(map?.timing).toEqual(applyReviewItems(syntheticTiming(DEMO_SPEC), DEMO_REVIEW_ITEMS))
    expect(map?.pages.map((page) => page.partId)).toEqual(await partIds(data, CLARK))
    expect(map?.pages).toHaveLength(3)
  })

  it('gives Clarinet and Flute 64 boxes and Trumpet 63, with its bar line after bar 22 missed', async () => {
    const { data } = createFakes({ seed: 'demo' })

    const map = await data.getPieceMap(CLARK)

    expect(map?.pages.map((page) => page.bars.length)).toEqual([64, 63, 64])
    const trumpet = map?.pages[1].bars ?? []
    const clarinet = map?.pages[0].bars ?? []
    expect(trumpet[21].w).toBe(clarinet[21].w + clarinet[22].w)
  })

  it('gives every other demo piece a map of 16 bars on one page, straight through', async () => {
    const { data } = createFakes({ seed: 'demo' })

    const map = await data.getPieceMap('piece-concert-march')

    expect(map?.timing.barCount).toBe(16)
    expect(map?.timing.playOrder).toEqual([{ from: 1, to: 16 }])
    expect(map?.pages).toHaveLength(2)
    for (const page of map?.pages ?? []) expect(page.bars.map((box) => box.pageIndex)).toEqual(Array(16).fill(0))
  })

  it('gives the demo piece different rests in different parts, and none in the shared timing', async () => {
    const { data } = createFakes({ seed: 'demo' })

    const map = await data.getPieceMap(CLARK)

    expect(map?.pages.map((page) => page.rests)).toEqual([[5, 6, 7, 8], [33, 34, 35, 36], []])
    expect(map?.timing.marks.map((mark) => mark.kind)).toEqual(['rit', 'rit', 'fermata'])
  })

  it('keeps the rests of a part when its page layer is saved and read again', async () => {
    const { data } = createFakes({ seed: 'demo' })
    const map = await data.getPieceMap(CLARK)
    const flute = map?.pages[2]
    if (flute === undefined) throw new Error('the demo piece has a flute')

    await data.savePageLayer(CLARK, { ...flute, rests: [12, 13] })

    const again = await data.getPieceMap(CLARK)
    expect(again?.pages.map((page) => page.rests)).toEqual([[5, 6, 7, 8], [33, 34, 35, 36], [12, 13]])
  })

  it('has no map content for a piece still processing, but a page layer per part', async () => {
    const { data } = createFakes({ seed: 'demo' })

    const map = await data.getPieceMap('piece-slow-waltz')

    expect(map?.timing.locators).toEqual([])
    expect(map?.timing.barCount).toBe(0)
    expect(map?.pages).toEqual([{ partId: (await partIds(data, 'piece-slow-waltz'))[0], bars: [], rests: [] }])
    expect(await data.getPartPages('piece-slow-waltz', (await partIds(data, 'piece-slow-waltz'))[0])).toEqual([])
  })

  it('gives null for an unknown piece and for the piece of another user', async () => {
    const fakes = createFakes({ seed: 'demo' })
    addSeedPiece(fakes.store, {
      id: 'piece-others',
      ownerId: OTHER_USER.id,
      title: 'Not Yours',
      createdAt: '2026-10-29T08:00:00.000Z',
      recording: { kind: 'file', name: 'secret.mp3' },
      durationSec: 100,
      parts: [{ name: 'Secret part' }],
      job: 'done',
    })

    expect(await fakes.data.getPieceMap('piece-nope')).toBeNull()
    expect(await fakes.data.getPieceMap('piece-others')).toBeNull()
    await expect(fakes.data.saveTiming('piece-others', syntheticTiming(DEMO_SPEC))).rejects.toThrow('piece not found')
  })

  it('gives four 1240 x 1754 SVG page images for each part of Clark County', async () => {
    const { data } = createFakes({ seed: 'demo' })

    for (const partId of await partIds(data, CLARK)) {
      const pages = await data.getPartPages(CLARK, partId)

      expect(pages.map((page) => page.pageIndex)).toEqual([0, 1, 2, 3])
      for (const page of pages) {
        expect([page.width, page.height]).toEqual([1240, 1754])
        expect(page.url.startsWith('data:image/svg+xml')).toBe(true)
      }
    }
  })

  it('prints every bar line on the page images of a part whose layer misses one: Trumpet draws as many as Clarinet', async () => {
    const { data } = createFakes({ seed: 'demo' })
    const [clarinet, trumpet] = await partIds(data, CLARK)
    const map = await data.getPieceMap(CLARK)
    const barLinesOf = async (partId: string, pageIndex: number) => {
      const image = (await data.getPartPages(CLARK, partId))[pageIndex]
      const markup = decodeURIComponent(image.url.slice('data:image/svg+xml;utf8,'.length))
      const doc = new DOMParser().parseFromString(markup, 'image/svg+xml')
      return [...doc.querySelectorAll('line.barline')].map((line) => [Number(line.getAttribute('x1')), Number(line.getAttribute('y1'))])
    }

    // The part's boxes miss the line after bar 22 (the page layer), the printed page does not.
    expect(map?.pages.find((layer) => layer.partId === trumpet)?.bars).toHaveLength(63)
    expect(map?.pages.find((layer) => layer.partId === clarinet)?.bars).toHaveLength(64)
    const clarinetLines = await barLinesOf(clarinet, 1)
    expect(clarinetLines).toHaveLength(4 * 5)
    expect(await barLinesOf(trumpet, 1)).toEqual(clarinetLines)
    // The old right edge of bar 22 (its box is part of the merged box in Trumpet's layer) is printed too.
    const box22 = map?.pages.find((layer) => layer.partId === clarinet)?.bars[21]
    const edge = box22!.x + box22!.w
    expect((await barLinesOf(trumpet, 1)).filter(([x]) => x === edge)).toHaveLength(4) // one on each of the page's four lines
  })

  it('gives [] for a part of another piece or an unknown part', async () => {
    const { data } = createFakes({ seed: 'demo' })
    const [marchPart] = await partIds(data, 'piece-concert-march')

    expect(await data.getPartPages(CLARK, marchPart)).toEqual([])
    expect(await data.getPartPages(CLARK, 'part-nope')).toEqual([])
    expect(await data.getPartPages('piece-nope', marchPart)).toEqual([])
  })

  it('reads back a saved timing layer as a deep copy', async () => {
    const { data } = createFakes({ seed: 'demo' })
    const timing = syntheticTiming(DEMO_SPEC)
    timing.locators[5] = { ...timing.locators[5], timeSec: 123.4, confirmed: true }

    await data.saveTiming(CLARK, timing)
    const read = (await data.getPieceMap(CLARK))?.timing

    expect(read).toEqual(timing)
    expect(read).not.toBe(timing)
    timing.locators[5].timeSec = 0
    read?.locators.splice(0)
    expect((await data.getPieceMap(CLARK))?.timing.locators[5].timeSec).toBe(123.4)
    expect((await data.getPieceMap(CLARK))?.timing.locators).toHaveLength(72)
  })

  it('reads back a saved page layer as a deep copy, and leaves the other parts alone', async () => {
    const { data } = createFakes({ seed: 'demo' })
    const before = await data.getPieceMap(CLARK)
    const layer = structuredClone(before?.pages[1]) as NonNullable<typeof before>['pages'][number]
    layer.bars = layer.bars.slice(0, 10)

    await data.savePageLayer(CLARK, layer)
    const after = await data.getPieceMap(CLARK)

    expect(after?.pages[1]).toEqual(layer)
    expect(after?.pages[1]).not.toBe(layer)
    expect(after?.pages[0]).toEqual(before?.pages[0])
    expect(after?.pages[2]).toEqual(before?.pages[2])
    layer.bars[0].x = -1
    expect((await data.getPieceMap(CLARK))?.pages[1].bars[0].x).toBe(before?.pages[1].bars[0].x)
  })

  it('rejects a page layer of a part that is not in the piece', async () => {
    const { data } = createFakes({ seed: 'demo' })

    await expect(data.savePageLayer(CLARK, { partId: 'part-nope', bars: [], rests: [] })).rejects.toThrow('part not found')
  })

  it('does not let the map handed out change the stored one', async () => {
    const { data } = createFakes({ seed: 'demo' })

    const map = await data.getPieceMap(CLARK)
    map?.timing.locators.splice(0)
    map?.pages[0].bars.splice(0)

    const again = await data.getPieceMap(CLARK)
    expect(again?.timing.locators).toHaveLength(72)
    expect(again?.pages[0].bars).toHaveLength(64)
  })

  it('gives a new piece a synthetic map with a page layer per part once its job is done', async () => {
    const { data, processor } = createFakes({ signedIn: true })
    const piece = await data.createPiece(newPieceInput())
    const [first] = piece.parts

    expect((await data.getPieceMap(piece.id))?.pages.every((page) => page.bars.length === 0)).toBe(true)
    expect(await data.getPartPages(piece.id, first.id)).toEqual([])

    const job = await processor.processPiece(piece.id)
    await readJob(data, job.id, 7)
    const map = await data.getPieceMap(piece.id)

    expect(map?.timing).toEqual(applyReviewItems(syntheticTiming(DEMO_SPEC), uncheckedItems(DEMO_REVIEW_ITEMS)))
    expect(map?.pages.map((page) => page.partId)).toEqual(piece.parts.map((part) => part.id))
    expect(map?.pages.map((page) => page.bars.length)).toEqual([64, 64, 64])
    expect(await data.getPartPages(piece.id, first.id)).toHaveLength(4)
  })

  it('reports the recording length and page counts of the map it will make while processing', async () => {
    const { data, processor } = createFakes({ signedIn: true })
    const piece = await data.createPiece(newPieceInput())
    const job = await processor.processPiece(piece.id)

    await readJob(data, job.id, 2)
    const detail = await data.getPiece(piece.id)

    expect(detail?.piece.recording?.durationSec).toBe(271)
    expect(detail?.parts.map((part) => part.pageCount)).toEqual([4, 4, 4])
    expect((await data.getPartPages(piece.id, piece.parts[0].id)).length).toBe(0)
    await readJob(data, job.id, 5)
    expect(await data.getPartPages(piece.id, piece.parts[0].id)).toHaveLength(4)
  })

  it('keeps the map of a piece whose processing job failed empty', async () => {
    const { data, processor } = createFakes({ signedIn: true, failStage: 'omr' })
    const piece = await data.createPiece(newPieceInput())
    const job = await processor.processPiece(piece.id)
    await readJob(data, job.id, 5)

    expect((await data.getPieceMap(piece.id))?.timing.locators).toEqual([])
  })

  it('has a locator for every slot of the demo play order', async () => {
    const { data } = createFakes({ seed: 'demo' })

    const timing = (await data.getPieceMap(CLARK))?.timing
    if (timing === undefined) throw new Error('no map')

    expect(timing.locators).toHaveLength(expandPlayOrder(timing.playOrder, timing.barCount).length)
  })

  it('removes the map and the page images with the piece', async () => {
    const { data, store } = createFakes({ seed: 'demo' })
    const ids = await partIds(data, CLARK)

    await data.deletePiece(CLARK)

    expect(store.maps.has(CLARK)).toBe(false)
    for (const id of ids) expect(store.pageImages.has(id)).toBe(false)
  })

  it('reports as many pages per part as the part has page images', async () => {
    const { data } = createFakes({ seed: 'demo' })

    for (const [pieceId, pages] of [['piece-clark-county', 4], ['piece-concert-march', 1], ['piece-jazz-combo', 1]] as const) {
      const detail = await data.getPiece(pieceId)
      expect(detail?.parts.map((part) => part.pageCount)).toEqual(detail?.parts.map(() => pages))
      expect(detail?.piece.parts.map((part) => part.pageCount)).toEqual(detail?.parts.map(() => pages))
      for (const part of detail?.parts ?? []) expect(await data.getPartPages(pieceId, part.id)).toHaveLength(pages)
    }
  })

  it('gives the demo peaks of Clark County from the synthetic recording', async () => {
    const { data } = createFakes({ seed: 'demo' })

    expect(await data.getPeaks(CLARK)).toEqual(recordingPeaks(DEMO_SPEC))
  })

  it('gives the other demo pieces 40 peaks a second of their own length', async () => {
    const { data } = createFakes({ seed: 'demo' })

    expect(await data.getPeaks('piece-concert-march')).toHaveLength(192 * 40)
    expect(await data.getPeaks('piece-jazz-combo')).toHaveLength(380 * 40)
  })
})

describe('FakeDataClient getAudioUrl', () => {
  const CLARK = 'piece-clark-county'

  it('is a data:audio/wav URL of the click track for a file recording with a map', async () => {
    const { data, store } = createFakes({ seed: 'demo' })

    const url = await data.getAudioUrl(CLARK)
    const timing = store.maps.get(CLARK)?.timing

    expect(url?.startsWith('data:audio/wav;base64,')).toBe(true)
    expect(timing).toBeDefined()
    expect(url).toBe(clickTrackUrl(timing as TimingLayer, 271))
  })

  it('is made from the original timing and caches the track by piece', async () => {
    const { data, store } = createFakes({ seed: 'demo' })

    const first = await data.getAudioUrl(CLARK)

    // The recording is the piece's original synthetic timing; the stored map's locators also carry review flags.
    expect(store.recordingTimings.get(CLARK)).toEqual(syntheticTiming(DEMO_SPEC))
    expect(store.clickTracks.get(CLARK)?.url).toBe(first)
    expect(await data.getAudioUrl(CLARK)).toBe(first)
  })

  it('stays the same recording after a locator is moved: the clicks sit at the original locator times', async () => {
    const { data, store } = createFakes({ seed: 'demo' })
    const original = structuredClone(store.maps.get(CLARK)?.timing) as TimingLayer
    const first = await data.getAudioUrl(CLARK)

    const moved = original.locators.map((locator, i) => (i === 1 ? { ...locator, timeSec: locator.timeSec + 0.5 } : locator))
    await data.saveTiming(CLARK, { ...original, locators: moved })

    expect(await data.getAudioUrl(CLARK)).toBe(first)
    expect(first).toBe(clickTrackUrl(original, 271))
  })

  it('stays the same recording after a realign', async () => {
    const { data, processor, store } = createFakes({ seed: 'demo' })
    const original = structuredClone(store.maps.get(CLARK)?.timing) as TimingLayer
    const first = await data.getAudioUrl(CLARK)
    const moved = original.locators.map((locator, i) => (!locator.confirmed && i === 1 ? { ...locator, timeSec: locator.timeSec + 0.5 } : locator))
    await data.saveTiming(CLARK, { ...original, locators: moved })

    const job = await processor.realign(CLARK)
    for (let i = 0; i < 6; i++) await data.getJob(job.id)

    expect(store.maps.get(CLARK)?.timing).not.toEqual({ ...original, locators: moved })
    expect(await data.getAudioUrl(CLARK)).toBe(first)
  })

  it('is forgotten with the piece', async () => {
    const { data, store } = createFakes({ seed: 'demo' })
    await data.getAudioUrl(CLARK)

    await data.deletePiece(CLARK)

    expect(store.recordingTimings.has(CLARK)).toBe(false)
    expect(store.clickTracks.has(CLARK)).toBe(false)
  })

  it('is the same click track for a recording whose piece is done', async () => {
    const { data, store } = createFakes({ seed: 'demo' })
    addSeedPiece(store, {
      id: 'piece-tube',
      title: 'From a link',
      createdAt: '2026-10-01T00:00:00.000Z',
      recording: { kind: 'file', name: 'take.mp3' },
      durationSec: 60,
      parts: [{ name: 'Piano' }],
      job: 'done',
    })
    const timing = store.recordingTimings.get('piece-tube') as TimingLayer

    const url = await data.getAudioUrl('piece-tube')

    expect(url).toBe(clickTrackUrl(timing, 60))
    expect(url?.startsWith('data:audio/wav;base64,')).toBe(true)
  })

  it('is null for a recording that is still processing', async () => {
    const { data } = createFakes({ seed: 'demo' })

    expect(await data.getAudioUrl('piece-slow-waltz')).toBeNull()
  })

  it('is null for a file recording that is still processing', async () => {
    const { data } = createFakes({ signedIn: true })
    const piece = await data.createPiece(newPieceInput({ recording: { kind: 'file', file: file('take.wav') } }))

    expect(await data.getAudioUrl(piece.id)).toBeNull()
  })

  it('is null for an unknown piece and for the piece of another user', async () => {
    const { data, store } = createFakes({ seed: 'demo' })
    addSeedPiece(store, {
      id: 'piece-other',
      ownerId: OTHER_USER.id,
      title: 'Not yours',
      createdAt: '2026-10-01T00:00:00.000Z',
      recording: { kind: 'file', name: 'x.wav' },
      durationSec: 60,
      parts: [{ name: 'Piano' }],
      job: 'done',
    })

    expect(await data.getAudioUrl('piece-nope')).toBeNull()
    expect(await data.getAudioUrl('piece-other')).toBeNull()
  })

  it('rejects when signed out', async () => {
    const { data } = createFakes({ seed: 'demo', signedIn: false })

    await expect(data.getAudioUrl(CLARK)).rejects.toThrow('not signed in')
  })
})

describe('FakeDataClient review numbers', () => {
  const CLARK = 'piece-clark-county'

  it('derive from the saved map: checking a flagged locator raises "x of y" for the piece and every part', async () => {
    const { data } = createFakes({ seed: 'demo' })
    const timing = (await data.getPieceMap(CLARK))?.timing as NonNullable<Awaited<ReturnType<DataClient['getPieceMap']>>>['timing']
    timing.locators = timing.locators.map((l) => (l.bar === 41 ? { ...l, checked: true } : l))

    await data.saveTiming(CLARK, timing)
    const detail = await data.getPiece(CLARK)

    expect(detail?.review).toEqual({ checked: 8, total: 13 })
    expect(detail?.parts.map((part) => part.review)).toEqual([
      { checked: 8, total: 12 },
      { checked: 8, total: 13 },
      { checked: 8, total: 12 },
    ])
    expect((await data.listPieces())[0].review).toEqual({ checked: 8, total: 13 })
  })

  it('count a bar without a locator as an item, and a part with a missing bar line as one more', async () => {
    const { data } = createFakes({ seed: 'demo' })
    const map = await data.getPieceMap(CLARK)
    const timing = map!.timing
    timing.locators = timing.locators.filter((l) => !(l.bar === 50 && l.passIndex === 0))
    await data.saveTiming(CLARK, timing)

    expect((await data.getPiece(CLARK))?.review).toEqual({ checked: 7, total: 14 })

    // Giving Trumpet the complete layout of Clarinet takes its own problem away.
    await data.savePageLayer(CLARK, { ...structuredClone(map!.pages[0]), partId: map!.pages[1].partId })
    const detail = await data.getPiece(CLARK)

    expect(detail?.review).toEqual({ checked: 7, total: 13 })
    expect(detail?.parts.map((part) => part.review.total)).toEqual([13, 13, 13])
  })

  it('stay put when a realign finishes: the flags and checked travel with their locators', async () => {
    const { data, processor } = createFakes({ seed: 'demo' })
    const before = await data.getPiece(CLARK)

    const job = await processor.realign(CLARK)
    await readJob(data, job.id, 6)

    const after = await data.getPiece(CLARK)
    expect(after?.job).toMatchObject({ kind: 'realign', status: 'done' })
    expect(after?.review).toEqual(before?.review)
    expect(after?.parts.map((part) => part.review)).toEqual(before?.parts.map((part) => part.review))
  })
})
