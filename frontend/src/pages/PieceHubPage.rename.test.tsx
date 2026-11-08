import { screen, waitFor, within } from '@testing-library/react'
import { createFakes } from '@/lib/fakes'
import { strings } from '@/strings'
import { chooseFromMenu, openMoreMenu } from '@/test/hubMenu'
import { renderWithApp } from '@/test/render'

const hub = strings.hub
const CLARK = 'piece-clark-county'

/** The hub of Clark County (three parts, a recording named after its file) once its parts have loaded. */
async function openHub(fakes = createFakes({ seed: 'demo' })) {
  const view = renderWithApp(`/pieces/${CLARK}`, { fakes })
  await screen.findByRole('list', { name: hub.parts })
  return { ...view, fakes }
}

// The page behind a modal dialog is hidden from assistive technology, so the list is looked up as hidden.
const rows = () => within(screen.getByRole('list', { name: hub.parts, hidden: true })).getAllByRole('listitem', { hidden: true })
const names = () => rows().map((row) => row.querySelector('[data-slot="part-name"]')?.textContent)
const gone = () => waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

describe('Piece hub: renaming a part', () => {
  async function openRename(index = 1) {
    const view = await openHub()
    const before = names()
    await chooseFromMenu(view.user, before[index]!, hub.rename, rows()[index])
    const dialog = await screen.findByRole('dialog', { name: hub.renamePartTexts.title })
    const field = within(dialog).getByRole('textbox', { name: hub.renamePartTexts.label })
    return { ...view, before, dialog, field }
  }

  it('has a Rename item in the three-dot menu of every part, a button of 44 px named after the part', async () => {
    const { user } = await openHub()

    for (const [index, row] of rows().entries()) {
      expect(within(row).getByRole('button', { name: hub.moreFor(names()[index]!) })).toHaveClass('size-11')
      await openMoreMenu(user, names()[index]!, row)
      expect(screen.getByRole('menuitem', { name: hub.rename })).toBeInTheDocument()
      await user.keyboard('{Escape}')
      await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
    }
  })

  it('opens a dialog with the part name filled in and focused', async () => {
    const { before, field } = await openRename()

    expect(field).toHaveValue(before[1])
    await waitFor(() => expect(field).toHaveFocus())
  })

  it('renames the part: its row shows the new name, the others stay, and the dialog closes', async () => {
    const { user, before, field, dialog } = await openRename()

    await user.clear(field)
    await user.type(field, 'Piccolo')
    await user.click(within(dialog).getByRole('button', { name: hub.renamePartTexts.save }))

    await waitFor(() => expect(names()).toEqual([before[0], 'Piccolo', before[2]]))
    await gone()
  })

  it('names the Practice and Edit links of the part after its new name', async () => {
    const { user, field } = await openRename()

    await user.clear(field)
    await user.type(field, 'Piccolo{Enter}')

    expect(await screen.findByRole('link', { name: hub.practicePart('Piccolo') })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: hub.editPart('Piccolo') })).toBeInTheDocument()
  })

  it('saves with Enter and trims the name', async () => {
    const { user, field, fakes } = await openRename()

    await user.clear(field)
    await user.type(field, '   Piccolo   {Enter}')

    await waitFor(() => expect(names()[1]).toBe('Piccolo'))
    expect([...fakes.store.parts.values()].some((part) => part.name === 'Piccolo')).toBe(true)
  })

  it('cancels with Escape and with Cancel, saving nothing', async () => {
    const { user, before, field } = await openRename()
    await user.clear(field)
    await user.type(field, 'Piccolo')

    await user.keyboard('{Escape}')
    await gone()

    expect(names()).toEqual(before)
    await chooseFromMenu(user, before[1]!, hub.rename, rows()[1])
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('textbox')).toHaveValue(before[1]) // opened again from the saved name
    await user.click(within(dialog).getByRole('button', { name: hub.cancel }))
    await gone()
    expect(names()).toEqual(before)
  })

  it('closes without saving when the name did not change', async () => {
    const { user, fakes, field } = await openRename()
    const rename = vi.spyOn(fakes.data, 'renamePart')

    await user.type(field, '{Enter}')
    await gone()

    expect(rename).not.toHaveBeenCalled()
  })

  it('refuses an empty name: the dialog stays, the field says why and nothing is saved', async () => {
    const { user, before, dialog, field } = await openRename()

    await user.clear(field)
    await user.click(within(dialog).getByRole('button', { name: hub.renamePartTexts.save }))

    expect(await within(dialog).findByText(hub.renamePartTexts.empty)).toBeInTheDocument()
    expect(field).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(names()).toEqual(before)
  })

  it('refuses a name of more than 80 characters and takes 80', async () => {
    const { user, dialog, field } = await openRename()

    await user.clear(field)
    await user.click(field)
    await user.paste('p'.repeat(81))
    await user.keyboard('{Enter}')
    expect(await within(dialog).findByText(hub.renamePartTexts.tooLong)).toBeInTheDocument()

    await user.clear(field)
    await user.paste('p'.repeat(80))
    await user.keyboard('{Enter}')
    await gone()
    expect(names()[1]).toBe('p'.repeat(80))
  })

  it('says so and stays open when the name could not be saved', async () => {
    const { user, before, field, dialog, fakes } = await openRename()
    vi.spyOn(fakes.data, 'renamePart').mockRejectedValueOnce(new Error('down'))

    await user.clear(field)
    await user.type(field, 'Piccolo{Enter}')

    expect(await within(dialog).findByText(hub.renamePartTexts.failed)).toBeInTheDocument()
    expect(names()).toEqual(before)
  })

  it('keeps the new name after leaving the hub and coming back', async () => {
    const { user, field, router } = await openRename()
    await user.clear(field)
    await user.type(field, 'Piccolo{Enter}')
    await waitFor(() => expect(names()[1]).toBe('Piccolo'))

    await user.click(screen.getByRole('link', { name: strings.common.backToLibrary }))
    await screen.findByRole('heading', { name: strings.library.title })
    await router.navigate(`/pieces/${CLARK}`)
    await screen.findByRole('list', { name: hub.parts })

    expect(names()[1]).toBe('Piccolo')
  })
})

describe('Piece hub: renaming the recording', () => {
  async function openRename() {
    const view = await openHub()
    await view.user.click(screen.getByRole('button', { name: hub.renameRecording }))
    const dialog = await screen.findByRole('dialog', { name: hub.renameRecordingTexts.title })
    const field = within(dialog).getByRole('textbox', { name: hub.renameRecordingTexts.label })
    return { ...view, dialog, field }
  }
  const label = () => document.querySelector<HTMLElement>('[data-slot="recording-name"]')!

  it('shows the recording under its name, with a Rename button of 44 px', async () => {
    await openHub()

    expect(label()).toHaveTextContent('clark-county-celebration.mp3')
    expect(screen.getByRole('button', { name: hub.renameRecording })).toHaveClass('size-11')
  })

  it('renames the recording', async () => {
    const { user, field, dialog } = await openRename()
    expect(field).toHaveValue('clark-county-celebration.mp3')

    await user.clear(field)
    await user.type(field, 'Los Banditos band performance march 2019')
    await user.click(within(dialog).getByRole('button', { name: hub.renameRecordingTexts.save }))

    await waitFor(() => expect(label()).toHaveTextContent('Los Banditos band performance march 2019'))
    await gone()
  })

  it('saves with Enter, cancels with Escape', async () => {
    const { user, field } = await openRename()
    await user.clear(field)
    await user.type(field, 'Take 3')
    await user.keyboard('{Escape}')
    await gone()
    expect(label()).toHaveTextContent('clark-county-celebration.mp3')

    await user.click(screen.getByRole('button', { name: hub.renameRecording }))
    const again = within(await screen.findByRole('dialog')).getByRole('textbox')
    await user.clear(again)
    await user.type(again, 'Take 3{Enter}')

    await waitFor(() => expect(label()).toHaveTextContent('Take 3'))
  })

  it('refuses an empty name and one of more than 120 characters', async () => {
    const { user, dialog, field } = await openRename()

    await user.clear(field)
    await user.keyboard('{Enter}')
    expect(await within(dialog).findByText(hub.renameRecordingTexts.empty)).toBeInTheDocument()

    await user.click(field)
    await user.paste('r'.repeat(121))
    await user.keyboard('{Enter}')
    expect(await within(dialog).findByText(hub.renameRecordingTexts.tooLong)).toBeInTheDocument()
    expect(label()).toHaveTextContent('clark-county-celebration.mp3')
  })

  it('says so and stays open when the name could not be saved', async () => {
    const { user, field, dialog, fakes } = await openRename()
    vi.spyOn(fakes.data, 'renameRecording').mockRejectedValueOnce(new Error('down'))

    await user.clear(field)
    await user.type(field, 'Take 3{Enter}')

    expect(await within(dialog).findByText(hub.renameRecordingTexts.failed)).toBeInTheDocument()
  })

  it('keeps the new name after leaving the hub and coming back', async () => {
    const { user, field, router } = await openRename()
    await user.clear(field)
    await user.type(field, 'Take 3{Enter}')
    await waitFor(() => expect(label()).toHaveTextContent('Take 3'))

    await router.navigate('/library')
    await screen.findByRole('heading', { name: strings.library.title })
    await router.navigate(`/pieces/${CLARK}`)
    await screen.findByRole('list', { name: hub.parts })

    expect(label()).toHaveTextContent('Take 3')
  })
})
