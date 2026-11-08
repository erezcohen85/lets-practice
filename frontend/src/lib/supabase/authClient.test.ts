import { TERMS_VERSION } from '@/domain/terms'
import { DEFAULT_SETTINGS } from '@/lib/dataClient'
import { createAuthMethods } from '@/lib/supabase/authClient'
import { SESSION, supabaseAuthStub } from '@/test/supabaseAuthStub'

const ORIGIN = 'https://app.example.com'

describe('createAuthMethods', () => {
  describe('signInWithGoogle', () => {
    it('sends Google the return address for a safe next, and stays on the page', async () => {
      const { client } = supabaseAuthStub()
      const auth = createAuthMethods(client, ORIGIN)

      expect(await auth.signInWithGoogle('/join/abc')).toBeNull()
      expect(client.auth.signInWithOAuth).toHaveBeenCalledWith({
        provider: 'google',
        options: { redirectTo: 'https://app.example.com/join/abc', queryParams: { prompt: 'select_account' } },
      })
    })

    it('has Google ask which account, so signing out and in again can change account', async () => {
      const { client } = supabaseAuthStub()

      await createAuthMethods(client, ORIGIN).signInWithGoogle()

      expect(vi.mocked(client.auth.signInWithOAuth).mock.calls[0][0].options.queryParams).toEqual({ prompt: 'select_account' })
    })

    it('falls back to the library for a hostile or missing next', async () => {
      const { client } = supabaseAuthStub()
      const auth = createAuthMethods(client, ORIGIN)

      await auth.signInWithGoogle('//evil.com')
      await auth.signInWithGoogle()

      const calls = vi.mocked(client.auth.signInWithOAuth).mock.calls
      expect(calls).toHaveLength(2)
      for (const [call] of calls) expect(call.options.redirectTo).toBe('https://app.example.com/library')
    })

    it('rejects when Google sign-in cannot start', async () => {
      const { client } = supabaseAuthStub()
      vi.mocked(client.auth.signInWithOAuth).mockResolvedValue({ error: new Error('no') })

      await expect(createAuthMethods(client, ORIGIN).signInWithGoogle()).rejects.toThrow('no')
    })
  })

  describe('getUser', () => {
    it('reads the user from the session', async () => {
      expect(await createAuthMethods(supabaseAuthStub().client, ORIGIN).getUser()).toEqual({ id: 'u1', email: 'a@example.com', name: 'Ana' })
      expect(await createAuthMethods(supabaseAuthStub(false).client, ORIGIN).getUser()).toBeNull()
    })

    it('reads the photo address Google keeps as avatar_url, and has no photo when there is none', async () => {
      const { client } = supabaseAuthStub()
      const give = (user_metadata?: Record<string, unknown>) => vi.mocked(client.auth.getSession).mockResolvedValue({ data: { session: { user: { id: 'u2', email: 'b@example.com', user_metadata } } } })
      const auth = createAuthMethods(client, ORIGIN)

      give({ full_name: 'Bo', avatar_url: 'https://lh3.googleusercontent.com/a/photo' })
      expect(await auth.getUser()).toEqual({ id: 'u2', email: 'b@example.com', name: 'Bo', photoUrl: 'https://lh3.googleusercontent.com/a/photo' })

      give({ full_name: 'Bo' })
      expect(await auth.getUser()).toStrictEqual({ id: 'u2', email: 'b@example.com', name: 'Bo' })
    })

    it('falls back to picture when there is no avatar_url', async () => {
      const { client } = supabaseAuthStub()
      vi.mocked(client.auth.getSession).mockResolvedValue({ data: { session: { user: { id: 'u2', email: 'b@example.com', user_metadata: { picture: 'https://lh3.googleusercontent.com/a/other' } } } } })

      expect((await createAuthMethods(client, ORIGIN).getUser())?.photoUrl).toBe('https://lh3.googleusercontent.com/a/other')
    })

    it('accepts only https photo addresses: anything else is no photo, and a later good one is used', async () => {
      const { client } = supabaseAuthStub()
      const give = (user_metadata: Record<string, unknown>) => vi.mocked(client.auth.getSession).mockResolvedValue({ data: { session: { user: { id: 'u2', email: 'b@example.com', user_metadata } } } })
      const auth = createAuthMethods(client, ORIGIN)

      for (const avatar_url of ['http://lh3.googleusercontent.com/a/x', 'javascript:alert(1)', 'data:image/png;base64,AAAA', 42]) {
        give({ avatar_url })
        expect((await auth.getUser())?.photoUrl).toBeUndefined()
      }
      give({ avatar_url: 'http://example.com/a.png', picture: 'https://example.com/b.png' })
      expect((await auth.getUser())?.photoUrl).toBe('https://example.com/b.png')
    })

    it('puts the photo on the user the session reports after a sign-in too', async () => {
      const { client, emit } = supabaseAuthStub()
      const heard: Array<{ photoUrl?: string } | null> = []
      vi.useFakeTimers()
      try {
        createAuthMethods(client, ORIGIN).onUserChange((user) => heard.push(user))
        emit('SIGNED_IN', { user: { id: 'u3', email: 'c@example.com', user_metadata: { avatar_url: 'https://example.com/c.png' } } } as never)
        await vi.runAllTimersAsync()
      } finally {
        vi.useRealTimers()
      }

      expect(heard[0]?.photoUrl).toBe('https://example.com/c.png')
    })

    it('falls back to the email for the name when Google gave none', async () => {
      const { client } = supabaseAuthStub()
      vi.mocked(client.auth.getSession).mockResolvedValue({ data: { session: { user: { id: 'u2', email: 'b@example.com' } } } })

      expect(await createAuthMethods(client, ORIGIN).getUser()).toEqual({ id: 'u2', email: 'b@example.com', name: 'b@example.com' })
    })

    it('waits for the library\'s getSession, which resolves only once the library has started and read the address', async () => {
      const { client } = supabaseAuthStub()
      let give: (value: { data: { session: typeof SESSION } }) => void = () => {}
      vi.mocked(client.auth.getSession).mockReturnValue(new Promise((resolve) => (give = resolve)))

      const pending = createAuthMethods(client, ORIGIN).getUser()
      give({ data: { session: SESSION } })

      expect((await pending)?.id).toBe('u1')
    })
  })

  describe('onUserChange', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    it('follows sign-ins and sign-outs, and unsubscribes', () => {
      const { client, emit, unsubscribe } = supabaseAuthStub()
      const seen: unknown[] = []
      const off = createAuthMethods(client, ORIGIN).onUserChange((user) => seen.push(user?.id ?? null))

      emit('SIGNED_IN', SESSION)
      emit('SIGNED_OUT', null)
      vi.runAllTimers()

      expect(seen).toEqual(['u1', null])
      off()
      expect(unsubscribe).toHaveBeenCalledOnce()
    })

    it('hands the user over outside the library callback, so the listener may call Supabase without a deadlock', () => {
      const { client, emit } = supabaseAuthStub()
      const listener = vi.fn()
      createAuthMethods(client, ORIGIN).onUserChange(listener)

      emit('SIGNED_IN', SESSION)

      expect(listener).not.toHaveBeenCalled()
      vi.runAllTimers()
      expect(listener).toHaveBeenCalledOnce()
    })

    it('cancels a hand-over that is still waiting when it is unsubscribed', () => {
      const { client, emit } = supabaseAuthStub()
      const listener = vi.fn()
      const off = createAuthMethods(client, ORIGIN).onUserChange(listener)

      emit('SIGNED_IN', SESSION)
      off()
      vi.runAllTimers()

      expect(listener).not.toHaveBeenCalled()
    })

    it('reports TOKEN_REFRESHED with a session, so a session that comes back after a failed first load is noticed', () => {
      const { client, emit } = supabaseAuthStub()
      const listener = vi.fn()
      createAuthMethods(client, ORIGIN).onUserChange(listener)

      emit('TOKEN_REFRESHED', SESSION)
      vi.runAllTimers()

      expect(listener).toHaveBeenCalledExactlyOnceWith({ id: 'u1', email: 'a@example.com', name: 'Ana' })
    })

    it.each(['INITIAL_SESSION', 'USER_UPDATED', 'PASSWORD_RECOVERY'])('does not report %s: nobody signed in or out', (event) => {
      const { client, emit } = supabaseAuthStub()
      const listener = vi.fn()
      createAuthMethods(client, ORIGIN).onUserChange(listener)

      emit(event, SESSION)
      emit(event, null)
      vi.runAllTimers()

      expect(listener).not.toHaveBeenCalled()
    })
  })

  describe('signOut', () => {
    it('signs out, and rejects when that fails', async () => {
      const { client } = supabaseAuthStub()
      const auth = createAuthMethods(client, ORIGIN)

      await auth.signOut()
      expect(client.auth.signOut).toHaveBeenCalledOnce()

      vi.mocked(client.auth.signOut).mockResolvedValue({ error: new Error('offline') })
      await expect(auth.signOut()).rejects.toThrow('offline')
    })
  })

  describe('the profile', () => {
    it('is built from the row and the two functions', async () => {
      const profile = await createAuthMethods(supabaseAuthStub().client, ORIGIN).getProfile()

      expect(profile).toMatchObject({ isAdmin: true, displayName: 'Ana', email: 'a@example.com', acceptedTermsAt: null, acceptedTermsVersion: null })
      expect(profile.settings).toEqual(DEFAULT_SETTINGS)
    })

    it('carries when the sample piece was given, null until then', async () => {
      expect((await createAuthMethods(supabaseAuthStub().client, ORIGIN).getProfile()).sampleGivenAt).toBeNull()

      const { client, single } = supabaseAuthStub()
      single.mockResolvedValueOnce({ data: { accepted_terms_at: null, accepted_terms_version: null, settings: {}, display_name: 'Ana', email: 'a@example.com', sample_given_at: '2026-11-08T10:00:00Z' }, error: null })
      expect((await createAuthMethods(client, ORIGIN).getProfile()).sampleGivenAt).toBe('2026-11-08T10:00:00Z')
    })

    it('rejects for nobody signed in, and for a row that cannot be read', async () => {
      await expect(createAuthMethods(supabaseAuthStub(false).client, ORIGIN).getProfile()).rejects.toThrow('not signed in')

      const { client, single } = supabaseAuthStub()
      single.mockResolvedValueOnce({ data: null, error: new Error('denied') })
      await expect(createAuthMethods(client, ORIGIN).getProfile()).rejects.toThrow('denied')
    })

    it('accepting stores the time and the current version, on the signed-in user\'s row only', async () => {
      const { client, update, eq } = supabaseAuthStub()

      const profile = await createAuthMethods(client, ORIGIN).acceptTerms()

      expect(Object.keys(update.mock.calls[0]![0]).sort()).toEqual(['accepted_terms_at', 'accepted_terms_version'])
      expect(update.mock.calls[0]![0]).toMatchObject({ accepted_terms_version: TERMS_VERSION })
      expect(eq).toHaveBeenCalledWith('id', 'u1')
      expect(profile.acceptedTermsVersion).toBe(TERMS_VERSION)
      expect(profile.acceptedTermsAt).not.toBeNull()
    })

    it('saving settings writes only the settings column', async () => {
      const { client, update } = supabaseAuthStub()

      await createAuthMethods(client, ORIGIN).saveSettings({ ...DEFAULT_SETTINGS, nightScore: true })

      expect(Object.keys(update.mock.calls[0]![0])).toEqual(['settings'])
    })

    it('passes a failed write on to the caller', async () => {
      const { client, eq } = supabaseAuthStub()
      eq.mockResolvedValueOnce({ error: new Error('write refused') })

      await expect(createAuthMethods(client, ORIGIN).acceptTerms()).rejects.toThrow('write refused')
    })
  })
})
