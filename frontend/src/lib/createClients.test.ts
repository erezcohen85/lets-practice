import { SPEED_RANGE } from '@/domain/tempo'
import { TERMS_VERSION } from '@/domain/terms'
import { createClients } from '@/lib/createClients'
import { SESSION, supabaseAuthStub } from '@/test/supabaseAuthStub'

// A stand-in for the library: no test builds a real Supabase client, so none can reach the network.
const createClientMock = vi.hoisted(() => vi.fn())
vi.mock('@supabase/supabase-js', () => ({ createClient: createClientMock }))

const SUPABASE = {
  VITE_SUPABASE_URL: 'https://project.supabase.co',
  VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
  VITE_PROCESSOR_URL: 'https://processor.example',
}

describe('createClients', () => {
  it('gives the in-memory fakes, signed out and empty, when VITE_USE_FAKES is 1', async () => {
    const clients = createClients({ VITE_USE_FAKES: '1' })

    expect(clients).not.toBeNull()
    expect(await clients?.data.getUser()).toBeNull()
  })

  it('gives a file player factory, with the speed range', () => {
    const player = createClients({ VITE_USE_FAKES: '1' })?.createPlayer?.()

    expect(player?.getRateRange()).toEqual(SPEED_RANGE)
    expect(player?.isPlaying()).toBe(false)
  })

  it('gives a click synth factory that makes no AudioContext until it is used', () => {
    const synth = createClients({ VITE_USE_FAKES: '1' })?.createClickSynth?.()

    expect(synth).toBeDefined()
    synth?.destroy()
  })

  it('seeds the demo library when VITE_FAKE_SEED is demo', async () => {
    const clients = createClients({ VITE_USE_FAKES: '1', VITE_FAKE_SEED: 'demo' })

    expect((await clients?.data.getUser())?.email).toBe('demo@example.com')
    expect(await clients?.data.listPieces()).toHaveLength(5)
  })

  it('seeds pieces the demo user has joined when VITE_FAKE_SEED is demo-shared', async () => {
    const pieces = await createClients({ VITE_USE_FAKES: '1', VITE_FAKE_SEED: 'demo-shared' })?.data.listPieces()

    expect(pieces).toHaveLength(8)
    expect(pieces?.filter((piece) => piece.role === 'viewer')).toHaveLength(3)
  })

  it('signs in as the user who is not the admin when VITE_FAKE_USER is other', async () => {
    const clients = createClients({ VITE_USE_FAKES: '1', VITE_FAKE_SEED: 'demo', VITE_FAKE_USER: 'other' })

    expect((await clients?.data.getUser())?.email).toBe('other@example.com')
    expect(await clients?.data.getProfile()).toMatchObject({ isAdmin: false, acceptedTermsVersion: TERMS_VERSION })
    expect((await clients?.data.listPieces())?.every((piece) => piece.role === 'viewer' || piece.ownerName === 'Other')).toBe(true)
    expect((await clients?.data.listPieces())?.length).toBeGreaterThan(0)
  })

  it('treats any other VITE_FAKE_SEED as the empty seed', async () => {
    const clients = createClients({ VITE_USE_FAKES: '1', VITE_FAKE_SEED: 'whatever' })

    expect(await clients?.data.getUser()).toBeNull()
  })

  it.each([undefined, '', '0', 'true'])('is not configured when VITE_USE_FAKES is %j', (flag) => {
    expect(createClients({ VITE_USE_FAKES: flag })).toBeNull()
  })

  describe('local mode', () => {
    const SERVER = 'http://127.0.0.1:8765'

    it('is configured by VITE_LOCAL_RUN alone, and asks the server for nothing yet', () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch')

      const clients = createClients({ VITE_LOCAL_RUN: SERVER })

      expect(clients).not.toBeNull()
      expect(clients?.createPlayer?.().getRateRange()).toEqual(SPEED_RANGE)
      expect(fetchSpy).not.toHaveBeenCalled()
      fetchSpy.mockRestore()
    })

    it('asks the server named by VITE_LOCAL_RUN once the app uses it', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'))

      await expect(createClients({ VITE_LOCAL_RUN: SERVER })?.data.listPieces()).rejects.toThrow(SERVER)

      expect(fetchSpy).toHaveBeenCalledWith(`${SERVER}/runs`, undefined)
      fetchSpy.mockRestore()
    })

    it('wins over VITE_USE_FAKES', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'))

      const clients = createClients({ VITE_LOCAL_RUN: SERVER, VITE_USE_FAKES: '1', VITE_FAKE_SEED: 'demo' })

      await expect(clients?.data.listPieces()).rejects.toThrow('did not answer')
      fetchSpy.mockRestore()
    })

    it('is off when VITE_LOCAL_RUN is empty', () => {
      expect(createClients({ VITE_LOCAL_RUN: '' })).toBeNull()
    })
  })
  describe('Supabase mode', () => {
    beforeEach(() => createClientMock.mockReset().mockImplementation(() => supabaseAuthStub().client))

    it('is configured by the Supabase URL, the publishable key and the processor URL together, and builds the library client from them', async () => {
      const clients = createClients(SUPABASE)

      expect(clients).not.toBeNull()
      expect(createClientMock).toHaveBeenCalledWith(SUPABASE.VITE_SUPABASE_URL, SUPABASE.VITE_SUPABASE_PUBLISHABLE_KEY, { auth: { flowType: 'pkce' } })
      expect((await clients?.data.getUser())?.email).toBe('a@example.com')
      expect(clients?.createPlayer?.().getRateRange()).toEqual(SPEED_RANGE)
    })

    it('starts jobs at the processor URL with the signed-in user\'s token, and hides only what the processor has no route for', async () => {
      const stub = supabaseAuthStub()
      // The stub's type names only the session's user; the real session also carries the access token.
      vi.mocked(stub.client.auth.getSession).mockResolvedValue({ data: { session: { ...SESSION, access_token: 'tok' } } } as unknown as Awaited<ReturnType<typeof stub.client.auth.getSession>>)
      createClientMock.mockImplementation(() => stub.client)
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ job_id: 'j', status: 'queued' }), { status: 200 }))
      const clients = createClients(SUPABASE)

      const job = await clients?.processor.realign('piece-1')

      expect(job?.id).toBe('j')
      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
      expect(url).toBe('https://processor.example/jobs/realign')
      expect(new Headers(init.headers).get('Authorization')).toBe('Bearer tok')
      expect(clients?.features).toEqual({ splitPdf: true, boxCheck: true, reprocess: false, suggestName: true })
      expect(clients?.features).not.toHaveProperty('upload')
      fetchSpy.mockRestore()
    })

    it('can be awaited, so a caller that returns it from an async function does not hang', async () => {
      const clients = createClients(SUPABASE)

      expect(await (async () => clients?.data)()).toBe(clients?.data)
    })

    it('loses to local mode and to the fakes when they are also set, and builds nothing', async () => {
      expect(await createClients({ ...SUPABASE, VITE_USE_FAKES: '1' })?.data.getUser()).toBeNull()
      expect(createClients({ ...SUPABASE, VITE_LOCAL_RUN: 'http://127.0.0.1:8765' })).not.toBeNull()
      expect(createClientMock).not.toHaveBeenCalled()
    })

    it.each([
      ['only the URL', { VITE_SUPABASE_URL: SUPABASE.VITE_SUPABASE_URL }],
      ['only the key', { VITE_SUPABASE_PUBLISHABLE_KEY: SUPABASE.VITE_SUPABASE_PUBLISHABLE_KEY }],
      ['an empty key', { ...SUPABASE, VITE_SUPABASE_PUBLISHABLE_KEY: '' }],
      ['no processor URL', { VITE_SUPABASE_URL: SUPABASE.VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY: SUPABASE.VITE_SUPABASE_PUBLISHABLE_KEY }],
      ['an empty processor URL', { ...SUPABASE, VITE_PROCESSOR_URL: '' }],
    ])('is not configured with %s', (_name, env) => {
      expect(createClients(env)).toBeNull()
      expect(createClientMock).not.toHaveBeenCalled()
    })
  })
})
