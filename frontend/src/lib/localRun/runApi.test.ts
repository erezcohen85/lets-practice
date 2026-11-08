import { createRunApi } from '@/lib/localRun/runApi'

function answering(status: number, body: unknown) {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const fetchFn = async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })
  }
  return { calls, fetchFn }
}

describe('createRunApi', () => {
  it('builds file URLs under the run, leaving a trailing slash off the base and encoding each segment', () => {
    const api = createRunApi('http://127.0.0.1:8765/', async () => new Response('{}'))

    expect(api.fileUrl('piece a', 'pages/part-1/page 0.webp')).toBe(
      'http://127.0.0.1:8765/runs/piece%20a/files/pages/part-1/page%200.webp',
    )
  })

  it('reads a run whose rests are still marks of the timing with the rests on every part', async () => {
    const old = {
      piece: { id: 'piece-a' },
      timing: { barCount: 8, playOrder: [], meters: [], marks: [{ bar: 3, kind: 'rest' }, { bar: 5, kind: 'fermata' }], locators: [] },
      pages: { 'part-1': { partId: 'part-1', bars: [] }, 'part-2': { partId: 'part-2', bars: [], rests: [1] } },
      parts: [],
    }
    const { fetchFn } = answering(200, old)

    const run = await createRunApi('http://x', fetchFn).getRun('piece-a')

    expect(run.timing.marks).toEqual([{ bar: 5, kind: 'fermata' }])
    expect(run.pages['part-1'].rests).toEqual([3])
    expect(run.pages['part-2'].rests).toEqual([1, 3])
    expect(run.piece.id).toBe('piece-a')
  })

  it('PUTs the map as JSON to the run', async () => {
    const { calls, fetchFn } = answering(200, { savedAt: 'now' })
    const map = { timing: { barCount: 0, playOrder: [], meters: [], marks: [], locators: [] }, pages: {} }

    await createRunApi('http://x', fetchFn).putMap('piece-a', map)

    expect(calls[0].url).toBe('http://x/runs/piece-a/map')
    expect(calls[0].init?.method).toBe('PUT')
    expect(JSON.parse(String(calls[0].init?.body))).toEqual(map)
  })

  it('PUTs the names of parts and of the recording as JSON to the run', async () => {
    const { calls, fetchFn } = answering(200, { parts: {}, recording: null })

    await createRunApi('http://x', fetchFn).putNames('piece-a', { parts: { 'part-1': 'Flute 1' }, recording: 'Take 3' })

    expect(calls[0].url).toBe('http://x/runs/piece-a/names')
    expect(calls[0].init?.method).toBe('PUT')
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ parts: { 'part-1': 'Flute 1' }, recording: 'Take 3' })
  })

  it('PUTs the title of the piece with the names', async () => {
    const { calls, fetchFn } = answering(200, { parts: {}, recording: null, title: 'Los Banditos' })

    await createRunApi('http://x', fetchFn).putNames('piece-a', { title: 'Los Banditos' })

    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ title: 'Los Banditos' })
  })

  it('DELETEs a piece at its run, and rejects with the server’s sentence when it refuses', async () => {
    const ok = answering(200, { movedTo: '.deleted/piece-a-1' })
    await createRunApi('http://x', ok.fetchFn).deletePiece('piece-a')
    expect(ok.calls[0].url).toBe('http://x/runs/piece-a')
    expect(ok.calls[0].init?.method).toBe('DELETE')

    const refused = answering(409, { detail: 'This piece is still being prepared; try again when it is done.' })
    await expect(createRunApi('http://x', refused.fetchFn).deletePiece('piece-a')).rejects.toThrow('still being prepared')
  })

  it('rejects a refused rename with the server’s sentence', async () => {
    const { fetchFn } = answering(400, { detail: 'A part name must be 1 to 80 characters.' })

    await expect(createRunApi('http://x', fetchFn).putNames('piece-a', { parts: { 'part-1': '' } })).rejects.toThrow('A part name must be 1 to 80 characters.')
  })

  it('POSTs the timing to re-align in the body', async () => {
    const { calls, fetchFn } = answering(200, { barCount: 0 })
    const timing = { barCount: 0, playOrder: [], meters: [], marks: [], locators: [] }

    await createRunApi('http://x', fetchFn).realign('piece-a', timing)

    expect(calls[0].url).toBe('http://x/runs/piece-a/realign')
    expect(calls[0].init?.method).toBe('POST')
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ timing })
  })

  it("rejects with the server's sentence when it refuses", async () => {
    const { fetchFn } = answering(400, { detail: 'The map is not valid: timing.barCount: nope.' })

    await expect(createRunApi('http://x', fetchFn).realign('piece-a', { barCount: 0, playOrder: [], meters: [], marks: [], locators: [] })).rejects.toThrow('The map is not valid: timing.barCount: nope.')
  })

  it('rejects with the status when the answer has no sentence', async () => {
    const { fetchFn } = answering(500, 'oops')

    await expect(createRunApi('http://x', fetchFn).listRuns()).rejects.toThrow('answered 500')
  })

  it('says where it looked when the server does not answer', async () => {
    const api = createRunApi('http://127.0.0.1:8765', async () => {
      throw new TypeError('Failed to fetch')
    })

    await expect(api.listRuns()).rejects.toThrow('http://127.0.0.1:8765 did not answer')
  })
})
