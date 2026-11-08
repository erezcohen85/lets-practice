import { createRunApi } from '@/lib/localRun/runApi'

function answering(status: number, body: unknown) {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const fetchFn = async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    return new Response(JSON.stringify(body), { status })
  }
  return { calls, fetchFn }
}

describe('createRunApi: deleting a part and suggesting a name', () => {
  it('sends DELETE for the part under the run, encoding both ids', async () => {
    const { calls, fetchFn } = answering(200, { parts: [] })

    await createRunApi('http://x', fetchFn).deletePart('piece a', 'part/1')

    expect(calls[0].url).toBe('http://x/runs/piece%20a/parts/part%2F1')
    expect(calls[0].init?.method).toBe('DELETE')
  })

  it('rejects with the server’s sentence when the delete is refused', async () => {
    const { fetchFn } = answering(400, { detail: 'A piece needs at least one part. Delete the piece instead.' })

    await expect(createRunApi('http://x', fetchFn).deletePart('piece-a', 'part-1')).rejects.toThrow('Delete the piece instead')
  })

  it('POSTs to the run’s suggest-name and gives back the suggestion', async () => {
    const suggestion = { name: 'Etude', source: 'claude', note: null }
    const { calls, fetchFn } = answering(200, suggestion)

    expect(await createRunApi('http://x', fetchFn).suggestName('piece-a')).toEqual(suggestion)

    expect(calls[0].url).toBe('http://x/runs/piece-a/suggest-name')
    expect(calls[0].init?.method).toBe('POST')
  })

  it('POSTs a form for a piece not yet uploaded: no recording file goes, only its name', async () => {
    const { calls, fetchFn } = answering(200, { name: '', source: 'fallback', note: 'x' })

    await createRunApi('http://x', fetchFn).suggestNewName({
      recording: { kind: 'file', file: new File(['audio'], 'take3.mp3') },
      firstPart: new File(['%PDF'], 'flute.pdf'),
    })

    expect(calls[0].url).toBe('http://x/suggest-name')
    const form = calls[0].init?.body as FormData
    expect(form.get('recordingName')).toBe('take3.mp3')
    expect((form.get('part') as File).name).toBe('flute.pdf')
    expect(form.get('recording')).toBeNull()
  })
})
