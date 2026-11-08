import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { ClientsProvider } from '@/lib/clients'
import { createFakes } from '@/lib/fakes'
import { createFakePlayer } from '@/lib/fakes/fakePlayer'
import { SessionProvider } from '@/lib/session'
import { routes } from '@/routes'
import { strings } from '@/strings'

// "Edit piece structure", its idle check, the confirm and "Bars in this box" (Decisions 2026-11-03, task 8.18 wave 2).

const CLARK = 'piece-clark-county'
const t = strings.editor.pieceEditing

async function open(structureSet = true) {
  const fakes = createFakes({ seed: 'demo' })
  // The demo piece's structure counts as set unless a test is about the step that sets it.
  if (structureSet) fakes.store.maps.get(CLARK)!.structureSetAt = '2026-11-03T12:00:00.000Z'
  const detail = (await fakes.data.getPiece(CLARK))!
  const router = createMemoryRouter(routes, { initialEntries: [`/pieces/${CLARK}/edit?part=${detail.parts[0].id}`] })
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  render(
    <ClientsProvider clients={{ data: fakes.data, processor: fakes.processor, createPlayer: () => createFakePlayer(260) }}>
      <SessionProvider>
        <RouterProvider router={router} />
      </SessionProvider>
    </ClientsProvider>,
  )
  // The first editor of a loaded run can take more than findBy's second to show its pages.
  await screen.findAllByRole('img', { name: /^Page \d of 4$/ }, { timeout: 10_000 })
  await screen.findByRole('button', { name: strings.dock.play }, { timeout: 10_000 })
  return { user, fakes }
}

/**
 * A closing dialog keeps the page out of reach until it has gone. Polled on the real setTimeout: waitFor's own
 * interval is one of the faked timers here.
 */
async function gone() {
  for (let waited = 0; waited < 5000 && document.querySelector('[role="alertdialog"]') !== null; waited += 20) {
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)))
  }
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
}
const pieceSwitch = () => screen.getByRole('switch', { name: t.switch })

async function turnOn(user: ReturnType<typeof userEvent.setup>) {
  await user.click(pieceSwitch())
  await user.click(await screen.findByRole('button', { name: t.turnOn }))
  await gone()
}

/** Selects the first bar of the score with the arrow key, as a click on it would. */
async function selectFirstBar(user: ReturnType<typeof userEvent.setup>) {
  await user.keyboard('{ArrowRight}')
  return screen.findByRole('group', { name: t.barsInBox })
}

beforeEach(() => {
  // Only the clock and the idle check's interval are faked: the dialogs close on real timers.
  vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['Date', 'setInterval', 'clearInterval'] })
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('the Edit piece structure switch', () => {
  it('is off on open and turns on only after its warning', async () => {
    const { user } = await open()
    expect(pieceSwitch()).not.toBeChecked()
    // The amber band is gone (Erez, 2026-11-06): the red switch itself says it is on.
    expect(screen.queryByText('Editing the piece structure · all parts')).toBeNull()

    await user.click(pieceSwitch())
    const warning = await screen.findByRole('alertdialog', { name: t.warningTitle })
    await user.click(within(warning).getByRole('button', { name: strings.hub.cancel }))
    await gone()
    expect(pieceSwitch()).not.toBeChecked()

    await turnOn(user)
    expect(pieceSwitch()).toBeChecked()
    expect(screen.queryByText('Editing the piece structure · all parts')).toBeNull()

    await user.click(pieceSwitch())
    expect(pieceSwitch()).not.toBeChecked()
  })

  it('asks "Still editing the piece?" after a minute without input, and turns off when nobody answers', async () => {
    const { user } = await open()
    await turnOn(user)

    act(() => vi.advanceTimersByTime(66_000))
    expect(screen.getByText(t.idleAsk)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: t.keep }))
    expect(screen.queryByText(t.idleAsk)).toBeNull()
    expect(pieceSwitch()).toBeChecked()

    act(() => vi.advanceTimersByTime(66_000))
    act(() => vi.advanceTimersByTime(36_000))
    expect(pieceSwitch()).not.toBeChecked()
    expect(screen.getByText(t.idleOff)).toBeInTheDocument()
  })
})

describe('Bars in this box', () => {
  it('turns the selected bar into a multi-rest of this part only, one undo step', async () => {
    const { user } = await open()
    const stepper = await selectFirstBar(user)
    expect(within(stepper).getByRole('spinbutton')).toHaveValue(1)

    await user.click(within(stepper).getByRole('button', { name: t.more }))

    expect(within(stepper).getByRole('spinbutton')).toHaveValue(2)
    expect(screen.getByRole('button', { name: /^Undo: make bar 1 a 2-bar rest$/ })).toBeInTheDocument()
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('draws the part\'s rest bars faintly on the score', async () => {
    const { user } = await open()
    const stepper = await selectFirstBar(user)
    await user.click(within(stepper).getByRole('button', { name: t.more }))
    await user.keyboard('{Escape}')

    expect(document.querySelector('[data-slot="bar-box"][data-bar="2"]')).toHaveAttribute('data-state', 'rest')
  })

  it('with Edit piece structure on it asks first, and Cancel changes nothing', async () => {
    const { user } = await open()
    await turnOn(user)
    const stepper = await selectFirstBar(user)

    await user.click(within(stepper).getByRole('button', { name: t.more }))
    const confirm = await screen.findByRole('alertdialog', { name: t.confirmTitle })
    await user.click(within(confirm).getByRole('button', { name: strings.hub.cancel }))
    await gone()
    expect(within(stepper).getByRole('spinbutton')).toHaveValue(1)

    await user.click(within(stepper).getByRole('button', { name: t.more }))
    await user.click(within(await screen.findByRole('alertdialog', { name: t.confirmTitle })).getByRole('button', { name: t.confirmAction }))
    await gone()
    expect(within(stepper).getByRole('spinbutton')).toHaveValue(2)
    // The piece's new bar has no recording time yet, so the editor fills it at once: one more step after the change.
    await user.click(await screen.findByRole('button', { name: 'Undo: fill the empty bars' }))
    expect(screen.getByRole('button', { name: /^Undo: make bar 1 a 2-bar rest in the piece$/ })).toBeInTheDocument()
  })

  it('takes a typed number as one step', async () => {
    const { user } = await open()
    const stepper = await selectFirstBar(user)
    const field = within(stepper).getByRole('spinbutton')

    fireEvent.change(field, { target: { value: '4' } })
    fireEvent.keyDown(field, { key: 'Enter' })

    expect(field).toHaveValue(4)
    expect(screen.getByRole('button', { name: /^Undo: make bar 1 a 4-bar rest$/ })).toBeInTheDocument()
  })
})

describe('the editor page', () => {
  it('never scrolls as a whole: only the score and the Review Queue scroll', async () => {
    await open()
    expect(screen.getByRole('main')).toHaveClass('h-dvh', 'overflow-hidden')
  })
})
