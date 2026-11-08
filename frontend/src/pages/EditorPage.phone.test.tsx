import { fireEvent, screen, within } from '@testing-library/react'
import { createFakes } from '@/lib/fakes'
import { strings } from '@/strings'
import { stubPhoneWindow } from '@/test/phoneWindow'
import { renderWithApp } from '@/test/render'

// The editor needs a computer or a tablet (Decisions 2026-11-08): on a phone its buttons open a pop-up, and its address
// shows a message page instead of the editor. A computer always gets the editor, however small its window.

const text = strings.editor.phone
const hub = strings.hub
const CLARK = 'piece-clark-county'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function openHub() {
  const view = renderWithApp(`/pieces/${CLARK}`, { seed: 'demo' })
  await screen.findByRole('list', { name: hub.parts })
  return view
}

async function popUpThenBack(view: Awaited<ReturnType<typeof openHub>>, path: string) {
  const dialog = await screen.findByRole('alertdialog', { name: text.title })
  expect(within(dialog).getByText(text.text)).toBeInTheDocument()
  expect(view.router.state.location.pathname).toBe(path)

  await view.user.click(within(dialog).getByRole('button', { name: text.back }))

  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  expect(view.router.state.location.pathname).toBe(path)
}

describe('the editor on a phone', () => {
  it('Edit map on the hub opens the pop-up and stays on the hub', async () => {
    stubPhoneWindow(true)
    const view = await openHub()

    await view.user.click(screen.getByRole('link', { name: hub.editMap }))

    await popUpThenBack(view, `/pieces/${CLARK}`)
  })

  it("a part's edit button on the hub opens the pop-up and stays on the hub", async () => {
    stubPhoneWindow(true)
    const view = await openHub()
    const firstPart = within(screen.getByRole('list', { name: hub.parts })).getAllByRole('listitem')[0]

    await view.user.click(within(firstPart).getByRole('link', { name: /^Edit / }))

    await popUpThenBack(view, `/pieces/${CLARK}`)
  })

  it('the Edit side of the Practice / Edit switch opens the pop-up and stays on Practice', async () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(358)
    stubPhoneWindow(true)
    const view = renderWithApp(`/pieces/${CLARK}/practice`, { fakes: createFakes({ seed: 'demo' }), playerSec: 271 })
    await screen.findAllByRole('img', { name: /^Page \d of 4$/ }, { timeout: 15000 })
    const links = within(screen.getByRole('group', { name: strings.common.viewSwitch }))

    fireEvent.click(links.getByRole('link', { name: strings.common.viewEdit }))

    await popUpThenBack(view, `/pieces/${CLARK}/practice`)
  })

  it("the editor's address shows a message page with the way to Practice and back to the piece, not the editor", async () => {
    stubPhoneWindow(true)
    const fakes = createFakes({ seed: 'demo' })
    const part = (await fakes.data.getPiece(CLARK))!.parts[0].id
    renderWithApp(`/pieces/${CLARK}/edit?part=${part}`, { fakes })

    expect(await screen.findByRole('heading', { name: text.title })).toBeInTheDocument()
    expect(screen.getByText(text.text)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: text.practice })).toHaveAttribute('href', `/pieces/${CLARK}/practice?part=${part}`)
    expect(screen.getByRole('link', { name: text.pieceHub })).toHaveAttribute('href', `/pieces/${CLARK}`)
    expect(screen.queryByRole('img', { name: /^Page \d of 4$/ })).not.toBeInTheDocument()
  })
})

describe('the editor on a computer window dragged to phone size', () => {
  it('opens the editor from Edit map', async () => {
    stubPhoneWindow(true, { mouse: true })
    const view = await openHub()

    await view.user.click(screen.getByRole('link', { name: hub.editMap }))

    expect(await screen.findAllByRole('img', { name: /^Page \d of 4$/ })).not.toHaveLength(0)
    expect(view.router.state.location.pathname).toBe(`/pieces/${CLARK}/edit`)
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })
})
