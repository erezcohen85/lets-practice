import { type Job } from '@/domain/types'
import { fakeFill, fakeRealign } from '@/lib/fakes/fakeRealign'
import { DEMO_SPEC, recordingSeconds, syntheticTiming } from '@/lib/fakes/syntheticPiece'
import { type DataClient } from '@/lib/dataClient'
import { type ProcessorClient } from '@/lib/processorClient'
import { createFakes } from '@/lib/fakes'
import { addSeedPiece } from '@/lib/fakes/seed'
import { OTHER_USER } from '@/lib/fakes/store'

function pdf(name: string): File {
  return new File(['%PDF'], name, { type: 'application/pdf' })
}

describe('FakeProcessorClient while signed out', () => {
  const calls: Array<[string, (processor: ProcessorClient) => Promise<unknown>]> = [
    ['processPiece', (processor) => processor.processPiece('piece-clark-county')],
    ['realign', (processor) => processor.realign('piece-clark-county')],
    ['fillEmptyBars', (processor) => processor.fillEmptyBars('piece-clark-county', syntheticTiming(DEMO_SPEC))],
    ['addParts', (processor) => processor.addParts('piece-clark-county', [{ file: pdf('oboe.pdf'), name: 'Oboe' }])],
    ['readPartName', (processor) => processor.readPartName(pdf('clarinet.pdf'))],
  ]

  it.each(calls)('%s rejects with "not signed in"', async (_name, call) => {
    const { processor } = createFakes({ seed: 'demo', signedIn: false })

    await expect(call(processor)).rejects.toThrow('not signed in')
  })
})

describe('FakeProcessorClient processPiece', () => {
  it('starts a queued process job for the piece', async () => {
    const { processor } = createFakes({ seed: 'demo' })

    const job = await processor.processPiece('piece-clark-county')

    expect(job).toMatchObject({
      pieceId: 'piece-clark-county',
      kind: 'process-piece',
      status: 'queued',
      progress: 0,
      error: null,
    })
    expect(job.id).not.toBe('')
  })

  it('starts a new job at every call, each with its own id', async () => {
    const { processor, store } = createFakes({ seed: 'demo' })

    const first = await processor.processPiece('piece-clark-county')
    const second = await processor.processPiece('piece-clark-county')

    expect(second.id).not.toBe(first.id)
    expect(store.jobs.has(first.id)).toBe(true)
    expect(store.jobs.has(second.id)).toBe(true)
  })

  it('makes the new job the latest job of the piece', async () => {
    const { data, processor } = createFakes({ seed: 'demo' })

    const job = await processor.processPiece('piece-clark-county')
    const detail = await data.getPiece('piece-clark-county')

    expect(detail?.job?.id).toBe(job.id)
    expect(detail?.job?.status).toBe('running')
  })

  it('rejects for a piece that does not exist', async () => {
    const { processor } = createFakes({ seed: 'demo' })

    await expect(processor.processPiece('piece-nope')).rejects.toThrow('piece not found')
  })

  it('rejects for a piece of another user', async () => {
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

    await expect(fakes.processor.processPiece('piece-others')).rejects.toThrow('piece not found')
    await expect(fakes.processor.realign('piece-others')).rejects.toThrow('piece not found')
    await expect(fakes.processor.addParts('piece-others', [{ file: pdf('oboe.pdf'), name: 'Oboe' }])).rejects.toThrow('piece not found')
    expect([...fakes.store.parts.values()].filter((part) => part.pieceId === 'piece-others')).toHaveLength(1)
  })

  it('returns a job that a caller cannot use to change the store', async () => {
    const { data, processor } = createFakes({ seed: 'demo' })
    const job = await processor.processPiece('piece-clark-county')

    job.status = 'done'
    job.progress = 1

    expect(await data.getJob(job.id)).toMatchObject({ status: 'running', progress: 0.2 })
  })
})

describe('FakeProcessorClient realign', () => {
  it('starts a queued realign job for the piece', async () => {
    const { processor } = createFakes({ seed: 'demo' })

    const job = await processor.realign('piece-concert-march')

    expect(job).toMatchObject({
      pieceId: 'piece-concert-march',
      kind: 'realign',
      status: 'queued',
      progress: 0,
      error: null,
    })
  })

  it('finishes with the progress values of the realign stages and leaves peaks and review alone', async () => {
    const { data, processor } = createFakes({ seed: 'demo' })
    const before = await data.getPiece('piece-clark-county')
    const job = await processor.realign('piece-clark-county')

    const seen: Array<[Job['status'], number]> = []
    for (let i = 0; i < 6; i++) {
      const read = await data.getJob(job.id)
      seen.push([read?.status ?? 'error', read?.progress ?? -1])
    }
    const after = await data.getPiece('piece-clark-county')

    expect(seen).toEqual([
      ['running', 0.1],
      ['running', 0.3],
      ['running', 0.6],
      ['running', 0.9],
      ['done', 1],
      ['done', 1],
    ])
    expect(after?.review).toEqual(before?.review)
    expect(after?.parts.map((part) => part.review)).toEqual(before?.parts.map((part) => part.review))
  })

  it('fails at a stage it shares with the process job', async () => {
    const { data, processor } = createFakes({ seed: 'demo', failStage: 'downbeats' })
    const job = await processor.realign('piece-clark-county')

    let last: Job | null = null
    for (let i = 0; i < 6; i++) last = await data.getJob(job.id)

    expect(last).toMatchObject({ status: 'error', progress: 0.3, error: 'downbeats failed: fake failure' })
  })
})

describe('FakeProcessorClient realign on the map', () => {
  it('refits the stored timing when the realign job reaches done, not before', async () => {
    const { data, processor } = createFakes({ seed: 'demo' })
    const scrambled = syntheticTiming(DEMO_SPEC)
    scrambled.locators = scrambled.locators.map((locator) =>
      locator.confirmed ? locator : { ...locator, timeSec: locator.timeSec + 5 },
    )
    await data.saveTiming('piece-clark-county', scrambled)
    const job = await processor.realign('piece-clark-county')

    for (let i = 0; i < 4; i++) await data.getJob(job.id)
    expect((await data.getPieceMap('piece-clark-county'))?.timing).toEqual(scrambled)
    expect((await data.getJob(job.id))?.status).toBe('done')
    const timing = (await data.getPieceMap('piece-clark-county'))?.timing

    expect(timing).toEqual(fakeRealign(scrambled, 271))
    expect(timing).not.toEqual(scrambled)
    expect(timing?.locators.filter((locator) => locator.confirmed)).toEqual(
      scrambled.locators.filter((locator) => locator.confirmed),
    )
    expect(recordingSeconds(DEMO_SPEC)).toBeCloseTo(271, 6)
  })

  it('does not refit when the job fails', async () => {
    const { data, processor } = createFakes({ seed: 'demo', failStage: 'align' })
    const scrambled = syntheticTiming(DEMO_SPEC)
    scrambled.locators[3] = { ...scrambled.locators[3], timeSec: 99 }
    await data.saveTiming('piece-clark-county', scrambled)
    const job = await processor.realign('piece-clark-county')

    for (let i = 0; i < 6; i++) await data.getJob(job.id)

    expect((await data.getJob(job.id))?.status).toBe('error')
    expect((await data.getPieceMap('piece-clark-county'))?.timing).toEqual(scrambled)
  })

  it('refits only once however often the finished job is read', async () => {
    const { data, processor } = createFakes({ seed: 'demo' })
    const job = await processor.realign('piece-clark-county')
    for (let i = 0; i < 5; i++) await data.getJob(job.id)
    const once = (await data.getPieceMap('piece-clark-county'))?.timing

    await data.getJob(job.id)
    await data.getJob(job.id)

    expect((await data.getPieceMap('piece-clark-county'))?.timing).toEqual(once)
  })
})

describe('FakeProcessorClient readPartName', () => {
  it('reads the part name from the file name', async () => {
    const { processor } = createFakes({ signedIn: true })

    expect(await processor.readPartName(pdf('CCC_clar1_final-v2.pdf'))).toBe('CCC clar1 final v2')
  })

  it('cannot read a name when the file name says unreadable', async () => {
    const { processor } = createFakes({ signedIn: true })

    expect(await processor.readPartName(pdf('unreadable.pdf'))).toBeNull()
    expect(await processor.readPartName(pdf('flute-unreadable-scan.pdf'))).toBeNull()
  })
})

describe('FakeProcessorClient addParts', () => {
  const OBOE = { file: pdf('oboe.pdf'), name: 'Oboe 1' }
  const HORN = { file: pdf('horn.pdf'), name: 'Horn in F' }

  /** Reads the job until it stops moving. */
  async function finish(data: DataClient, jobId: string) {
    for (let i = 0; i < 8; i++) await data.getJob(jobId)
    return (await data.getJob(jobId))!
  }

  it('stores the new parts after the existing ones and starts a queued add-parts job', async () => {
    const { data, processor } = createFakes({ seed: 'demo' })

    const job = await processor.addParts('piece-concert-march', [OBOE, HORN])
    const detail = (await data.getPiece('piece-concert-march'))!

    expect(job).toMatchObject({ pieceId: 'piece-concert-march', kind: 'add-parts', status: 'queued', progress: 0, error: null })
    expect(detail.parts.map((part) => part.name).slice(-2)).toEqual(['Oboe 1', 'Horn in F'])
    expect(detail.parts).toHaveLength(4)
    expect(detail.job?.id).toBe(job.id)
  })

  it('walks the stages of its own ladder: pages 0.3, omr 0.8, then done', async () => {
    const { data, processor } = createFakes({ seed: 'demo' })
    const job = await processor.addParts('piece-concert-march', [OBOE])

    const seen: Array<[Job['status'], number]> = []
    for (let i = 0; i < 4; i++) {
      const read = (await data.getJob(job.id))!
      seen.push([read.status, read.progress])
    }

    expect(seen).toEqual([
      ['running', 0.3],
      ['running', 0.8],
      ['done', 1],
      ['done', 1],
    ])
  })

  it('gives each new part pages and bar boxes for the piece\'s bar count, and leaves the shared timing and the other parts alone', async () => {
    const { data, processor } = createFakes({ seed: 'demo' })
    const before = (await data.getPieceMap('piece-clark-county'))!
    const job = await processor.addParts('piece-clark-county', [OBOE, HORN])

    expect((await finish(data, job.id)).status).toBe('done')
    const after = (await data.getPieceMap('piece-clark-county'))!

    expect(after.timing).toEqual(before.timing)
    expect(after.pages.slice(0, 3)).toEqual(before.pages)
    expect(after.pages).toHaveLength(5)
    for (const layer of after.pages.slice(3)) {
      expect(layer.bars).toHaveLength(before.timing.barCount)
      expect(layer.bars.map((box) => box.bar)).toEqual(Array.from({ length: before.timing.barCount }, (_, index) => index + 1))
    }
    const parts = (await data.getPiece('piece-clark-county'))!.parts
    expect(parts.slice(3).map((part) => part.pageCount)).toEqual([4, 4])
    expect(await data.getPartPages('piece-clark-county', parts[3].id)).toHaveLength(4)
  })

  it('counts nothing of the new parts as unchecked: the piece\'s review numbers stay', async () => {
    const { data, processor } = createFakes({ seed: 'demo' })
    const before = (await data.getPiece('piece-clark-county'))!.review
    const job = await processor.addParts('piece-clark-county', [OBOE])

    await finish(data, job.id)

    expect((await data.getPiece('piece-clark-county'))!.review).toEqual(before)
  })

  it('fails at a stage with its error, and a run with no new files processes the parts still without pages', async () => {
    const { data, processor, store } = createFakes({ seed: 'demo', failStage: 'omr' })
    const job = await processor.addParts('piece-concert-march', [OBOE])

    const failed = await finish(data, job.id)
    expect(failed).toMatchObject({ status: 'error', error: 'omr failed: fake failure' })
    expect((await data.getPieceMap('piece-concert-march'))!.pages).toHaveLength(3)
    expect(store.maps.get('piece-concert-march')?.pages.size).toBe(2)

    const retry = await processor.addParts('piece-concert-march', [])
    expect((await finish(data, retry.id)).status).toBe('done')
    const detail = (await data.getPiece('piece-concert-march'))!
    expect(detail.parts).toHaveLength(3)
    expect(store.maps.get('piece-concert-march')?.pages.size).toBe(3)
  })
})

describe('FakeProcessorClient fillEmptyBars', () => {
  it("answers the fakes' fill of the timing it is given, and stores nothing", async () => {
    const { data, processor } = createFakes({ seed: 'demo' })
    const timing = syntheticTiming(DEMO_SPEC)
    const gap = { ...timing, locators: timing.locators.filter((_, index) => index < 10 || index > 14) }
    const stored = (await data.getPieceMap('piece-clark-county'))?.timing

    const answer = await processor.fillEmptyBars('piece-clark-county', gap)

    expect(answer).toEqual(fakeFill(gap, 271))
    expect(answer?.locators).toHaveLength(timing.locators.length)
    expect((await data.getPieceMap('piece-clark-county'))?.timing).toEqual(stored)
  })

  it('gives the last bar a time after the recording of the bar before it, as after a ripple delete', async () => {
    const { processor } = createFakes({ seed: 'demo' })
    const timing = syntheticTiming(DEMO_SPEC)
    const last = timing.locators[timing.locators.length - 1]
    const trailing = { ...timing, locators: timing.locators.slice(0, -1) }

    const answer = await processor.fillEmptyBars('piece-clark-county', trailing)

    expect(answer?.locators).toHaveLength(timing.locators.length)
    const filled = answer!.locators[answer!.locators.length - 1]
    expect(filled).toMatchObject({ bar: last.bar, passIndex: last.passIndex, confirmed: false })
    expect(filled.timeSec).toBeGreaterThan(answer!.locators[answer!.locators.length - 2].timeSec)
    expect(filled.timeSec).toBeLessThan(271)
  })

  it('refuses a piece of another user', async () => {
    const { processor } = createFakes({ seed: 'demo' })

    await expect(processor.fillEmptyBars('piece-others', syntheticTiming(DEMO_SPEC))).rejects.toThrow('piece not found')
  })
})

describe('FakeProcessorClient reprocessPart', () => {
  const CLARK = 'piece-clark-county'

  async function finish(data: DataClient, jobId: string) {
    for (let i = 0; i < 8; i++) await data.getJob(jobId)
    return (await data.getJob(jobId))!
  }

  it('starts a queued add-parts job for the one part and keeps the boxCheck for tests to read', async () => {
    const { data, processor, store } = createFakes({ seed: 'demo' })
    const [, second] = (await data.getPiece(CLARK))!.parts

    const job = await processor.reprocessPart(CLARK, second.id, { boxCheck: true })

    expect(job).toMatchObject({ pieceId: CLARK, kind: 'add-parts', status: 'queued', progress: 0, error: null })
    expect(store.reprocessed).toEqual([{ pieceId: CLARK, partId: second.id, boxCheck: true }])
  })

  it('marks the part as read again: no pages until the job is done, then new pages; the name, the place and the others stay', async () => {
    const { data, processor, store } = createFakes({ seed: 'demo' })
    const before = (await data.getPiece(CLARK))!.parts
    const otherLayers = (await data.getPieceMap(CLARK))!.pages.filter((layer) => layer.partId !== before[1].id)

    const job = await processor.reprocessPart(CLARK, before[1].id, { boxCheck: false })
    expect(store.parts.get(before[1].id)).toMatchObject({ name: before[1].name, pageCount: 0 })
    expect(store.maps.get(CLARK)?.pages.has(before[1].id)).toBe(false)

    expect((await finish(data, job.id)).status).toBe('done')
    const after = (await data.getPiece(CLARK))!.parts
    expect(after.map((part) => [part.id, part.name])).toEqual(before.map((part) => [part.id, part.name]))
    expect(after[1].pageCount).toBeGreaterThan(0)
    const layers = (await data.getPieceMap(CLARK))!.pages
    expect(layers.filter((layer) => layer.partId !== before[1].id)).toEqual(otherLayers)
    expect(layers.map((layer) => layer.partId).sort()).toEqual(before.map((part) => part.id).sort())
  })

  it('rejects for a part the piece does not have, and for a piece that is not found', async () => {
    const { processor } = createFakes({ seed: 'demo' })

    await expect(processor.reprocessPart(CLARK, 'part-nope', { boxCheck: false })).rejects.toThrow('part not found')
    await expect(processor.reprocessPart('piece-others', 'x', { boxCheck: false })).rejects.toThrow('piece not found')
  })

  it('rejects with "not signed in" while signed out', async () => {
    const { processor } = createFakes({ seed: 'demo', signedIn: false })

    await expect(processor.reprocessPart(CLARK, 'x', { boxCheck: false })).rejects.toThrow('not signed in')
  })
})
