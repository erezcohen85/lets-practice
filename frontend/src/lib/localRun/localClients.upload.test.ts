import { createFakeRunServer, type FakeRunServer } from '@/lib/localRun/fakeRunServer'
import { createLocalClients } from '@/lib/localRun/localClients'
import { createRunApi, type RunDocument } from '@/lib/localRun/runApi'
import { sampleRun } from '@/lib/localRun/sampleRun'
import { sentenceOf } from '@/lib/processorClient'

const BASE = 'http://127.0.0.1:8765'
const pdf = (name: string) => new File(['%PDF-1.7'], `${name}.pdf`, { type: 'application/pdf' })
const clarinets = [
  { file: pdf('Clarinet 1'), name: 'Clarinet 1' },
  { file: pdf('Clarinet 2'), name: 'Clarinet 2' },
]
const upload = { title: 'Clark County Test', recording: { kind: 'file' as const, file: new File(['mp3'], 'take.mp3') }, parts: clarinets }

function setup(documents: RunDocument[] = []) {
  const fake = createFakeRunServer(documents)
  const clients = createLocalClients(createRunApi(BASE, fake.fetch))
  return { fake, clients, data: clients.data, processor: clients.processor }
}

/** What the pipeline leaves for a piece uploaded with the two clarinets: the run of the sample, with these ids and names. */
function finishedRun(runId: string, partIds: string[], names: string[]): RunDocument {
  const run = sampleRun(runId)
  run.piece.title = 'Clark County Test'
  run.recording = { kind: 'file', name: 'take.mp3' }
  run.parts = partIds.map((id, position) => ({ id, name: names[position], position, pageCount: 1 }))
  run.pageImages = Object.fromEntries(partIds.map((id) => [id, [{ pageIndex: 0, width: 200, height: 100, file: `pages/${id}/page-0.webp` }]]))
  run.pages = Object.fromEntries(partIds.map((id) => [id, { partId: id, bars: run.pages['part-flute'].bars, rests: [] }]))
  return run
}

async function uploaded(documents: RunDocument[] = []) {
  const world = setup(documents)
  const piece = await world.data.createPiece(upload)
  const job = await world.processor.processPiece(piece.id)
  return { ...world, piece, job }
}

const ids = ['clark-county-test-01-clarinet-1', 'clark-county-test-02-clarinet-2']

describe('local mode: a new piece goes to the server', () => {
  it('sends the title, the recording and each PDF with its name, in order, in one request', async () => {
    const { fake } = await uploaded()

    expect(fake.uploads).toEqual([
      { path: '/runs', title: 'Clark County Test', recordingName: 'take.mp3', partNames: ['Clarinet 1', 'Clarinet 2'], partFiles: ['Clarinet 1.pdf', 'Clarinet 2.pdf'] },
    ])
  })

  it('sends an empty name for a part left to the score, and lists it under the name the server made', async () => {
    const { fake, data } = setup()

    const piece = await data.createPiece({ ...upload, parts: [{ file: pdf('CCC_clar1-final'), name: '' }, clarinets[1]] })

    expect(fake.uploads[0].partNames).toEqual(['', 'Clarinet 2'])
    expect((await data.getPiece(piece.id))?.parts.map((part) => part.name)).toEqual(['CCC clar1 final', 'Clarinet 2'])
  })

  it('shows the names the finished run has: read from the score, and the recording named after the file', async () => {
    const { fake, data, processor } = setup()
    const piece = await data.createPiece({ ...upload, parts: [{ file: pdf('clar1'), name: '' }, clarinets[1]] })
    const job = await processor.processPiece(piece.id)
    const run = finishedRun(piece.id, ['clark-county-test-01-clar1', ids[1]], ['Clarinet in B♭ 1', 'Clarinet 2'])
    run.recordingName = 'take'
    fake.finish('job-1', run)

    await data.getJob(job.id)
    const detail = await data.getPiece(piece.id)

    expect(detail?.parts.map((part) => part.name)).toEqual(['Clarinet in B♭ 1', 'Clarinet 2'])
    expect(detail?.recordingLabel).toBe('take')
  })

  it('makes the piece with the id and the part ids the server gave', async () => {
    const { piece, data } = await uploaded()

    expect(piece.id).toBe('clark-county-test')
    expect((await data.getPiece(piece.id))?.parts.map((part) => [part.id, part.name, part.pageCount])).toEqual([
      [ids[0], 'Clarinet 1', 0],
      [ids[1], 'Clarinet 2', 0],
    ])
  })

  it('hands out the server job once, without a second request', async () => {
    const { fake, job } = await uploaded()

    expect(job).toMatchObject({ id: 'local-job-1', pieceId: 'clark-county-test', kind: 'process-piece', status: 'queued', progress: 0 })
    expect(fake.requests.filter((request) => request.method === 'POST')).toHaveLength(1)
  })

  it('shows the progress the server reports on the piece and in the library', async () => {
    const { fake, data, piece } = await uploaded()
    const serverJob = fake.jobs.get('job-1')!

    serverJob.status = 'running'
    serverJob.progress = 0.55

    expect((await data.getPiece(piece.id))?.job).toEqual({ id: 'local-job-1', pieceId: piece.id, kind: 'process-piece', status: 'running', progress: 0.55, error: null })
    expect((await data.listPieces())[0].job).toMatchObject({ status: 'running', progress: 0.55 })
    expect(await data.getJob('local-job-1')).toMatchObject({ status: 'running', progress: 0.55 })
  })

  it('does not give the piece the fakes’ synthetic map while it works', async () => {
    const { data, piece } = await uploaded()

    expect((await data.getPieceMap(piece.id))?.timing.barCount).toBe(0)
    expect(await data.getPeaks(piece.id)).toBeNull()
    expect(await data.getAudioUrl(piece.id)).toBeNull()
  })

  it('takes the finished run from the server when the job is done', async () => {
    const run = finishedRun('clark-county-test', ids, ['Clarinet 1', 'Clarinet 2'])
    const { fake, data, piece } = await uploaded()
    fake.finish('job-1', run)

    const detail = await data.getPiece(piece.id)

    expect(detail?.job).toMatchObject({ status: 'done', progress: 1 })
    expect(detail?.parts.map((part) => [part.id, part.pageCount])).toEqual([[ids[0], 1], [ids[1], 1]])
    expect(detail?.piece.recording?.durationSec).toBe(20)
    const map = await data.getPieceMap(piece.id)
    expect(map?.timing).toEqual(run.timing)
    expect(map?.pages.map((page) => page.partId)).toEqual(ids)
    expect(await data.getPartPages(piece.id, ids[1])).toEqual([{ pageIndex: 0, width: 200, height: 100, url: `${BASE}/runs/clark-county-test/files/pages/${ids[1]}/page-0.webp` }])
    expect(await data.getAudioUrl(piece.id)).toBe(`${BASE}/runs/clark-county-test/files/audio.m4a`)
    expect((await data.getPeaks(piece.id))?.length).toBe(800)
  })

  it('shows one piece in the library, not the placeholder and the run', async () => {
    const { fake, data } = await uploaded()
    fake.finish('job-1', finishedRun('clark-county-test', ids, ['Clarinet 1', 'Clarinet 2']))

    const pieces = await data.listPieces()

    expect(pieces.map((piece) => [piece.id, piece.partCount, piece.job?.status])).toEqual([['clark-county-test', 2, 'done']])
  })

  it('lets two polls of a finished job read the run once', async () => {
    const { fake, data, piece } = await uploaded()
    fake.finish('job-1', finishedRun('clark-county-test', ids, ['Clarinet 1', 'Clarinet 2']))

    await Promise.all([data.getPiece(piece.id), data.getPiece(piece.id)])

    expect(fake.requests.filter((request) => request.path === '/runs/clark-county-test')).toHaveLength(1)
  })

  it('shows the pipeline’s sentence when the job fails, and starts it again on the same folder', async () => {
    const { fake, data, processor, piece } = await uploaded()
    const failed = fake.jobs.get('job-1')!
    failed.status = 'error'
    failed.progress = 0.2
    failed.error = 'audio failed: Couldn\'t read this recording; use another file.'

    expect((await data.getPiece(piece.id))?.job).toMatchObject({ status: 'error', progress: 0.2, error: failed.error })

    const again = await processor.processPiece(piece.id)

    expect(fake.requests.at(-1)).toMatchObject({ method: 'POST', path: '/runs/clark-county-test/process' })
    expect(again).toMatchObject({ id: 'local-job-2', status: 'queued', progress: 0 })
    expect((await data.getPiece(piece.id))?.job?.id).toBe('local-job-2')
    expect(fake.uploads).toHaveLength(1)
  })

  it('never starts the fakes’ processing on a piece that is already prepared', async () => {
    const { processor } = setup([sampleRun()])

    await expect(processor.processPiece('piece-a')).rejects.toThrow('already been prepared')
  })

  it('rejects with the server’s sentence when it refuses the upload, and keeps no piece', async () => {
    const { fake, data } = setup()
    fake.refuseUpload = 'The recording is longer than 20 minutes.'

    const error: unknown = await data.createPiece(upload).catch((caught: unknown) => caught)

    expect(sentenceOf(error)).toBe('The recording is longer than 20 minutes.')
    expect(await data.listPieces()).toEqual([])
  })

  it('says so when the server does not answer', async () => {
    const clients = createLocalClients(createRunApi(BASE, async () => { throw new TypeError('Failed to fetch') }))

    const error: unknown = await clients.data.createPiece(upload).catch((caught: unknown) => caught)

    expect(sentenceOf(error)).toContain('did not answer')
  })

  it('shows a second upload as queued behind the first', async () => {
    const { fake, data, processor } = await uploaded()
    const second = await data.createPiece({ ...upload, title: 'Second' })
    await processor.processPiece(second.id)

    expect((await data.getPiece(second.id))?.job).toMatchObject({ status: 'queued', progress: 0 })
    expect(fake.uploads.map((item) => item.title)).toEqual(['Clark County Test', 'Second'])
  })

  it('finds the finished piece again after a reload, from the server', async () => {
    const { fake } = await uploaded()
    fake.finish('job-1', finishedRun('clark-county-test', ids, ['Clarinet 1', 'Clarinet 2']))
    const reloaded = createLocalClients(createRunApi(BASE, fake.fetch))

    const pieces = await reloaded.data.listPieces()

    expect(pieces.map((piece) => [piece.id, piece.partCount, piece.job?.status])).toEqual([['clark-county-test', 2, 'done']])
  })

  it('keeps nothing in the browser’s storage', async () => {
    const { fake } = await uploaded()
    fake.finish('job-1', finishedRun('clark-county-test', ids, ['Clarinet 1', 'Clarinet 2']))

    expect(localStorage.length).toBe(0)
    expect(sessionStorage.length).toBe(0)
  })
})

describe('local mode: + Add part goes to the server', () => {
  const horn = { file: pdf('Horn'), name: 'Horn' }
  const hornId = 'piece-a-03-horn'

  async function adding(fake?: FakeRunServer) {
    const world = setup([sampleRun()])
    if (fake !== undefined) throw new Error('unused')
    await world.data.storeParts('piece-a', [horn])
    const job = await world.processor.addParts('piece-a', [])
    return { ...world, job }
  }

  function withHorn(): RunDocument {
    const run = sampleRun()
    run.parts.push({ id: hornId, name: 'Horn', position: 2, pageCount: 1 })
    run.pageImages[hornId] = [{ pageIndex: 0, width: 200, height: 100, file: `pages/${hornId}/page-0.webp` }]
    run.pages[hornId] = { partId: hornId, bars: run.pages['part-horn'].bars, rests: [] }
    return run
  }

  it('sends the new PDF with its name when the files are stored, and starts one job', async () => {
    const { fake, job } = await adding()

    expect(fake.uploads).toEqual([{ path: '/runs/piece-a/parts', title: null, recordingName: null, partNames: ['Horn'], partFiles: ['Horn.pdf'] }])
    expect(job).toMatchObject({ id: 'local-job-1', pieceId: 'piece-a', kind: 'add-parts', status: 'queued' })
    expect(fake.requests.filter((request) => request.method === 'POST')).toHaveLength(1)
  })

  it('lists the new part at once, without pages, after the others', async () => {
    const { data } = await adding()

    expect((await data.getPiece('piece-a'))?.parts.map((part) => [part.id, part.pageCount])).toEqual([
      ['part-flute', 1],
      ['part-horn', 1],
      [hornId, 0],
    ])
  })

  it('follows the job and then has the new part’s pages, leaving the edited timing as it is', async () => {
    const { fake, data } = await adding()
    const map = await data.getPieceMap('piece-a')
    if (map === null) throw new Error('no map')
    const edited = { ...map.timing, locators: map.timing.locators.map((locator) => (locator.bar === 3 ? { ...locator, timeSec: 5.5, confirmed: true } : locator)) }
    await data.saveTiming('piece-a', edited)
    fake.jobs.get('job-1')!.status = 'running'
    fake.jobs.get('job-1')!.progress = 0.3
    expect((await data.getPiece('piece-a'))?.job).toMatchObject({ kind: 'add-parts', status: 'running', progress: 0.3 })

    fake.finish('job-1', withHorn())
    const detail = await data.getPiece('piece-a')

    expect(detail?.job).toMatchObject({ status: 'done' })
    expect(detail?.parts.map((part) => [part.id, part.pageCount])).toEqual([['part-flute', 1], ['part-horn', 1], [hornId, 1]])
    const after = await data.getPieceMap('piece-a')
    expect(after?.timing).toEqual(edited)
    expect(after?.pages.map((page) => page.partId)).toEqual(['part-flute', 'part-horn', hornId])
    expect(await data.getPartPages('piece-a', hornId)).toHaveLength(1)
  })

  it('sends the whole map once more when the server holds a confirmed one, so the new pages stay in it', async () => {
    const { fake, data } = await adding()
    const run = withHorn()
    run.confirmedAt = '2026-10-31T10:00:00+00:00'
    fake.finish('job-1', run)

    await data.getPiece('piece-a')

    const put = fake.requests.find((request) => request.method === 'PUT')
    expect(Object.keys((put?.body as { pages: object }).pages)).toEqual(['part-flute', 'part-horn', hornId])
  })

  it('writes nothing to the folder when no confirmed map exists', async () => {
    const { fake, data } = await adding()
    fake.finish('job-1', withHorn())

    await data.getPiece('piece-a')

    expect(fake.requests.some((request) => request.method === 'PUT')).toBe(false)
  })

  it('starts the job again with no files when it failed', async () => {
    const { fake, data, processor } = await adding()
    const failed = fake.jobs.get('job-1')!
    failed.status = 'error'
    failed.error = 'Horn: The score PDF has more than 40 pages.'
    expect((await data.getPiece('piece-a'))?.job).toMatchObject({ status: 'error', error: failed.error })

    const again = await processor.addParts('piece-a', [])

    expect(fake.uploads.at(-1)).toMatchObject({ path: '/runs/piece-a/parts', partNames: [], partFiles: [] })
    expect(again).toMatchObject({ id: 'local-job-2', kind: 'add-parts', status: 'queued' })
  })

  it('sends the files itself when addParts is given some', async () => {
    const { fake, processor } = setup([sampleRun()])

    const job = await processor.addParts('piece-a', [horn])

    expect(fake.uploads).toHaveLength(1)
    expect(job).toMatchObject({ kind: 'add-parts', status: 'queued' })
  })

  it('rejects with the server’s sentence when it refuses the part', async () => {
    const { fake, data } = setup([sampleRun()])
    fake.refuseUpload = 'Horn is not a PDF.'

    const error: unknown = await data.storeParts('piece-a', [horn]).catch((caught: unknown) => caught)

    expect(sentenceOf(error)).toBe('Horn is not a PDF.')
    expect((await data.getPiece('piece-a'))?.parts).toHaveLength(2)
  })

  it('keeps the finished job’s skipped part and its reason, and leaves the part out of the piece', async () => {
    const { fake, data } = await adding()
    const reason = 'The score reader failed: page 1 has no five-line staves.'
    fake.jobs.get('job-1')!.parts = [{ id: hornId, name: 'Horn', state: 'failed', error: reason }]
    fake.finish('job-1', sampleRun())

    const detail = await data.getPiece('piece-a')

    expect(detail?.job).toMatchObject({ status: 'done', parts: [{ id: hornId, name: 'Horn', state: 'failed', error: reason }] })
    expect(detail?.parts.map((part) => part.id)).toEqual(['part-flute', 'part-horn'])
    expect((await data.getPiece('piece-a'))?.job?.parts?.[0].error).toBe(reason)
  })

  it('forgets a finished job that read every part, as before', async () => {
    const { fake, data } = await adding()
    fake.jobs.get('job-1')!.parts = [{ id: hornId, name: 'Horn', state: 'done' }]
    fake.finish('job-1', withHorn())

    await data.getPiece('piece-a')

    expect(((await data.getPiece('piece-a'))?.job?.parts ?? []).filter((part) => part.state === 'failed')).toEqual([])
  })

  it('reads a reload from the server like any run', async () => {
    const { fake } = await adding()
    fake.finish('job-1', withHorn())

    const reloaded = createLocalClients(createRunApi(BASE, fake.fetch))

    expect((await reloaded.data.getPiece('piece-a'))?.parts.map((part) => part.id)).toEqual(['part-flute', 'part-horn', hornId])
  })
})
