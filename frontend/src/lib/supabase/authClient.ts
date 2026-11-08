import { safeNext } from '@/domain/nextPath'
import { safePhotoUrl } from '@/domain/photoUrl'
import { TERMS_VERSION } from '@/domain/terms'
import { normaliseSettings, type DataClient, type Profile, type User, type UserSettings } from '@/lib/dataClient'

interface SessionUser { id: string; email?: string; user_metadata?: { full_name?: string; name?: string; avatar_url?: unknown; picture?: unknown } }
interface ProfileRow { accepted_terms_at: string | null; accepted_terms_version: string | null; settings: unknown; display_name: string | null; email: string | null; sample_given_at?: string | null }

/**
 * The part of the Supabase client that sign-in uses, so tests can pass a stub and never touch the network. There is no
 * insert or upsert on purpose: users cannot insert into `profiles`, and the row comes from a trigger.
 */
export interface SupabaseLike {
  auth: {
    getSession(): Promise<{ data: { session: { user: SessionUser } | null } }>
    onAuthStateChange(callback: (event: string, session: { user: SessionUser } | null) => void): { data: { subscription: { unsubscribe(): void } } }
    signInWithOAuth(args: { provider: 'google'; options: { redirectTo: string; queryParams?: Record<string, string> } }): Promise<{ error: Error | null }>
    signOut(): Promise<{ error: Error | null }>
  }
  from(table: 'profiles'): {
    select(columns: string): { eq(column: string, value: string): { single(): PromiseLike<{ data: ProfileRow | null; error: Error | null }> } }
    update(values: Record<string, unknown>): { eq(column: string, value: string): PromiseLike<{ error: Error | null }> }
  }
  rpc(name: 'is_admin'): PromiseLike<{ data: boolean | null; error: Error | null }>
}

function toUser(user: SessionUser): User {
  const email = user.email ?? ''
  // Supabase keeps what Google sent in user_metadata: the picture as avatar_url, and again as picture.
  const photoUrl = safePhotoUrl(user.user_metadata?.avatar_url) ?? safePhotoUrl(user.user_metadata?.picture)
  return { id: user.id, email, name: user.user_metadata?.full_name ?? user.user_metadata?.name ?? email, ...(photoUrl === undefined ? {} : { photoUrl }) }
}

function fail(error: Error | null): void {
  if (error !== null) throw new Error(error.message)
}

/** The signed-in user, or a rejection the pages already understand. */
export function createRequireUser(client: Pick<SupabaseLike, 'auth'>): () => Promise<User> {
  return async () => {
    const { data } = await client.auth.getSession()
    if (data.session === null) throw new Error('not signed in')
    return toUser(data.session.user)
  }
}

/** Google sign-in and the signed-in user's own profile, on Supabase Auth. The session stays in Supabase's own auth storage. */
export function createAuthMethods(client: SupabaseLike, origin: string) {
  async function currentUser(): Promise<User | null> {
    // getSession waits for the library to finish starting, which includes reading a return from Google out of the address.
    const { data } = await client.auth.getSession()
    return data.session === null ? null : toUser(data.session.user)
  }
  async function requireId(): Promise<string> {
    const user = await currentUser()
    if (user === null) throw new Error('not signed in')
    return user.id
  }
  async function getProfile(): Promise<Profile> {
    const id = await requireId()
    const [row, admin] = await Promise.all([
      client.from('profiles').select('accepted_terms_at, accepted_terms_version, settings, display_name, email, sample_given_at').eq('id', id).single(),
      client.rpc('is_admin'),
    ])
    fail(row.error)
    fail(admin.error)
    if (row.data === null) throw new Error('profile not found')
    return {
      acceptedTermsAt: row.data.accepted_terms_at,
      acceptedTermsVersion: row.data.accepted_terms_version,
      settings: normaliseSettings(row.data.settings),
      isAdmin: admin.data === true,
      displayName: row.data.display_name,
      email: row.data.email,
      sampleGivenAt: row.data.sample_given_at ?? null,
    }
  }
  async function writeProfile(values: Record<string, unknown>): Promise<Profile> {
    const { error } = await client.from('profiles').update(values).eq('id', await requireId())
    fail(error)
    return getProfile()
  }
  return {
    getUser: currentUser,
    /**
     * Reports a sign-in, a token refresh that carries a session, and a sign-out. A refresh is passed on because a session
     * that comes back after a failed first load is otherwise not noticed; the session ignores it for a user already in.
     * INITIAL_SESSION (getUser reads that) and USER_UPDATED are not changes of who is signed in. The listener is called
     * from a timer, not from inside the library's callback: Supabase warns that calling it from there can deadlock.
     */
    onUserChange(listener) {
      const pending = new Set<ReturnType<typeof setTimeout>>()
      const { data } = client.auth.onAuthStateChange((event, session) => {
        let user: User | null
        if (event === 'SIGNED_OUT') user = null
        else if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && session !== null) user = toUser(session.user)
        else return
        const timer = setTimeout(() => {
          pending.delete(timer)
          listener(user)
        }, 0)
        pending.add(timer)
      })
      return () => {
        for (const timer of pending) clearTimeout(timer)
        pending.clear()
        data.subscription.unsubscribe()
      }
    },
    /**
     * Resolves to null: the browser is on its way to Google, and onUserChange brings the user after it returns. Google is
     * asked to show its account list every time, so after signing out a person can come back as another account; someone
     * who never signed out does not get here, because the kept session signs them in and the landing page sends them on.
     */
    async signInWithGoogle(next?: string | null) {
      const { error } = await client.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: origin + (safeNext(next) ?? '/library'), queryParams: { prompt: 'select_account' } },
      })
      fail(error)
      return null
    },
    async signOut() {
      fail((await client.auth.signOut()).error)
    },
    getProfile,
    acceptTerms: () => writeProfile({ accepted_terms_at: new Date().toISOString(), accepted_terms_version: TERMS_VERSION }),
    saveSettings: (settings: UserSettings) => writeProfile({ settings }),
  } satisfies Pick<DataClient, 'getUser' | 'onUserChange' | 'signInWithGoogle' | 'signOut' | 'getProfile' | 'acceptTerms' | 'saveSettings'>
}
