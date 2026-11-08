import { createFakeRunServer } from '@/lib/localRun/fakeRunServer'
import { createLocalClients } from '@/lib/localRun/localClients'
import { createRunApi } from '@/lib/localRun/runApi'
import { sampleRun } from '@/lib/localRun/sampleRun'

const BASE = 'http://127.0.0.1:8765'

function setup() {
  const fake = createFakeRunServer([sampleRun()])
  const clients = createLocalClients(createRunApi(BASE, fake.fetch))
  return { fake, data: clients.data, processor: clients.processor }
}

describe('local mode: deleting a part', () => {
  it('asks the server to delete the files and then drops the part from the app', async () => {
    const { fake, data } = setup()

    await data.deletePart('piece-a', 'part-flute')

    expect(fake.deleted).toEqual(['part-flute'])
    expect((await data.getPiece('piece-a'))?.parts.map((part) => part.id)).toEqual(['part-horn'])
    expect((await data.getPieceMap('piece-a'))?.pages.map((layer) => layer.partId)).toEqual(['part-horn'])
  })

  it('keeps the part when the server refuses, and says the server’s sentence', async () => {
    const { fake, data } = setup()
    fake.refuseDelete = 'This piece is still being prepared; try again when it is done.'

    await expect(data.deletePart('piece-a', 'part-flute')).rejects.toThrow('still being prepared')

    expect((await data.getPiece('piece-a'))?.parts).toHaveLength(2)
  })

  it('does not ask the server about a part the piece does not have', async () => {
    const { fake, data } = setup()

    await expect(data.deletePart('piece-a', 'part-tuba')).rejects.toThrow('part not found')

    expect(fake.deleted).toEqual([])
  })

  it('writes the map without the part on the next save', async () => {
    const { fake, data } = setup()
    await data.deletePart('piece-a', 'part-flute')

    await data.saveTiming('piece-a', (await data.getPieceMap('piece-a'))!.timing)

    expect(Object.keys(fake.mapOf('piece-a').pages)).toEqual(['part-horn'])
  })
})

describe('local mode: suggesting a name', () => {
  it('asks the server about the piece', async () => {
    const { fake, processor } = setup()
    fake.suggestion = { name: 'Etude (Berg)', source: 'claude', note: null }

    expect(await processor.suggestPieceName('piece-a')).toEqual(fake.suggestion)

    expect(fake.suggestRequests).toEqual([{ runId: 'piece-a', fields: {} }])
  })

  it('sends a form’s first PDF, and the audio file’s name but never the audio', async () => {
    const { fake, processor } = setup()

    await processor.suggestNewPieceName({
      recording: { kind: 'file', file: new File(['audio bytes'], 'take3.mp3') },
      firstPart: new File(['%PDF'], 'flute.pdf'),
    })
    await processor.suggestNewPieceName({ recording: null, firstPart: null })

    expect(fake.suggestRequests).toEqual([
      { runId: null, fields: { recordingName: 'take3.mp3', part: 'flute.pdf' } },
      { runId: null, fields: {} },
    ])
  })

  it('refuses a piece the app does not have', async () => {
    const { processor } = setup()

    await expect(processor.suggestPieceName('piece-nope')).rejects.toThrow('piece not found')
  })
})
