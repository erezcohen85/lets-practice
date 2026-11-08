import { Navigate, Outlet, useLocation, useSearchParams, type RouteObject } from 'react-router'
import { PageColumn } from '@/components/shell/PageColumn'
import { LoadingState } from '@/components/shell/StateCards'
import { needsTerms } from '@/domain/terms'
import { safeNext } from '@/domain/nextPath'
import { useAppTheme } from '@/lib/useAppTheme'
import { useSession } from '@/lib/session'
import { AdminPage } from '@/pages/AdminPage'
import { DemoPage } from '@/pages/DemoPage'
import { EditorPage } from '@/pages/EditorPage'
import { LandingPage } from '@/pages/LandingPage'
import { JoinPage } from '@/pages/JoinPage'
import { LibraryPage } from '@/pages/LibraryPage'
import { NewPiecePage } from '@/pages/NewPiecePage'
import { NotFoundPage } from '@/pages/NotFoundPage'
import { PieceHubPage } from '@/pages/PieceHubPage'
import { PracticePage } from '@/pages/PracticePage'
import { ProcessingPage } from '@/pages/ProcessingPage'
import { SettingsPage } from '@/pages/SettingsPage'
import { TermsPage } from '@/pages/TermsPage'
import { strings } from '@/strings'

// Nothing is decided before the session is known, so there is never a flash of the wrong page.
function SessionGate() {
  const { status } = useSession()
  useAppTheme()
  if (status === 'loading') {
    return (
      <PageColumn width="narrow">
        <LoadingState message={strings.common.loadingSession} />
      </PageColumn>
    )
  }
  return <Outlet />
}

/** Only a join link is worth coming back to (spec 5.3); signing out of any other page starts at the library. */
function joinPathOf(pathname: string): string | null {
  return pathname.startsWith('/join/') ? pathname : null
}

export function withNext(path: string, next: string | null): string {
  return next === null ? path : `${path}?next=${encodeURIComponent(next)}`
}

// The landing page is for visitors: whoever is signed in goes on to the library (or the path they came for), or to the terms first.
function VisitorsOnly() {
  const { status, profile } = useSession()
  const [params] = useSearchParams()
  if (status !== 'signed-in') return <Outlet />
  const next = safeNext(params.get('next'))
  return <Navigate to={needsTerms(profile) ? withNext('/terms', next) : (next ?? '/library')} replace />
}

// The pages of the app: signed out goes to the landing page, signed in without the current terms accepted goes to the terms.
// A join link is carried along, so the way to it survives sign-in and the terms.
function AccountOnly() {
  const { status, profile } = useSession()
  const { pathname } = useLocation()
  const next = joinPathOf(pathname)
  if (status === 'signed-out') return <Navigate to={withNext('/', next)} replace />
  if (profile !== null && needsTerms(profile)) return <Navigate to={withNext('/terms', next)} replace />
  return <Outlet />
}

// Upload access is kept by the admin alone; anyone else is sent to the library.
function AdminOnly() {
  const { status, profile } = useSession()
  if (status !== 'signed-in' || !profile.isAdmin) return <Navigate to="/library" replace />
  return <Outlet />
}

export const routes: RouteObject[] = [
  {
    element: <SessionGate />,
    children: [
      { element: <VisitorsOnly />, children: [{ path: '/', element: <LandingPage /> }] },
      // Public: it reads the session itself, to show the accept controls only to a signed-in user who has not accepted.
      { path: '/terms', element: <TermsPage /> },
      // Public, for the landing page's Practice Demo button: the Practice screen on fixed files, whether or not someone is signed in.
      { path: '/demo', element: <DemoPage /> },
      {
        element: <AccountOnly />,
        children: [
          { path: '/join/:token', element: <JoinPage /> },
          { path: '/library', element: <LibraryPage /> },
          { path: '/pieces/new', element: <NewPiecePage /> },
          { path: '/pieces/:pieceId', element: <PieceHubPage /> },
          { path: '/pieces/:pieceId/processing', element: <ProcessingPage /> },
          { path: '/pieces/:pieceId/practice', element: <PracticePage /> },
          { path: '/pieces/:pieceId/edit', element: <EditorPage /> },
          { path: '/settings', element: <SettingsPage /> },
          { element: <AdminOnly />, children: [{ path: '/admin', element: <AdminPage /> }] },
        ],
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]
