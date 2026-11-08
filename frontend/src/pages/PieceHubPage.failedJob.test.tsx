import { screen, waitFor, within } from '@testing-library/react'
import { type JobKind, type JobPart } from '@/domain/types'
import { createFakes, type Fakes } from '@/lib/fakes'
import { latestJobOf } from '@/lib/fakes/store'
import { strings } from '@/strings'
import { renderWithApp } from '@/test/render'

const hub = strings.hub

// A Realign or Add part that ended in an error leaves a piece with a good map: the owner can still practise, edit, share and
// manage the parts (Decisions 2026-11-04: "Being prepared" applies only to a piece's first read). Only a failed first read
// (process-piece) is the failed page. The shapes are the processor's: the startup sweep writes INTERRUPTED with no parts;
// an add-parts job whose parts could not be read ends in an error with them listed as failed.

const MARCH = 'piece-concert-march'
const INTERRUPTED = 'The server restarted while this was running. Try again.'
const REASON = 'The score reader failed: page 1 has no five-line staves (one-line percussion staves cannot be read yet).'

/** The demo piece, its last job ended in an error of this kind. */
function endedInError(kind: JobKind, error: string, parts?: JobPart[]): Fakes {
  const fakes = createFakes({ seed: 'demo' })
  const stored = latestJobOf(fakes.store, MARCH)
  if (stored === undefined) throw new Error('the demo piece has no job')
  stored.job = { ...stored.job, kind, status: 'error', progress: 0.35, error, parts: parts ?? [] }
  return fakes
}

async function openHub(fakes: Fakes) {
  const view = renderWithApp(`/pieces/${MARCH}`, { fakes })
  await screen.findByRole('heading', { level: 1 })
  return view
}

describe('Piece hub: a Realign that ended in an error', () => {
  it('keeps Practice, Edit map, Share and the parts, and says why with a Try again', async () => {
    await openHub(endedInError('realign', INTERRUPTED))

    expect(screen.getByRole('link', { name: hub.practice })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: hub.editMap })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: hub.shareButton })).toBeInTheDocument()
    expect(screen.getByRole('list', { name: hub.parts })).toBeInTheDocument()
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent(hub.jobFailedTitle('realign'))
    expect(alert).toHaveTextContent(INTERRUPTED)
    expect(within(alert).getByRole('button', { name: strings.common.retry })).toBeInTheDocument()
    expect(screen.queryByText(hub.failedTitle)).not.toBeInTheDocument()
  })

  it('tries again with a Realign, never a new first read, and follows it', async () => {
    const fakes = endedInError('realign', INTERRUPTED)
    const first = vi.spyOn(fakes.processor, 'processPiece')
    const { user, router } = await openHub(fakes)

    await user.click(within(screen.getByRole('alert')).getByRole('button', { name: strings.common.retry }))

    await waitFor(() => expect(latestJobOf(fakes.store, MARCH)?.job).toMatchObject({ kind: 'realign', status: expect.stringMatching(/queued|running/) }))
    expect(first).not.toHaveBeenCalled()
    await waitFor(() => expect(router.state.location.pathname).toBe(`/pieces/${MARCH}/processing`))
  })

  it('says the retry was refused when the processor refuses it, and keeps the hub', async () => {
    const fakes = endedInError('realign', INTERRUPTED)
    vi.spyOn(fakes.processor, 'realign').mockRejectedValue(new Error('down'))
    const { user } = await openHub(fakes)

    await user.click(within(screen.getByRole('alert')).getByRole('button', { name: strings.common.retry }))

    expect(await screen.findByText(hub.retryFailed)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: hub.practice })).toBeInTheDocument()
  })
})

describe('Piece hub: an Add part that ended in an error', () => {
  it('lists the part that could not be read, so it can be deleted, and keeps the rest of the hub', async () => {
    await openHub(endedInError('add-parts', 'The score reader failed.', [{ id: 'p2', name: 'Crash cymbal', state: 'failed', error: REASON }]))

    const notice = screen.getByRole('alert')
    expect(within(notice).getByText(hub.skippedTitle(1))).toBeInTheDocument()
    expect(within(notice).getByText(hub.skippedPart('Crash cymbal', REASON))).toBeInTheDocument()
    expect(screen.getByRole('link', { name: hub.practice })).toBeInTheDocument()
    expect(screen.getByRole('list', { name: hub.parts })).toBeInTheDocument()
    expect(screen.queryByText(hub.failedTitle)).not.toBeInTheDocument()
  })

  it('says why, with a Try again that adds parts and not a new first read, when no part is named', async () => {
    const fakes = endedInError('add-parts', INTERRUPTED)
    const first = vi.spyOn(fakes.processor, 'processPiece')
    const { user } = await openHub(fakes)

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent(hub.jobFailedTitle('add-parts'))
    expect(alert).toHaveTextContent(INTERRUPTED)
    await user.click(within(alert).getByRole('button', { name: strings.common.retry }))

    await waitFor(() => expect(latestJobOf(fakes.store, MARCH)?.job).toMatchObject({ kind: 'add-parts' }))
    expect(first).not.toHaveBeenCalled()
  })
})

describe('Piece hub: a first read that ended in an error', () => {
  it('is still the failed page, with Retry and Library and no Practice', async () => {
    const fakes = endedInError('process-piece', 'The score reader failed.')
    renderWithApp(`/pieces/${MARCH}`, { fakes })

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(hub.failedTitle)
    expect(screen.queryByRole('link', { name: hub.practice })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: hub.editMap })).not.toBeInTheDocument()
  })
})
