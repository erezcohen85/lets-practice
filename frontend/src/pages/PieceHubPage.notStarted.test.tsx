import { screen, waitFor, within } from '@testing-library/react'
import { createFakes } from '@/lib/fakes'
import { strings } from '@/strings'
import { renderWithApp } from '@/test/render'

// A piece the browser saved (its files and rows) whose job was never started: the person left the form, or the processor
// could not be reached. It has no job and no page read, so it is not "Ready": the hub offers to start it.

const hub = strings.hub
const part = () => new File(['%PDF'], 'Flute.pdf', { type: 'application/pdf' })

async function unstartedPiece() {
  const fakes = createFakes({ seed: 'demo' })
  const piece = await fakes.data.createPiece({ title: 'Saved only', recording: { kind: 'file', file: new File(['x'], 'take.mp3', { type: 'audio/mpeg' }) }, parts: [{ file: part(), name: '' }] })
  return { fakes, piece }
}

describe('A piece that was saved and never started', () => {
  it('shows the hub\'s start button with a sentence that says what happened, and no Practice button', async () => {
    const { fakes, piece } = await unstartedPiece()
    renderWithApp(`/pieces/${piece.id}`, { fakes })

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(hub.failedTitle)
    expect(alert).toHaveTextContent(hub.notStartedText)
    expect(within(alert).getByRole('button', { name: strings.common.retry })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: hub.practice })).not.toBeInTheDocument()
  })

  it('starts the first read of the piece, not a retry of a job, and goes to the processing screen', async () => {
    const { fakes, piece } = await unstartedPiece()
    const start = vi.spyOn(fakes.processor, 'processPiece')
    const { user, router } = renderWithApp(`/pieces/${piece.id}`, { fakes })
    await screen.findByRole('alert')

    await user.click(screen.getByRole('button', { name: strings.common.retry }))

    expect(start).toHaveBeenCalledWith(piece.id)
    await waitFor(() => expect(router.state.location.pathname).toBe(`/pieces/${piece.id}/processing`))
  })

  it('is not called Ready on its card in the library', async () => {
    const { fakes, piece } = await unstartedPiece()
    renderWithApp('/library', { fakes })

    const card = (await screen.findByText(piece.title)).closest('a')!
    expect(within(card).getByText(strings.library.status.failed)).toBeInTheDocument()
    expect(within(card).queryByText(strings.library.status.ready)).not.toBeInTheDocument()
  })

  it('stays ready when it has pages and no job, as an imported piece does', async () => {
    const { fakes, piece } = await unstartedPiece()
    for (const stored of fakes.store.parts.values()) if (stored.pieceId === piece.id) stored.pageCount = 2
    renderWithApp(`/pieces/${piece.id}`, { fakes })

    expect(await screen.findByRole('heading', { level: 1, name: piece.title })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: hub.practice })).toBeInTheDocument()
  })

  it('leaves a piece that has a finished job alone, whatever its pages', async () => {
    const fakes = createFakes({ seed: 'demo' })
    renderWithApp('/pieces/piece-clark-county', { fakes })

    expect(await screen.findByRole('heading', { level: 1, name: 'Clark County Celebration' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
