import { pieceState } from '@/domain/pieceStatus'
import { createFakeRunServer } from '@/lib/localRun/fakeRunServer'
import { createLocalClients } from '@/lib/localRun/localClients'
import { createRunApi, type RunDocument } from '@/lib/localRun/runApi'
import { sampleRun } from '@/lib/localRun/sampleRun'

const BASE = 'http://127.0.0.1:8765'
const RESTARTED = 'Processing stopped when the local server restarted.'
const names = ['Clarinet 1', 'Clarinet 2']
const ids = ['clark-01-clarinet-1', 'clark-02-clarinet-2']

function setup(documents: RunDocument[] = []) {
  const fake = createFakeRunServer(documents)
  const clients = createLocalClients(createRunApi(BASE, fake.fetch))
  return { fake, clients, data: clients.data, processor: clients.processor }
}

/** What the pipeline writes for the two clarinets when it finishes. */
function finishedRun(): RunDocument {
  const run = sampleRun('clark')
  run.piece.title = 'Clark County'
  run.parts = ids.map((id, position) => ({ id, name: names[position], position, pageCount: 1 }))
  run.pageImages = Object.fromEntries(ids.map((id) => [id, [{ pageIndex: 0, width: 200, height: 100, file: `pages/${id}/page-0.webp` }]]))
  run.pages = Object.fromEntries(ids.map((id) => [id, { partId: id, bars: run.pages['part-flute'].bars, rests: [] }]))
  return run
}

const stateOf = (piece: { job: Parameters<typeof pieceState>[0]; review: Parameters<typeof pieceState>[1]; pageCount: number }) => pieceState(piece.job, piece.review, piece.pageCount)

describe('local mode: a piece the server is still processing', () => {
  it('is in the library with its title, its parts and the progress of its job', async () => {
    const { fake, data } = setup()
    fake.jobs.set('job-7', { id: 'job-7', runId: 'clark', kind: 'process-piece', status: 'running', progress: 0.4, stage: 'pages', error: null })
    fake.addPending('clark', 'Clark County', names, {
      jobId: 'job-7',
      status: 'running',
      progress: 0.4,
      stage: 'pages',
      error: null,
      parts: [
        { id: ids[0], name: names[0], state: 'done' },
        { id: ids[1], name: names[1], state: 'reading' },
      ],
    })

    const [piece] = await data.listPieces()

    expect(piece).toMatchObject({ id: 'clark', title: 'Clark County', partCount: 2, pageCount: 0 })
    expect(piece.job).toMatchObject({ id: 'local-job-7', pieceId: 'clark', kind: 'process-piece', status: 'running', progress: 0.4, error: null })
    expect(stateOf(piece)).toBe('processing')
  })

  it('opens on the Processing screen with the real steps and the part names', async () => {
    const { fake, data } = setup()
    fake.jobs.set('job-7', { id: 'job-7', runId: 'clark', kind: 'process-piece', status: 'running', progress: 0.4, stage: 'pages', error: null, parts: [{ id: ids[0], name: names[0], state: 'done' }, { id: ids[1], name: names[1], state: 'reading' }] })
    fake.addPending('clark', 'Clark County', names, {
      jobId: 'job-7',
      status: 'running',
      progress: 0.4,
      stage: 'pages',
      error: null,
      parts: [
        { id: ids[0], name: names[0], state: 'done' },
        { id: ids[1], name: names[1], state: 'reading' },
      ],
    })

    const detail = await data.getPiece('clark')

    expect(detail?.parts.map((part) => part.name)).toEqual(names)
    expect(detail?.job?.parts).toEqual([
      { id: ids[0], name: names[0], state: 'done' },
      { id: ids[1], name: names[1], state: 'reading' },
    ])
  })

  it('follows the server’s job on each poll and does not read the run it does not have', async () => {
    const { fake, data } = setup()
    fake.jobs.set('job-7', { id: 'job-7', runId: 'clark', kind: 'process-piece', status: 'running', progress: 0.4, stage: 'pages', error: null })
    fake.addPending('clark', 'Clark County', names, { jobId: 'job-7', status: 'running', progress: 0.4, stage: 'pages', error: null })
    await data.listPieces()

    fake.jobs.get('job-7')!.progress = 0.7

    expect((await data.listPieces())[0].job).toMatchObject({ status: 'running', progress: 0.7 })
    expect(fake.requests.filter((request) => request.path === '/runs/clark')).toEqual([])
  })

  it('turns into a normal piece when the job is done, without a reload', async () => {
    const { fake, data } = setup()
    fake.jobs.set('job-7', { id: 'job-7', runId: 'clark', kind: 'process-piece', status: 'running', progress: 0.9, stage: 'save', error: null })
    fake.addPending('clark', 'Clark County', names, { jobId: 'job-7', status: 'running', progress: 0.9, stage: 'save', error: null })
    expect(stateOf((await data.listPieces())[0])).toBe('processing')

    fake.finish('job-7', finishedRun())
    const pieces = await data.listPieces()

    expect(pieces).toHaveLength(1)
    expect(pieces[0]).toMatchObject({ id: 'clark', partCount: 2, pageCount: 2 })
    expect(pieces[0].job).toMatchObject({ status: 'done' })
    expect(stateOf(pieces[0])).not.toBe('processing')
    expect((await data.getPieceMap('clark'))?.pages.map((page) => page.partId)).toEqual(ids)
  })

  it('is a failed piece, with the job’s own sentence, when the server’s job failed', async () => {
    const { fake, data } = setup()
    fake.jobs.set('job-7', { id: 'job-7', runId: 'clark', kind: 'process-piece', status: 'error', progress: 0.3, stage: 'pages', error: 'No part could be read.' })
    fake.addPending('clark', 'Clark County', names, { jobId: 'job-7', status: 'error', progress: 0.3, stage: 'pages', error: 'No part could be read.' })

    const [piece] = await data.listPieces()

    expect(piece.job).toMatchObject({ status: 'error', error: 'No part could be read.' })
    expect(stateOf(piece)).toBe('failed')
  })

  it('is failed with the restart sentence when the server has no job for it, and Try again runs it', async () => {
    const { fake, data, processor } = setup()
    fake.addPending('clark', 'Clark County', names, { progress: 0.3 })

    const [piece] = await data.listPieces()
    expect(piece.job).toMatchObject({ kind: 'process-piece', status: 'error', error: RESTARTED })
    expect(stateOf(piece)).toBe('failed')

    const again = await processor.processPiece('clark')

    expect(fake.requests.filter((request) => request.method === 'POST').map((request) => request.path)).toEqual(['/runs/clark/process'])
    expect(again).toMatchObject({ pieceId: 'clark', status: 'queued' })
    expect((await data.listPieces())[0].job).toMatchObject({ status: 'queued', error: null })
    expect(stateOf((await data.listPieces())[0])).toBe('processing')
  })

  it('shows the restart sentence when the server lost the job while the app was open', async () => {
    const { fake, data } = setup()
    fake.jobs.set('job-7', { id: 'job-7', runId: 'clark', kind: 'process-piece', status: 'running', progress: 0.4, stage: 'pages', error: null })
    const summary = fake.addPending('clark', 'Clark County', names, { jobId: 'job-7', status: 'running', progress: 0.4, stage: 'pages', error: null })
    expect(stateOf((await data.listPieces())[0])).toBe('processing')

    // the server is restarted: it has no job 7 any more, and the folder says the job was running
    fake.jobs.delete('job-7')
    summary.pending = { ...summary.pending!, jobId: null, status: 'error', progress: 0.4, error: RESTARTED }
    const [piece] = await data.listPieces()

    expect(piece.job).toMatchObject({ status: 'error', error: RESTARTED })
    expect(stateOf(piece)).toBe('failed')
  })

  it('lists the finished pieces as before, beside it', async () => {
    const { fake, data } = setup([sampleRun('piece-a')])
    fake.addPending('clark', 'Clark County', names)

    const pieces = await data.listPieces()

    expect(pieces.map((piece) => piece.id).sort()).toEqual(['clark', 'piece-a'])
    expect(stateOf(pieces.find((piece) => piece.id === 'piece-a')!)).not.toBe('processing')
  })

  it('can be renamed, and a stopped one deleted', async () => {
    const { fake, data } = setup()
    fake.addPending('clark', 'Clark County', names)

    await data.renamePiece('clark', 'Clark County Concert')
    expect(fake.pending.get('clark')?.title).toBe('Clark County Concert')
    expect((await data.listPieces())[0].title).toBe('Clark County Concert')

    await data.deletePiece('clark')
    expect(fake.deletedPieces).toEqual(['clark'])
    expect(await data.listPieces()).toEqual([])
  })
})
