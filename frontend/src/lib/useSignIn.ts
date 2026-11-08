import { useCallback, useState } from 'react'
import { useSearchParams } from 'react-router'
import { safeNext } from '@/domain/nextPath'
import { useSession } from '@/lib/session'

/**
 * "Continue with Google" for the pages that offer it: `signIn` runs the session's sign-in, `pending` is true while it runs
 * (so a second click does nothing) and `failed` is true after a sign-in that did not work, until the next try starts.
 * A safe `next` in the address is handed on, so the way back to a share link survives the trip to Google.
 * On success the route guards move the user on, so there is nothing to do here.
 */
export function useSignIn() {
  const { signIn: signInWithGoogle } = useSession()
  const [params] = useSearchParams()
  const next = safeNext(params.get('next'))
  const [pending, setPending] = useState(false)
  const [failed, setFailed] = useState(false)

  const signIn = useCallback(async () => {
    setPending(true)
    setFailed(false)
    try {
      await signInWithGoogle(next)
    } catch {
      setFailed(true)
    } finally {
      setPending(false)
    }
  }, [signInWithGoogle, next])

  return { signIn, pending, failed }
}
