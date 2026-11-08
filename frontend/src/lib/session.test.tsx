import { act, render, renderHook, screen, waitFor } from '@testing-library/react'
import { StrictMode, type ReactNode } from 'react'
import { DEFAULT_SETTINGS, type DataClient, type Profile, type UserSettings } from '@/lib/dataClient'
import { ClientsProvider } from '@/lib/clients'
import { createFakes, type CreateFakesOptions } from '@/lib/fakes'
import { SessionProvider, useSession } from '@/lib/session'
import { createAuthMethods } from '@/lib/supabase/authClient'
import { SESSION, supabaseAuthStub } from '@/test/supabaseAuthStub'

const DEMO_PROFILE: Profile = { acceptedTermsAt: null, acceptedTermsVersion: null, settings: DEFAULT_SETTINGS, isAdmin: false, displayName: null, email: null, sampleGivenAt: null }

function setup(options?: CreateFakesOptions, override?: Partial<DataClient>) {
  const fakes = createFakes(options)
  const clients = { data: { ...fakes.data, ...override }, processor: fakes.processor }
  const wrapper = ({ children }: { children: ReactNode }) => (
    <ClientsProvider clients={clients}>
      <SessionProvider>{children}</SessionProvider>
    </ClientsProvider>
  )
  return { fakes, ...renderHook(() => useSession(), { wrapper }) }
}

describe('useSession', () => {
  it('is loading first, then signed out when nobody is signed in', async () => {
    const { result } = setup()

    expect(result.current.status).toBe('loading')
    await waitFor(() => expect(result.current.status).toBe('signed-out'))
    expect(result.current.user).toBeNull()
    expect(result.current.profile).toBeNull()
  })

  it('is signed in with the user and the profile when somebody already is', async () => {
    const { result } = setup({ signedIn: true, termsAccepted: true })

    await waitFor(() => expect(result.current.status).toBe('signed-in'))
    expect(result.current.user?.email).toBe('demo@example.com')
    expect(result.current.profile?.acceptedTermsAt).not.toBeNull()
    expect(result.current.profile?.settings).toEqual(DEFAULT_SETTINGS)
  })

  it('stays loading until the profile is there, so a signed-in user never shows as signed out', async () => {
    let giveProfile: (profile: Profile) => void = () => {}
    const { result } = setup(
      { signedIn: true },
      { getProfile: () => new Promise<Profile>((resolve) => (giveProfile = resolve)) },
    )

    await act(async () => {})
    expect(result.current.status).toBe('loading')
    await act(async () => giveProfile({ acceptedTermsAt: null, acceptedTermsVersion: null, settings: DEFAULT_SETTINGS, isAdmin: false, displayName: null, email: null, sampleGivenAt: null }))
    await waitFor(() => expect(result.current.status).toBe('signed-in'))
  })

  describe('a failed sign-in is a problem, not silence', () => {
    afterEach(() => window.history.replaceState(null, '', '/'))

    it('has no problem when nobody is signed in and nothing went wrong', async () => {
      const { result } = setup()
      await waitFor(() => expect(result.current.status).toBe('signed-out'))
      expect(result.current.problem).toBe(false)
    })

    it('ends signed out with a problem when the signed-in user\'s profile cannot be read', async () => {
      const { result } = setup({ signedIn: true }, { getProfile: () => Promise.reject(new Error('relation does not exist')) })

      await waitFor(() => expect(result.current.status).toBe('signed-out'))
      expect(result.current.problem).toBe(true)
      expect(result.current.user).toBeNull()
      expect(result.current.profile).toBeNull()
    })

    it('has no problem once somebody is signed in', async () => {
      const { result } = setup({ signedIn: true })
      await waitFor(() => expect(result.current.status).toBe('signed-in'))
      expect(result.current.problem).toBe(false)
    })

    it.each([
      ['/library#error=access_denied&error_description=Nope'],
      ['/join/abc?error=server_error'],
      ['/?next=%2Fjoin%2Fabc&error=access_denied'],
    ])('ends signed out with a problem when Google\'s return in the address holds an error: %s', async (address) => {
      window.history.replaceState(null, '', address)
      const { result } = setup()

      await waitFor(() => expect(result.current.status).toBe('signed-out'))
      expect(result.current.problem).toBe(true)
    })

    it.each([['/library?code=abc123'], ['/join/abc?code=abc123&x=1']])(
      'ends signed out with a problem when the return carries a code and no session follows (a failed exchange): %s',
      async (address) => {
        window.history.replaceState(null, '', address)
        const { result } = setup()

        await waitFor(() => expect(result.current.status).toBe('signed-out'))
        expect(result.current.problem).toBe(true)
      },
    )

    it('keeps the session and shows no problem when a code is in the address but somebody is signed in', async () => {
      window.history.replaceState(null, '', '/library?code=stale')
      const { result } = setup({ signedIn: true })

      await waitFor(() => expect(result.current.status).toBe('signed-in'))
      expect(result.current.problem).toBe(false)
      expect(result.current.user).not.toBeNull()
    })

    it('shows the failed return under StrictMode too, whose first effect run is cancelled and runs again', async () => {
      window.history.replaceState(null, '', '/library#error=access_denied')
      const fakes = createFakes()
      let reads = 0
      const getUser = fakes.data.getUser
      fakes.data.getUser = () => {
        reads += 1
        return getUser()
      }
      function Show() {
        const { status, problem } = useSession()
        return <p>{`${status}, problem ${problem}`}</p>
      }
      // render, not renderHook: only render runs the effects twice under StrictMode, as the dev server does.
      render(
        <StrictMode>
          <ClientsProvider clients={{ data: fakes.data, processor: fakes.processor }}>
            <SessionProvider>
              <Show />
            </SessionProvider>
          </ClientsProvider>
        </StrictMode>,
      )

      await waitFor(() => expect(screen.getByText(/^signed-out/)).toBeInTheDocument())
      expect(reads).toBe(2) // the cancelled run and the live one: this test does see StrictMode
      expect(screen.getByText('signed-out, problem true')).toBeInTheDocument()
    })

    it('ignores an error in the address when somebody is signed in anyway', async () => {
      window.history.replaceState(null, '', '/library#error=access_denied')
      const { result } = setup({ signedIn: true })

      await waitFor(() => expect(result.current.status).toBe('signed-in'))
      expect(result.current.problem).toBe(false)
    })

    it('clears the problem when a sign-in works, and when the user signs out', async () => {
      const { result } = setup({ signedIn: true }, { getProfile: vi.fn().mockRejectedValueOnce(new Error('offline')).mockImplementation(() => Promise.resolve(DEMO_PROFILE)) })
      await waitFor(() => expect(result.current.problem).toBe(true))

      await act(() => result.current.signIn())

      expect(result.current.status).toBe('signed-in')
      expect(result.current.problem).toBe(false)
      await act(() => result.current.signOut())
      expect(result.current.problem).toBe(false)
    })
  })

  it('signIn signs in, and the profile is ready by the time it resolves', async () => {
    const { result } = setup()
    await waitFor(() => expect(result.current.status).toBe('signed-out'))

    await act(() => result.current.signIn())

    expect(result.current.status).toBe('signed-in')
    expect(result.current.user?.email).toBe('demo@example.com')
    expect(result.current.profile?.acceptedTermsAt).toBeNull()
  })

  it('signOut signs out', async () => {
    const { result } = setup({ signedIn: true })
    await waitFor(() => expect(result.current.status).toBe('signed-in'))

    await act(() => result.current.signOut())

    expect(result.current.status).toBe('signed-out')
    expect(result.current.user).toBeNull()
    expect(result.current.profile).toBeNull()
  })

  it('follows a sign-out and a sign-in made elsewhere', async () => {
    const { result, fakes } = setup({ signedIn: true })
    await waitFor(() => expect(result.current.status).toBe('signed-in'))

    await act(() => fakes.data.signOut())
    await waitFor(() => expect(result.current.status).toBe('signed-out'))

    await act(async () => {
      await fakes.data.signInWithGoogle()
    })
    await waitFor(() => expect(result.current.status).toBe('signed-in'))
  })

  it('acceptTerms stores the time on the profile', async () => {
    const { result, fakes } = setup({ signedIn: true })
    await waitFor(() => expect(result.current.status).toBe('signed-in'))
    expect(result.current.profile?.acceptedTermsAt).toBeNull()

    await act(() => result.current.acceptTerms())

    expect(result.current.profile?.acceptedTermsAt).not.toBeNull()
    expect((await fakes.data.getProfile()).acceptedTermsAt).toBe(result.current.profile?.acceptedTermsAt)
  })

  it('saveSettings keeps the new settings in the profile and in the data client', async () => {
    const { result, fakes } = setup({ signedIn: true })
    await waitFor(() => expect(result.current.status).toBe('signed-in'))
    const settings: UserSettings = { ...DEFAULT_SETTINGS, follow: { ...DEFAULT_SETTINGS.follow, scroll: 'page' }, nightScore: true }

    await act(() => result.current.saveSettings(settings))

    expect(result.current.profile?.settings).toEqual(settings)
    expect((await fakes.data.getProfile()).settings).toEqual(settings)
  })

  it('saveSettings passes a failure on to the caller and leaves the profile as it was', async () => {
    const { result } = setup({ signedIn: true }, { saveSettings: () => Promise.reject(new Error('save failed')) })
    await waitFor(() => expect(result.current.status).toBe('signed-in'))

    await act(async () => {
      await expect(result.current.saveSettings({ ...DEFAULT_SETTINGS, nightScore: true })).rejects.toThrow('save failed')
    })

    expect(result.current.profile?.settings).toEqual(DEFAULT_SETTINGS)
  })

  describe('on the Supabase client, whose events repeat for the same user', () => {
    function setupSupabase(prepare?: (stub: ReturnType<typeof supabaseAuthStub>) => void) {
      const stub = supabaseAuthStub()
      prepare?.(stub)
      const fakes = createFakes()
      const clients = { data: { ...fakes.data, ...createAuthMethods(stub.client, 'https://app.example.com') }, processor: fakes.processor }
      const statuses: string[] = []
      const wrapper = ({ children }: { children: ReactNode }) => (
        <ClientsProvider clients={clients}>
          <SessionProvider>{children}</SessionProvider>
        </ClientsProvider>
      )
      const hook = renderHook(
        () => {
          const session = useSession()
          statuses.push(session.status)
          return session
        },
        { wrapper },
      )
      // The library's events reach the listener from a timer, so give it one.
      const emit = (event: string, value: typeof SESSION | null) => act(async () => { stub.emit(event, value); await new Promise((resolve) => setTimeout(resolve, 5)) })
      return { ...stub, ...hook, statuses, emit, emitRaw: stub.emit }
    }

    it.each(['INITIAL_SESSION', 'TOKEN_REFRESHED', 'USER_UPDATED'])('%s leaves the signed-in user as they are: no loading state, no bounce, no profile read', async (event) => {
      const { result, statuses, emit, single } = setupSupabase()
      await waitFor(() => expect(result.current.status).toBe('signed-in'))
      const reads = single.mock.calls.length
      single.mockRejectedValue(new Error('offline'))

      await emit(event, SESSION)

      expect(result.current.status).toBe('signed-in')
      expect(statuses.slice(statuses.indexOf('signed-in')).every((status) => status === 'signed-in')).toBe(true)
      expect(single).toHaveBeenCalledTimes(reads)
    })

    it('SIGNED_IN again for the same user (a tab refocused) keeps the session even if the profile cannot be read just then', async () => {
      const { result, statuses, emit, single } = setupSupabase()
      await waitFor(() => expect(result.current.status).toBe('signed-in'))
      single.mockRejectedValue(new Error('offline'))

      await emit('SIGNED_IN', SESSION)

      expect(result.current.status).toBe('signed-in')
      expect(statuses.slice(statuses.indexOf('signed-in')).every((status) => status === 'signed-in')).toBe(true)
    })

    it('SIGNED_IN for another user loads that user, so the guard only skips a repeat of the same one', async () => {
      const { result, emit, single } = setupSupabase()
      await waitFor(() => expect(result.current.user?.id).toBe('u1'))
      const reads = single.mock.calls.length

      await emit('SIGNED_IN', { user: { id: 'u2', email: 'b@example.com', user_metadata: { full_name: 'Ben' } } })

      await waitFor(() => expect(result.current.user?.id).toBe('u2'))
      expect(result.current.status).toBe('signed-in')
      expect(single.mock.calls.length).toBeGreaterThan(reads)
    })

    it('TOKEN_REFRESHED signs the user in when the first load failed and the session came back', async () => {
      const { result, emit, single } = setupSupabase((stub) => stub.single.mockRejectedValueOnce(new Error('offline')))
      await waitFor(() => expect(result.current.status).toBe('signed-out'))
      expect(single).toHaveBeenCalledOnce()

      await emit('TOKEN_REFRESHED', SESSION)

      await waitFor(() => expect(result.current.status).toBe('signed-in'))
      expect(result.current.user?.id).toBe('u1')
    })

    it('signOut ends signed out as soon as it resolves, before the library tells the listener, which comes from a timer', async () => {
      const { result, client, emitRaw } = setupSupabase()
      await waitFor(() => expect(result.current.status).toBe('signed-in'))
      vi.mocked(client.auth.signOut).mockImplementation(async () => {
        // The library announces the sign-out to its subscribers; the listener of onUserChange hears it a tick later.
        emitRaw('SIGNED_OUT', null)
        return { error: null }
      })
      vi.useFakeTimers()
      try {
        await act(() => result.current.signOut())
        expect(result.current.status).toBe('signed-out')
      } finally {
        vi.useRealTimers()
      }
    })

    it('a SIGNED_OUT signs the user out, and a later SIGNED_IN brings them back', async () => {
      const { result, emit } = setupSupabase()
      await waitFor(() => expect(result.current.status).toBe('signed-in'))

      await emit('SIGNED_OUT', null)
      expect(result.current.status).toBe('signed-out')

      await emit('SIGNED_IN', SESSION)
      await waitFor(() => expect(result.current.status).toBe('signed-in'))
    })
  })
})
