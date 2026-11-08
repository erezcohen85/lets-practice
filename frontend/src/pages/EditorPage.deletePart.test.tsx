import { configure, screen, waitFor, within } from '@testing-library/react'
import { createFakes, type Fakes } from '@/lib/fakes'
import { strings } from '@/strings'
import { renderWithApp } from '@/test/render'

const CLARK = 'piece-clark-county'
const ETUDE = 'piece-etude-4'
const COLUMN = 1240 + 2 * 16
const text = strings.editor
const del = strings.partDelete

// Real timers, as the other editor tests that mount the whole page.
configure({ asyncUtilTimeout: 10_000 })

async function open(pieceId: string, pages: RegExp, fakes: Fakes = createFakes({ seed: 'demo' })) {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(COLUMN)
  const detail = (await fakes.data.getPiece(pieceId))!
  const view = renderWithApp(`/pieces/${pieceId}/edit?part=${detail.parts[0].id}`, { fakes })
  await screen.findAllByRole('img', { name: pages })
  return { ...view, fakes, detail }
}

async function chooseDelete(user: Awaited<ReturnType<typeof open>>['user'], chipName: RegExp) {
  await user.click(screen.getByRole('button', { name: chipName }))
  await user.click(await screen.findByRole('menuitem', { name: text.deletePart }))
}

describe('Editor: deleting the part from the top bar', () => {
  it('asks first, naming the part, and Cancel keeps it', async () => {
    const { user, fakes } = await open(CLARK, /^Page \d of 4$/)

    await chooseDelete(user, /^Clarinet/)
    const dialog = await screen.findByRole('alertdialog', { name: del.title('Clarinet in B♭ 1') })
    await user.click(within(dialog).getByRole('button', { name: strings.hub.cancel }))

    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect((await fakes.data.getPiece(CLARK))?.parts).toHaveLength(3)
  })

  it('deletes the part and leaves for the piece hub, which lists the others', async () => {
    const { user, fakes, router } = await open(CLARK, /^Page \d of 4$/)

    await chooseDelete(user, /^Clarinet/)
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: strings.hub.delete }))

    await waitFor(() => expect(router.state.location.pathname).toBe(`/pieces/${CLARK}`))
    expect((await fakes.data.getPiece(CLARK))?.parts.map((part) => part.name)).not.toContain('Clarinet in B♭ 1')
    expect(await screen.findByRole('list', { name: strings.hub.parts })).toBeInTheDocument()
  })

  it('says the part is the last one and deletes nothing', async () => {
    const { user, fakes } = await open(ETUDE, /^Page \d of \d+$/)

    await chooseDelete(user, /^Piano/)
    const dialog = await screen.findByRole('alertdialog', { name: del.lastTitle('Piano') })
    expect(within(dialog).queryByRole('button', { name: strings.hub.delete })).toBeNull()
    await user.click(within(dialog).getByRole('button', { name: del.close }))

    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect((await fakes.data.getPiece(ETUDE))?.parts).toHaveLength(1)
  })
})
