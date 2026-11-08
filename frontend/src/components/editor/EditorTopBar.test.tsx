import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { strings } from '@/strings'
import { EditorTopBar, type EditorTopBarProps } from './EditorTopBar'

const text = strings.editor
const PARTS = [
  { id: 'a', name: 'Clarinet in B♭ 1' },
  { id: 'b', name: 'Trumpet in B♭ 2' },
]

function setup(props: Partial<EditorTopBarProps> = {}) {
  const handlers = { onPartChange: vi.fn() }
  const user = userEvent.setup()
  render(
    <MemoryRouter>
      <EditorTopBar
        pieceId="p1"
        title="Clark County Celebration"
        parts={PARTS}
        partId="a"
        practiceHref="/pieces/p1/practice?part=a&bar=33"
        {...handlers}
        {...props}
      />
    </MemoryRouter>,
  )
  return { user, ...handlers }
}

describe('EditorTopBar', () => {
  it('has the way back, the title, the part chip, the Practice / Edit toggle and no zoom (it moved to the Edit bar lines row)', () => {
    setup()

    expect(screen.getByRole('link', { name: text.pieceHub })).toHaveAttribute('href', '/pieces/p1')
    expect(screen.getByRole('heading', { level: 1, name: 'Clark County Celebration' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Clarinet in B♭ 1' })).toHaveAttribute('aria-haspopup', 'menu')
    expect(screen.getByRole('link', { name: strings.common.viewPractice })).toHaveAttribute('href', '/pieces/p1/practice?part=a&bar=33')
    expect(screen.getByRole('link', { name: strings.common.viewEdit })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: strings.common.viewEdit })).toHaveAttribute('href', '/pieces/p1/edit?part=a')
    expect(screen.queryByText('100%')).toBeNull()
    expect(screen.queryByRole('button', { name: strings.score.zoomIn })).toBeNull()
  })

  it('keeps the way back and the part chip on one line, and lets only the names truncate', () => {
    setup()

    expect(screen.getByRole('link', { name: text.pieceHub })).toHaveClass('whitespace-nowrap')
    const chip = screen.getByRole('button', { name: 'Clarinet in B♭ 1' })
    expect(chip).toHaveClass('whitespace-nowrap', 'shrink-0')
    expect(chip).toHaveAttribute('title', 'Clarinet in B♭ 1')
    expect(within(chip).getByText('Clarinet in B♭ 1')).toHaveClass('truncate')
    expect(screen.getByRole('heading', { level: 1 })).toHaveClass('truncate')
  })

  it('opens the part menu with the current part checked, and choosing a part calls onPartChange and closes it', async () => {
    const { user, onPartChange } = setup()

    await user.click(screen.getByRole('button', { name: 'Clarinet in B♭ 1' }))
    const menu = screen.getByRole('menu', { name: text.partMenu })
    expect(within(menu).getByRole('menuitemradio', { name: 'Clarinet in B♭ 1' })).toHaveAttribute('aria-checked', 'true')
    expect(within(menu).getByRole('menuitemradio', { name: 'Trumpet in B♭ 2' })).toHaveAttribute('aria-checked', 'false')
    await user.click(within(menu).getByRole('menuitemradio', { name: 'Trumpet in B♭ 2' }))

    expect(onPartChange).toHaveBeenCalledWith('b')
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('closes the menu with Escape (focus back on the chip) and with a click outside', async () => {
    const { user } = setup()
    const chip = screen.getByRole('button', { name: 'Clarinet in B♭ 1' })

    await user.click(chip)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).toBeNull()
    expect(chip).toHaveFocus()

    await user.click(chip)
    await user.click(screen.getByRole('heading', { level: 1 }))
    expect(screen.queryByRole('menu')).toBeNull()
  })

  describe('renaming the part', () => {
    const rename = (extra: Partial<EditorTopBarProps> = {}) => {
      const onRenamePart = vi.fn().mockResolvedValue(undefined)
      return { onRenamePart, ...setup({ onRenamePart, ...extra }) }
    }
    const openDialog = async (user: ReturnType<typeof userEvent.setup>) => {
      await user.click(screen.getByRole('button', { name: 'Clarinet in B♭ 1' }))
      await user.click(within(screen.getByRole('menu', { name: text.partMenu })).getByRole('menuitem', { name: text.renamePart }))
      const dialog = await screen.findByRole('dialog', { name: strings.hub.renamePartTexts.title })
      return { dialog, field: within(dialog).getByRole('textbox', { name: strings.hub.renamePartTexts.label }) }
    }

    it('has no rename item when the page gives no way to rename', async () => {
      const { user } = setup()

      await user.click(screen.getByRole('button', { name: 'Clarinet in B♭ 1' }))

      expect(screen.queryByRole('menuitem', { name: text.renamePart })).toBeNull()
    })

    it('adds "Rename this part" to the part menu, below the parts', async () => {
      const { user } = rename()

      await user.click(screen.getByRole('button', { name: 'Clarinet in B♭ 1' }))

      const menu = screen.getByRole('menu', { name: text.partMenu })
      const items = menu.querySelectorAll('[role^="menuitem"]')
      expect([...items].map((item) => item.textContent)).toEqual(['Clarinet in B♭ 1', 'Trumpet in B♭ 2', text.renamePart])
    })

    it('closes the menu and opens a dialog with the current part name filled in and focused', async () => {
      const { user } = rename()

      const { field } = await openDialog(user)

      expect(screen.queryByRole('menu')).toBeNull()
      expect(field).toHaveValue('Clarinet in B♭ 1')
      await waitFor(() => expect(field).toHaveFocus())
    })

    it('saves the trimmed name with Enter and closes the dialog', async () => {
      const { user, onRenamePart } = rename()
      const { field } = await openDialog(user)

      await user.clear(field)
      await user.type(field, '  Clarinet 1  {Enter}')

      expect(onRenamePart).toHaveBeenCalledWith('Clarinet 1')
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    })

    it('cancels with Escape without saving', async () => {
      const { user, onRenamePart } = rename()
      const { field } = await openDialog(user)

      await user.type(field, ' x')
      await user.keyboard('{Escape}')

      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
      expect(onRenamePart).not.toHaveBeenCalled()
    })

    it('refuses an empty name and one of more than 80 characters', async () => {
      const { user, onRenamePart } = rename()
      const { dialog, field } = await openDialog(user)

      await user.clear(field)
      await user.keyboard('{Enter}')
      expect(await within(dialog).findByText(strings.hub.renamePartTexts.empty)).toBeInTheDocument()

      await user.click(field)
      await user.paste('p'.repeat(81))
      await user.keyboard('{Enter}')
      expect(await within(dialog).findByText(strings.hub.renamePartTexts.tooLong)).toBeInTheDocument()
      expect(onRenamePart).not.toHaveBeenCalled()
    })

    it('says so and stays open when the name could not be saved', async () => {
      const { user, onRenamePart } = rename()
      onRenamePart.mockRejectedValueOnce(new Error('down'))
      const { dialog, field } = await openDialog(user)

      await user.clear(field)
      await user.type(field, 'Clarinet 1{Enter}')

      expect(await within(dialog).findByText(strings.hub.renamePartTexts.failed)).toBeInTheDocument()
    })
  })
})
