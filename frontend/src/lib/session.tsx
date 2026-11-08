import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { returnedFromGoogle } from '@/domain/authReturn'
import { deleteAccountWithPieces } from '@/lib/accountDeletion'
import { useClients } from '@/lib/clients'
import { type Profile, type User, type UserSettings } from '@/lib/dataClient'

/**
 * `problem` is true only for a visitor who ended signed out because something went wrong, not because they never signed in:
 * the profile of a signed-in user could not be read, or Google's return held an error. The landing page then says so.
 */
type SessionState =
  | { status: 'loading'; user: null; profile: null; problem: false }
  | { status: 'signed-out'; user: null; profile: null; problem: boolean }
  | { status: 'signed-in'; user: User; profile: Profile; problem: false }

export type Session = SessionState & {
  signIn(next?: string | null): Promise<void>
  signOut(): Promise<void>
  /** Deletes the account and every piece the user owns, then ends the session; rejects with an AccountDeletionError, and the session stays. */
  deleteAccount(): Promise<void>
  acceptTerms(): Promise<void>
  saveSettings(settings: UserSettings): Promise<void>
}

const LOADING: SessionState = { status: 'loading', user: null, profile: null, problem: false }
const SIGNED_OUT: SessionState = { status: 'signed-out', user: null, profile: null, problem: false }
const SIGNED_OUT_WITH_PROBLEM: SessionState = { ...SIGNED_OUT, problem: true }

const SessionContext = createContext<Session | null>(null)

/**
 * Who is signed in and what their profile says. It stays 'loading' until the user and the profile are both known, so a
 * signed-in user never shows as signed out for a moment. It follows sign-ins and sign-outs through onUserChange.
 * A profile that cannot be loaded is treated as no session, with `problem` set so the landing page says that sign-in failed;
 * so is a return from Google whose address holds an error, or a code that no session followed (read once, when the app starts, before anything clears it).
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const { data } = useClients()
  const [state, setState] = useState<SessionState>(LOADING)
  // Whether the address the page was opened with holds an error or a code from Google; read before the library can clear it.
  const returnedError = useRef<boolean | null>(null)
  returnedError.current ??= returnedFromGoogle(window.location.search, window.location.hash)
  // Each load takes a ticket, and only the newest one may write: a slow older load must not undo a newer one.
  const latest = useRef(0)
  // Who is signed in right now, for telling a repeat of the same sign-in from a new one.
  const signedInId = useRef<string | null>(null)
  const commit = useCallback((next: SessionState) => {
    signedInId.current = next.status === 'signed-in' ? next.user.id : null
    setState(next)
  }, [])

  const apply = useCallback(
    async (user: User | null) => {
      const ticket = ++latest.current
      if (user === null) {
        commit(SIGNED_OUT)
        return
      }
      try {
        const profile = await data.getProfile()
        if (ticket === latest.current) commit({ status: 'signed-in', user, profile, problem: false })
      } catch {
        if (ticket === latest.current) commit(SIGNED_OUT_WITH_PROBLEM)
      }
    },
    [data, commit],
  )

  useEffect(() => {
    let active = true
    // A sign-in or sign-out that arrives while getUser is still running is newer news and wins.
    const before = latest.current
    const loadFirst = async () => {
      let user: User | null = null
      try {
        user = await data.getUser()
      } catch {
        // No user could be read: the visitor is treated as signed out.
      }
      if (active && latest.current === before) {
        // Cleared only by the load that is still live: under StrictMode the first, cancelled effect run must not use it up.
        const returned = returnedError.current === true
        returnedError.current = false
        if (user === null && returned) {
          // Google sent the visitor back with an error, or with a code that did not turn into a session: nobody is signed in, and the landing page says so.
          commit(SIGNED_OUT_WITH_PROBLEM)
        } else {
          await apply(user)
        }
      }
    }
    void loadFirst()
    const unsubscribe = data.onUserChange((user) => {
      // A sign-in repeated for the user who is already in (Supabase repeats it when a tab is refocused) changes nothing:
      // no profile read, no loading state, and a read that fails just then must not sign them out.
      if (active && !(user !== null && user.id === signedInId.current)) void apply(user)
    })
    return () => {
      active = false
      latest.current += 1
      unsubscribe()
    }
  }, [data, apply, commit])

  const session = useMemo<Session>(() => {
    const updateProfile = (profile: Profile) =>
      setState((current) => (current.status === 'signed-in' ? { ...current, profile } : current))
    return {
      ...state,
      signIn: async (next?: string | null) => {
        const user = await data.signInWithGoogle(next)
        // null: the browser is on its way to Google, and onUserChange brings the user after it returns.
        if (user !== null) await apply(user)
      },
      // The library tells onUserChange from a timer, so the session is set signed out here, as signIn does; the later SIGNED_OUT is a repeat.
      signOut: async () => {
        await data.signOut()
        await apply(null)
      },
      // Signing out after the delete only clears the browser's session (the server no longer knows it), so a failure of it cannot undo the delete.
      deleteAccount: async () => {
        await deleteAccountWithPieces(data)
        try {
          await data.signOut()
        } catch {
          // The account is gone either way.
        }
        await apply(null)
      },
      acceptTerms: async () => updateProfile(await data.acceptTerms()),
      saveSettings: async (settings) => updateProfile(await data.saveSettings(settings)),
    }
  }, [state, data, apply])

  return <SessionContext value={session}>{children}</SessionContext>
}

export function useSession(): Session {
  const session = useContext(SessionContext)
  if (session === null) throw new Error('useSession needs a SessionProvider above it')
  return session
}
