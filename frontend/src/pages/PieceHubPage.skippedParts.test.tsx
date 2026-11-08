import { screen, waitFor, within } from '@testing-library/react'
import { type JobPart } from '@/domain/types'
import { createFakes, type Fakes } from '@/lib/fakes'
import { latestJobOf } from '@/lib/fakes/store'
import { strings } from '@/strings'
import { renderWithApp } from '@/test/render'

const hub = strings.hub

const MARCH = 'piece-concert-march'
const REASON = 'The score reader failed: page 1 has no five-line staves (one-line percussion staves cannot be read yet).'

/** The demo piece, its last job finished with these parts. */
function finishedWith(parts: JobPart[]): Fakes {
  const fakes = createFakes({ seed: 'demo' })
  const stored = latestJobOf(fakes.store, MARCH)
  if (stored === undefined) throw new Error('the demo piece has no job')
  stored.job = { ...stored.job, status: 'done', progress: 1, error: null, parts }
  return fakes
}

async function openHub(fakes: Fakes) {
  const view = renderWithApp(`/pieces/${MARCH}`, { fakes })
  await screen.findByRole('heading', { level: 1 })
  return view
}

describe('Piece hub: a part that could not be read', () => {
  it('names the part and the reason, and says its PDF is kept', async () => {
    await openHub(
      finishedWith([
        { id: 'p1', name: 'Flute', state: 'done' },
        { id: 'p2', name: 'Crash cymbal', state: 'failed', error: REASON },
      ]),
    )

    const notice = screen.getByRole('alert')
    expect(within(notice).getByText(hub.skippedTitle(1))).toBeInTheDocument()
    expect(within(notice).getByText(hub.skippedPart('Crash cymbal', REASON))).toBeInTheDocument()
    expect(within(notice).getByText(hub.skippedText(1))).toBeInTheDocument()
  })

  it('counts several parts', async () => {
    await openHub(
      finishedWith([
        { id: 'p1', name: 'Snare', state: 'failed', error: 'a' },
        { id: 'p2', name: 'Claves', state: 'failed', error: 'b' },
      ]),
    )

    const notice = screen.getByRole('alert')
    expect(within(notice).getByText(hub.skippedTitle(2))).toBeInTheDocument()
    expect(within(notice).getAllByRole('listitem')).toHaveLength(2)
  })

  it('tries the skipped parts again with an add-parts job and follows it', async () => {
    const fakes = finishedWith([{ id: 'p2', name: 'Crash cymbal', state: 'failed', error: REASON }])
    const { user } = await openHub(fakes)

    await user.click(within(screen.getByRole('alert')).getByRole('button', { name: strings.common.retry }))

    await waitFor(() => expect(latestJobOf(fakes.store, MARCH)?.job).toMatchObject({ kind: 'add-parts' }))
    expect(await screen.findByRole('heading', { level: 1, name: strings.processing.title('Concert March') })).toBeInTheDocument()
  })

  it('shows nothing when the last job read every part', async () => {
    await openHub(finishedWith([{ id: 'p1', name: 'Flute', state: 'done' }]))

    expect(screen.queryByText(hub.skippedTitle(1))).not.toBeInTheDocument()
  })
})
