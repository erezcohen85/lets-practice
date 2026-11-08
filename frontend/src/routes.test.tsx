import { act, screen, waitFor } from '@testing-library/react'
import { matchRoutes } from 'react-router'
import { createFakes } from '@/lib/fakes'
import { routes } from '@/routes'
import { strings } from '@/strings'
import { renderWithApp } from '@/test/render'

const pathNow = (router: { state: { location: { pathname: string } } }) => router.state.location.pathname

describe('the route table', () => {
  it.each([
    ['/', {}],
    ['/terms', {}],
    ['/library', {}],
    ['/pieces/new', {}],
    ['/pieces/p1', { pieceId: 'p1' }],
    ['/pieces/p1/processing', { pieceId: 'p1' }],
    ['/pieces/p1/practice', { pieceId: 'p1' }],
    ['/pieces/p1/edit', { pieceId: 'p1' }],
    ['/settings', {}],
  ])('has a page for %s', (path, params) => {
    const leaf = matchRoutes(routes, path)?.at(-1)

    expect(leaf?.route.path).not.toBe('*')
    expect(leaf?.params).toMatchObject(params)
  })

  it('reads /pieces/new as the New piece page, not as a piece called "new"', () => {
    expect(matchRoutes(routes, '/pieces/new')?.at(-1)?.params.pieceId).toBeUndefined()
  })

  it('sends every other path to the catch-all', () => {
    expect(matchRoutes(routes, '/nowhere')?.at(-1)?.route.path).toBe('*')
    expect(matchRoutes(routes, '/pieces/p1/unknown')?.at(-1)?.route.path).toBe('*')
  })
})

describe('guards', () => {
  it('sends a signed-out visit to /library back to the landing page', async () => {
    const { router } = renderWithApp('/library')

    await waitFor(() => expect(pathNow(router)).toBe('/'))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it.each(['/library', '/pieces/new', '/pieces/p1', '/pieces/p1/processing', '/pieces/p1/practice', '/pieces/p1/edit', '/settings'])(
    'keeps a signed-out visitor out of %s',
    async (path) => {
      const { router } = renderWithApp(path)

      await waitFor(() => expect(pathNow(router)).toBe('/'))
    },
  )

  it('sends a signed-in user who has not accepted the terms from /library to /terms', async () => {
    const { router } = renderWithApp('/library', { signedIn: true })

    await waitFor(() => expect(pathNow(router)).toBe('/terms'))
  })

  it('sends a signed-in user who has not accepted the terms from every account page to /terms', async () => {
    const { router } = renderWithApp('/settings', { signedIn: true })

    await waitFor(() => expect(pathNow(router)).toBe('/terms'))
  })

  it('sends a signed-in user with accepted terms from / to /library', async () => {
    const { router } = renderWithApp('/', { signedIn: true, termsAccepted: true })

    await waitFor(() => expect(pathNow(router)).toBe('/library'))
  })

  it('sends a signed-in user who has not accepted the terms from / to /terms', async () => {
    const { router } = renderWithApp('/', { signedIn: true })

    await waitFor(() => expect(pathNow(router)).toBe('/terms'))
  })

  it('lets a signed-in user with accepted terms stay on the account pages', async () => {
    const { router } = renderWithApp('/settings', { signedIn: true, termsAccepted: true })

    expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument()
    expect(pathNow(router)).toBe('/settings')
  })

  it('leaves /terms public, signed out or signed in', async () => {
    const signedOut = renderWithApp('/terms')
    expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument()
    expect(pathNow(signedOut.router)).toBe('/terms')
    signedOut.unmount()

    const signedIn = renderWithApp('/terms', { signedIn: true, termsAccepted: true })
    expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument()
    expect(pathNow(signedIn.router)).toBe('/terms')
  })

  it('moves a signed-out visitor on to /terms when they sign in on the landing page', async () => {
    const { router, fakes } = renderWithApp('/')
    expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument()

    await act(async () => {
      await fakes.data.signInWithGoogle()
    })

    await waitFor(() => expect(pathNow(router)).toBe('/terms'))
  })

  it('sends a user back to / when they sign out of an account page', async () => {
    const { router, fakes } = renderWithApp('/library', { signedIn: true, termsAccepted: true })
    await waitFor(() => expect(pathNow(router)).toBe('/library'))
    expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument()

    await act(() => fakes.data.signOut())

    await waitFor(() => expect(pathNow(router)).toBe('/'))
  })
})

describe('the loading state', () => {
  it('shows the loading state, not the wrong page, while the session loads', async () => {
    const fakes = createFakes({ signedIn: true, termsAccepted: true })
    let giveUser: (user: Awaited<ReturnType<typeof fakes.data.getUser>>) => void = () => {}
    const getUser = fakes.data.getUser
    fakes.data.getUser = () => new Promise((resolve) => (giveUser = resolve))

    const { router } = renderWithApp('/library', { fakes })

    expect(screen.getByRole('status', { name: strings.common.loading })).toBeInTheDocument()
    expect(screen.getByText(strings.common.loadingSession)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument()
    expect(pathNow(router)).toBe('/library')

    giveUser(await getUser())

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
    expect(pathNow(router)).toBe('/library')
  })

  it('does not redirect a visitor to /library before it knows who they are', async () => {
    const fakes = createFakes()
    fakes.data.getUser = () => new Promise(() => {})

    const { router } = renderWithApp('/library', { fakes })
    await act(async () => {})

    expect(pathNow(router)).toBe('/library')
    expect(screen.getByRole('status')).toBeInTheDocument()
  })
})

describe('the other pages', () => {
  it('shows the not found page for an unknown path, signed in or not', async () => {
    const signedOut = renderWithApp('/nowhere')
    expect(await screen.findByRole('heading', { name: strings.common.notFoundTitle })).toBeInTheDocument()
    expect(pathNow(signedOut.router)).toBe('/nowhere')
    signedOut.unmount()

    renderWithApp('/pieces/p1/unknown', { signedIn: true, termsAccepted: true })
    expect(await screen.findByRole('heading', { name: strings.common.notFoundTitle })).toBeInTheDocument()
  })

  it('offers a way back to the library from the not found page', async () => {
    renderWithApp('/nowhere', { signedIn: true, termsAccepted: true })

    const link = await screen.findByRole('link', { name: strings.common.goToLibrary })
    expect(link).toHaveAttribute('href', '/library')
  })

  it('opens Practice for a piece of the demo, signed in with accepted terms', async () => {
    const { router } = renderWithApp('/pieces/piece-clark-county/practice', { seed: 'demo' })

    expect(await screen.findByRole('heading', { level: 1, name: 'Clark County Celebration' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: strings.practice.toolbar })).toBeInTheDocument()
    expect(pathNow(router)).toBe('/pieces/piece-clark-county/practice')
  })

  it('shows the not found page for the Practice of a piece that does not exist', async () => {
    renderWithApp('/pieces/p1/practice', { signedIn: true, termsAccepted: true })

    expect(await screen.findByRole('heading', { name: strings.common.notFoundTitle })).toBeInTheDocument()
  })

  it('opens the Editor for a piece of the demo, signed in with accepted terms', async () => {
    renderWithApp('/pieces/piece-clark-county/edit', { seed: 'demo' })

    expect(await screen.findByRole('heading', { level: 1, name: 'Clark County Celebration' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: strings.editor.sheet })).toBeInTheDocument()
  })
})
