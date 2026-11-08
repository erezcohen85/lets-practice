import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { ClientsProvider } from '@/lib/clients'
import { createFakes } from '@/lib/fakes'
import { createFakePlayer, type FakePlayer } from '@/lib/fakes/fakePlayer'
import { SessionProvider } from '@/lib/session'
import { routes } from '@/routes'
import { strings } from '@/strings'

const CLARK = 'piece-clark-county'

/** The Editor on the demo piece, with every player the page makes kept so a test can see which one is alive. */
async function open() {
  const fakes = createFakes({ seed: 'demo' })
  const players: FakePlayer[] = []
  const destroyed = vi.fn()
  const detail = (await fakes.data.getPiece(CLARK))!
  const router = createMemoryRouter(routes, { initialEntries: [`/pieces/${CLARK}/edit?part=${detail.parts[0].id}`] })
  const user = userEvent.setup()
  render(
    <ClientsProvider
      clients={{
        data: fakes.data,
        processor: fakes.processor,
        createPlayer: () => {
          const player = createFakePlayer(260)
          const destroy = player.destroy.bind(player)
          player.destroy = () => {
            destroyed()
            destroy()
          }
          players.push(player)
          return player
        },
      }}
    >
      <SessionProvider>
        <RouterProvider router={router} />
      </SessionProvider>
    </ClientsProvider>,
  )
  await screen.findAllByRole('img', { name: /^Page \d of 4$/ })
  await screen.findByRole('button', { name: strings.dock.play })
  return { user, players, destroyed }
}

const strip = () => screen.getByRole('region', { name: strings.structure.title })
const toggle = () => screen.getByRole('button', { name: strings.structure.title })
const region = () => document.querySelector<HTMLElement>('[data-slot="dock-region"]')!
const body = () => document.querySelector<HTMLElement>('[data-slot="structure-body"]')

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('Structure opens downward in place of the waveform dock', () => {
  it('keeps the strip where it is, opens the panel under it and takes the dock out of reach until it closes', async () => {
    const { user } = await open()
    expect(body()).toBeNull()
    expect(region()).not.toHaveAttribute('inert')

    await user.click(toggle())

    expect(body()).not.toBeNull()
    expect(strip().contains(body())).toBe(true)
    expect(body()).toHaveClass('top-full')
    expect(body()).not.toHaveClass('bottom-full')
    expect(region()).toHaveAttribute('inert')
    // The strip sits between the score area and the dock region, and the panel is its last child, so it lies under the strip.
    expect(strip().nextElementSibling).toBe(region())
    expect(strip().lastElementChild).toBe(body())

    await user.click(toggle())

    expect(body()).toBeNull()
    expect(region()).not.toHaveAttribute('inert')
  })

  it('closes on Escape', async () => {
    const { user } = await open()
    await user.click(toggle())
    expect(body()).not.toBeNull()

    await user.keyboard('{Escape}')

    expect(body()).toBeNull()
    expect(toggle()).toHaveAttribute('aria-expanded', 'false')
    expect(region()).not.toHaveAttribute('inert')
  })

  it('keeps the same player, still playing and at its time, through an open and a close', async () => {
    const { user, players, destroyed } = await open()
    await user.click(screen.getByRole('button', { name: strings.dock.play }))
    expect(players).toHaveLength(1)
    act(() => players[0].advance(5))
    const time = players[0].getTime()
    expect(time).toBeGreaterThan(0)

    await user.click(toggle())
    expect(within(region()).getByRole('button', { name: strings.dock.pause })).toBeInTheDocument()
    await user.click(toggle())

    expect(players).toHaveLength(1)
    expect(destroyed).not.toHaveBeenCalled()
    expect(players[0].isPlaying()).toBe(true)
    expect(players[0].getTime()).toBe(time)
    expect(screen.getByRole('button', { name: strings.dock.pause })).toBeInTheDocument()
  })
})

describe('Edit as text belongs to the open panel', () => {
  const asText = () => screen.getByRole('switch', { name: strings.structure.editAsText })
  const textbox = () => screen.queryByRole('textbox', { name: strings.structure.text.label })

  it('is not on the strip while the panel is closed, and neither are the tabs', async () => {
    await open()

    expect(screen.queryByRole('switch', { name: strings.structure.editAsText })).toBeNull()
    expect(screen.queryByRole('tab')).toBeNull()
    expect(body()).toBeNull()
  })

  it('moves a Bars panel to Meters, which has the text, and stays on the tab chosen when it is switched off', async () => {
    const { user } = await open()
    await user.click(toggle())
    expect(within(strip()).getByRole('heading', { name: strings.structure.sections.bars })).toBeInTheDocument()

    await user.click(asText())
    expect(textbox()).toBeInTheDocument()
    expect(within(strip()).getByRole('heading', { name: strings.structure.text.label })).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: strings.structure.sections.marks }))
    await user.click(asText())

    expect(textbox()).toBeNull()
    expect(within(strip()).getByRole('heading', { name: strings.structure.sections.marks })).toBeInTheDocument()
    expect(region()).toHaveAttribute('inert')
  })

  it('goes with the panel: closing it on Escape turns the text off, and the panel opens on the forms again', async () => {
    const { user } = await open()
    await user.click(toggle())
    await user.click(asText())

    await user.keyboard('{Escape}')
    expect(body()).toBeNull()
    expect(region()).not.toHaveAttribute('inert')
    await user.click(toggle())

    expect(textbox()).toBeNull()
    expect(asText()).not.toBeChecked()
  })
})

describe('Structure takes the height it needs', () => {
  const regionHeight = () => document.querySelector('main')!.style.getPropertyValue('--region-height')
  const dockLine = () => screen.getByRole('separator', { name: strings.editor.resizeDock })

  /** jsdom has no layout: the content of the open section measures `height` px. */
  function measured(height: number) {
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return this.dataset.slot === 'structure-content' ? height : 0
    })
  }
  function setWindow(height: number) {
    vi.stubGlobal('innerHeight', height)
    act(() => {
      window.dispatchEvent(new Event('resize'))
    })
  }

  it('makes the region as tall as the content when that is between the dock and 60 % of the window, and gives the dock back on close', async () => {
    setWindow(900)
    measured(400)
    const { user } = await open()
    expect(regionHeight()).toBe('262px')

    await user.click(toggle())

    expect(regionHeight()).toBe('400px')
    expect(region().className).toContain('lg:h-(--region-height)')
    expect(body()!.className).toContain('lg:h-(--region-height')
    expect(dockLine()).toHaveAttribute('aria-valuenow', '400')

    await user.click(toggle())

    expect(regionHeight()).toBe('262px')
    expect(dockLine()).toHaveAttribute('aria-valuenow', '262')
  })

  it('never goes below the dock height, and stops at 60 % of the window', async () => {
    setWindow(900)
    measured(100)
    const { user } = await open()
    await user.click(toggle())
    expect(regionHeight()).toBe('262px')
    await user.click(toggle())

    measured(5000)
    await user.click(toggle())

    expect(regionHeight()).toBe('540px')
    await user.click(toggle())
    expect(regionHeight()).toBe('262px')
  })

  it('follows the dock height the user set, as the lower limit', async () => {
    setWindow(900)
    measured(300)
    const { user } = await open()
    fireEvent.keyDown(dockLine(), { key: 'ArrowUp', shiftKey: true })
    expect(regionHeight()).toBe('326px')

    await user.click(toggle())
    expect(regionHeight()).toBe('326px')
    await user.click(toggle())

    expect(regionHeight()).toBe('326px')
  })

  it('lets the splitter size the region while open, starts each section at its content height and leaves the dock height alone', async () => {
    setWindow(900)
    measured(400)
    const { user } = await open()
    await user.click(toggle())

    fireEvent.keyDown(dockLine(), { key: 'ArrowUp' })
    expect(regionHeight()).toBe('416px')
    await user.click(screen.getByRole('tab', { name: strings.structure.sections.meters }))
    expect(regionHeight()).toBe('400px')
    fireEvent.keyDown(dockLine(), { key: 'ArrowDown' })
    expect(regionHeight()).toBe('384px')
    await user.click(toggle())

    expect(regionHeight()).toBe('262px')
  })

  it('keeps the player mounted and playing while the region grows', async () => {
    setWindow(900)
    measured(400)
    const { user, players, destroyed } = await open()
    await user.click(screen.getByRole('button', { name: strings.dock.play }))

    await user.click(toggle())
    await user.click(toggle())

    expect(players).toHaveLength(1)
    expect(destroyed).not.toHaveBeenCalled()
    expect(players[0].isPlaying()).toBe(true)
  })
})
