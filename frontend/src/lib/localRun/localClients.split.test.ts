import { createFakeRunServer } from '@/lib/localRun/fakeRunServer'
import { createLocalClients } from '@/lib/localRun/localClients'
import { createRunApi } from '@/lib/localRun/runApi'
import { sampleRun } from '@/lib/localRun/sampleRun'
import { sentenceOf } from '@/lib/processorClient'

const BASE = 'http://127.0.0.1:8765'
const pdf = (name: string) => new File(['%PDF-1.7'], name, { type: 'application/pdf' })
const GOOD_LINK = { kind: 'file' as const, file: new File(['x'], 'take.mp3', { type: 'audio/mpeg' }) }

function setup() {
  const fake = createFakeRunServer([sampleRun()])
  const clients = createLocalClients(createRunApi(BASE, fake.fetch))
  return { fake, data: clients.data, processor: clients.processor }
}

const split = (splitId: string) => ({
  splitId,
  fileName: 'band.pdf',
  parts: [{ name: 'Flute', fromPage: 1, toPage: 2, skipPages: [] }, { name: 'Oboe', fromPage: 3, toPage: 3, skipPages: [] }],
})

describe('local mode: one PDF with several parts', () => {
  it('asks the server to read the PDF and gives its proposal, the thumbs under the server’s address', async () => {
    const { fake, processor } = setup()

    const proposal = await processor.proposeSplit(pdf('band.pdf'))

    expect(fake.requests.at(-1)).toMatchObject({ method: 'POST', path: '/split' })
    expect(proposal.parts).toEqual(fake.splitProposal.parts)
    expect(proposal.pages[0].thumb).toBe(`${BASE}/split/${proposal.splitId}/pages/1.png`)
  })

  it('shows the server’s sentence when the PDF cannot be read', async () => {
    const { fake, processor } = setup()
    fake.refuseSplit = 'This PDF has more than 120 pages.'

    await expect(processor.proposeSplit(pdf('band.pdf'))).rejects.toSatisfy((error: unknown) => sentenceOf(error) === 'This PDF has more than 120 pages.')
  })

  it('uploads a new piece as the split and no part files, and lists the parts under the names the server gave', async () => {
    const { fake, data } = setup()

    const piece = await data.createPiece({ title: 'Band', recording: GOOD_LINK, parts: [], split: split('abc') })

    expect(fake.uploads[0]).toMatchObject({ path: '/runs', splitId: 'abc', split: split('abc').parts, partFiles: [], partNames: [] })
    expect((await data.getPiece(piece.id))?.parts.map((part) => [part.name, part.pageCount])).toEqual([['Flute', 0], ['Oboe', 0]])
  })

  it('creates no piece when the server refuses the split, and says its sentence', async () => {
    const { fake, data } = setup()
    fake.refuseUpload = 'This split has expired: choose the PDF again.'

    await expect(data.createPiece({ title: 'Band', recording: GOOD_LINK, parts: [], split: split('abc') })).rejects.toThrow('This split has expired')

    expect((await data.listPieces()).map((item) => item.id)).toEqual(['piece-a'])
  })

  it('adds the parts of a split to a piece and starts the add-parts job once', async () => {
    const { fake, data, processor } = setup()

    await data.storeParts('piece-a', [], split('abc'))
    const job = await processor.addParts('piece-a', [])

    expect(fake.uploads[0]).toMatchObject({ path: '/runs/piece-a/parts', splitId: 'abc' })
    expect(job).toMatchObject({ kind: 'add-parts', status: 'queued' })
    expect(fake.requests.filter((request) => request.method === 'POST')).toHaveLength(1)
    expect((await data.getPiece('piece-a'))?.parts.map((part) => part.name)).toEqual(['Flute', 'Horn', 'Flute', 'Oboe'])
  })

  it('passes on which part the job is reading', async () => {
    const { fake, data } = setup()
    const piece = await data.createPiece({ title: 'Band', recording: GOOD_LINK, parts: [], split: split('abc') })
    const serverJob = fake.jobs.get('job-1')!
    serverJob.status = 'running'
    serverJob.progress = 0.4
    serverJob.parts = [
      { id: 'band-01-flute', name: 'Flute', state: 'done' },
      { id: 'band-02-oboe', name: 'Oboe', state: 'reading' },
    ]

    expect((await data.getPiece(piece.id))?.job?.parts).toEqual(serverJob.parts)
  })
})
