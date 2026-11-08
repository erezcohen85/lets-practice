import { screen, waitFor, within } from '@testing-library/react'
import { SPLIT_EXPIRED, type SplitProposal } from '@/domain/splitEdits'
import { type Fakes } from '@/lib/fakes'
import { SentenceError } from '@/lib/processorClient'
import { strings } from '@/strings'
import { renderWithApp } from '@/test/render'

const t = strings.newPiece
const s = strings.split
const SIGNED_IN = { signedIn: true, termsAccepted: true } as const

const pdf = (name: string) => new File(['%PDF-1.4'], name, { type: 'application/pdf' })
const audio = (name: string) => new File(['ID3'], name, { type: 'audio/mpeg' })

async function openPage() {
  const view = renderWithApp('/pieces/new', SIGNED_IN)
  await screen.findByRole('heading', { level: 1, name: t.title })
  return view
}

type User = ReturnType<typeof renderWithApp>['user']

const chooseSplitMode = (user: User) => user.click(screen.getByRole('button', { name: s.modeSplit }))
const chooseSplitPdf = (user: User, name = 'band.pdf') => user.upload(screen.getByLabelText(s.dropZone), pdf(name))
const rows = () => within(screen.getByRole('list', { name: s.partsList })).getAllByRole('listitem')
const nameFields = () => within(screen.getByRole('list', { name: s.partsList })).getAllByRole('textbox', { name: s.partName }) as HTMLInputElement[]
const rowOf = (name: string) => rows()[nameFields().findIndex((field) => field.value === name)]
const confirm = (user: User) => user.click(screen.getByRole('button', { name: s.confirm }))

/** The page on the split screen, with the fake's proposal: Flute 1-2, Oboe 3, Clarinet in B♭ 4-6. */
async function onSplitScreen(proposal?: SplitProposal | Error) {
  const view = await openPage()
  if (proposal instanceof Error) vi.spyOn(view.fakes.processor, 'proposeSplit').mockRejectedValue(proposal)
  else if (proposal !== undefined) vi.spyOn(view.fakes.processor, 'proposeSplit').mockResolvedValue(proposal)
  await chooseSplitMode(view.user)
  await chooseSplitPdf(view.user)
  if (!(proposal instanceof Error)) await screen.findByRole('list', { name: s.partsList })
  return view
}

const savedParts = (fakes: Fakes) => [...fakes.store.parts.values()].sort((a, b) => a.position - b.position)

async function fillRest(user: User) {
  await user.type(screen.getByRole('textbox', { name: t.titleLabel }), 'Band piece')
  await user.upload(screen.getByLabelText(t.audioChoose), audio('take.mp3'))
}

describe('New piece: one PDF with several parts', () => {
  it('offers the choice beside one PDF per part, which stays the way it was', async () => {
    const { user } = await openPage()

    expect(screen.getByRole('button', { name: s.modeEach })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: s.modeSplit })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByLabelText(t.dropZone)).toHaveAttribute('multiple')

    await chooseSplitMode(user)

    expect(screen.getByRole('button', { name: s.modeSplit })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByLabelText(t.dropZone)).not.toBeInTheDocument()
    const input = screen.getByLabelText(s.dropZone)
    expect(input).toHaveAttribute('accept', 'application/pdf')
    expect(input).not.toHaveAttribute('multiple')
  })

  it('shows a busy state while the pages are read, then the proposed parts with names, pages and a thumbnail per page', async () => {
    const view = await openPage()
    let finish: () => void = () => {}
    const real = view.fakes.processor.proposeSplit.bind(view.fakes.processor)
    vi.spyOn(view.fakes.processor, 'proposeSplit').mockImplementation(async (file) => {
      const proposal = await real(file)
      return new Promise<SplitProposal>((done) => (finish = () => done(proposal)))
    })
    await chooseSplitMode(view.user)

    await chooseSplitPdf(view.user)

    expect(await screen.findByText(s.reading)).toBeInTheDocument()
    finish()
    await screen.findByRole('list', { name: s.partsList })
    expect(screen.queryByText(s.reading)).not.toBeInTheDocument()
    expect(nameFields().map((field) => field.value)).toEqual(['Flute', 'Oboe', 'Clarinet in B♭'])
    expect(rows().map((row) => within(row).getByText(/^pages? \d/).textContent)).toEqual(['pages 1-2', 'page 3', 'pages 4-6'])
    expect(within(rowOf('Flute')).getAllByRole('img').map((image) => image.getAttribute('alt'))).toEqual([s.page(1), s.page(2)])
    expect(within(rowOf('Clarinet in B♭')).getAllByRole('img')).toHaveLength(3)
    expect(screen.getAllByRole('checkbox').every((box) => box.getAttribute('aria-checked') === 'true')).toBe(true)
  })

  it('shows the server note above the rows', async () => {
    const view = await openPage()
    const real = await view.fakes.processor.proposeSplit(pdf('x.pdf'))
    vi.spyOn(view.fakes.processor, 'proposeSplit').mockResolvedValue({ ...real, note: 'The header of 1 page could not be read; it is taken to continue the part before it.' })
    await chooseSplitMode(view.user)
    await chooseSplitPdf(view.user)

    expect(await screen.findByText(/could not be read; it is taken to continue/)).toBeInTheDocument()
  })

  it('numbers two parts that have the same name', async () => {
    const view = await openPage()
    const real = await view.fakes.processor.proposeSplit(pdf('x.pdf'))
    vi.spyOn(view.fakes.processor, 'proposeSplit').mockResolvedValue({
      ...real,
      parts: [{ name: 'Violin', fromPage: 1, toPage: 3 }, { name: 'Viola', fromPage: 4, toPage: 4 }, { name: 'Violin', fromPage: 5, toPage: 6 }],
    })
    await chooseSplitMode(view.user)
    await chooseSplitPdf(view.user)
    await screen.findByRole('list', { name: s.partsList })

    expect(nameFields().map((field) => field.value)).toEqual(['Violin', 'Viola', 'Violin (2)'])
  })

  it('renames a part', async () => {
    const { user } = await onSplitScreen()

    await user.clear(nameFields()[1])
    await user.type(nameFields()[1], 'Oboe 1')

    expect(nameFields()[1]).toHaveValue('Oboe 1')
  })

  it('moves a boundary by one page either way, and only where the part keeps a page', async () => {
    const { user } = await onSplitScreen()
    const flute = rowOf('Flute')

    // Oboe has one page: it cannot give it to Flute; Flute can give its last page.
    expect(within(flute).getByRole('button', { name: s.pageUp(3, 'Flute') })).toBeDisabled()
    await user.click(within(flute).getByRole('button', { name: s.pageDown(2, 'Oboe') }))

    expect(rows().map((row) => within(row).getByText(/^pages? \d/).textContent)).toEqual(['page 1', 'pages 2-3', 'pages 4-6'])
    expect(within(rowOf('Flute')).getAllByRole('img')).toHaveLength(1)
    expect(within(rowOf('Oboe')).getAllByRole('img')).toHaveLength(2)

    await user.click(within(rowOf('Flute')).getByRole('button', { name: s.pageUp(2, 'Flute') }))

    expect(rows().map((row) => within(row).getByText(/^pages? \d/).textContent)).toEqual(['pages 1-2', 'page 3', 'pages 4-6'])
  })

  it('merges a part with the next one under the first name', async () => {
    const { user } = await onSplitScreen()

    await user.click(within(rowOf('Flute')).getByRole('button', { name: s.mergeLabel('Flute', 'Oboe') }))

    expect(nameFields().map((field) => field.value)).toEqual(['Flute', 'Clarinet in B♭'])
    expect(rows().map((row) => within(row).getByText(/^pages? \d/).textContent)).toEqual(['pages 1-3', 'pages 4-6'])
  })

  it('reads "Merge the part below" on the button between two parts, and keeps the label that names both', async () => {
    await onSplitScreen()

    const button = within(rowOf('Flute')).getByRole('button', { name: s.mergeLabel('Flute', 'Oboe') })
    expect(button).toHaveTextContent(/^Merge the part below$/)
    expect(s.merge).toBe('Merge the part below')
  })

  it('starts a new part at a page, named "<name> (2)", that can be renamed', async () => {
    const { user } = await onSplitScreen()
    const clarinet = rowOf('Clarinet in B♭')

    // The first page of a part has no such button: that is where it starts already.
    expect(within(clarinet).queryByRole('button', { name: s.startHere(4) })).not.toBeInTheDocument()
    expect(within(clarinet).getAllByRole('button', { name: /^Start a new part at page/ }).map((button) => button.getAttribute('aria-label'))).toEqual([s.startHere(5), s.startHere(6)])
    await user.click(within(clarinet).getByRole('button', { name: s.startHere(6) }))

    expect(nameFields().map((field) => field.value)).toEqual(['Flute', 'Oboe', 'Clarinet in B♭', 'Clarinet in B♭ (2)'])
    expect(rows().map((row) => within(row).getByText(/^pages? \d/).textContent)).toEqual(['pages 1-2', 'page 3', 'pages 4-5', 'page 6'])
  })

  it('numbers two parts renamed alike when the parts are confirmed', async () => {
    const { user } = await onSplitScreen()
    await user.clear(nameFields()[1])
    await user.type(nameFields()[1], 'flute')

    await confirm(user)

    expect(screen.getAllByRole('listitem').map((row) => row.textContent)).toEqual([expect.stringContaining('Flute ·'), expect.stringContaining('flute (2) ·'), expect.stringContaining('Clarinet')])
  })

  it('says "part N" in the buttons of a part whose name was cleared', async () => {
    const { user } = await onSplitScreen()
    await user.clear(nameFields()[1])

    expect(screen.getByRole('button', { name: s.pageDown(2, 'part 2') })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: s.mergeLabel('Flute', 'part 2') })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: s.boundaryLabel('part 2', 'Clarinet in B♭') })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: s.keep('part 2') })).toBeInTheDocument()
  })

  it('greys a part that is unticked, and sends only the kept parts', async () => {
    const { user, fakes, router } = await onSplitScreen()
    await user.click(screen.getByRole('checkbox', { name: s.keep('Oboe') }))
    expect(within(rowOf('Oboe')).getByText(s.notUsed)).toBeInTheDocument()
    await confirm(user)

    // Back in the form: the kept parts are rows with their pages, and the PDF is not asked for again.
    expect(screen.queryByRole('list', { name: s.partsList })).not.toBeInTheDocument()
    const kept = screen.getAllByRole('listitem')
    expect(kept.map((row) => row.textContent)).toEqual([expect.stringContaining('Flute'), expect.stringContaining('Clarinet in B♭')])
    expect(kept[0]).toHaveTextContent('pages 1-2')
    expect(kept[1]).toHaveTextContent('pages 4-6')

    await fillRest(user)
    await user.click(screen.getByRole('button', { name: t.start }))

    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/pieces\/[^/]+\/processing$/))
    expect(savedParts(fakes).map((part) => part.name)).toEqual(['Flute', 'Clarinet in B♭'])
  })

  it('lets a kept part be removed in the form, and the whole choice start over when none is left', async () => {
    const { user } = await onSplitScreen()
    await confirm(user)

    await user.click(screen.getAllByRole('button', { name: s.removePart })[0])
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    await user.click(screen.getAllByRole('button', { name: s.removePart })[0])
    await user.click(screen.getAllByRole('button', { name: s.removePart })[0])

    expect(screen.getByLabelText(s.dropZone)).toBeInTheDocument()
  })

  it('opens the split screen again with the edits made so far', async () => {
    const { user } = await onSplitScreen()
    await user.clear(nameFields()[0])
    await user.type(nameFields()[0], 'Flute 1')
    await confirm(user)

    await user.click(screen.getByRole('button', { name: s.change }))

    expect(nameFields().map((field) => field.value)).toEqual(['Flute 1', 'Oboe', 'Clarinet in B♭'])
  })

  it('does not confirm a split with nothing kept, or a part with no name', async () => {
    const { user } = await onSplitScreen()
    await user.clear(nameFields()[0])
    await confirm(user)
    expect(screen.getByText(s.problems.nameEmpty)).toBeInTheDocument()
    expect(screen.getByRole('list', { name: s.partsList })).toBeInTheDocument()

    await user.type(nameFields()[0], 'Flute')
    for (const box of screen.getAllByRole('checkbox')) await user.click(box)
    await confirm(user)

    expect(screen.getByText(s.problems.none)).toBeInTheDocument()
    expect(screen.getByRole('list', { name: s.partsList })).toBeInTheDocument()
  })

  it('stops at a full-score PDF with one sentence and a way back', async () => {
    const view = await openPage()
    await chooseSplitMode(view.user)

    await chooseSplitPdf(view.user, 'fullscore.pdf')

    expect(await screen.findByText(s.fullScore)).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: s.partsList })).not.toBeInTheDocument()
    await view.user.click(screen.getByRole('button', { name: s.chooseAnother }))
    expect(screen.getByLabelText(s.dropZone)).toBeInTheDocument()
  })

  it('says the sentence when the PDF could not be read, and keeps the picker', async () => {
    await onSplitScreen(new SentenceError('This PDF has more than 120 pages.'))

    expect(await screen.findByText('This PDF has more than 120 pages.')).toBeInTheDocument()
    expect(screen.getByLabelText(s.dropZone)).toBeInTheDocument()
  })

  it('does not start while the split is not confirmed', async () => {
    const { user, fakes } = await onSplitScreen()
    await fillRest(user)

    await user.click(screen.getByRole('button', { name: t.start }))

    expect(screen.getByText(s.confirmFirst)).toBeInTheDocument()
    expect(fakes.store.pieces.size).toBe(0)
  })

  it('shows the sentence of a refused upload, keeps the parts and sends again after a fix', async () => {
    const { user, fakes, router } = await onSplitScreen()
    await confirm(user)
    await fillRest(user)
    vi.spyOn(fakes.data, 'createPiece').mockRejectedValueOnce(new SentenceError('The parts must be in page order and must not overlap.'))

    await user.click(screen.getByRole('button', { name: t.start }))

    expect(await screen.findByRole('alert')).toHaveTextContent('The parts must be in page order and must not overlap.')
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
    await user.click(screen.getByRole('button', { name: t.start }))
    await waitFor(() => expect(router.state.location.pathname).toMatch(/processing$/))
    expect(savedParts(fakes)).toHaveLength(3)
  })

  it('sends the user back to choose the PDF when the split has expired', async () => {
    const { user, fakes } = await onSplitScreen()
    await confirm(user)
    await fillRest(user)
    vi.spyOn(fakes.data, 'createPiece').mockRejectedValueOnce(new SentenceError(SPLIT_EXPIRED))

    await user.click(screen.getByRole('button', { name: t.start }))

    expect(await screen.findByRole('alert')).toHaveTextContent(SPLIT_EXPIRED)
    expect(screen.getByLabelText(s.dropZone)).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: s.partsList })).not.toBeInTheDocument()
  })

  it('keeps the PDF-per-part rows when the choice is switched and switched back', async () => {
    const { user } = await openPage()
    await user.upload(screen.getByLabelText(t.dropZone), pdf('oboe.pdf'))
    await screen.findByRole('textbox', { name: t.partName })

    await chooseSplitMode(user)
    expect(screen.queryByRole('textbox', { name: t.partName })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: s.modeEach }))

    expect(screen.getByRole('textbox', { name: t.partName })).toHaveValue('oboe')
  })

  it('asks for the PDF when the several-parts choice is started with none', async () => {
    const { user } = await openPage()
    await chooseSplitMode(user)

    await user.click(screen.getByRole('button', { name: t.start }))

    expect(screen.getByText(t.errors.partsMissing)).toBeInTheDocument()
  })
})
