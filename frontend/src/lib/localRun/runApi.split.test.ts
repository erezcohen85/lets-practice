import { createRunApi } from '@/lib/localRun/runApi'

const PROPOSAL = {
  splitId: 'abc123',
  pageCount: 2,
  fullScore: false,
  parts: [{ name: 'Flute', fromPage: 1, toPage: 2 }],
  pages: [
    { page: 1, partName: 'Flute', printedPage: 1, fullScore: false, thumb: '/split/abc123/pages/1.png' },
    { page: 2, partName: null, printedPage: null, fullScore: false, thumb: '/split/abc123/pages/2.png' },
  ],
  costUsd: 0.0002,
  note: null,
}

function answering(status: number, body: unknown) {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const fetchFn = async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    return new Response(JSON.stringify(body), { status })
  }
  return { calls, fetchFn }
}

const pdf = (name: string) => new File(['%PDF-1.7'], name, { type: 'application/pdf' })
const split = { splitId: 'abc123', fileName: 'band.pdf', parts: [{ name: 'Flute', fromPage: 1, toPage: 2, skipPages: [] }, { name: 'Oboe', fromPage: 3, toPage: 3, skipPages: [] }] }

describe('createRunApi: one PDF with several parts', () => {
  it('POSTs the PDF as the "pdf" field of /split', async () => {
    const { calls, fetchFn } = answering(200, PROPOSAL)

    await createRunApi('http://x/', fetchFn).proposeSplit(pdf('band.pdf'))

    expect(calls[0].url).toBe('http://x/split')
    expect(calls[0].init?.method).toBe('POST')
    expect((calls[0].init?.body as FormData).get('pdf')).toBeInstanceOf(File)
  })

  it('gives the proposal back with each thumb under the server’s address', async () => {
    const { fetchFn } = answering(200, PROPOSAL)

    const proposal = await createRunApi('http://x', fetchFn).proposeSplit(pdf('band.pdf'))

    expect(proposal.splitId).toBe('abc123')
    expect(proposal.parts).toEqual(PROPOSAL.parts)
    expect(proposal.pages.map((page) => page.thumb)).toEqual(['http://x/split/abc123/pages/1.png', 'http://x/split/abc123/pages/2.png'])
  })

  it('rejects with the server’s sentence', async () => {
    const { fetchFn } = answering(400, { detail: 'This file is not a PDF.' })

    await expect(createRunApi('http://x', fetchFn).proposeSplit(pdf('band.pdf'))).rejects.toThrow('This file is not a PDF.')
  })

  it('sends a new piece’s split as splitId and the list to keep, with no part files or names', async () => {
    const { calls, fetchFn } = answering(200, { runId: 'r', jobId: 'j', parts: [] })

    await createRunApi('http://x', fetchFn).uploadPiece({
      title: 'Band piece',
      recording: { kind: 'file', file: new File(['x'], 'take.mp3', { type: 'audio/mpeg' }) },
      parts: [],
      split,
    })

    const form = calls[0].init?.body as FormData
    expect(calls[0].url).toBe('http://x/runs')
    expect(form.get('title')).toBe('Band piece')
    expect(form.get('splitId')).toBe('abc123')
    expect(JSON.parse(String(form.get('split')))).toEqual(split.parts)
    expect(form.getAll('parts')).toEqual([])
    expect(form.getAll('names')).toEqual([])
  })

  it('sends the discarded pages of a part in the list to keep', async () => {
    const { calls, fetchFn } = answering(200, { jobId: 'j', parts: [] })
    const skipping = { ...split, parts: [{ name: 'Winds', fromPage: 1, toPage: 6, skipPages: [2, 4] }] }

    await createRunApi('http://x', fetchFn).uploadParts('piece-a', [], skipping)

    const form = calls[0].init?.body as FormData
    expect(JSON.parse(String(form.get('split')))).toEqual([{ name: 'Winds', fromPage: 1, toPage: 6, skipPages: [2, 4] }])
  })

  it('sends the split of added parts to the run’s parts route', async () => {
    const { calls, fetchFn } = answering(200, { jobId: 'j', parts: [] })

    await createRunApi('http://x', fetchFn).uploadParts('piece-a', [], split)

    const form = calls[0].init?.body as FormData
    expect(calls[0].url).toBe('http://x/runs/piece-a/parts')
    expect(form.get('splitId')).toBe('abc123')
    expect(JSON.parse(String(form.get('split')))).toEqual(split.parts)
  })
})
