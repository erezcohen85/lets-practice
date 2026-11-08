import { useLayoutEffect } from 'react'
import { useLocation } from 'react-router'
import { themeFor } from '@/domain/theme'
import { useSession } from '@/lib/session'

/**
 * Puts the theme on the <html> element (the shadcn colour names are aliases on :root, so a wrapper would not reach them).
 * It is the only place that does, and it reads the app's own session: the demo at /demo runs a session of its own below
 * this one, which cannot reach it. Signed out, loading and the always-dark pages are dark (domain/theme).
 * Call it once, below the router and the session.
 */
export function useAppTheme(): void {
  const session = useSession()
  const { pathname } = useLocation()
  const userTheme = session.status === 'signed-in' ? session.profile.settings.theme : null
  const theme = themeFor(pathname, userTheme)
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])
}
