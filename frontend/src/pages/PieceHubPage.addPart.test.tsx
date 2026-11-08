import { screen, waitFor, within } from '@testing-library/react'
import { createFakes, type Fakes } from '@/lib/fakes'
import { latestJobOf } from '@/lib/fakes/store'
import { SentenceError } from '@/lib/processorClient'
import { strings } from '@/strings'
import { renderWithApp } from '@/test/render'

const hub = strings.hub
const np = strings.newPiece
const processing = strings.processing

const MARCH = 'piece-concert-march'

const pdf = (name: string) => new File(['%PDF-1.4'], name, { type: 'application/pdf' })

async function openHub(fakes: Fakes = createFakes({ seed: 'demo' }), id = MARCH) {
  const view = renderWithApp(`/pieces/${id}`, { fakes })
  await screen.findByRole('heading', { level: 1 })
  return view
}

async function openDialog(fakes?: Fakes) {
  const view = await openHub(fakes)
  await view.user.click(screen.getByRole('button', { name: hub.addPart }))
  const dialog = await screen.findByRole('dialog', { name: hub.addPartsTitle })
  const choose = (...names: string[]) => view.user.upload(within(dialog).getByLabelText(np.dropZone), names.map(pdf))
  const submit = () => view.user.click(within(dialog).getByRole('button', { name: hub.addPartsSubmit }))
  return { ...view, dialog, choose, submit }
}

const partRows = () => within(screen.getByRole('list', { name: hub.parts })).getAllByRole('listitem')
const partsOf = (fakes: Fakes, pieceId: string) => [...fakes.store.parts.values()].filter((part) => part.pieceId === pieceId)

describe('Piece hub: Add part', () => {
  it('opens a dialog for PDFs, with a PDF picker that takes several files, and closes with Cancel', async () => {
    const { user, dialog } = await openDialog()

    const input = within(dialog).getByLabelText(np.dropZone)
    expect(input).toHaveAttribute('accept', 'application/pdf')
    expect(input).toHaveAttribute('multiple')
    expect(within(dialog).queryAllByRole('textbox', { name: np.partName })).toHaveLength(0)

    await user.click(within(dialog).getByRole('button', { name: hub.cancel }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('gives each chosen PDF a row with an editable part name read from the file', async () => {
    const { user, dialog, choose } = await openDialog()

    await choose('oboe_1.pdf', 'horn-in-F.pdf')

    const names = await within(dialog).findAllByRole('textbox', { name: np.partName })
    await waitFor(() => expect(names.map((field) => (field as HTMLInputElement).value)).toEqual(['oboe 1', 'horn in F']))
    await user.clear(names[0])
    await user.type(names[0], 'Oboe 1')
    expect(names[0]).toHaveValue('Oboe 1')
    await user.click(within(dialog).getAllByRole('button', { name: np.removePart })[1])
    expect(within(dialog).getAllByRole('textbox', { name: np.partName })).toHaveLength(1)
  })

  it('asks for a PDF, and starts nothing while there is none', async () => {
    const fakes = createFakes({ seed: 'demo' })
    const { dialog, submit } = await openDialog(fakes)

    await submit()

    expect(within(dialog).getByText(np.errors.partsMissing)).toBeInTheDocument()
    expect(partsOf(fakes, MARCH)).toHaveLength(2)
    expect([...fakes.store.jobs.values()].filter((stored) => stored.job.kind === 'add-parts')).toHaveLength(0)
  })

  it('does not ask for a name: an emptied field says what happens and the part is added under its file name', async () => {
    const fakes = createFakes({ seed: 'demo' })
    const store = vi.spyOn(fakes.data, 'storeParts')
    const { user, router, dialog, choose, submit } = await openDialog(fakes)
    await choose('oboe.pdf')
    const field = await within(dialog).findByRole('textbox', { name: np.partName })
    await waitFor(() => expect(field).toHaveValue('oboe'))
    await user.clear(field)
    expect(field).toHaveAttribute('placeholder', np.partNameHint)

    await submit()

    await waitFor(() => expect(router.state.location.pathname).toBe(`/pieces/${MARCH}/processing`))
    expect(store.mock.calls[0][1].map((part) => part.name)).toEqual([''])
    expect(partsOf(fakes, MARCH).map((part) => part.name)).toContain('oboe')
  })

  it('sends only the names that were typed', async () => {
    const fakes = createFakes({ seed: 'demo' })
    const store = vi.spyOn(fakes.data, 'storeParts')
    const { user, router, dialog, choose, submit } = await openDialog(fakes)
    await choose('oboe_1.pdf', 'horn.pdf')
    const fields = await within(dialog).findAllByRole('textbox', { name: np.partName })
    await waitFor(() => expect(fields[1]).toHaveValue('horn'))
    await user.clear(fields[1])
    await user.type(fields[1], ' Horn in F ')

    await submit()

    await waitFor(() => expect(router.state.location.pathname).toBe(`/pieces/${MARCH}/processing`))
    expect(store.mock.calls[0][1].map((part) => part.name)).toEqual(['', 'Horn in F'])
  })

  it('stores the parts after the existing ones, starts an add-parts job and goes to the processing screen', async () => {
    const fakes = createFakes({ seed: 'demo' })
    const { user, router, dialog, choose, submit } = await openDialog(fakes)
    await choose('oboe_1.pdf', 'horn.pdf')
    const fields = await within(dialog).findAllByRole('textbox', { name: np.partName })
    await waitFor(() => expect(fields[1]).toHaveValue('horn'))
    await user.clear(fields[1])
    await user.type(fields[1], 'Horn in F')

    await submit()

    await waitFor(() => expect(router.state.location.pathname).toBe(`/pieces/${MARCH}/processing`))
    const parts = partsOf(fakes, MARCH).sort((a, b) => a.position - b.position)
    expect(parts.map((part) => part.name)).toEqual(['Clarinet in B♭ 1', 'Alto Sax 1', 'oboe 1', 'Horn in F'])
    expect(parts.slice(2).map((part) => part.file.name)).toEqual(['oboe_1.pdf', 'horn.pdf'])
    expect(latestJobOf(fakes.store, MARCH)?.job.kind).toBe('add-parts')
    // Its own steps: three, not the five of a new piece.
    const steps = await screen.findByRole('list', { name: processing.stepsLabel })
    expect(within(steps).getAllByRole('listitem')).toHaveLength(3)
  })

  it('shows the new parts on the hub once the job is done', async () => {
    const fakes = createFakes({ seed: 'demo' })
    const { router, choose, submit } = await openDialog(fakes)
    await choose('oboe.pdf')
    await submit()
    await waitFor(() => expect(router.state.location.pathname).toBe(`/pieces/${MARCH}/processing`))
    const jobId = latestJobOf(fakes.store, MARCH)!.job.id
    for (let i = 0; i < 4; i++) await fakes.data.getJob(jobId)

    await waitFor(() => expect(router.state.location.pathname).toBe(`/pieces/${MARCH}`), { timeout: 5000 })
    await screen.findByRole('heading', { level: 1 })

    expect(partRows()).toHaveLength(3)
    expect(partRows()[2]).toHaveTextContent('oboe')
    expect(screen.getByText(hub.summary(3, '3:12'))).toBeInTheDocument()
    expect(screen.getByRole('link', { name: hub.practicePart('oboe') })).toBeInTheDocument()
  })

  it('shows the sentence of a refusal in place of the generic text', async () => {
    const fakes = createFakes({ seed: 'demo' })
    fakes.data.storeParts = () => Promise.reject(new SentenceError('Oboe is not a PDF.'))
    const { dialog, choose, submit } = await openDialog(fakes)
    await choose('oboe.pdf')
    await within(dialog).findByRole('textbox', { name: np.partName })

    await submit()

    expect(await within(dialog).findByText('Oboe is not a PDF.')).toBeInTheDocument()
    expect(within(dialog).queryByText(hub.addPartsFailed)).not.toBeInTheDocument()
  })

  it('says so and keeps the entries when the parts could not be added', async () => {
    const fakes = createFakes({ seed: 'demo' })
    fakes.processor.addParts = () => Promise.reject(new Error('offline'))
    const { router, dialog, choose, submit } = await openDialog(fakes)
    await choose('oboe.pdf')
    await within(dialog).findByRole('textbox', { name: np.partName })

    await submit()

    expect(await within(dialog).findByText(hub.addPartsFailed)).toBeInTheDocument()
    expect(within(dialog).getAllByRole('textbox', { name: np.partName })).toHaveLength(1)
    expect(router.state.location.pathname).toBe(`/pieces/${MARCH}`)
    expect(within(dialog).getByRole('button', { name: hub.addPartsSubmit })).toBeEnabled()
  })

  it('stores each file once when a start that failed is tried again', async () => {
    const fakes = createFakes({ seed: 'demo' })
    const stored = vi.spyOn(fakes.data, 'storeParts')
    // The first start reports a failure after the processor has already taken what it was given.
    const start = fakes.processor.addParts
    let calls = 0
    fakes.processor.addParts = async (pieceId, parts) => {
      const job = await start(pieceId, parts)
      if (calls++ === 0) throw new Error('offline')
      return job
    }
    const { router, dialog, choose, submit } = await openDialog(fakes)
    await choose('oboe.pdf')
    await within(dialog).findByRole('textbox', { name: np.partName })

    await submit()
    expect(await within(dialog).findByText(hub.addPartsFailed)).toBeInTheDocument()
    await submit()

    await waitFor(() => expect(router.state.location.pathname).toBe(`/pieces/${MARCH}/processing`))
    expect(stored.mock.calls.flatMap(([, parts]) => parts.map((part) => part.file.name))).toEqual(['oboe.pdf'])
    expect(partsOf(fakes, MARCH)).toHaveLength(3)
  })

  it('shows the error of a failed job on the processing screen, and Try again runs the add-parts job again', async () => {
    const fakes = createFakes({ seed: 'demo', failStage: 'omr' })
    const { user, router, choose, submit } = await openDialog(fakes)
    await choose('oboe.pdf')
    await submit()
    await waitFor(() => expect(router.state.location.pathname).toBe(`/pieces/${MARCH}/processing`))
    const failedId = latestJobOf(fakes.store, MARCH)!.job.id
    for (let i = 0; i < 3; i++) await fakes.data.getJob(failedId)

    expect(await screen.findByText('omr failed: fake failure', {}, { timeout: 5000 })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: strings.common.retry }))

    await waitFor(() => expect(latestJobOf(fakes.store, MARCH)!.job.id).not.toBe(failedId))
    expect(latestJobOf(fakes.store, MARCH)?.job.kind).toBe('add-parts')
    expect([...fakes.store.jobs.values()].filter((stored) => stored.job.kind === 'process-piece' && stored.job.pieceId === MARCH)).toHaveLength(1)
  })

  it('leaves a piece that is still processing on its processing screen', async () => {
    const { router } = renderWithApp('/pieces/piece-slow-waltz', { seed: 'demo' })

    await waitFor(() => expect(router.state.location.pathname).toBe('/pieces/piece-slow-waltz/processing'))
    expect(screen.queryByRole('button', { name: hub.addPart })).not.toBeInTheDocument()
  })
})
