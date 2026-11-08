import { act, render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, type RouteObject } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { ClientsProvider } from '@/lib/clients'
import { DEFAULT_SETTINGS } from '@/lib/dataClient'
import { createDemoClients } from '@/lib/demo/demoClients'
import { createFakes } from '@/lib/fakes'
import { SessionProvider } from '@/lib/session'
import { DemoPage } from '@/pages/DemoPage'
import { routes } from '@/routes'
import { strings } from '@/strings'
import { renderWithApp } from '@/test/render'

const theme = () => document.documentElement.dataset.theme

/** A signed-in demo user who has chosen the light theme, with the terms accepted. */
async function lightUser() {
  const fakes = createFakes({ seed: 'demo' })
  await fakes.data.saveSettings({ ...DEFAULT_SETTINGS, theme: 'light' })
  return fakes
}

afterEach(() => {
  delete document.documentElement.dataset.theme
})

describe('the theme of the page', () => {
  it('is dark for a signed-in user who has not chosen light', async () => {
    renderWithApp('/library', { seed: 'demo' })

    await screen.findByRole('heading', { level: 1 })
    expect(theme()).toBe('dark')
  })

  it('is light on the pages of the app for a user who chose light, and stays so while moving between them', async () => {
    const fakes = await lightUser()
    const { router } = renderWithApp('/library', { fakes })
    await screen.findByRole('heading', { level: 1 })
    expect(theme()).toBe('light')

    await act(() => router.navigate('/settings'))
    await screen.findByRole('heading', { level: 1, name: strings.settings.title })
    expect(theme()).toBe('light')
  })

  it('is set on the html element, not on a wrapper', async () => {
    const fakes = await lightUser()
    renderWithApp('/library', { fakes })

    await waitFor(() => expect(document.documentElement).toHaveAttribute('data-theme', 'light'))
    expect(document.body).not.toHaveAttribute('data-theme')
    expect(document.querySelector('body [data-theme]')).toBeNull()
  })

  it('is dark on the Terms for a light user, and back to light on leaving them', async () => {
    const fakes = await lightUser()
    const { router } = renderWithApp('/terms', { fakes })
    await screen.findByRole('heading', { level: 1 })
    expect(theme()).toBe('dark')

    await act(() => router.navigate('/library'))
    await waitFor(() => expect(theme()).toBe('light'))
  })

  it('is dark on the landing page for someone signed out', async () => {
    renderWithApp('/', { seed: 'demo', signedIn: false })
    await screen.findByRole('heading', { level: 1 })
    expect(theme()).toBe('dark')
  })

  it('goes back to dark when a light user signs out', async () => {
    const fakes = await lightUser()
    const { user, router } = renderWithApp('/settings', { fakes })
    await screen.findByRole('heading', { level: 1, name: strings.settings.title })
    expect(theme()).toBe('light')

    await user.click(screen.getByRole('button', { name: strings.settings.signOut }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
    expect(theme()).toBe('dark')
  })

  it('is light the moment the switch is turned on in Settings, and dark again when it is turned off', async () => {
    const { user } = renderWithApp('/settings', { seed: 'demo' })
    const light = await screen.findByRole('switch', { name: strings.settings.lightMode })
    expect(theme()).toBe('dark')

    await user.click(light)
    await waitFor(() => expect(theme()).toBe('light'))

    await user.click(light)
    await waitFor(() => expect(theme()).toBe('dark'))
  })
})

describe('the theme on the public demo', () => {
  /** The demo page inside the app's own providers, as main.tsx has them; `demoLight` makes the demo's own session hold a light setting. */
  async function openDemo({ outer, demoLight = false }: { outer: 'light' | 'dark' | 'signed-out'; demoLight?: boolean }) {
    const fakes = createFakes({ seed: 'demo', signedIn: outer !== 'signed-out' })
    if (outer === 'light') await fakes.data.saveSettings({ ...DEFAULT_SETTINGS, theme: 'light' })
    const demoClients = createDemoClients({ baseUrl: '/demo/none', fetchFn: () => Promise.resolve(new Response('missing', { status: 404 })) })
    if (demoLight) {
      const profile = await demoClients.data.getProfile()
      vi.spyOn(demoClients.data, 'getProfile').mockResolvedValue({ ...profile, settings: { ...profile.settings, theme: 'light' } })
    }
    const table = routes.map((route): RouteObject => ({
      ...route,
      children: route.children?.map((child) => (child.path === '/demo' ? { ...child, element: <DemoPage clients={demoClients} /> } : child)),
    }) as RouteObject)
    const router = createMemoryRouter(table, { initialEntries: ['/demo'] })
    render(
      <ClientsProvider clients={{ data: fakes.data, processor: fakes.processor }}>
        <SessionProvider>
          <RouterProvider router={router} />
        </SessionProvider>
      </ClientsProvider>,
    )
    await screen.findByRole('link', { name: strings.demo.back })
    return router
  }

  it('is dark for a signed-in light user, and light again on leaving', async () => {
    const router = await openDemo({ outer: 'light' })
    expect(theme()).toBe('dark')

    await act(() => router.navigate('/library'))
    await waitFor(() => expect(theme()).toBe('light'))
  })

  it('is decided by nothing in the demo session: its own light setting changes nothing', async () => {
    await openDemo({ outer: 'dark', demoLight: true })
    expect(theme()).toBe('dark')
  })

  it('is dark for a visitor who is signed out, whatever the demo session holds', async () => {
    await openDemo({ outer: 'signed-out', demoLight: true })
    expect(theme()).toBe('dark')
  })
})
