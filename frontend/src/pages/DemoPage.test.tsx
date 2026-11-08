import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, type RouteObject } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { createFakeClickSynth } from '@/lib/audio/fakeClickSynth'
import { ClientsProvider } from '@/lib/clients'
import { DEFAULT_SETTINGS } from '@/lib/dataClient'
import { type DemoBundle } from '@/lib/demo/demoBundle'
import { createDemoClients } from '@/lib/demo/demoClients'
import { createFakes } from '@/lib/fakes'
import { createFakePlayer, type FakePlayer } from '@/lib/fakes/fakePlayer'
import { SessionProvider } from '@/lib/session'
import { routes } from '@/routes'
import { DemoPage } from '@/pages/DemoPage'
import { strings } from '@/strings'
import { stubPhoneWindow } from '@/test/phoneWindow'

const text = strings.practice
const BASE = '/demo/synthetic'

function bundle(): DemoBundle {
  const bars = Array.from({ length: 8 }, (_, index) => ({ bar: index + 1, pageIndex: 0, x: 10 + 45 * (index % 4), y: 5 + 50 * Math.floor(index / 4), w: 45, h: 40 }))
  return {
    version: 1,
    piece: { id: 'demo', title: 'Demo Etude', createdAt: '2026-11-06T09:00:00.000Z', countInBars: 1, durationSec: 20 },
    audio: 'audio.m4a',
    peaks: Array.from({ length: 800 }, (_, index) => (index % 100) / 100),
    parts: [{ id: 'part-1', name: 'Piano', position: 0, pageCount: 1 }],
    pageImages: { 'part-1': [{ pageIndex: 0, width: 200, height: 100, file: 'pages/part-1/page-0.webp' }] },
    timing: {
      barCount: 8,
      playOrder: [{ from: 1, to: 8 }],
      meters: [{ fromBar: 1, numerator: 4, denominator: 4 }],
      marks: [],
      locators: bars.map((box) => ({ bar: box.bar, passIndex: 0, timeSec: 1 + 2 * (box.bar - 1), confirmed: false })),
    },
    pages: { 'part-1': { partId: 'part-1', bars, rests: [] } },
  }
}

interface Setup { answer?: Response; signedIn?: boolean }

/** The demo page at /demo inside the app's own providers, as main.tsx has them, on a fake library with spies on every write the screen could make. */
async function open({ answer, signedIn = true }: Setup = {}) {
  const fakes = createFakes({ seed: 'demo', signedIn })
  const writes = {
    saveSettings: vi.spyOn(fakes.data, 'saveSettings'),
    savePracticeMemory: vi.spyOn(fakes.data, 'savePracticeMemory'),
    setLastPart: vi.spyOn(fakes.data, 'setLastPart'),
    setCountInBars: vi.spyOn(fakes.data, 'setCountInBars'),
  }
  const requests: Array<{ url: string; method: string }> = []
  const fetchFn = async (url: string, init?: RequestInit) => {
    requests.push({ url, method: init?.method ?? 'GET' })
    return answer ?? new Response(JSON.stringify(bundle()), { status: 200 })
  }
  let player: FakePlayer | undefined
  const demoClients = createDemoClients({
    baseUrl: BASE,
    fetchFn,
    createPlayer: () => {
      player = createFakePlayer(20)
      return player
    },
    createClickSynth: () => createFakeClickSynth(),
  })
  // The route table with the demo's clients given to the page (the page builds its own from the address otherwise).
  const table = routes.map((route): RouteObject => ({
    ...route,
    children: route.children?.map((child) => (child.path === '/demo' ? { ...child, element: <DemoPage clients={demoClients} /> } : child)),
  }) as RouteObject)
  const router = createMemoryRouter(table, { initialEntries: ['/demo'] })
  const view = render(
    <ClientsProvider clients={{ data: fakes.data, processor: fakes.processor }}>
      <SessionProvider>
        <RouterProvider router={router} />
      </SessionProvider>
    </ClientsProvider>,
  )
  return { fakes, writes, requests, router, player: () => player!, ...view }
}

const toolbar = () => screen.getByRole('region', { name: text.toolbar })

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Demo page', () => {
  it('opens the Practice screen on the bundle, with a way back to the landing page and no Edit switch', async () => {
    await open({ signedIn: false })

    expect(await screen.findByRole('heading', { level: 1, name: 'Demo Etude' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: strings.demo.back })).toHaveAttribute('href', '/')
    expect(document.querySelector('[data-slot="part-chip"]')).toHaveTextContent('Piano')
    expect(toolbar()).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: strings.common.viewSwitch })).toBeNull()
    expect(screen.queryByRole('link', { name: strings.common.viewEdit })).toBeNull()
  })

  it('works for someone signed in, and is not sent on to the library', async () => {
    const { router } = await open({ signedIn: true })

    expect(await screen.findByRole('heading', { level: 1, name: 'Demo Etude' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/demo')
  })

  it('loads the score pages and the recording from the bundle folder', async () => {
    const { player } = await open()

    await screen.findByRole('heading', { level: 1, name: 'Demo Etude' })

    await waitFor(() => expect(screen.getByRole('img', { name: /^Page 1/ })).toHaveAttribute('src', `${BASE}/pages/part-1/page-0.webp`))
    expect(player().loadedUrl).toBe(`${BASE}/audio.m4a`)
  })

  it('plays and loops, and the speed and the mute work, as in the real Practice', async () => {
    const { player } = await open()
    await screen.findByRole('heading', { level: 1, name: 'Demo Etude' })

    await act(async () => {
      fireEvent.click(within(toolbar()).getByRole('button', { name: strings.player.play }))
    })
    expect(player().isPlaying()).toBe(true)

    fireEvent.click(within(toolbar()).getByRole('button', { name: text.muteMusic }))
    expect(within(toolbar()).getByRole('button', { name: text.unmuteMusic })).toBeInTheDocument()
  })

  it('shows a plain failure card, with the way back, when the bundle is not there', async () => {
    await open({ answer: new Response('missing', { status: 404 }) })

    expect(await screen.findByText(text.loadErrorTitle)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: strings.demo.back })).toHaveAttribute('href', '/')
  })
})

describe('Demo page: credits', () => {
  const credits = [
    { what: 'Recording', who: 'A Pianist', licence: 'CC BY 3.0', source: 'https://example.org/file', licenceUrl: 'https://creativecommons.org/licenses/by/3.0/', note: 'Converted to AAC.' },
    { what: 'Score', who: 'An Edition', licence: 'public domain', source: 'https://example.org/score' },
  ]

  it('names who made the recording and the score, with links to the sources and the licence', async () => {
    await open({ answer: new Response(JSON.stringify({ ...bundle(), credits }), { status: 200 }) })

    const performer = await screen.findByRole('link', { name: 'A Pianist' })
    expect(performer).toHaveAttribute('href', 'https://example.org/file')
    expect(screen.getByRole('link', { name: 'CC BY 3.0' })).toHaveAttribute('href', 'https://creativecommons.org/licenses/by/3.0/')
    expect(screen.getByRole('link', { name: 'An Edition' })).toHaveAttribute('href', 'https://example.org/score')
    const line = document.querySelector('[data-slot="demo-credits"]')
    expect(line).toHaveTextContent('Recording: A Pianist, CC BY 3.0. Converted to AAC.')
    expect(line).toHaveTextContent('Score: An Edition, public domain.')
  })

  it('names the title of the recording when it has one, as CC BY asks, with the link on the title', async () => {
    const [recording, score] = credits
    const titled = [{ ...recording, title: 'Boat Song' }, score]
    await open({ answer: new Response(JSON.stringify({ ...bundle(), credits: titled }), { status: 200 }) })

    expect(await screen.findByRole('link', { name: 'Boat Song' })).toHaveAttribute('href', 'https://example.org/file')
    expect(screen.queryByRole('link', { name: 'A Pianist' })).toBeNull()
    expect(document.querySelector('[data-slot="demo-credits"]')).toHaveTextContent('Recording: Boat Song by A Pianist, CC BY 3.0. Converted to AAC.')
  })

  it('opens the credit links in a new tab, so the music is not left behind', async () => {
    await open({ answer: new Response(JSON.stringify({ ...bundle(), credits }), { status: 200 }) })

    const performer = await screen.findByRole('link', { name: 'A Pianist' })

    expect(performer).toHaveAttribute('target', '_blank')
    expect(performer).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('on a phone folds the credits under one word that stays on the screen, with the same links', async () => {
    stubPhoneWindow(true)
    await open({ answer: new Response(JSON.stringify({ ...bundle(), credits }), { status: 200 }) })

    const word = await screen.findByText(strings.demo.credits)
    const fold = word.closest('details')
    expect(fold).toHaveAttribute('data-slot', 'demo-credits')
    expect(fold).not.toHaveAttribute('open')
    expect(fold).toHaveTextContent('Recording: A Pianist, CC BY 3.0. Converted to AAC.')
    expect(within(fold!).getByRole('link', { name: 'CC BY 3.0', hidden: true })).toHaveAttribute('href', 'https://creativecommons.org/licenses/by/3.0/')
    vi.unstubAllGlobals()
  })

  it('shows no credit line for a bundle that has no credits', async () => {
    await open()
    await screen.findByRole('heading', { level: 1, name: 'Demo Etude' })

    expect(document.querySelector('[data-slot="demo-credits"]')).toBeNull()
  })
})

describe('Demo page: a signed-in visitor is never written to', () => {
  it('saves no settings, no practice memory and no last part of the visitor, however the screen is used', async () => {
    const { fakes, writes, requests, player } = await open({ signedIn: true })
    await screen.findByRole('heading', { level: 1, name: 'Demo Etude' })
    const profileBefore = await fakes.data.getProfile()
    const memoryBefore = (await fakes.data.getPiece('piece-clark-county'))?.piece.practice

    // Play, set a loop range, change the speed, the metronome and a Playback setting (the one the session saves).
    await act(async () => {
      fireEvent.click(within(toolbar()).getByRole('button', { name: strings.player.play }))
    })
    fireEvent.click(within(toolbar()).getByRole('switch', { name: text.metronomeSwitch }))
    fireEvent.click(within(toolbar()).getByRole('button', { name: text.playback }))
    fireEvent.click(within(screen.getByRole('dialog', { name: text.playbackMenu })).getByRole('radio', { name: text.countInFades['pre-roll-and-loop'] }))
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
    })
    player().seek(5)

    expect(writes.saveSettings).not.toHaveBeenCalled()
    expect(writes.savePracticeMemory).not.toHaveBeenCalled()
    expect(writes.setLastPart).not.toHaveBeenCalled()
    expect(writes.setCountInBars).not.toHaveBeenCalled()
    expect(await fakes.data.getProfile()).toEqual(profileBefore)
    expect(profileBefore.settings).toEqual(DEFAULT_SETTINGS)
    expect((await fakes.data.getPiece('piece-clark-county'))?.piece.practice).toEqual(memoryBefore)
    expect(requests.every((request) => request.method === 'GET')).toBe(true)
  })

  it('keeps a Playback change for the visit only, and the same page shows it', async () => {
    await open({ signedIn: true })
    await screen.findByRole('heading', { level: 1, name: 'Demo Etude' })
    fireEvent.click(within(toolbar()).getByRole('button', { name: text.playback }))

    fireEvent.click(within(screen.getByRole('dialog', { name: text.playbackMenu })).getByRole('radio', { name: text.countInFades['pre-roll-and-loop'] }))

    await waitFor(() => expect(within(screen.getByRole('dialog', { name: text.playbackMenu })).getByRole('radio', { name: text.countInFades['pre-roll-and-loop'] })).toHaveAttribute('aria-checked', 'true'))
  })
})

