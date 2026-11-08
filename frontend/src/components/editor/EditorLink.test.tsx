import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { strings } from '@/strings'
import { stubPhoneWindow } from '@/test/phoneWindow'
import { EditorLink } from './EditorLink'

const text = strings.editor.phone

function open() {
  const router = createMemoryRouter(
    [
      { path: '/here', element: <EditorLink to="/pieces/p/edit?part=a">Edit map</EditorLink> },
      { path: '/pieces/p/edit', element: <p>the editor</p> },
    ],
    { initialEntries: ['/here'] },
  )
  const user = userEvent.setup()
  render(<RouterProvider router={router} />)
  return { user, router }
}

afterEach(() => vi.unstubAllGlobals())

describe('EditorLink', () => {
  it('opens the editor on a tablet or a computer', async () => {
    stubPhoneWindow(false)
    const { user, router } = open()

    await user.click(screen.getByRole('link', { name: 'Edit map' }))

    expect(router.state.location.pathname).toBe('/pieces/p/edit')
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('on a phone, opens a pop-up instead and stays where it is', async () => {
    stubPhoneWindow(true)
    const { user, router } = open()

    await user.click(screen.getByRole('link', { name: 'Edit map' }))

    const dialog = await screen.findByRole('alertdialog', { name: text.title })
    expect(within(dialog).getByText(text.text)).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/here')
  })

  it('the pop-up has only Back, which closes it', async () => {
    stubPhoneWindow(true)
    const { user, router } = open()
    await user.click(screen.getByRole('link', { name: 'Edit map' }))
    const dialog = await screen.findByRole('alertdialog', { name: text.title })

    expect(within(dialog).getAllByRole('button').map((button) => button.textContent)).toEqual([text.back])
    await user.click(within(dialog).getByRole('button', { name: text.back }))

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/here')
  })

  it("keeps the editor's address on the link", () => {
    stubPhoneWindow(true)
    open()

    expect(screen.getByRole('link', { name: 'Edit map' })).toHaveAttribute('href', '/pieces/p/edit?part=a')
  })
})
