import { SPLIT_EXPIRED } from '@/domain/splitEdits'
import { createFakes } from '@/lib/fakes'
import { partsOf } from '@/lib/fakes/store'
import { sentenceOf } from '@/lib/processorClient'

const pdf = (name: string) => new File(['%PDF'], name, { type: 'application/pdf' })
const GOOD_LINK = { kind: 'file' as const, file: new File(['x'], 'take.mp3', { type: 'audio/mpeg' }) }

async function proposed(name = 'band.pdf') {
  const world = createFakes({ signedIn: true, termsAccepted: true })
  const proposal = await world.processor.proposeSplit(pdf(name))
  return { ...world, proposal }
}

const splitOf = (splitId: string, parts: Array<[string, number, number] | [string, number, number, number[]]>) => ({
  splitId,
  fileName: 'band.pdf',
  parts: parts.map(([name, fromPage, toPage, skipPages = []]) => ({ name, fromPage, toPage, skipPages })),
})

describe('the fake processor proposes a split', () => {
  it('reads three parts over six pages, every page with a small picture', async () => {
    const { proposal } = await proposed()

    expect(proposal.pageCount).toBe(6)
    expect(proposal.fullScore).toBe(false)
    expect(proposal.parts.map((part) => [part.name, part.fromPage, part.toPage])).toEqual([['Flute', 1, 2], ['Oboe', 3, 3], ['Clarinet in B♭', 4, 6]])
    expect(proposal.pages.map((page) => page.page)).toEqual([1, 2, 3, 4, 5, 6])
    expect(proposal.pages[0].thumb).toMatch(/^data:image\//)
    expect(proposal.note).toBeNull()
  })

  it('draws the page pictures 640 px wide, as sharp as the processor’s for the 320 px preview', async () => {
    const { proposal } = await proposed()

    expect(decodeURIComponent(proposal.pages[0].thumb)).toContain('width="640"')
  })

  it('says full score for a file named like one, and gives one part with a note for a file it cannot read', async () => {
    expect((await proposed('fullscore.pdf')).proposal.fullScore).toBe(true)
    const unread = (await proposed('unreadable.pdf')).proposal
    expect(unread.parts).toEqual([{ name: 'Part 1', fromPage: 1, toPage: 6 }])
    expect(unread.note).toMatch(/could not be read/)
  })

  it('refuses a file that is not a PDF with a sentence', async () => {
    const { processor } = createFakes({ signedIn: true })

    await expect(processor.proposeSplit(new File(['x'], 'notes.txt'))).rejects.toThrow('This file is not a PDF.')
  })

  it('needs a signed-in user', async () => {
    const { processor } = createFakes()

    await expect(processor.proposeSplit(pdf('band.pdf'))).rejects.toThrow('not signed in')
  })
})

describe('a new piece made from a split', () => {
  it('has one part per kept range, under the names the user gave, and no file of its own', async () => {
    const { data, store, proposal } = await proposed()

    const piece = await data.createPiece({
      title: 'Band',
      recording: GOOD_LINK,
      parts: [],
      split: splitOf(proposal.splitId, [['Flute', 1, 2], ['Horn', 4, 6]]),
    })

    expect(partsOf(store, piece.id).map((part) => [part.name, part.position, part.file.name])).toEqual([['Flute', 0, 'band.pdf'], ['Horn', 1, 'band.pdf']])
  })

  it('takes a part that skips some of its pages', async () => {
    const { data, store, proposal } = await proposed()

    const piece = await data.createPiece({ title: 'Band', recording: GOOD_LINK, parts: [], split: splitOf(proposal.splitId, [['Winds', 1, 6, [2, 4]]]) })

    expect(partsOf(store, piece.id).map((part) => part.name)).toEqual(['Winds'])
  })

  it('refuses a split the processor does not hold, and creates no piece', async () => {
    const { data, store } = await proposed()

    const attempt = data.createPiece({ title: 'Band', recording: GOOD_LINK, parts: [], split: splitOf('nope', [['Flute', 1, 2]]) })

    await expect(attempt).rejects.toSatisfy((error: unknown) => sentenceOf(error) === SPLIT_EXPIRED)
    expect(store.pieces.size).toBe(0)
  })

  it.each([
    [[], 'Keep at least one part.'],
    [[['A', 5, 7]], 'The pages 5 to 7 are not inside this PDF of 6 pages.'],
    [[['A', 1, 3], ['B', 3, 4]], 'The parts must be in page order and must not overlap.'],
    [[['', 1, 3]], 'Every part needs a name of 1 to 80 characters.'],
    [[['A', 2, 4, [5]]], 'The skipped pages must be inside the part\'s pages (2 to 4).'],
    [[['A', 2, 4, [1]]], 'The skipped pages must be inside the part\'s pages (2 to 4).'],
    [[['A', 2, 3, [2, 3]]], 'A part needs at least one page that is not skipped.'],
  ] as Array<[Array<[string, number, number] | [string, number, number, number[]]>, string]>)('refuses %j with the processor’s sentence and keeps the staged split for another try', async (ranges, sentence) => {
    const { data, store, proposal } = await proposed()

    const attempt = data.createPiece({ title: 'Band', recording: GOOD_LINK, parts: [], split: splitOf(proposal.splitId, ranges) })

    await expect(attempt).rejects.toSatisfy((error: unknown) => sentenceOf(error) === sentence)
    expect(store.pieces.size).toBe(0)
    await data.createPiece({ title: 'Band', recording: GOOD_LINK, parts: [], split: splitOf(proposal.splitId, [['Flute', 1, 6]]) })
    expect(store.pieces.size).toBe(1)
  })

  it('uses the staged split once: a second upload of it has expired', async () => {
    const { data, proposal } = await proposed()
    const split = splitOf(proposal.splitId, [['Flute', 1, 6]])
    await data.createPiece({ title: 'Band', recording: GOOD_LINK, parts: [], split })

    await expect(data.createPiece({ title: 'Band 2', recording: GOOD_LINK, parts: [], split })).rejects.toThrow(SPLIT_EXPIRED)
  })

  it('adds the parts of a split to a piece after its own', async () => {
    const { data, processor, store, proposal } = await proposed()
    const piece = await data.createPiece({ title: 'Solo', recording: GOOD_LINK, parts: [{ file: pdf('solo.pdf'), name: 'Solo' }] })

    await data.storeParts(piece.id, [], splitOf(proposal.splitId, [['Flute', 1, 2], ['Oboe', 3, 6]]))
    const job = await processor.addParts(piece.id, [])

    expect(partsOf(store, piece.id).map((part) => part.name)).toEqual(['Solo', 'Flute', 'Oboe'])
    expect(job.kind).toBe('add-parts')
  })
})

describe('a fake job that reads several parts says which one', () => {
  it('lists them waiting, then reading one after another, then done', async () => {
    const { data, processor, proposal } = await proposed()
    const piece = await data.createPiece({
      title: 'Band',
      recording: GOOD_LINK,
      parts: [],
      split: splitOf(proposal.splitId, [['Flute', 1, 2], ['Oboe', 3, 3], ['Horn', 4, 6]]),
    })

    const first = await processor.processPiece(piece.id)
    expect(first.parts?.map((part) => [part.name, part.state])).toEqual([['Flute', 'waiting'], ['Oboe', 'waiting'], ['Horn', 'waiting']])

    const seen: string[] = []
    for (let step = 0; step < 10; step += 1) {
      const job = await data.getJob(first.id)
      seen.push((job?.parts ?? []).map((part) => part.state[0]).join(''))
    }
    expect(seen.some((states) => states.includes('r'))).toBe(true)
    expect(seen.at(-1)).toBe('ddd')
  })

  it('leaves the job of a single part as it always was', async () => {
    const { data, processor } = createFakes({ signedIn: true })
    const piece = await data.createPiece({ title: 'Solo', recording: GOOD_LINK, parts: [{ file: pdf('solo.pdf'), name: 'Solo' }] })

    expect((await processor.processPiece(piece.id)).parts).toBeUndefined()
  })
})
