import { screen, waitFor, within } from '@testing-library/react'
import { createFakes } from '@/lib/fakes'
import { SentenceError } from '@/lib/processorClient'
import { strings } from '@/strings'
import { chooseFromMenu, openMoreMenu } from '@/test/hubMenu'
import { renderWithApp } from '@/test/render'

const hub = strings.hub
const del = strings.partDelete
const CLARK = 'piece-clark-county'
const ETUDE = 'piece-etude-4'

async function openHub(id = CLARK, fakes = createFakes({ seed: 'demo' })) {
  const view = renderWithApp(`/pieces/${id}`, { fakes })
  await screen.findByRole('list', { name: hub.parts })
  return { ...view, fakes }
}

const rows = () => within(screen.getByRole('list', { name: hub.parts, hidden: true })).getAllByRole('listitem', { hidden: true })
const names = () => rows().map((row) => row.querySelector('[data-slot="part-name"]')?.textContent)
const gone = () => waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())

describe('Piece hub: Delete part', () => {
  it('has a Delete item in the three-dot menu of every part, drawn as a danger item', async () => {
    const { user } = await openHub()

    for (const [index, row] of rows().entries()) {
      await openMoreMenu(user, names()[index]!, row)
      expect(screen.getByRole('menuitem', { name: hub.delete })).toHaveClass('text-problem')
      await user.keyboard('{Escape}')
      await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
    }
  })

  it('asks first, naming the part and saying the files are deleted for good, and Cancel changes nothing', async () => {
    const { user, fakes } = await openHub()
    const before = names()

    await chooseFromMenu(user, before[1]!, hub.delete, rows()[1])
    const dialog = await screen.findByRole('alertdialog', { name: del.title(before[1]!) })
    expect(within(dialog).getByText(del.text)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: hub.cancel }))

    await gone()
    expect(names()).toEqual(before)
    expect([...fakes.store.parts.values()].filter((part) => part.pieceId === CLARK)).toHaveLength(3)
  })

  it('deletes the part: its row goes, the others stay and the dialog closes', async () => {
    const { user } = await openHub()
    const before = names()

    await chooseFromMenu(user, before[1]!, hub.delete, rows()[1])
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: hub.delete }))

    await waitFor(() => expect(names()).toEqual([before[0], before[2]]))
    await gone()
  })

  it('says it is the last part, offers only Close and deletes nothing', async () => {
    const { user, fakes } = await openHub(ETUDE)
    const [name] = names()

    await chooseFromMenu(user, name!, hub.delete, rows()[0])

    const dialog = await screen.findByRole('alertdialog', { name: del.lastTitle(name!) })
    expect(within(dialog).getByText(del.lastText)).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: hub.delete })).toBeNull()
    await user.click(within(dialog).getByRole('button', { name: del.close }))
    await gone()
    expect([...fakes.store.parts.values()].filter((part) => part.pieceId === ETUDE)).toHaveLength(1)
  })

  it('says why when the part could not be deleted and stays open', async () => {
    const fakes = createFakes({ seed: 'demo' })
    vi.spyOn(fakes.data, 'deletePart').mockRejectedValue(new SentenceError('This piece is still being prepared; try again when it is done.'))
    const { user } = await openHub(CLARK, fakes)
    const before = names()

    await chooseFromMenu(user, before[0]!, hub.delete, rows()[0])
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: hub.delete }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('still being prepared')
    expect(names()).toEqual(before)
  })

  it('says the generic sentence for any other failure', async () => {
    const fakes = createFakes({ seed: 'demo' })
    vi.spyOn(fakes.data, 'deletePart').mockRejectedValue(new Error('boom'))
    const { user } = await openHub(CLARK, fakes)

    await chooseFromMenu(user, names()[0]!, hub.delete, rows()[0])
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: hub.delete }))

    expect(await screen.findByRole('alert')).toHaveTextContent(del.failed)
  })
})
