import { screen, waitFor, within } from '@testing-library/react'
import { createFakes } from '@/lib/fakes'
import { latestJobOf } from '@/lib/fakes/store'
import { SentenceError } from '@/lib/processorClient'
import { strings } from '@/strings'
import { renderWithApp } from '@/test/render'

const hub = strings.hub
const s = strings.split

const MARCH = 'piece-concert-march'
const pdf = (name: string) => new File(['%PDF-1.4'], name, { type: 'application/pdf' })

async function openDialog() {
  const fakes = createFakes({ seed: 'demo' })
  const view = renderWithApp(`/pieces/${MARCH}`, { fakes })
  await screen.findByRole('heading', { level: 1 })
  await view.user.click(screen.getByRole('button', { name: hub.addPart }))
  const dialog = await screen.findByRole('dialog', { name: hub.addPartsTitle })
  await view.user.click(within(dialog).getByRole('button', { name: s.modeSplit }))
  const choose = (name = 'band.pdf') => view.user.upload(within(dialog).getByLabelText(s.dropZone), pdf(name))
  return { ...view, fakes, dialog, choose }
}

const partsOf = (fakes: ReturnType<typeof createFakes>) => [...fakes.store.parts.values()].filter((part) => part.pieceId === MARCH).sort((a, b) => a.position - b.position)

describe('Piece hub: Add part with one PDF that holds several parts', () => {
  it('adds the kept parts after the piece’s own and starts one add-parts job', async () => {
    const { user, fakes, router, dialog, choose } = await openDialog()
    const before = partsOf(fakes).length
    await choose()
    await within(dialog).findByRole('list', { name: s.partsList })
    await user.click(within(dialog).getByRole('checkbox', { name: s.keep('Oboe') }))
    await user.click(within(dialog).getByRole('button', { name: s.confirm }))

    await user.click(within(dialog).getByRole('button', { name: hub.addPartsSubmit }))

    await waitFor(() => expect(router.state.location.pathname).toBe(`/pieces/${MARCH}/processing`))
    expect(partsOf(fakes).slice(before).map((part) => part.name)).toEqual(['Flute', 'Clarinet in B♭'])
    expect(latestJobOf(fakes.store, MARCH)?.job).toMatchObject({ kind: 'add-parts' })
  })

  it('says the limits of one PDF, and lets a page be discarded and shown larger as on New piece', async () => {
    const { user, fakes, router, dialog, choose } = await openDialog()
    expect(within(dialog).getByText(s.dropZoneLimits)).toBeInTheDocument()
    expect(s.dropZoneLimits).toBe('One PDF. Up to 120 pages and 50 MB.')
    const before = partsOf(fakes).length
    await choose()
    await within(dialog).findByRole('list', { name: s.partsList })

    await user.hover(within(dialog).getByAltText(s.page(5)))
    expect(document.querySelector('[data-page-preview]')).not.toBeNull()
    await user.unhover(within(dialog).getByAltText(s.page(5)))
    await user.click(within(dialog).getByRole('button', { name: s.discardPage(5) }))
    expect(within(dialog).getByText('pages 4, 6')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: s.confirm }))
    expect(within(dialog).getByText('pages 4, 6', { exact: false })).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: hub.addPartsSubmit }))

    await waitFor(() => expect(router.state.location.pathname).toBe(`/pieces/${MARCH}/processing`))
    expect(partsOf(fakes)).toHaveLength(before + 3)
  })

  it('does not add anything while the split is not confirmed', async () => {
    const { user, fakes, dialog, choose } = await openDialog()
    const before = partsOf(fakes).length
    await choose()
    await within(dialog).findByRole('list', { name: s.partsList })

    await user.click(within(dialog).getByRole('button', { name: hub.addPartsSubmit }))

    expect(within(dialog).getByText(s.confirmFirst)).toBeInTheDocument()
    expect(partsOf(fakes)).toHaveLength(before)
  })

  it('stops at a full-score PDF', async () => {
    const { dialog, choose } = await openDialog()

    await choose('fullscore.pdf')

    expect(await within(dialog).findByText(s.fullScore)).toBeInTheDocument()
  })

  it('shows the sentence of a refused add and keeps the parts for another try', async () => {
    const { user, fakes, dialog, choose } = await openDialog()
    await choose()
    await within(dialog).findByRole('list', { name: s.partsList })
    await user.click(within(dialog).getByRole('button', { name: s.confirm }))
    vi.spyOn(fakes.data, 'storeParts').mockRejectedValueOnce(new SentenceError('Keep at least one part.'))

    await user.click(within(dialog).getByRole('button', { name: hub.addPartsSubmit }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Keep at least one part.')
    expect(within(dialog).getAllByRole('listitem')).toHaveLength(3)
  })
})
