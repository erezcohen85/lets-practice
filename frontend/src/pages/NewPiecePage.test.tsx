import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { type Fakes } from '@/lib/fakes'
import { SentenceError } from '@/lib/processorClient'
import { strings } from '@/strings'
import { renderWithApp } from '@/test/render'

const t = strings.newPiece
const SIGNED_IN = { signedIn: true, termsAccepted: true } as const

const pdf = (name: string) => new File(['%PDF-1.4'], name, { type: 'application/pdf' })
const audio = (name: string) => new File(['ID3'], name, { type: 'audio/mpeg' })

async function openPage(options: Parameters<typeof renderWithApp>[1] = {}) {
  const view = renderWithApp('/pieces/new', { ...SIGNED_IN, ...options })
  await screen.findByRole('heading', { level: 1, name: t.title })
  return view
}

const pathNow = (router: { state: { location: { pathname: string } } }) => router.state.location.pathname
const titleField = () => screen.getByRole('textbox', { name: t.titleLabel })
const audioField = () => screen.getByLabelText(t.audioChoose)
const chooseRecording = (user: ReturnType<typeof renderWithApp>['user'], name = 'take.mp3') => user.upload(audioField(), audio(name))
const partNameFields = () => screen.queryAllByRole('textbox', { name: t.partName })
const startButton = () => screen.getByRole('button', { name: t.start })
const addPdfs = (user: ReturnType<typeof renderWithApp>['user'], ...names: string[]) =>
  user.upload(screen.getByLabelText(t.dropZone), names.map(pdf))

// What the fake kept, read straight from its store (reading through the data client would move the jobs on).
const savedPieces = (fakes: Fakes) => [...fakes.store.pieces.values()]
const savedPartsOf = (fakes: Fakes, pieceId: string) =>
  [...fakes.store.parts.values()].filter((part) => part.pieceId === pieceId).sort((a, b) => a.position - b.position)

/** A promise the test settles by hand, to hold the part-name read open. */
function deferred<T>() {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>((done) => (resolve = done))
  return { promise, resolve }
}

describe('the New piece page', () => {
  it('has the heading, the way back to the library and the empty form', async () => {
    await openPage()

    expect(screen.getByRole('link', { name: strings.common.backToLibrary })).toHaveAttribute('href', '/library')
    expect(titleField()).toHaveValue('')
    // The recording is a file only: no choice between a link and a file, and no field for a link.
    expect(audioField()).toHaveAttribute('type', 'file')
    expect(screen.getByText(t.audioDropZone)).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: /youtube/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /youtube/i })).not.toBeInTheDocument()
    expect(screen.queryByPlaceholderText(/youtube/i)).not.toBeInTheDocument()
    expect(screen.getByText(t.partsHint)).toBeInTheDocument()
    expect(partNameFields()).toHaveLength(0)
    expect(screen.getByText(t.startNote)).toBeInTheDocument()
  })

  it('says what the PDF area takes, in a second grey line, and keeps the area’s name', async () => {
    await openPage()

    expect(t.dropZoneLimits).toBe('PDF only. Up to 100 pages and 50 MB per file.')
    const limits = screen.getByText(t.dropZoneLimits)
    expect(limits).toHaveClass('text-text-muted')
    expect(limits.closest('label')).toBe(screen.getByText(t.dropZone).closest('label'))
    expect(screen.getByLabelText(t.dropZone)).toHaveAccessibleDescription(t.dropZoneLimits)
  })

  it('takes PDFs one file per part and audio files only as audio', async () => {
    await openPage()

    const pdfInput = screen.getByLabelText(t.dropZone)
    expect(pdfInput).toHaveAttribute('type', 'file')
    expect(pdfInput).toHaveAttribute('accept', 'application/pdf')
    expect(pdfInput).toHaveAttribute('multiple')

    const audioInput = audioField()
    expect(audioInput).toHaveAttribute('type', 'file')
    expect(audioInput).toHaveAttribute('accept', 'audio/*')
    expect(audioInput).not.toHaveAttribute('multiple')
  })

  describe('submitting an empty form', () => {
    it('shows the title, recording and parts errors, each tied to its field', async () => {
      const { user, fakes } = await openPage()

      await user.click(startButton())

      expect(screen.getByText(t.errors.titleMissing)).toBeInTheDocument()
      expect(screen.getByText(t.errors.recordingMissingFile)).toBeInTheDocument()
      expect(screen.getByText(t.errors.partsMissing)).toBeInTheDocument()

      expect(titleField()).toHaveAttribute('aria-invalid', 'true')
      expect(titleField()).toHaveAccessibleDescription(t.errors.titleMissing)
      expect(audioField()).toHaveAttribute('aria-invalid', 'true')
      expect(audioField()).toHaveAccessibleDescription(t.errors.recordingMissingFile)
      const pdfInput = screen.getByLabelText(t.dropZone)
      expect(pdfInput).toHaveAttribute('aria-invalid', 'true')
      // The error comes first, then the limits line that describes the area.
      expect(pdfInput).toHaveAccessibleDescription(`${t.errors.partsMissing} ${t.dropZoneLimits}`)

      expect(savedPieces(fakes)).toHaveLength(0)
    })

    it('puts the focus on the first field with an error', async () => {
      const { user } = await openPage()

      await user.click(startButton())

      expect(titleField()).toHaveFocus()
    })

    it('moves the focus to the recording when only the title is right', async () => {
      const { user } = await openPage()
      await user.type(titleField(), 'Concert March')

      await user.click(startButton())

      expect(audioField()).toHaveFocus()
    })

    it('drops an error as soon as its field is put right, and leaves the others', async () => {
      const { user } = await openPage()
      await user.click(startButton())

      await user.type(titleField(), 'C')

      expect(screen.queryByText(t.errors.titleMissing)).not.toBeInTheDocument()
      expect(titleField()).not.toHaveAttribute('aria-invalid', 'true')
      expect(screen.getByText(t.errors.recordingMissingFile)).toBeInTheDocument()
    })

    it('asks for an audio file when the recording is missing', async () => {
      const { user } = await openPage()

      await user.click(startButton())

      expect(screen.getByText(t.errors.recordingMissingFile)).toBeInTheDocument()
      expect(audioField()).toHaveAttribute('aria-invalid', 'true')
    })
  })

  describe('the recording', () => {
    it('drops the recording error as soon as a file is chosen', async () => {
      const { user } = await openPage()
      await user.click(startButton())
      expect(screen.getByText(t.errors.recordingMissingFile)).toBeInTheDocument()

      await chooseRecording(user)

      expect(screen.queryByText(t.errors.recordingMissingFile)).not.toBeInTheDocument()
      expect(audioField()).not.toHaveAttribute('aria-invalid', 'true')
    })

    it('shows the name of the chosen audio file', async () => {
      const { user } = await openPage()

      await user.upload(screen.getByLabelText(t.audioChoose), audio('recording take 2.mp3'))

      expect(screen.getByText('recording take 2.mp3')).toBeInTheDocument()
      expect(screen.getByLabelText(t.audioChoose)).toHaveAccessibleDescription('recording take 2.mp3')
    })
  })

  describe('the parts', () => {
    it('lists one row per PDF, in the order added, with the name the fake read', async () => {
      const { user } = await openPage()

      await addPdfs(user, 'CCC_clar1_final-v2.pdf', 'scan0042.pdf')

      await waitFor(() => expect(partNameFields().map((field) => (field as HTMLInputElement).value)).toEqual(['CCC clar1 final v2', 'scan0042']))
      expect(screen.getByText('CCC_clar1_final-v2.pdf')).toBeInTheDocument()
      expect(screen.getByText('scan0042.pdf')).toBeInTheDocument()
      expect(screen.getAllByRole('button', { name: t.removePart })).toHaveLength(2)
    })

    it('adds to the rows already there when more PDFs are chosen', async () => {
      const { user } = await openPage()
      await addPdfs(user, 'first.pdf')
      await addPdfs(user, 'second.pdf')

      await waitFor(() => expect(partNameFields().map((field) => (field as HTMLInputElement).value)).toEqual(['first', 'second']))
    })

    it('says "Reading the part name…" until the read comes back', async () => {
      const { user, fakes } = await openPage()
      const read = deferred<string | null>()
      fakes.processor.readPartName = () => read.promise

      await addPdfs(user, 'flute part.pdf')

      expect(partNameFields()[0]).toHaveAttribute('placeholder', t.readingName)
      expect(partNameFields()[0]).toHaveValue('')

      await act(async () => read.resolve('Flute 1'))

      expect(partNameFields()[0]).toHaveValue('Flute 1')
      expect(partNameFields()[0]).not.toHaveAttribute('placeholder', t.readingName)
    })

    it('falls back to the name made from the file name when the PDF cannot be read', async () => {
      const { user } = await openPage()

      await addPdfs(user, 'unreadable_trumpet-2.pdf')

      await waitFor(() => expect(partNameFields()[0]).toHaveValue('unreadable trumpet 2'))
    })

    it('falls back to the file name when the read itself fails', async () => {
      const { user, fakes } = await openPage()
      fakes.processor.readPartName = () => Promise.reject(new Error('boom'))

      await addPdfs(user, 'oboe.pdf')

      await waitFor(() => expect(partNameFields()[0]).toHaveValue('oboe'))
    })

    it('lets the name be edited', async () => {
      const { user } = await openPage()
      await addPdfs(user, 'scan0042.pdf')
      await waitFor(() => expect(partNameFields()[0]).toHaveValue('scan0042'))

      await user.clear(partNameFields()[0])
      await user.type(partNameFields()[0], 'Trumpet in B♭ 2')

      expect(partNameFields()[0]).toHaveValue('Trumpet in B♭ 2')
    })

    it('never overwrites a name the user typed with a read that comes back late', async () => {
      const { user, fakes } = await openPage()
      const read = deferred<string | null>()
      fakes.processor.readPartName = () => read.promise
      await addPdfs(user, 'scan0042.pdf')

      await user.type(partNameFields()[0], 'My own name')
      await act(async () => read.resolve('Flute 1'))

      expect(partNameFields()[0]).toHaveValue('My own name')
    })

    it('keeps an emptied name empty when a late read comes back', async () => {
      const { user, fakes } = await openPage()
      const read = deferred<string | null>()
      fakes.processor.readPartName = () => read.promise
      await addPdfs(user, 'scan0042.pdf')
      await user.type(partNameFields()[0], 'x')
      await user.clear(partNameFields()[0])

      await act(async () => read.resolve('Flute 1'))

      expect(partNameFields()[0]).toHaveValue('')
    })

    it('removes a row and keeps the order of the others', async () => {
      const { user } = await openPage()
      await addPdfs(user, 'a.pdf', 'b.pdf', 'c.pdf')
      await waitFor(() => expect(partNameFields()).toHaveLength(3))
      await waitFor(() => expect(partNameFields()[2]).toHaveValue('c'))

      await user.click(screen.getAllByRole('button', { name: t.removePart })[1])

      expect(partNameFields().map((field) => (field as HTMLInputElement).value)).toEqual(['a', 'c'])
      expect(screen.queryByText('b.pdf')).not.toBeInTheDocument()
    })

    it('does not let a late read bring a removed row back', async () => {
      const { user, fakes } = await openPage()
      const read = deferred<string | null>()
      fakes.processor.readPartName = () => read.promise
      await addPdfs(user, 'a.pdf')

      await user.click(screen.getByRole('button', { name: t.removePart }))
      await act(async () => read.resolve('Flute 1'))

      expect(partNameFields()).toHaveLength(0)
    })

    it('tells the remove button and the name field which file they belong to', async () => {
      const { user } = await openPage()
      await addPdfs(user, 'CCC_clar1.pdf')
      await waitFor(() => expect(partNameFields()).toHaveLength(1))

      expect(partNameFields()[0]).toHaveAccessibleDescription('CCC_clar1.pdf')
      expect(screen.getByRole('button', { name: t.removePart })).toHaveAccessibleDescription('CCC_clar1.pdf')
    })

    it('turns a file that is not a PDF away, and says which', async () => {
      await openPage()
      const zone = screen.getByLabelText(t.dropZone).closest('label') as HTMLElement

      fireEvent.drop(zone, { dataTransfer: { files: [new File(['x'], 'notes.txt', { type: 'text/plain' }), pdf('flute.pdf')] } })

      expect(await screen.findByText(t.notPdf('notes.txt'))).toBeInTheDocument()
      await waitFor(() => expect(partNameFields()).toHaveLength(1))
      expect(partNameFields()[0]).toHaveValue('flute')
      expect(screen.queryByText('notes.txt')).not.toBeInTheDocument()
    })

    it('knows a PDF by its extension when the browser gives it no type', async () => {
      await openPage()
      const zone = screen.getByLabelText(t.dropZone).closest('label') as HTMLElement

      fireEvent.drop(zone, { dataTransfer: { files: [new File(['x'], 'Scan.PDF', { type: '' })] } })

      await waitFor(() => expect(partNameFields()).toHaveLength(1))
      expect(screen.queryByText(t.notPdf('Scan.PDF'))).not.toBeInTheDocument()
    })

    it('does not ask for a name: a part whose name was emptied is fine, and the field says what happens', async () => {
      const { user, fakes, router } = await openPage()
      await user.type(titleField(), 'Concert March')
      await chooseRecording(user)
      await addPdfs(user, 'scan0042.pdf')
      await waitFor(() => expect(partNameFields()[0]).toHaveValue('scan0042'))
      await user.clear(partNameFields()[0])

      expect(partNameFields()[0]).toHaveAttribute('placeholder', t.partNameHint)
      await user.click(startButton())

      await waitFor(() => expect(pathNow(router)).toMatch(/^\/pieces\/[^/]+\/processing$/))
      expect(savedPartsOf(fakes, savedPieces(fakes)[0].id).map((part) => part.name)).toEqual(['scan0042'])
    })
  })

  describe('starting the processing', () => {
    it('creates the piece with the parts in order and the edited names, starts one job and opens the processing page', async () => {
      const { user, fakes, router } = await openPage()
      await user.type(titleField(), '  Clark County Celebration ')
      await chooseRecording(user)
      await addPdfs(user, 'CCC_clar1_final_v2.pdf', 'scan0042.pdf', 'flute part.pdf')
      await waitFor(() => expect(partNameFields()[2]).toHaveValue('flute part'))
      await user.clear(partNameFields()[1])
      await user.type(partNameFields()[1], 'Trumpet in B♭ 2')

      await user.click(startButton())

      await waitFor(() => expect(pathNow(router)).toMatch(/^\/pieces\/[^/]+\/processing$/))
      const [piece] = savedPieces(fakes)
      expect(savedPieces(fakes)).toHaveLength(1)
      expect(pathNow(router)).toBe(`/pieces/${piece.id}/processing`)
      expect(piece.title).toBe('Clark County Celebration')
      expect(fakes.store.recordings.get(piece.id)).toMatchObject({ kind: 'file', name: 'take.mp3' })
      expect(savedPartsOf(fakes, piece.id).map((part) => [part.position, part.name, part.file.name])).toEqual([
        [0, 'CCC clar1 final v2', 'CCC_clar1_final_v2.pdf'],
        [1, 'Trumpet in B♭ 2', 'scan0042.pdf'],
        [2, 'flute part', 'flute part.pdf'],
      ])
      const jobs = [...fakes.store.jobs.values()].map((stored) => stored.job)
      expect(jobs).toHaveLength(1)
      expect(jobs[0]).toMatchObject({ pieceId: piece.id, kind: 'process-piece' })
    })

    it('sends only the names the user typed: a name read or made from the file is left to the processing', async () => {
      const { user, fakes } = await openPage()
      const create = vi.spyOn(fakes.data, 'createPiece')
      await user.type(titleField(), 'Clark County Celebration')
      await chooseRecording(user)
      await addPdfs(user, 'CCC_clar1_final_v2.pdf', 'scan0042.pdf', 'flute part.pdf')
      await waitFor(() => expect(partNameFields()[2]).toHaveValue('flute part'))
      await user.clear(partNameFields()[1])
      await user.type(partNameFields()[1], '  Trumpet in B♭ 2 ')
      await user.clear(partNameFields()[2])

      await user.click(startButton())

      await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
      expect(create.mock.calls[0][0].parts.map((part) => part.name)).toEqual(['', 'Trumpet in B♭ 2', ''])
    })

    it('takes the audio file as the recording', async () => {
      const { user, fakes, router } = await openPage()
      await user.type(titleField(), 'Slow Waltz in G')
      await chooseRecording(user, 'waltz.mp3')
      await addPdfs(user, 'violin.pdf')
      await waitFor(() => expect(partNameFields()[0]).toHaveValue('violin'))

      await user.click(startButton())

      await waitFor(() => expect(pathNow(router)).toMatch(/\/processing$/))
      const [piece] = savedPieces(fakes)
      expect(fakes.store.recordings.get(piece.id)).toMatchObject({ kind: 'file', name: 'waltz.mp3' })
      expect(savedPartsOf(fakes, piece.id)).toHaveLength(1)
      expect([...fakes.store.jobs.values()]).toHaveLength(1)
    })

    it('shows that it is working and cannot be started twice', async () => {
      const { user, fakes, router } = await openPage()
      const held = deferred<void>()
      const create = fakes.data.createPiece
      fakes.data.createPiece = async (input) => {
        await held.promise
        return create(input)
      }
      await user.type(titleField(), 'Concert March')
      await chooseRecording(user)
      await addPdfs(user, 'clarinet.pdf')
      await waitFor(() => expect(partNameFields()[0]).toHaveValue('clarinet'))

      await user.click(startButton())

      const working = screen.getByRole('button', { name: t.starting })
      expect(working).toBeDisabled()
      await user.click(working)

      await act(async () => held.resolve())
      await waitFor(() => expect(pathNow(router)).toMatch(/\/processing$/))
      expect(savedPieces(fakes)).toHaveLength(1)
    })

    async function fillValidForm(user: ReturnType<typeof renderWithApp>['user']) {
      await user.type(titleField(), 'Concert March')
      await chooseRecording(user)
      await addPdfs(user, 'clarinet.pdf')
      await waitFor(() => expect(partNameFields()[0]).toHaveValue('clarinet'))
    }

    it('shows an error above the button and keeps the form when the piece cannot be created', async () => {
      const { user, fakes, router } = await openPage()
      fakes.data.createPiece = () => Promise.reject(new Error('storage is down'))
      await fillValidForm(user)

      await user.click(startButton())

      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent(t.startFailed)
      expect(pathNow(router)).toBe('/pieces/new')
      expect(titleField()).toHaveValue('Concert March')
      expect(screen.getByText('take.mp3')).toBeInTheDocument()
      expect(partNameFields()).toHaveLength(1)
      expect(startButton()).toBeEnabled()
      // The message sits above the button.
      expect(alert.compareDocumentPosition(startButton()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    })

    it('shows the sentence of a refusal in place of the generic text', async () => {
      const { user, fakes } = await openPage()
      fakes.data.createPiece = () => Promise.reject(new SentenceError('The recording is longer than 20 minutes.'))
      await fillValidForm(user)

      await user.click(startButton())

      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent('The recording is longer than 20 minutes.')
      expect(alert).not.toHaveTextContent(t.startFailed)
    })

    it('keeps the form and does not make a second piece when only the job could not be started', async () => {
      const { user, fakes, router } = await openPage()
      const start = fakes.processor.processPiece
      fakes.processor.processPiece = () => Promise.reject(new Error('processor is down'))
      await fillValidForm(user)

      await user.click(startButton())
      expect(await screen.findByRole('alert')).toHaveTextContent(t.startFailed)
      expect(pathNow(router)).toBe('/pieces/new')
      expect(titleField()).toHaveValue('Concert March')

      fakes.processor.processPiece = start
      await user.click(startButton())

      await waitFor(() => expect(pathNow(router)).toMatch(/\/processing$/))
      expect(savedPieces(fakes)).toHaveLength(1)
      expect([...fakes.store.jobs.values()]).toHaveLength(1)
    })

    it('makes a new piece after a failed start when the form was changed in between', async () => {
      const { user, fakes, router } = await openPage()
      const start = fakes.processor.processPiece
      fakes.processor.processPiece = () => Promise.reject(new Error('processor is down'))
      await fillValidForm(user)
      await user.click(startButton())
      expect(await screen.findByRole('alert')).toBeInTheDocument()

      fakes.processor.processPiece = start
      await user.type(titleField(), ' No. 2')
      await user.click(startButton())

      await waitFor(() => expect(pathNow(router)).toMatch(/\/processing$/))
      const titles = savedPieces(fakes).map((piece) => piece.title)
      expect(titles).toContain('Concert March No. 2')
      const [job] = [...fakes.store.jobs.values()]
      expect(fakes.store.pieces.get(job.job.pieceId)?.title).toBe('Concert March No. 2')
    })

    it('clears the start error once the next try goes through the form again', async () => {
      const { user, fakes } = await openPage()
      fakes.data.createPiece = () => Promise.reject(new Error('storage is down'))
      await fillValidForm(user)
      await user.click(startButton())
      expect(await screen.findByRole('alert')).toBeInTheDocument()

      await user.clear(titleField())
      await user.click(startButton())

      expect(within(document.body).queryByText(t.startFailed)).not.toBeInTheDocument()
      expect(screen.getByText(t.errors.titleMissing)).toBeInTheDocument()
    })
  })
})

describe('the New piece page: Suggest a name', () => {
  const suggestButton = () => screen.getByRole('button', { name: strings.suggestName.button })

  it('is off until the form has an audio file or a PDF to go on', async () => {
    const { user } = await openPage()
    expect(suggestButton()).toBeDisabled()

    await chooseRecording(user)

    expect(suggestButton()).toBeEnabled()
  })

  it('puts the suggestion in the title field, to save or edit', async () => {
    const { user, fakes } = await openPage()
    const ask = vi.spyOn(fakes.processor, 'suggestNewPieceName').mockResolvedValue({ name: 'Etude in C (Berg)', source: 'claude', note: null })
    await chooseRecording(user)
    await addPdfs(user, 'flute.pdf', 'horn.pdf')

    await user.click(suggestButton())

    await waitFor(() => expect(titleField()).toHaveValue('Etude in C (Berg)'))
    expect(ask).toHaveBeenCalledOnce()
    const clues = ask.mock.calls[0][0]
    expect(clues.recording).toMatchObject({ kind: 'file', file: { name: 'take.mp3' } })
    expect(clues.firstPart?.name).toBe('flute.pdf')
    await user.type(titleField(), '!')
    expect(titleField()).toHaveValue('Etude in C (Berg)!')
  })

  it('sends the audio file chosen', async () => {
    const { user, fakes } = await openPage()
    const ask = vi.spyOn(fakes.processor, 'suggestNewPieceName').mockResolvedValue({ name: 'Take 3', source: 'claude', note: null })
    await chooseRecording(user, 'take3.mp3')

    await user.click(suggestButton())

    await waitFor(() => expect(ask).toHaveBeenCalled())
    expect(ask.mock.calls[0][0].recording).toMatchObject({ kind: 'file', file: { name: 'take3.mp3' } })
    expect(ask.mock.calls[0][0].firstPart).toBeNull()
  })

  it('says it was the fallback and why', async () => {
    const { user, fakes } = await openPage()
    vi.spyOn(fakes.processor, 'suggestNewPieceName').mockResolvedValue({
      name: 'Live at the park',
      source: 'fallback',
      note: 'There is no Anthropic API key. Used the file name instead.',
    })
    await chooseRecording(user)

    await user.click(suggestButton())

    expect(await screen.findByRole('status')).toHaveTextContent('Used the file name instead.')
    expect(titleField()).toHaveValue('Live at the park')
  })

  it('says the sentence of a failure and keeps the title as typed', async () => {
    const { user, fakes } = await openPage()
    vi.spyOn(fakes.processor, 'suggestNewPieceName').mockRejectedValue(new SentenceError('The local run server did not answer.'))
    await user.type(titleField(), 'My title')
    await chooseRecording(user)

    await user.click(suggestButton())

    expect(await screen.findByRole('status')).toHaveTextContent('did not answer')
    expect(titleField()).toHaveValue('My title')
  })
})

