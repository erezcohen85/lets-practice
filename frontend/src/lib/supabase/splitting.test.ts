import { describe, expect, it, vi } from 'vitest'
import { PlanLimitError, sentenceOf, SentenceError } from '@/lib/processorClient'
import { type SupabasePort } from '@/lib/supabase/port'
import { createProcessorHttp } from '@/lib/supabase/processorHttp'
import { createCutSplit, createStaging } from '@/lib/supabase/splitting'

const USER = '00000000-0000-4000-8000-0000000000a1'
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

function staging(error: { message: string } | null = null, check: (file: File) => void = () => undefined) {
  const upload = vi.fn<(path: string, body: Blob, options: { contentType: string }) => Promise<{ error: { message: string } | null }>>(async () => ({ error }))
  const port = { storage: { from: () => ({ upload }) } } as unknown as SupabasePort
  return { upload, stage: createStaging(port, async () => ({ id: USER, email: 'x@example.com', name: 'X' }), check).stage }
}

describe('staging a PDF', () => {
  it('puts it under the user\'s own folder with a new id, as a nameless application/pdf body', async () => {
    const { upload, stage } = staging()
    const id = await stage(new File(['%PDF'], 'Band parts ../x.pdf', { type: 'text/plain' }))

    expect(id).toMatch(/^[0-9a-f-]{36}$/)
    const [path, body, options] = upload.mock.calls[0]!
    expect(path).toBe(`${USER}/staging/${id}.pdf`)
    expect(body.type).toBe('application/pdf')
    expect('name' in body).toBe(false)
    expect(options).toEqual({ contentType: 'application/pdf' })
  })

  it('refuses a file the check refuses, before anything moves', async () => {
    const { upload, stage } = staging(null, () => {
      throw new SentenceError('big.pdf is larger than 50 MB.')
    })
    expect(sentenceOf(await stage(new File(['x'], 'big.pdf')).catch((caught: unknown) => caught))).toBe('big.pdf is larger than 50 MB.')
    expect(upload).not.toHaveBeenCalled()
  })

  it('fails when Storage refuses it', async () => {
    await expect(staging({ message: 'no room' }).stage(new File(['x'], 'a.pdf'))).rejects.toThrow('no room')
  })
})

describe('the cut route', () => {
  const http = (fetchFn: typeof fetch) => createProcessorHttp({ baseUrl: 'https://p.example', token: async () => 'jwt', fetchFn })
  const parts = [{ id: 'a', name: 'Flute', fromPage: 1, toPage: 2, skipPages: [] }]

  it('posts the piece and the kept parts to the staged split and gives back what was written', async () => {
    const fetchFn = vi.fn(async () => reply(200, { parts: [{ id: 'a', sha256: 'ff' }] }))

    expect(await createCutSplit(http(fetchFn as unknown as typeof fetch))('piece-1', 'split-1', parts)).toEqual([{ id: 'a', sha256: 'ff' }])

    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://p.example/splits/split-1/cut')
    expect(JSON.parse(init.body as string)).toEqual({ piece_id: 'piece-1', parts })
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer jwt')
  })

  it.each([
    [400, 'The pages 5 to 7 are not inside this PDF of 6 pages.', 'The pages 5 to 7 are not inside this PDF of 6 pages.'],
    [410, 'x', 'This split has expired: choose the PDF again.'],
  ])('a %s answer is a sentence', async (status, detail, sentence) => {
    const fetchFn = vi.fn(async () => reply(status, { detail }))
    const error = await createCutSplit(http(fetchFn as unknown as typeof fetch))('p', 's', parts).catch((caught: unknown) => caught)
    expect(sentenceOf(error)).toBe(sentence)
  })

  it('a 403 plan refusal names the limit', async () => {
    const fetchFn = vi.fn(async () => reply(403, { detail: { code: 'plan_limit', limit: 'split_pdf' } }))
    const error = await createCutSplit(http(fetchFn as unknown as typeof fetch))('p', 's', parts).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(PlanLimitError)
    expect((error as PlanLimitError).limit).toBe('split_pdf')
  })

  it('a 403 for a piece that is not the user\'s is a plain failure', async () => {
    const fetchFn = vi.fn(async () => reply(403, { detail: 'not your piece' }))
    const error = await createCutSplit(http(fetchFn as unknown as typeof fetch))('p', 's', parts).catch((caught: unknown) => caught)
    expect(sentenceOf(error)).toBeNull()
  })
})
