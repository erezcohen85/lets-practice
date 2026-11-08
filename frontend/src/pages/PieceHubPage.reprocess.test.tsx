import { screen, waitFor, within } from '@testing-library/react'
import { vi } from 'vitest'
import { createFakes, type Fakes } from '@/lib/fakes'
import { latestJobOf } from '@/lib/fakes/store'
import { SentenceError } from '@/lib/processorClient'
import { strings } from '@/strings'
import { chooseFromMenu, openMoreMenu } from '@/test/hubMenu'
import { renderWithApp } from '@/test/render'

const hub = strings.hub
const rp = strings.partReprocess
const b = strings.boxCheck

const MARCH = 'piece-concert-march'

async function openHub(fakes: Fakes = createFakes({ seed: 'demo' })) {
  const view = renderWithApp(`/pieces/${MARCH}`, { fakes })
  await screen.findByRole('list', { name: hub.parts })
  return { ...view, fakes }
}

const rows = () => within(screen.getByRole('list', { name: hub.parts, hidden: true })).getAllByRole('listitem', { hidden: true })
const names = () => rows().map((row) => row.querySelector('[data-slot="part-name"]')?.textContent ?? '')

async function openDialog(fakes?: Fakes, index = 1) {
  const view = await openHub(fakes)
  const name = names()[index]
  await chooseFromMenu(view.user, name, rp.submit, rows()[index])
  const dialog = await screen.findByRole('alertdialog', { name: rp.title(name) })
  return { ...view, dialog, name, partId: [...view.fakes.store.parts.values()].find((part) => part.pieceId === MARCH && part.name === name)!.id }
}

describe('Piece hub: Reprocess part', () => {
  it('has a Reprocess item in the three-dot menu of every part, between Rename and Delete', async () => {
    const { user } = await openHub()

    for (const [index, row] of rows().entries()) {
      await openMoreMenu(user, names()[index], row)
      expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([hub.rename, rp.submit, hub.delete])
      await user.keyboard('{Escape}')
      await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
    }
  })

  it('opens a confirm with one sentence, the Advanced tick for that part (off), Cancel and Reprocess', async () => {
    const { user, dialog, name } = await openDialog()

    expect(within(dialog).getByText(rp.text)).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: hub.cancel })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: rp.submit })).toBeInTheDocument()
    expect(within(dialog).queryByRole('checkbox')).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: b.advanced }))
    const ticks = within(dialog).getAllByRole('checkbox')
    expect(ticks).toHaveLength(1)
    expect(ticks[0]).not.toBeChecked()
    expect(within(dialog).getByText(name)).toBeInTheDocument()
  })

  it('Cancel changes nothing and starts no job', async () => {
    const { user, dialog, fakes } = await openDialog()
    const before = names()
    const reprocess = vi.spyOn(fakes.processor, 'reprocessPart')

    await user.click(within(dialog).getByRole('button', { name: hub.cancel }))

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(reprocess).not.toHaveBeenCalled()
    expect(names()).toEqual(before)
    expect(fakes.store.reprocessed).toEqual([])
  })

  it('Reprocess calls the client once with the piece, the part and boxCheck false, then follows the add-parts job on the processing screen', async () => {
    const { user, dialog, fakes, router, partId } = await openDialog()
    const reprocess = vi.spyOn(fakes.processor, 'reprocessPart')

    await user.click(within(dialog).getByRole('button', { name: rp.submit }))

    await waitFor(() => expect(router.state.location.pathname).toBe(`/pieces/${MARCH}/processing`))
    expect(reprocess).toHaveBeenCalledTimes(1)
    expect(reprocess).toHaveBeenCalledWith(MARCH, partId, { boxCheck: false })
    expect(latestJobOf(fakes.store, MARCH)?.job.kind).toBe('add-parts')
    const steps = await screen.findByRole('list', { name: strings.processing.stepsLabel })
    expect(within(steps).getAllByRole('listitem')).toHaveLength(3)
  })

  it('calls the tick Advanced Reading, as everywhere else', async () => {
    const { user, dialog } = await openDialog()
    await user.click(within(dialog).getByRole('button', { name: b.advanced }))

    expect(within(dialog).getByRole('list', { name: 'Advanced Reading for each part' })).toBeInTheDocument()
    expect(within(dialog).getByText('Advanced Reading (scanned scores)')).toBeInTheDocument()
  })

  it('sends boxCheck true when the Advanced tick is on', async () => {
    const { user, dialog, fakes, router, partId } = await openDialog()
    await user.click(within(dialog).getByRole('button', { name: b.advanced }))
    await user.click(within(dialog).getByRole('checkbox'))

    await user.click(within(dialog).getByRole('button', { name: rp.submit }))

    await waitFor(() => expect(router.state.location.pathname).toBe(`/pieces/${MARCH}/processing`))
    expect(fakes.store.reprocessed).toEqual([{ pieceId: MARCH, partId, boxCheck: true }])
  })

  it('starts again with the tick off each time the dialog opens', async () => {
    const { user, dialog, name } = await openDialog()
    await user.click(within(dialog).getByRole('button', { name: b.advanced }))
    await user.click(within(dialog).getByRole('checkbox'))
    await user.click(within(dialog).getByRole('button', { name: hub.cancel }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())

    await chooseFromMenu(user, name, rp.submit, rows()[1])
    const again = await screen.findByRole('alertdialog')
    await user.click(within(again).getByRole('button', { name: b.advanced }))

    expect(within(again).getByRole('checkbox')).not.toBeChecked()
  })

  it.each([
    ['409', 'This piece is still being prepared; try again when it is done.'],
    ['400', 'The PDF of this part is not in the folder.'],
  ])('shows the server’s sentence for a %s refusal, keeps the dialog open and does not leave the hub', async (_status, sentence) => {
    const { user, dialog, fakes, router } = await openDialog()
    vi.spyOn(fakes.processor, 'reprocessPart').mockRejectedValueOnce(new SentenceError(sentence))

    await user.click(within(dialog).getByRole('button', { name: rp.submit }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(sentence)
    expect(router.state.location.pathname).toBe(`/pieces/${MARCH}`)
    expect(within(dialog).getByRole('button', { name: rp.submit })).toBeEnabled()
  })

  it('says a plain failure when the error has no sentence', async () => {
    const { user, dialog, fakes } = await openDialog()
    vi.spyOn(fakes.processor, 'reprocessPart').mockRejectedValueOnce(new Error('boom'))

    await user.click(within(dialog).getByRole('button', { name: rp.submit }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(rp.failed)
  })

  it('gives the part back with the same name and place once the job is done', async () => {
    const { user, dialog, fakes, router } = await openDialog()
    const before = names()
    await user.click(within(dialog).getByRole('button', { name: rp.submit }))
    await waitFor(() => expect(router.state.location.pathname).toBe(`/pieces/${MARCH}/processing`))
    const jobId = latestJobOf(fakes.store, MARCH)!.job.id
    for (let i = 0; i < 4; i++) await fakes.data.getJob(jobId)

    await waitFor(() => expect(router.state.location.pathname).toBe(`/pieces/${MARCH}`), { timeout: 5000 })
    await screen.findByRole('list', { name: hub.parts })

    expect(names()).toEqual(before)
  })
})
