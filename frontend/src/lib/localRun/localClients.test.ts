import { type PageLayer, type TimingLayer } from '@/domain/types'
import { createFakeRunServer, type FakeRunServer } from '@/lib/localRun/fakeRunServer'
import { createLocalClients } from '@/lib/localRun/localClients'
import { createRunApi, type RunDocument } from '@/lib/localRun/runApi'
import { sampleRun } from '@/lib/localRun/sampleRun'

const BASE = 'http://127.0.0.1:8765'

function setup(document: RunDocument = sampleRun(), server?: FakeRunServer) {
  const fake = server ?? createFakeRunServer([document])
  const clients = createLocalClients(createRunApi(BASE, fake.fetch))
  return { fake, clients, data: clients.data, processor: clients.processor }
}

function moved(timing: TimingLayer, bar: number, timeSec: number): TimingLayer {
  return { ...timing, locators: timing.locators.map((locator) => (locator.bar === bar ? { ...locator, timeSec, confirmed: true } : locator)) }
}

const puts = (fake: FakeRunServer) => fake.requests.filter((request) => request.method === 'PUT')

describe('local mode: the sample piece', () => {
  it('is never given: the library shows the runs and nothing else', async () => {
    const { data, processor } = setup()

    expect(await processor.claimSamplePiece()).toEqual({ status: 'already' })
    expect((await data.listPieces()).map((piece) => piece.id)).toEqual(['piece-a'])
    expect((await data.listPieces())[0]!.isSample).toBe(false)
  })
})

describe('local mode: what the app reads from the run', () => {
  it('asks the server for nothing until the first call', () => {
    const { fake } = setup()

    expect(fake.requests).toEqual([])
  })

  it('has the demo user signed in with the terms accepted', async () => {
    const { data } = setup()

    expect((await data.getUser())?.email).toBe('demo@example.com')
    expect((await data.getProfile()).acceptedTermsAt).not.toBeNull()
  })

  it('shows one piece per run in the library, finished, with its parts and length', async () => {
    const { data } = setup()

    const pieces = await data.listPieces()

    expect(pieces).toHaveLength(1)
    expect(pieces[0]).toMatchObject({ id: 'piece-a', title: 'Synthetic Etude', partCount: 2, durationSec: 20 })
    expect(pieces[0].job?.status).toBe('done')
  })

  it('shows two runs as two pieces', async () => {
    const second = sampleRun('piece-b')
    second.piece.title = 'Second Piece'
    const { data } = setup(sampleRun(), createFakeRunServer([sampleRun(), second]))

    expect((await data.listPieces()).map((piece) => piece.title).sort()).toEqual(['Second Piece', 'Synthetic Etude'])
  })

  it('opens the hub: parts in order, the recording label, the count-in', async () => {
    const { data } = setup()

    const detail = await data.getPiece('piece-a')

    expect(detail?.parts.map((part) => part.name)).toEqual(['Flute', 'Horn'])
    expect(detail?.recordingLabel).toBe('etude.mp3')
    expect(detail?.piece.countInBars).toBe(1)
    expect(detail?.piece.recording).toEqual({ kind: 'file', urlOrPath: 'etude.mp3', durationSec: 20 })
  })

  it('hands the map out exactly as the run holds it', async () => {
    const { data } = setup()
    const run = sampleRun()

    const map = await data.getPieceMap('piece-a')

    expect(map?.timing).toEqual(run.timing)
    expect(map?.pages).toEqual([run.pages['part-flute'], run.pages['part-horn']])
  })

  it("gives the part's page images the server's file URLs", async () => {
    const { data } = setup()

    expect(await data.getPartPages('piece-a', 'part-horn')).toEqual([
      { pageIndex: 0, width: 200, height: 100, url: `${BASE}/runs/piece-a/files/pages/part-horn/page-0.webp` },
    ])
  })

  it('gives the peaks as 0 to 1', async () => {
    const { data } = setup()

    const peaks = await data.getPeaks('piece-a')

    expect(peaks).toHaveLength(800)
    expect(peaks?.[127]).toBe(1)
    expect(peaks?.[0]).toBe(0)
  })

  it('gives the run\'s detected beats, and null for a run made before they were kept', async () => {
    const withBeats = { ...sampleRun(), beats: [{ t: 0.5, downbeat: 0.9 }, { t: 1, downbeat: 0.1 }] }

    expect(await setup(withBeats).data.getBeats('piece-a')).toEqual([{ t: 0.5, downbeat: 0.9 }, { t: 1, downbeat: 0.1 }])
    expect(await setup().data.getBeats('piece-a')).toBeNull()
  })

  it("gives the server's audio file as the audio URL", async () => {
    const { data } = setup()

    expect(await data.getAudioUrl('piece-a')).toBe(`${BASE}/runs/piece-a/files/audio.m4a`)
    expect(await data.getAudioUrl('piece-nope')).toBeNull()
  })

  it('shows the review numbers from the flags on the locators', async () => {
    const run = sampleRun()
    run.timing.locators[2] = {
      ...run.timing.locators[2],
      flags: [{ kind: 'crowded', severity: 2, expected: 2, found: 1, factor: 0.5, explainedBy: null, uncertainLine: null }],
    }
    const { data } = setup(run)

    expect((await data.listPieces())[0].review).toEqual({ checked: 0, total: 1 })
  })

  it('shows the confirmed map when the run has one', async () => {
    const run = sampleRun()
    run.timing = moved(run.timing, 3, 5.5)
    const { data } = setup(run)

    expect((await data.getPieceMap('piece-a'))?.timing.locators[2]).toMatchObject({ timeSec: 5.5, confirmed: true })
  })

  it('rejects every call, naming the server, when it is not running', async () => {
    const clients = createLocalClients(
      createRunApi(BASE, async () => {
        throw new TypeError('Failed to fetch')
      }),
    )

    await expect(clients.data.listPieces()).rejects.toThrow(`${BASE} did not answer`)
  })

  it('tries the server again on the next call after a failure', async () => {
    let up = false
    const fake = createFakeRunServer([sampleRun()])
    const clients = createLocalClients(
      createRunApi(BASE, async (url, init) => {
        if (!up) throw new TypeError('Failed to fetch')
        return fake.fetch(url, init)
      }),
    )
    await expect(clients.data.listPieces()).rejects.toThrow('did not answer')

    up = true

    expect(await clients.data.listPieces()).toHaveLength(1)
  })

  it('stores nothing in the browser', async () => {
    const { data } = setup()
    await data.listPieces()
    await data.saveTiming('piece-a', moved(sampleRun().timing, 2, 3.5))

    expect(window.localStorage).toHaveLength(0)
    expect(window.sessionStorage).toHaveLength(0)
  })
})

describe('local mode: saving the map', () => {
  it('PUTs the whole map when the timing is saved', async () => {
    const { fake, data } = setup()
    const run = sampleRun()
    const timing = moved(run.timing, 4, 7.25)

    await data.saveTiming('piece-a', timing)

    expect(puts(fake)).toHaveLength(1)
    expect(puts(fake)[0]).toMatchObject({ path: '/runs/piece-a/map', body: { timing, pages: run.pages } })
  })

  it('PUTs the whole map when a page layer is saved, with the other parts as they were', async () => {
    const { fake, data } = setup()
    const run = sampleRun()
    const horn: PageLayer = { ...run.pages['part-horn'], bars: run.pages['part-horn'].bars.map((box) => (box.bar === 2 ? { ...box, x: 99 } : box)) }

    await data.savePageLayer('piece-a', horn)

    // structureSetAt goes with every PUT: the app holds the map as the server sent it (null: not set yet).
    expect(puts(fake)[0].body).toEqual({ timing: run.timing, pages: { 'part-flute': run.pages['part-flute'], 'part-horn': horn }, structureSetAt: null })
  })

  it('keeps the edit across a reload: a new client on the same server reads the saved map', async () => {
    const { fake, data } = setup()
    const timing = moved(sampleRun().timing, 5, 9.5)
    await data.saveTiming('piece-a', timing)

    const reloaded = createLocalClients(createRunApi(BASE, fake.fetch))

    expect((await reloaded.data.getPieceMap('piece-a'))?.timing).toEqual(timing)
  })

  it('shows a saved edit at once in the same session', async () => {
    const { data } = setup()
    const timing = moved(sampleRun().timing, 5, 9.5)

    await data.saveTiming('piece-a', timing)

    expect((await data.getPieceMap('piece-a'))?.timing).toEqual(timing)
  })

  it('rejects the save, with the sentence, when the server refuses the map', async () => {
    const { fake, data } = setup()
    fake.onPut = async () => {
      throw new Error('The map is not valid: timing.locators.3.timeSec: Input should be greater than or equal to 0.')
    }

    await expect(data.saveTiming('piece-a', moved(sampleRun().timing, 4, 7))).rejects.toThrow('timing.locators.3.timeSec')
  })

  it('rejects the save when the server is gone, and a later save gets through', async () => {
    const fake = createFakeRunServer([sampleRun()])
    let up = true
    const clients = createLocalClients(
      createRunApi(BASE, async (url, init) => {
        if (up || init?.method !== 'PUT') return fake.fetch(url, init)
        throw new TypeError('Failed to fetch')
      }),
    )
    await clients.data.listPieces()
    up = false
    await expect(clients.data.saveTiming('piece-a', moved(sampleRun().timing, 4, 7))).rejects.toThrow('did not answer')

    up = true
    await clients.data.saveTiming('piece-a', moved(sampleRun().timing, 4, 7))

    expect(fake.mapOf('piece-a').timing.locators[3].timeSec).toBe(7)
  })

  it('runs one save at a time and the latest edit wins', async () => {
    const { fake, data } = setup()
    const release: Array<() => void> = []
    fake.onPut = () => new Promise<void>((resolve) => release.push(resolve))
    const base = sampleRun().timing

    const first = data.saveTiming('piece-a', moved(base, 2, 3.1))
    await vi.waitFor(() => expect(release).toHaveLength(1))
    const second = data.saveTiming('piece-a', moved(base, 2, 3.2))
    const third = data.saveTiming('piece-a', moved(base, 2, 3.3))
    release[0]()
    await first
    await vi.waitFor(() => expect(release).toHaveLength(2))
    release[1]()
    await Promise.all([second, third])

    expect(fake.maxPutsInFlight).toBe(1)
    expect(puts(fake)).toHaveLength(2)
    expect(fake.mapOf('piece-a').timing.locators[1].timeSec).toBe(3.3)
  })

  it('does not let a failed save stop the next one', async () => {
    const { fake, data } = setup()
    fake.onPut = async () => {
      throw new Error('The map could not be saved to the run folder.')
    }
    await expect(data.saveTiming('piece-a', moved(sampleRun().timing, 2, 3.1))).rejects.toThrow()
    fake.onPut = async () => {}

    await data.saveTiming('piece-a', moved(sampleRun().timing, 2, 3.2))

    expect(fake.mapOf('piece-a').timing.locators[1].timeSec).toBe(3.2)
  })
})

describe('local mode: re-align', () => {
  const refit = (): TimingLayer => moved(sampleRun().timing, 6, 11.4)

  it("takes the server's refit timing as the result of the job and saves it to the folder, so a reload shows it", async () => {
    const run = sampleRun()
    run.canRealign = true
    const { fake, data, processor } = setup(run)
    fake.realignAnswer = refit()

    const job = await processor.realign('piece-a')

    expect(job.status).toBe('done')
    expect((await data.getPieceMap('piece-a'))?.timing).toEqual(refit())
    expect(puts(fake)).toHaveLength(1)
    expect(puts(fake)[0].body).toMatchObject({ timing: refit(), pages: run.pages })
    const reloaded = createLocalClients(createRunApi(BASE, fake.fetch))
    expect((await reloaded.data.getPieceMap('piece-a'))?.timing).toEqual(refit())
  })

  it('fails the job with the message when the refit cannot be written to the folder', async () => {
    const run = sampleRun()
    run.canRealign = true
    const { fake, processor } = setup(run)
    fake.realignAnswer = refit()
    fake.onPut = async () => {
      throw new Error('The map could not be saved to the run folder.')
    }

    const job = await processor.realign('piece-a')

    expect(job).toMatchObject({ status: 'error', error: 'The map could not be saved to the run folder.' })
  })

  it("sends the timing the editor shows, not the folder's, so a save still on its way does not matter", async () => {
    const run = sampleRun()
    run.canRealign = true
    const { fake, data, processor } = setup(run)
    fake.realignAnswer = refit()
    let release = () => {}
    fake.onPut = () => new Promise<void>((resolve) => (release = resolve)) // the PUT of this edit is still on its way
    const edited = moved(run.timing, 3, 5.4)
    const saving = data.saveTiming('piece-a', edited)
    await vi.waitFor(() => expect(puts(fake)).toHaveLength(1))

    const realigning = processor.realign('piece-a')
    await vi.waitFor(() => expect(fake.realignSent).toEqual([edited]))
    release()
    fake.onPut = async () => {}
    await Promise.all([saving, realigning])
  })

  it("fails the job with the server's sentence when it refuses", async () => {
    const run = sampleRun()
    run.canRealign = true
    const { fake, processor } = setup(run)
    fake.realignAnswer = { error: 'The play order has changed since the pipeline ran, so this run cannot re-align.' }

    const job = await processor.realign('piece-a')

    expect(job).toMatchObject({ status: 'error', error: 'The play order has changed since the pipeline ran, so this run cannot re-align.' })
  })

  it("stays on the fakes' re-align when the run has no activations, and asks the server nothing", async () => {
    const { fake, data, processor } = setup()
    await data.listPieces()

    const job = await processor.realign('piece-a')

    expect(job.status).toBe('queued')
    expect(fake.requests.some((request) => request.path.endsWith('/realign'))).toBe(false)
  })
})

describe('local mode: fill the empty bars', () => {
  const withGap = (timing: TimingLayer): TimingLayer => ({ ...timing, locators: timing.locators.filter((locator) => locator.bar !== 3) })

  it('asks the server for a fill, with the timing it is given, and hands back its answer without saving anything', async () => {
    const run = sampleRun()
    run.canRealign = true
    const { fake, data, processor } = setup(run)
    await data.listPieces()
    fake.realignAnswer = run.timing
    const gap = withGap(run.timing)

    const answer = await processor.fillEmptyBars('piece-a', gap)

    expect(answer).toEqual(run.timing)
    expect(fake.realignSent).toEqual([gap])
    expect(fake.realignModes).toEqual(['fill'])
    expect(puts(fake)).toHaveLength(0)
  })

  it('asks the server for the last bar when a ripple delete on the waveform left it without a time', async () => {
    const run = sampleRun()
    run.canRealign = true
    const { fake, data, processor } = setup(run)
    await data.listPieces()
    fake.realignAnswer = run.timing
    const lastBar = Math.max(...run.timing.locators.map((locator) => locator.bar))
    const trailing = { ...run.timing, locators: run.timing.locators.filter((locator) => locator.bar !== lastBar) }

    const answer = await processor.fillEmptyBars('piece-a', trailing)

    expect(answer).toEqual(run.timing)
    expect(fake.realignSent).toEqual([trailing])
    expect(fake.realignModes).toEqual(['fill'])
  })

  it('answers null when the server refuses, so the bars stay empty', async () => {
    const run = sampleRun()
    run.canRealign = true
    const { fake, data, processor } = setup(run)
    await data.listPieces()
    fake.realignAnswer = { error: 'Re-align failed: no valid alignment: anchors cannot be satisfied.' }

    expect(await processor.fillEmptyBars('piece-a', withGap(run.timing))).toBeNull()
  })

  it("stays on the fakes' fill when the run has no activations, and asks the server nothing", async () => {
    const { fake, data, processor } = setup()
    await data.listPieces()

    const answer = await processor.fillEmptyBars('piece-a', withGap(sampleRun().timing))

    expect(answer?.locators.some((locator) => locator.bar === 3)).toBe(true)
    expect(fake.requests.some((request) => request.path.endsWith('/realign'))).toBe(false)
  })
})

describe('local mode: the piece in the Library and the hub', () => {
  it('renames the piece on the server, and a reload reads the new title', async () => {
    const { data, fake } = setup()

    await data.renamePiece('piece-a', '  Los Banditos ')

    expect(fake.requests.filter((request) => request.method === 'PUT' && request.path === '/runs/piece-a/names')).toEqual([
      { method: 'PUT', path: '/runs/piece-a/names', body: { title: 'Los Banditos' } },
    ])
    expect((await data.getPiece('piece-a'))?.piece.title).toBe('Los Banditos')
    const reloaded = createLocalClients(createRunApi(BASE, fake.fetch)).data
    expect((await reloaded.listPieces())[0].title).toBe('Los Banditos')
  })

  it('keeps the old title and rejects with the sentence when the server refuses, or the title is empty', async () => {
    const { data, fake } = setup()
    fake.refuseNames = 'The piece title must be 1 to 200 characters.'

    await expect(data.renamePiece('piece-a', 'New')).rejects.toThrow('1 to 200')
    await expect(data.renamePiece('piece-a', '   ')).rejects.toThrow('empty')

    expect((await data.getPiece('piece-a'))?.piece.title).toBe('Synthetic Etude')
    expect(fake.requests.filter((request) => request.path.endsWith('/names'))).toHaveLength(1)
  })

  it('deletes the piece on the server, and a reload does not bring it back', async () => {
    const { data, fake } = setup()

    await data.deletePiece('piece-a')

    expect(fake.deletedPieces).toEqual(['piece-a'])
    expect(await data.listPieces()).toEqual([])
    expect(await data.getPiece('piece-a')).toBeNull()
    const reloaded = createLocalClients(createRunApi(BASE, fake.fetch)).data
    expect(await reloaded.listPieces()).toEqual([])
  })

  it('keeps the piece when the server refuses to delete it', async () => {
    const { data, fake } = setup()
    fake.refuseDeletePiece = 'This piece is still being prepared; try again when it is done.'

    await expect(data.deletePiece('piece-a')).rejects.toThrow('still being prepared')

    expect(await data.listPieces()).toHaveLength(1)
  })

  it('does not ask the server about a piece the library does not have', async () => {
    const { data, fake } = setup()

    await expect(data.deletePiece('nope')).rejects.toThrow('piece not found')
    await expect(data.renamePiece('nope', 'X')).rejects.toThrow('piece not found')

    expect(fake.deletedPieces).toEqual([])
  })
})

describe('local mode: names', () => {
  const names = (fake: FakeRunServer) => fake.requests.filter((request) => request.path === '/runs/piece-a/names')

  it('shows the recording under the name the run holds, else under its file name', async () => {
    const named = sampleRun()
    named.recordingName = 'Los Banditos band performance march 2019'

    expect((await setup(named).data.getPiece('piece-a'))?.recordingLabel).toBe('Los Banditos band performance march 2019')
    expect((await setup().data.getPiece('piece-a'))?.recordingLabel).toBe('etude.mp3')
  })

  it('renames a part on the server, and the hub and the editor show it at once', async () => {
    const { data, fake } = setup()

    await data.renamePart('piece-a', 'part-horn', '  French horn ')

    expect(names(fake)).toEqual([{ method: 'PUT', path: '/runs/piece-a/names', body: { parts: { 'part-horn': 'French horn' } } }])
    expect((await data.getPiece('piece-a'))?.parts.map((part) => part.name)).toEqual(['Flute', 'French horn'])
    expect((await data.getPieceMap('piece-a'))?.piece.parts[1].name).toBe('French horn')
  })

  it('renames the recording on the server', async () => {
    const { data, fake } = setup()

    await data.renameRecording('piece-a', 'Take 3')

    expect(names(fake)).toEqual([{ method: 'PUT', path: '/runs/piece-a/names', body: { recording: 'Take 3' } }])
    expect((await data.getPiece('piece-a'))?.recordingLabel).toBe('Take 3')
  })

  it('keeps both names across a reload: a new client on the same server reads them', async () => {
    const { data, fake } = setup()
    await data.renamePart('piece-a', 'part-flute', 'Piccolo')
    await data.renameRecording('piece-a', 'Take 3')

    const reloaded = createLocalClients(createRunApi(BASE, fake.fetch)).data
    const detail = await reloaded.getPiece('piece-a')

    expect(detail?.parts.map((part) => part.name)).toEqual(['Piccolo', 'Horn'])
    expect(detail?.recordingLabel).toBe('Take 3')
  })

  it('does not save a name that is not allowed, and sends nothing', async () => {
    const { data, fake } = setup()

    await expect(data.renamePart('piece-a', 'part-flute', '   ')).rejects.toThrow('empty')
    await expect(data.renameRecording('piece-a', 'r'.repeat(121))).rejects.toThrow('too long')

    expect(names(fake)).toEqual([])
    expect((await data.getPiece('piece-a'))?.parts[0].name).toBe('Flute')
  })

  it('keeps the old name and rejects with the sentence when the server refuses', async () => {
    const { data, fake } = setup()
    fake.refuseNames = 'A part name must be 1 to 80 characters.'

    await expect(data.renamePart('piece-a', 'part-flute', 'Piccolo')).rejects.toThrow('A part name must be 1 to 80 characters.')

    expect((await data.getPiece('piece-a'))?.parts[0].name).toBe('Flute')
  })

  it('keeps the old name when the server is gone', async () => {
    const fake = createFakeRunServer([sampleRun()])
    let down = false
    const data = createLocalClients(createRunApi(BASE, (url, init) => (down ? Promise.reject(new Error('down')) : fake.fetch(url, init)))).data
    await data.getPiece('piece-a')

    down = true
    await expect(data.renamePart('piece-a', 'part-flute', 'Piccolo')).rejects.toThrow('did not answer')
    down = false

    expect((await data.getPiece('piece-a'))?.parts[0].name).toBe('Flute')
  })
})
