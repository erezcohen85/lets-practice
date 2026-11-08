import { createFakeRunServer } from '@/lib/localRun/fakeRunServer'
import { createLocalClients } from '@/lib/localRun/localClients'
import { createRunApi } from '@/lib/localRun/runApi'
import { sampleRun } from '@/lib/localRun/sampleRun'

// The box check tick (Decisions 2026-11-03): a per-part boxCheck field beside names, "1" or "0", sent only when a part is ticked.

const BASE = 'http://127.0.0.1:8765'
const pdf = (name: string) => new File(['%PDF-1.7'], `${name}.pdf`, { type: 'application/pdf' })
const recording = { kind: 'file' as const, file: new File(['mp3'], 'take.mp3') }

function setup() {
  const fake = createFakeRunServer([sampleRun()])
  const clients = createLocalClients(createRunApi(BASE, fake.fetch))
  return { fake, data: clients.data }
}

describe('local mode: the box check tick goes to the server', () => {
  it('sends boxCheck for every part of a new piece, aligned with the names, when one is ticked', async () => {
    const { fake, data } = setup()

    await data.createPiece({
      title: 'Etude',
      recording,
      parts: [
        { file: pdf('Flute'), name: 'Flute', boxCheck: true },
        { file: pdf('Oboe'), name: 'Oboe' },
      ],
    })

    expect(fake.uploads[0]).toMatchObject({ partNames: ['Flute', 'Oboe'], partBoxChecks: ['1', '0'] })
  })

  it('sends no boxCheck field when no part is ticked', async () => {
    const { fake, data } = setup()

    await data.createPiece({ title: 'Etude', recording, parts: [{ file: pdf('Flute'), name: 'Flute', boxCheck: false }] })

    expect(fake.uploads[0]).not.toHaveProperty('partBoxChecks')
  })

  it('sends boxCheck for added parts', async () => {
    const { fake, data } = setup()

    await data.storeParts('piece-a', [{ file: pdf('Horn'), name: 'Horn', boxCheck: true }])

    expect(fake.uploads[0]).toMatchObject({ path: '/runs/piece-a/parts', partBoxChecks: ['1'] })
  })

  it('sends boxCheck for the kept parts of a split, in order', async () => {
    const { fake, data } = setup()
    const parts = [
      { name: 'Flute', fromPage: 1, toPage: 2, skipPages: [] },
      { name: 'Oboe', fromPage: 3, toPage: 3, skipPages: [] },
    ]

    await data.createPiece({ title: 'Band', recording, parts: [], split: { splitId: 'abc', fileName: 'band.pdf', parts, boxChecks: [false, true] } })

    expect(fake.uploads[0]).toMatchObject({ splitId: 'abc', partBoxChecks: ['0', '1'] })
  })
})
