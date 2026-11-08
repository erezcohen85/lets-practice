import { createFakeRunServer } from '@/lib/localRun/fakeRunServer'
import { createLocalClients } from '@/lib/localRun/localClients'
import { createRunApi, type RunDocument } from '@/lib/localRun/runApi'
import { sampleRun } from '@/lib/localRun/sampleRun'
import { sentenceOf } from '@/lib/processorClient'

// Reprocess part: POST /runs/{run}/parts/{part}/reprocess with {"boxCheck": bool}; the answer is the add-parts shape.

const BASE = 'http://127.0.0.1:8765'

function setup() {
  const fake = createFakeRunServer([sampleRun()])
  const clients = createLocalClients(createRunApi(BASE, fake.fetch))
  return { fake, data: clients.data, processor: clients.processor }
}

/** The run the pipeline leaves when it has read the Horn again: other boxes, another page size. */
function readAgain(): RunDocument {
  const run = sampleRun()
  run.pageImages['part-horn'] = [
    { pageIndex: 0, width: 300, height: 150, file: 'pages/part-horn/page-0.webp' },
    { pageIndex: 1, width: 300, height: 150, file: 'pages/part-horn/page-1.webp' },
  ]
  run.pages['part-horn'] = { partId: 'part-horn', bars: run.pages['part-horn'].bars.map((box) => ({ ...box, x: box.x + 1 })), rests: [] }
  run.parts[1] = { ...run.parts[1], pageCount: 2 }
  return run
}

describe('local mode: reprocessing a part', () => {
  it('posts the box check to the part’s reprocess route and starts the job it names', async () => {
    const { fake, processor } = setup()

    const job = await processor.reprocessPart('piece-a', 'part-horn', { boxCheck: true })

    const post = fake.requests.find((request) => request.method === 'POST')
    expect(post).toEqual({ method: 'POST', path: '/runs/piece-a/parts/part-horn/reprocess', body: { boxCheck: true } })
    expect(fake.reprocesses).toEqual([{ runId: 'piece-a', partId: 'part-horn', boxCheck: true }])
    expect(job).toMatchObject({ id: 'local-job-1', pieceId: 'piece-a', kind: 'add-parts', status: 'queued' })
  })

  it('sends boxCheck false when the tick is off', async () => {
    const { fake, processor } = setup()

    await processor.reprocessPart('piece-a', 'part-flute', { boxCheck: false })

    expect(fake.reprocesses).toEqual([{ runId: 'piece-a', partId: 'part-flute', boxCheck: false }])
  })

  it('does not ask the server about a part the piece does not have', async () => {
    const { fake, processor } = setup()

    await expect(processor.reprocessPart('piece-a', 'part-tuba', { boxCheck: false })).rejects.toThrow('part not found')

    expect(fake.reprocesses).toEqual([])
  })

  it('says the server’s sentence for a busy run (409) and for a missing PDF (400), and starts no job', async () => {
    const { fake, data, processor } = setup()
    fake.refuseReprocess = { status: 409, detail: 'This piece is still being prepared; try again when it is done.' }
    const busy: unknown = await processor.reprocessPart('piece-a', 'part-horn', { boxCheck: false }).catch((caught: unknown) => caught)
    expect(sentenceOf(busy)).toBe('This piece is still being prepared; try again when it is done.')

    fake.refuseReprocess = { status: 400, detail: 'The PDF of Horn is not in the folder.' }
    const missing: unknown = await processor.reprocessPart('piece-a', 'part-horn', { boxCheck: false }).catch((caught: unknown) => caught)
    expect(sentenceOf(missing)).toBe('The PDF of Horn is not in the folder.')

    expect(fake.jobs.size).toBe(0)
    expect((await data.getPiece('piece-a'))?.job).toMatchObject({ kind: 'process-piece', status: 'done' })
  })

  it('follows the job, then has the part’s new pages and boxes, with its name and place unchanged', async () => {
    const { fake, data, processor } = setup()
    const before = (await data.getPiece('piece-a'))!.parts

    await processor.reprocessPart('piece-a', 'part-horn', { boxCheck: false })
    expect((await data.getPiece('piece-a'))?.job).toMatchObject({ kind: 'add-parts', status: 'queued' })
    fake.finish('job-1', readAgain())
    const detail = await data.getPiece('piece-a')

    expect(detail?.job).toMatchObject({ status: 'done' })
    expect(detail?.parts.map((part) => [part.id, part.name, part.position])).toEqual(before.map((part) => [part.id, part.name, part.position]))
    expect(detail?.parts[1].pageCount).toBe(2)
    expect(await data.getPartPages('piece-a', 'part-horn')).toHaveLength(2)
    const horn = (await data.getPieceMap('piece-a'))?.pages.find((layer) => layer.partId === 'part-horn')
    expect(horn?.bars[0].x).toBe(11)
  })

  it('leaves the other part and the shared timing as the editor has them', async () => {
    const { fake, data, processor } = setup()
    const map = (await data.getPieceMap('piece-a'))!
    const edited = { ...map.timing, locators: map.timing.locators.map((locator) => (locator.bar === 3 ? { ...locator, timeSec: 5.5, confirmed: true } : locator)) }
    await data.saveTiming('piece-a', edited)
    const flute = map.pages.find((layer) => layer.partId === 'part-flute')

    await processor.reprocessPart('piece-a', 'part-horn', { boxCheck: false })
    fake.finish('job-1', readAgain())
    await data.getPiece('piece-a')

    const after = (await data.getPieceMap('piece-a'))!
    expect(after.timing).toEqual(edited)
    expect(after.pages.find((layer) => layer.partId === 'part-flute')).toEqual(flute)
  })

  it('starts the job again with no files when it failed, as an add does', async () => {
    const { fake, data, processor } = setup()
    await processor.reprocessPart('piece-a', 'part-horn', { boxCheck: false })
    const failed = fake.jobs.get('job-1')!
    failed.status = 'error'
    failed.error = 'Horn: The score PDF has more than 40 pages.'
    expect((await data.getPiece('piece-a'))?.job).toMatchObject({ status: 'error', error: failed.error })

    const again = await processor.addParts('piece-a', [])

    expect(again).toMatchObject({ kind: 'add-parts', status: 'queued' })
  })
})
