import { describe, expect, it, vi } from 'vitest'
import { SPLIT_EXPIRED } from '@/domain/splitEdits'
import { PlanLimitError, retryJob, SampleFailedError, SentenceError, sentenceOf } from '@/lib/processorClient'
import { createHttpProcessorClient } from '@/lib/supabase/httpProcessor'
import { strings } from '@/strings'

const PIECE = '00000000-0000-4000-8000-0000000000f1'
const TIMING = { barCount: 1, playOrder: [], meters: [], marks: [], locators: [] }
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const STAGED = '11111111-1111-4111-8111-111111111111'

function client(fetchFn: typeof fetch, token: string | null = 'jwt') {
  const storeParts = vi.fn(async () => [])
  const stage = vi.fn<(file: File) => Promise<string>>(async () => STAGED)
  return { storeParts, stage, processor: createHttpProcessorClient({ baseUrl: 'https://p.example/', token: async () => token, data: { storeParts }, stage, fetchFn }) }
}

describe('the job routes', () => {
  it.each([
    ['processPiece', 'process-piece'],
    ['realign', 'realign'],
  ] as const)('%s posts with the bearer token and gives a queued job', async (method, kind) => {
    const fetchFn = vi.fn(async () => reply(200, { job_id: 'j', status: 'queued' }))
    const job = await client(fetchFn as unknown as typeof fetch).processor[method](PIECE)
    expect(job).toEqual({ id: 'j', pieceId: PIECE, kind, status: 'queued', progress: 0, error: null })
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`https://p.example/jobs/${kind}`)
    expect(init.method).toBe('POST')
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer jwt')
    expect(JSON.parse(init.body as string)).toEqual({ piece_id: PIECE })
  })

  it('keeps the token out of the address and the body', async () => {
    const fetchFn = vi.fn(async () => reply(200, { job_id: 'j', status: 'queued' }))
    await client(fetchFn as unknown as typeof fetch, 'secret-jwt').processor.realign(PIECE)
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).not.toContain('secret-jwt')
    expect(init.body).not.toContain('secret-jwt')
  })

  it('stores new files through the data client before add-parts', async () => {
    const fetchFn = vi.fn(async () => reply(200, { job_id: 'j', status: 'queued' }))
    const { processor, storeParts } = client(fetchFn as unknown as typeof fetch)
    const parts = [{ file: new File(['x'], 'a.pdf'), name: '' }]
    const job = await processor.addParts(PIECE, parts)
    expect(job.kind).toBe('add-parts')
    expect((fetchFn.mock.calls[0] as unknown as [string])[0]).toBe('https://p.example/jobs/add-parts')
    expect(storeParts).toHaveBeenCalledWith(PIECE, parts)
    await processor.addParts(PIECE, [])
    expect(storeParts).toHaveBeenCalledTimes(1)
  })

  it('rejects without a session, sending nothing', async () => {
    const fetchFn = vi.fn()
    await expect(client(fetchFn as unknown as typeof fetch, null).processor.realign(PIECE)).rejects.toThrow('not signed in')
    expect(fetchFn).not.toHaveBeenCalled()
  })
})

describe('refusals are sentences a user can read', () => {
  it('a 403 plan refusal is a PlanLimitError naming the limit', async () => {
    const fetchFn = vi.fn(async () => reply(403, { detail: { code: 'plan_limit', limit: 'pages_per_part_max' } }))
    const error = await client(fetchFn as unknown as typeof fetch).processor.processPiece(PIECE).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(PlanLimitError)
    expect((error as PlanLimitError).limit).toBe('pages_per_part_max')
  })

  it('a 403 that names no known limit is a plain failure, not a made-up prompt', async () => {
    for (const detail of [{ code: 'plan_limit', limit: 'no_such_limit' }, { code: 'other', limit: 'advanced_reading' }, 'uploads are limited']) {
      const fetchFn = vi.fn(async () => reply(403, { detail }))
      const error = await client(fetchFn as unknown as typeof fetch).processor.realign(PIECE).catch((caught: unknown) => caught)
      expect(error).not.toBeInstanceOf(PlanLimitError)
      expect(sentenceOf(error)).toBeNull()
    }
  })

  it('a busy piece says so', async () => {
    const fetchFn = vi.fn(async () => reply(409, { detail: strings.realServices.stillPreparing }))
    const error = await client(fetchFn as unknown as typeof fetch).processor.realign(PIECE).catch((caught: unknown) => caught)
    expect(sentenceOf(error)).toBe(strings.realServices.stillPreparing)
  })

  it('a refused token is a sentence that is true whether the session ended or the server cannot check it', async () => {
    const fetchFn = vi.fn(async () => reply(401, { detail: 'invalid token' }))
    const error = await client(fetchFn as unknown as typeof fetch).processor.realign(PIECE).catch((caught: unknown) => caught)
    expect(sentenceOf(error)).toBe(strings.realServices.notAccepted)
  })

  it('a job the worker would not take says so', async () => {
    const fetchFn = vi.fn(async () => reply(503, { detail: 'The server could not start this job right now. Try again in a moment.' }))
    const error = await client(fetchFn as unknown as typeof fetch).processor.processPiece(PIECE).catch((caught: unknown) => caught)
    expect(sentenceOf(error)).toBe(strings.realServices.cannotStart)
  })

  it('anything else is a plain failure, and its body is not shown', async () => {
    const fetchFn = vi.fn(async () => reply(500, { detail: 'private' }))
    const error = await client(fetchFn as unknown as typeof fetch).processor.realign(PIECE).catch((caught: unknown) => caught)
    expect(sentenceOf(error)).toBeNull()
    expect((error as Error).message).not.toContain('private')
  })

  it('a refusal that is not JSON is a plain failure too', async () => {
    const fetchFn = vi.fn(async () => new Response('<html>bad gateway</html>', { status: 502 }))
    const error = await client(fetchFn as unknown as typeof fetch).processor.realign(PIECE).catch((caught: unknown) => caught)
    expect(sentenceOf(error)).toBeNull()
    expect((error as Error).message).not.toContain('html')
  })
})

describe('Try again on a failed job', () => {
  const job = (kind: 'process-piece' | 'realign' | 'add-parts') => ({ id: 'j0', pieceId: PIECE, kind, status: 'error' as const, progress: 0.3, error: 'x' })

  it.each([
    ['realign', '/jobs/realign'],
    ['add-parts', '/jobs/add-parts'],
    ['process-piece', '/jobs/process-piece'],
  ] as const)('starts a %s job again, never another kind', async (kind, route) => {
    const fetchFn = vi.fn(async () => reply(200, { job_id: 'j', status: 'queued' }))
    await retryJob(client(fetchFn as unknown as typeof fetch).processor, job(kind))
    expect((fetchFn.mock.calls[0] as unknown as [string])[0]).toBe(`https://p.example${route}`)
  })
})

describe('fill empty bars', () => {
  it('answers the filled timing', async () => {
    const fetchFn = vi.fn(async () => reply(200, TIMING))
    expect(await client(fetchFn as unknown as typeof fetch).processor.fillEmptyBars(PIECE, TIMING)).toEqual(TIMING)
    expect((fetchFn.mock.calls[0] as unknown as [string])[0]).toBe(`https://p.example/pieces/${PIECE}/fill`)
  })

  it('answers null when it cannot, so the bars stay empty, whatever the cause', async () => {
    const refused = vi.fn(async () => reply(422, { detail: 'no' }))
    expect(await client(refused as unknown as typeof fetch).processor.fillEmptyBars(PIECE, TIMING)).toBeNull()
    const offline = vi.fn(async () => {
      throw new TypeError('network')
    })
    expect(await client(offline as unknown as typeof fetch).processor.fillEmptyBars(PIECE, TIMING)).toBeNull()
  })
})

describe('what the real processor does not do yet', () => {
  const { processor } = client(vi.fn() as unknown as typeof fetch)

  it('reads no part name: the file name stands until the job reads one', async () => {
    expect(await processor.readPartName(new File(['x'], 'a.pdf'))).toBeNull()
  })

  it('refuses to read a part again, in a sentence, should a screen still reach it', async () => {
    expect(sentenceOf(await processor.reprocessPart(PIECE, 'p', { boxCheck: false }).catch((caught: unknown) => caught))).toBe(strings.realServices.reprocessOff)
  })
})

describe('proposing a split', () => {
  const PROPOSAL = { splitId: STAGED, pageCount: 6, fullScore: false, parts: [], pages: [], note: null }

  it('stages the PDF in Storage and tells the processor only its id: the PDF is never sent to it', async () => {
    const fetchFn = vi.fn(async () => reply(200, PROPOSAL))
    const { processor, stage } = client(fetchFn as unknown as typeof fetch)
    const pdf = new File(['x'], 'Band.pdf')

    expect(await processor.proposeSplit(pdf)).toEqual(PROPOSAL)

    expect(stage).toHaveBeenCalledWith(pdf)
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`https://p.example/splits/${STAGED}/propose`)
    expect(init.method).toBe('POST')
    expect(init.body).toBeUndefined()
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer jwt')
  })

  it('says a PDF it cannot read in the processor\'s own sentence', async () => {
    const fetchFn = vi.fn(async () => reply(400, { detail: 'This PDF has more than 120 pages.' }))
    const error = await client(fetchFn as unknown as typeof fetch).processor.proposeSplit(new File(['x'], 'a.pdf')).catch((caught: unknown) => caught)
    expect(sentenceOf(error)).toBe('This PDF has more than 120 pages.')
  })

  it('sends the user back to choose the PDF when it has gone', async () => {
    const fetchFn = vi.fn(async () => reply(410, { detail: SPLIT_EXPIRED }))
    const error = await client(fetchFn as unknown as typeof fetch).processor.proposeSplit(new File(['x'], 'a.pdf')).catch((caught: unknown) => caught)
    expect(sentenceOf(error)).toBe(SPLIT_EXPIRED)
  })

  it('names the limit when the plan has no split PDF', async () => {
    const fetchFn = vi.fn(async () => reply(403, { detail: { code: 'plan_limit', limit: 'split_pdf' } }))
    const error = await client(fetchFn as unknown as typeof fetch).processor.proposeSplit(new File(['x'], 'a.pdf')).catch((caught: unknown) => caught)
    expect((error as PlanLimitError).limit).toBe('split_pdf')
  })

  it('sends nothing when the PDF cannot be staged', async () => {
    const fetchFn = vi.fn()
    const { processor, stage } = client(fetchFn as unknown as typeof fetch)
    stage.mockRejectedValueOnce(new SentenceError('big.pdf is larger than 50 MB.'))
    const error = await processor.proposeSplit(new File(['x'], 'big.pdf')).catch((caught: unknown) => caught)
    expect(sentenceOf(error)).toBe('big.pdf is larger than 50 MB.')
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('a plain failure of the processor does not show its body', async () => {
    const fetchFn = vi.fn(async () => reply(500, { detail: 'private' }))
    const error = await client(fetchFn as unknown as typeof fetch).processor.proposeSplit(new File(['x'], 'a.pdf')).catch((caught: unknown) => caught)
    expect(sentenceOf(error)).toBeNull()
    expect((error as Error).message).not.toContain('private')
  })
})

describe('suggesting a name', () => {
  const SUGGESTION = { name: 'Carnival (Saint-Saëns)', source: 'claude', note: null }

  it('asks for a piece by its id', async () => {
    const fetchFn = vi.fn(async () => reply(200, SUGGESTION))
    expect(await client(fetchFn as unknown as typeof fetch).processor.suggestPieceName(PIECE)).toEqual(SUGGESTION)
    expect((fetchFn.mock.calls[0] as unknown as [string])[0]).toBe(`https://p.example/pieces/${PIECE}/suggest-name`)
  })

  it('asks for a form with the recording file\'s name and the staged first PDF', async () => {
    const fetchFn = vi.fn(async () => reply(200, SUGGESTION))
    const { processor, stage } = client(fetchFn as unknown as typeof fetch)
    const first = new File(['x'], 'Flute.pdf')

    expect(await processor.suggestNewPieceName({ recording: { kind: 'file', file: new File(['a'], 'take.mp3') }, firstPart: first })).toEqual(SUGGESTION)

    expect(stage).toHaveBeenCalledWith(first)
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://p.example/suggest-name')
    expect(JSON.parse(init.body as string)).toEqual({ recording_name: 'take.mp3', staged_id: STAGED })
  })

  it('goes on with the file name alone when the first PDF cannot be staged', async () => {
    const fetchFn = vi.fn(async () => reply(200, SUGGESTION))
    const { processor, stage } = client(fetchFn as unknown as typeof fetch)
    stage.mockRejectedValueOnce(new Error('too large'))

    await processor.suggestNewPieceName({ recording: { kind: 'file', file: new File(['a'], 'take.mp3') }, firstPart: new File(['x'], 'big.pdf') })

    const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toEqual({ recording_name: 'take.mp3', staged_id: null })
  })

  it('stages nothing when there is no first PDF', async () => {
    const fetchFn = vi.fn(async () => reply(200, SUGGESTION))
    const { processor, stage } = client(fetchFn as unknown as typeof fetch)
    await processor.suggestNewPieceName({ recording: null, firstPart: null })
    expect(stage).not.toHaveBeenCalled()
    const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toEqual({ recording_name: null, staged_id: null })
  })

  it('names the limit when the plan has no Suggest a name', async () => {
    const fetchFn = vi.fn(async () => reply(403, { detail: { code: 'plan_limit', limit: 'suggest_name' } }))
    const error = await client(fetchFn as unknown as typeof fetch).processor.suggestPieceName(PIECE).catch((caught: unknown) => caught)
    expect((error as PlanLimitError).limit).toBe('suggest_name')
  })
})

describe('the sample piece', () => {
  it('posts to /sample-piece with the bearer token and no body', async () => {
    const fetchFn = vi.fn(async () => reply(200, { status: 'already', piece_id: null }))
    await client(fetchFn as unknown as typeof fetch).processor.claimSamplePiece()
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://p.example/sample-piece')
    expect(init.method).toBe('POST')
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer jwt')
    expect(init.body).toBeUndefined()
  })

  it.each([
    [{ status: 'given', piece_id: 'p-1' }, { status: 'given', pieceId: 'p-1' }],
    [{ status: 'skipped', piece_id: null }, { status: 'skipped' }],
    [{ status: 'already', piece_id: null }, { status: 'already' }],
  ])('maps %j to %j', async (body, claim) => {
    const fetchFn = vi.fn(async () => reply(200, body))
    expect(await client(fetchFn as unknown as typeof fetch).processor.claimSamplePiece()).toEqual(claim)
  })

  it('a 200 that is no known claim is a plain failure', async () => {
    for (const body of [{ status: 'given', piece_id: null }, { status: 'later', piece_id: null }, 'nope']) {
      const fetchFn = vi.fn(async () => reply(200, body))
      await expect(client(fetchFn as unknown as typeof fetch).processor.claimSamplePiece()).rejects.toThrow()
    }
  })

  it('a 503 sample_failed is a SampleFailedError, whose message holds no body', async () => {
    const fetchFn = vi.fn(async () => reply(503, { detail: { code: 'sample_failed' } }))
    const error = await client(fetchFn as unknown as typeof fetch).processor.claimSamplePiece().catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(SampleFailedError)
    expect(sentenceOf(error)).toBeNull()
  })

  it('any other 503 stays the sentence it is for the job routes, and a 500 a plain failure', async () => {
    const busy = vi.fn(async () => reply(503, { detail: 'busy' }))
    const error = await client(busy as unknown as typeof fetch).processor.claimSamplePiece().catch((caught: unknown) => caught)
    expect(error).not.toBeInstanceOf(SampleFailedError)
    expect(sentenceOf(error)).toBe(strings.realServices.cannotStart)
    const broken = vi.fn(async () => reply(500, { detail: 'private' }))
    const plain = await client(broken as unknown as typeof fetch).processor.claimSamplePiece().catch((caught: unknown) => caught)
    expect((plain as Error).message).not.toContain('private')
  })

  it('rejects without a session, sending nothing', async () => {
    const fetchFn = vi.fn()
    await expect(client(fetchFn as unknown as typeof fetch, null).processor.claimSamplePiece()).rejects.toThrow('not signed in')
    expect(fetchFn).not.toHaveBeenCalled()
  })
})
