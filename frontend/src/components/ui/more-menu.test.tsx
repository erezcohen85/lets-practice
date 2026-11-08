import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Pencil, Trash2 } from 'lucide-react'
import { describe, expect, it, vi } from 'vitest'
import { MoreMenu } from '@/components/ui/more-menu'

function setup(overrides: Partial<Parameters<typeof MoreMenu>[0]> = {}) {
  const onRename = vi.fn()
  const onDelete = vi.fn()
  const user = userEvent.setup()
  render(
    <div>
      <MoreMenu
        label="More for Sonata"
        items={[
          { label: 'Rename', icon: Pencil, onSelect: onRename },
          { label: 'Delete', icon: Trash2, onSelect: onDelete, danger: true },
        ]}
        {...overrides}
      />
      <button type="button">Elsewhere</button>
    </div>,
  )
  return { user, onRename, onDelete, trigger: () => screen.getByRole('button', { name: 'More for Sonata' }) }
}

describe('MoreMenu', () => {
  it('is a 44 px button named by its label that says it opens a menu, closed at first', () => {
    const { trigger } = setup()

    expect(trigger()).toHaveAttribute('aria-haspopup', 'menu')
    expect(trigger()).toHaveAttribute('aria-expanded', 'false')
    expect(trigger().className).toContain('size-11')
    expect(trigger().querySelector('svg')).not.toBeNull()
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('opens a menu of its items, each with an icon, 180 px wide', async () => {
    const { user, trigger } = setup()

    await user.click(trigger())

    const menu = await screen.findByRole('menu')
    expect(trigger()).toHaveAttribute('aria-expanded', 'true')
    const items = screen.getAllByRole('menuitem')
    expect(items.map((item) => item.textContent)).toEqual(['Rename', 'Delete'])
    for (const item of items) {
      expect(item.querySelector('svg')).not.toBeNull()
      expect(item.className).toContain('h-11')
    }
    expect(menu.className).toContain('w-45')
  })

  it('styles a danger item with the problem colour and the others with the text colour', async () => {
    const { user, trigger } = setup()
    await user.click(trigger())

    await screen.findByRole('menu')
    expect(screen.getByRole('menuitem', { name: 'Delete' }).className).toContain('text-problem')
    expect(screen.getByRole('menuitem', { name: 'Delete' }).className).not.toContain('text-text ')
    expect(screen.getByRole('menuitem', { name: 'Rename' }).className).toContain('text-text')
    expect(screen.getByRole('menuitem', { name: 'Rename' }).className).not.toContain('text-problem')
  })

  it('runs the item and closes when an item is chosen', async () => {
    const { user, trigger, onRename, onDelete } = setup()
    await user.click(trigger())

    await user.click(await screen.findByRole('menuitem', { name: 'Rename' }))

    expect(onRename).toHaveBeenCalledTimes(1)
    expect(onDelete).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
  })

  it('closes on Escape and gives the focus back to the button', async () => {
    const { user, trigger } = setup()
    await user.click(trigger())
    await screen.findByRole('menu')

    await user.keyboard('{Escape}')

    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    expect(trigger()).toHaveFocus()
    expect(trigger()).toHaveAttribute('aria-expanded', 'false')
  })

  it('closes on a click outside, and the item is not run', async () => {
    const { user, trigger, onRename, onDelete } = setup()
    await user.click(trigger())
    await screen.findByRole('menu')

    await user.click(screen.getByRole('button', { name: 'Elsewhere' }))

    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    expect(onRename).not.toHaveBeenCalled()
    expect(onDelete).not.toHaveBeenCalled()
  })

  it('moves through the items with the arrow keys and chooses with Enter', async () => {
    const { user, trigger, onDelete } = setup()
    trigger().focus()

    await user.keyboard('{Enter}')
    await screen.findByRole('menu')
    // Opened from the keyboard, the first item takes the focus.
    await waitFor(() => expect(screen.getAllByRole('menuitem')[0]).toHaveFocus())
    await user.keyboard('{ArrowDown}')
    await waitFor(() => expect(screen.getAllByRole('menuitem')[1]).toHaveFocus())
    await user.keyboard('{ArrowUp}')
    await waitFor(() => expect(screen.getAllByRole('menuitem')[0]).toHaveFocus())
    await user.keyboard('{ArrowUp}')
    await waitFor(() => expect(screen.getAllByRole('menuitem')[1]).toHaveFocus())
    await user.keyboard('{Enter}')

    expect(onDelete).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
  })

  it('opens with the arrow key from the button too', async () => {
    const { user, trigger } = setup()
    trigger().focus()

    await user.keyboard('{ArrowDown}')

    expect(await screen.findByRole('menu')).toBeInTheDocument()
  })

  it('does not run a disabled item', async () => {
    const onSelect = vi.fn()
    const { user, trigger } = setup({ items: [{ label: 'Share', icon: Pencil, onSelect, disabled: true }] })
    await user.click(trigger())

    await user.click(await screen.findByRole('menuitem', { name: 'Share' }))

    expect(onSelect).not.toHaveBeenCalled()
  })
})
