import { vi } from 'vitest'
import { type SupabaseLike } from '@/lib/supabase/authClient'

export const SESSION = { user: { id: 'u1', email: 'a@example.com', user_metadata: { full_name: 'Ana' } } }
type Session = typeof SESSION

/**
 * A hand-written stand-in for the part of the Supabase client that sign-in uses. It never touches the network, and it
 * has no insert or upsert, so code that tried to create a profile row would fail on it as it does on the real database.
 */
export function supabaseAuthStub(signedIn = true) {
  let listener: ((event: string, value: Session | null) => void) | null = null
  const unsubscribe = vi.fn()
  const row = { accepted_terms_at: null as string | null, accepted_terms_version: null as string | null, settings: {}, display_name: 'Ana', email: 'a@example.com', sample_given_at: null as string | null }
  const eq = vi.fn(() => Promise.resolve({ error: null as Error | null }))
  const update = vi.fn((values: Partial<typeof row>) => {
    Object.assign(row, values)
    return { eq }
  })
  const single = vi.fn(async () => ({ data: { ...row } as typeof row | null, error: null as Error | null }))
  const client: SupabaseLike = {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: signedIn ? SESSION : null } })),
      onAuthStateChange: vi.fn((callback) => {
        listener = callback
        return { data: { subscription: { unsubscribe } } }
      }),
      signInWithOAuth: vi.fn(async () => ({ error: null })),
      signOut: vi.fn(async () => ({ error: null })),
    },
    from: vi.fn(() => ({
      select: () => ({ eq: () => ({ single }) }),
      update,
    })),
    rpc: vi.fn(async (name: string) => ({ data: name === 'is_admin', error: null })),
  }
  return { client, update, eq, single, unsubscribe, emit: (event: string, value: Session | null) => listener?.(event, value) }
}
