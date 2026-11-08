import { type DemoBundle } from '@/lib/demo/demoBundle'
import { createDemoClients, demoBaseUrl } from '@/lib/demo/demoClients'
import { DEFAULT_PRACTICE_MEMORY } from '@/domain/types'
import { DEFAULT_SETTINGS } from '@/lib/dataClient'

const BASE = '/demo/synthetic'

function bundle(): DemoBundle {
  return {
    version: 1,
    piece: { id: 'demo', title: 'Demo Etude', createdAt: '2026-11-06T09:00:00.000Z', countInBars: 1, durationSec: 20 },
    audio: 'audio.m4a',
    peaks: [0, 0.5, 1],
    parts: [{ id: 'part-1', name: 'Piano', position: 0, pageCount: 2 }],
    pageImages: {
      'part-1': [
        { pageIndex: 0, width: 1240, height: 1754, file: 'pages/part-1/page-0.webp' },
        { pageIndex: 1, width: 1240, height: 1754, file: 'pages/part-1/page-1.webp' },
      ],
    },
    timing: {
      barCount: 2,
      playOrder: [{ from: 1, to: 2 }],
      meters: [{ fromBar: 1, numerator: 4, denominator: 4 }],
      marks: [],
      locators: [
        { bar: 1, passIndex: 0, timeSec: 1, confirmed: false },
        { bar: 2, passIndex: 0, timeSec: 3, confirmed: false },
      ],
    },
    pages: { 'part-1': { partId: 'part-1', bars: [{ bar: 1, pageIndex: 0, x: 10, y: 10, w: 100, h: 50 }, { bar: 2, pageIndex: 0, x: 110, y: 10, w: 100, h: 50 }], rests: [] } },
  }
}

/** A fetch that serves the bundle and records every call, so a test can see what was asked of the network. */
function server(body: unknown = bundle(), status = 200) {
  const calls: Array<{ url: string; method: string }> = []
  const fetchFn = async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? 'GET' })
    return new Response(JSON.stringify(body), { status })
  }
  return { calls, fetchFn }
}

function make(body?: unknown, status?: number) {
  const { calls, fetchFn } = server(body, status)
  return { calls, ...createDemoClients({ baseUrl: BASE, fetchFn }) }
}

describe('demo clients: what they read', () => {
  it('reads the piece, its parts and the map from the bundle', async () => {
    const { data } = make()

    const detail = await data.getPiece('demo')
    const map = await data.getPieceMap('demo')

    expect(detail?.piece.title).toBe('Demo Etude')
    expect(detail?.parts).toEqual([{ id: 'part-1', name: 'Piano', position: 0, pageCount: 2, review: { checked: 0, total: 0 } }])
    expect(map?.timing.barCount).toBe(2)
    expect(map?.pages.map((page) => page.partId)).toEqual(['part-1'])
  })

  it('is a viewer, so the screen offers no editing, and the piece is not being prepared', async () => {
    const { data } = make()

    const detail = await data.getPiece('demo')

    expect(detail?.piece.role).toBe('viewer')
    expect(detail?.job).toBeNull()
  })

  it('serves the page images, the audio and the peaks from the bundle folder', async () => {
    const { data } = make()

    expect(await data.getPartPages('demo', 'part-1')).toEqual([
      { pageIndex: 0, width: 1240, height: 1754, url: `${BASE}/pages/part-1/page-0.webp` },
      { pageIndex: 1, width: 1240, height: 1754, url: `${BASE}/pages/part-1/page-1.webp` },
    ])
    expect(await data.getAudioUrl('demo')).toBe(`${BASE}/audio.m4a`)
    expect(await data.getPeaks('demo')).toEqual([0, 0.5, 1])
  })

  it('knows no other piece', async () => {
    const { data } = make()

    expect(await data.getPiece('someone-elses')).toBeNull()
    expect(await data.getPieceMap('someone-elses')).toBeNull()
    expect(await data.getAudioUrl('someone-elses')).toBeNull()
  })

  it('gives a signed-in demo visitor with the default settings and no terms to accept', async () => {
    const { data } = make()

    const profile = await data.getProfile()

    expect(profile.settings).toEqual(DEFAULT_SETTINGS)
    expect(profile.isAdmin).toBe(false)
    expect(await data.getUser()).not.toBeNull()
  })

  it('puts the demo visitor on Trial with nothing used', async () => {
    const { data } = make()

    const state = await data.myPlan()

    expect(state).toMatchObject({ is_admin: false, plan: { id: 'trial', pieces_created_max: 3 }, usage: { pieces_created: 0, pieces_stored: 0 }, piece: null })
  })

  it('reads the bundle once however many calls ask for it', async () => {
    const { data, calls } = make()

    await Promise.all([data.getPiece('demo'), data.getPieceMap('demo'), data.getPeaks('demo'), data.getAudioUrl('demo')])

    expect(calls).toEqual([{ url: `${BASE}/demo.json`, method: 'GET' }])
  })

  it('rejects when the bundle is not there, and tries again on the next call', async () => {
    let answer: Response = new Response('<html>not found</html>', { status: 404 })
    const fetchFn = async () => answer
    const { data } = createDemoClients({ baseUrl: BASE, fetchFn })

    await expect(data.getPiece('demo')).rejects.toThrow()

    answer = new Response(JSON.stringify(bundle()), { status: 200 })
    expect((await data.getPiece('demo'))?.piece.title).toBe('Demo Etude')
  })

  it('rejects a file that is not a bundle (the server answers 200 with a page for an unknown address)', async () => {
    const fetchFn = async () => new Response('<!doctype html><html></html>', { status: 200 })
    const { data } = createDemoClients({ baseUrl: BASE, fetchFn })

    await expect(data.getPiece('demo')).rejects.toThrow()
  })

  it('rejects a bundle that lacks its map', async () => {
    const { data } = make({ ...bundle(), timing: undefined })

    await expect(data.getPieceMap('demo')).rejects.toThrow()
  })
})

describe('demo clients: credits', () => {
  const credit = { what: 'Recording', who: 'A Pianist', licence: 'CC BY 3.0', source: 'https://example.org/file' }
  const clientsWith = (raw: unknown) => createDemoClients({ baseUrl: BASE, fetchFn: async () => new Response(JSON.stringify(raw), { status: 200 }) })

  it('reads the credits of the bundle', async () => {
    await expect(clientsWith({ ...bundle(), credits: [credit] }).credits()).resolves.toEqual([credit])
  })

  it('has none when the bundle has none', async () => {
    await expect(clientsWith(bundle()).credits()).resolves.toEqual([])
  })

  it.each([
    ['no licence', { what: 'Recording', who: 'A Pianist', source: 'https://example.org/file' }],
    ['no name', { what: 'Recording', licence: 'CC BY 3.0', source: 'https://example.org/file' }],
    ['a source that is not https', { ...credit, source: 'javascript:alert(1)' }],
    ['a licence link that is not https', { ...credit, licenceUrl: 'http://example.org/licence' }],
    ['a title that is not text', { ...credit, title: 7 }],
  ])('refuses a bundle whose credit has %s, rather than show the music without it', async (_name, bad) => {
    await expect(clientsWith({ ...bundle(), credits: [bad] }).data.getPiece('demo')).rejects.toThrow('credit')
  })
})

describe('demoBaseUrl', () => {
  it('serves the Gondola Song when nothing else is asked for', () => {
    expect(demoBaseUrl({ BASE_URL: '/' })).toBe('/demo/gondola-song')
  })

  it('serves the bundle named at build time', () => {
    expect(demoBaseUrl({ BASE_URL: '/', VITE_DEMO_BUNDLE: 'synthetic' })).toBe('/demo/synthetic')
  })

  it('ignores a name that is not a plain folder name', () => {
    expect(demoBaseUrl({ BASE_URL: '/', VITE_DEMO_BUNDLE: '../secrets' })).toBe('/demo/gondola-song')
  })
})

describe('demo clients: nothing is written', () => {
  it('lets the screen save its settings, its memory and its part without anything changing or being sent', async () => {
    const { data, calls } = make()
    const before = [await data.getProfile(), await data.getPiece('demo'), await data.getPieceMap('demo')]
    const callsBefore = calls.length

    const settings = { ...DEFAULT_SETTINGS, nightScore: true, loop: { colour: 'amber' as const, show: false } }
    const saved = await data.saveSettings(settings)
    await data.savePracticeMemory('demo', { ...DEFAULT_PRACTICE_MEMORY, speed: 0.5 })
    await data.setLastPart('demo', 'part-1')
    await data.setCountInBars('demo', 2)

    // The returned profile carries the change, so the screen keeps it for the visit; the client itself holds none of it.
    expect(saved.settings.nightScore).toBe(true)
    expect([await data.getProfile(), await data.getPiece('demo'), await data.getPieceMap('demo')]).toEqual(before)
    expect(calls).toHaveLength(callsBefore)
  })

  it('refuses every other write', async () => {
    const { data } = make()

    const writes: Array<Promise<unknown>> = [
      data.acceptTerms(),
      data.createPiece({ title: 'x', recording: { kind: 'file', file: new File(['x'], 'x.mp3') }, parts: [] }),
      data.storeParts('demo', []),
      data.renamePiece('demo', 'x'),
      data.renamePart('demo', 'part-1', 'x'),
      data.renameRecording('demo', 'x'),
      data.deletePiece('demo'),
      data.deleteAccount(),
      data.deletePart('demo', 'part-1'),
      data.saveTiming('demo', bundle().timing),
      data.savePageLayer('demo', bundle().pages['part-1']),
      data.saveStructureSetAt('demo', null),
      data.getShare('demo'),
      data.setShareEnabled('demo', true),
      data.resetShareLink('demo'),
      data.removeMember('demo', 'x'),
      data.joinPiece('x'),
      data.leavePiece('demo'),
      data.adminOverview(),
      data.saveAdminChanges({ plans: [], people: [] }),
      data.getMemberLimit('demo'),
      data.listHeldPieces(),
      data.signInWithGoogle(),
      data.signOut(),
    ]

    for (const write of writes) await expect(write).rejects.toThrow('read only')
  })

  it('has no sample piece to give: the visitor is told they were already given one', async () => {
    const { processor, data } = make()

    expect(await processor.claimSamplePiece()).toEqual({ status: 'already' })
    expect((await data.getProfile()).sampleGivenAt).toBeNull()
    expect((await data.getPiece('demo'))?.sampleCredits).toBeNull()
  })

  it('has no processor to talk to', async () => {
    const { processor } = make()

    await expect(processor.processPiece('demo')).rejects.toThrow('read only')
  })

  it('only ever asks the network for the bundle with a GET', async () => {
    const { data, calls } = make()

    await data.getPiece('demo')
    await data.saveSettings(DEFAULT_SETTINGS)
    await data.savePracticeMemory('demo', DEFAULT_PRACTICE_MEMORY)

    expect(calls.every((call) => call.method === 'GET')).toBe(true)
  })
})
