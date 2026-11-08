import { type UserEvent } from '@testing-library/user-event'
import { screen, waitFor, within } from '@testing-library/react'
import { createFakes } from '@/lib/fakes'
import { addJob, latestJobOf } from '@/lib/fakes/store'
import { type Features } from '@/lib/clients'
import { SentenceError } from '@/lib/processorClient'
import { strings } from '@/strings'
import { chooseFromPieceMenu, openMoreMenu } from '@/test/hubMenu'
import { renderWithApp } from '@/test/render'

// The hub where the real processor has no route for a feature (features off), and Try again after a refusal.

const hub = strings.hub
const rp = strings.partReprocess
const MARCH = 'piece-concert-march'
const SLOW = 'piece-slow-waltz'

async function open(features?: Partial<Features>) {
  const view = renderWithApp(`/pieces/${MARCH}`, { seed: 'demo', ...(features === undefined ? {} : { features }) })
  await screen.findByRole('list', { name: hub.parts })
  return view
}

// How many parts offer Reprocess in their three-dot menu: each menu is opened, read and closed.
async function reprocessOffered(user: UserEvent) {
  let offered = 0
  for (const row of within(screen.getByRole('list', { name: hub.parts })).getAllByRole('listitem')) {
    await openMoreMenu(user, row.querySelector('[data-slot="part-name"]')?.textContent ?? '', row)
    if (screen.queryByRole('menuitem', { name: rp.submit }) !== null) offered += 1
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
  }
  return offered
}

describe('Piece hub with features off', () => {
  it('control: + Add part and Reprocess on a part are there, and Rename has Suggest a name', async () => {
    const { user } = await open()
    expect(screen.getByRole('button', { name: hub.addPart })).toBeInTheDocument()
    expect(await reprocessOffered(user)).toBeGreaterThan(0)
    await chooseFromPieceMenu(user, hub.rename)
    expect(within(await screen.findByRole('dialog', { name: hub.renameTitle })).getByRole('button', { name: strings.suggestName.button })).toBeInTheDocument()
  })

  it('gives Rename piece no Suggest a name with suggestName off', async () => {
    const { user } = await open({ suggestName: false })
    await chooseFromPieceMenu(user, hub.rename)
    const dialog = await screen.findByRole('dialog', { name: hub.renameTitle })
    expect(within(dialog).queryByRole('button', { name: strings.suggestName.button })).not.toBeInTheDocument()
  })

  it('shows no Reprocess on any part with reprocess off', async () => {
    const { user } = await open({ reprocess: false })
    expect(await reprocessOffered(user)).toBe(0)
  })

  it('shows no + Add part with upload off', async () => {
    await open({ upload: false })
    expect(screen.queryByRole('button', { name: hub.addPart })).not.toBeInTheDocument()
  })
})

describe('Piece hub: Try again after a refusal', () => {
  const failed = () => createFakes({ seed: 'demo', failStage: 'play order' })

  it('shows the processor\'s sentence when the retry is refused with one', async () => {
    const fakes = failed()
    fakes.processor.processPiece = () => Promise.reject(new SentenceError(strings.realServices.stillPreparing))
    const { user, router } = renderWithApp(`/pieces/${SLOW}`, { fakes })
    await screen.findByRole('alert')

    await user.click(screen.getByRole('button', { name: strings.common.retry }))

    expect(await screen.findByText(strings.realServices.stillPreparing)).toBeInTheDocument()
    expect(screen.queryByText(hub.retryFailed)).not.toBeInTheDocument()
    expect(router.state.location.pathname).toBe(`/pieces/${SLOW}`)
  })

  it('drops the sentence when the next try works', async () => {
    const fakes = failed()
    const processPiece = vi.spyOn(fakes.processor, 'processPiece').mockRejectedValueOnce(new SentenceError(strings.realServices.cannotStart))
    const { user, router } = renderWithApp(`/pieces/${SLOW}`, { fakes })
    await screen.findByRole('alert')
    await user.click(screen.getByRole('button', { name: strings.common.retry }))
    await screen.findByText(strings.realServices.cannotStart)

    await user.click(screen.getByRole('button', { name: strings.common.retry }))

    await waitFor(() => expect(router.state.location.pathname).toBe(`/pieces/${SLOW}/processing`))
    expect(processPiece).toHaveBeenCalledTimes(2)
  })

  it('starts a realign again, not the whole piece, when the job that failed was a realign', async () => {
    const fakes = createFakes({ seed: 'demo' })
    const failedRealign = addJob(fakes.store, MARCH, 'realign')
    failedRealign.job.status = 'error'
    failedRealign.job.error = 'x'
    const processPiece = vi.spyOn(fakes.processor, 'processPiece')
    const realign = vi.spyOn(fakes.processor, 'realign')
    const { user, router } = renderWithApp(`/pieces/${MARCH}`, { fakes })
    await screen.findByRole('alert')

    await user.click(screen.getByRole('button', { name: strings.common.retry }))

    await waitFor(() => expect(router.state.location.pathname).toBe(`/pieces/${MARCH}/processing`))
    expect(realign).toHaveBeenCalledWith(MARCH)
    expect(processPiece).not.toHaveBeenCalled()
    expect(latestJobOf(fakes.store, MARCH)?.job.kind).toBe('realign')
  })
})

describe('Piece hub: Try again in the notice of a part that could not be read', () => {
  function skipped() {
    const fakes = createFakes({ seed: 'demo' })
    const stored = latestJobOf(fakes.store, MARCH)!
    stored.job = { ...stored.job, status: 'done', progress: 1, error: null, parts: [{ id: 'p2', name: 'Crash cymbal', state: 'failed', error: 'x' }] }
    return fakes
  }

  it('shows the processor\'s sentence when it refuses', async () => {
    const fakes = skipped()
    vi.spyOn(fakes.processor, 'addParts').mockRejectedValue(new SentenceError(strings.limited.text))
    const { user } = renderWithApp(`/pieces/${MARCH}`, { fakes })
    await screen.findByRole('heading', { level: 1 })

    await user.click(within(screen.getByRole('alert')).getByRole('button', { name: strings.common.retry }))

    expect(await within(screen.getByRole('alert')).findByText(strings.limited.text)).toBeInTheDocument()
    expect(screen.queryByText(hub.skippedRetryFailed)).not.toBeInTheDocument()
  })

  it('keeps the generic sentence for any other error', async () => {
    const fakes = skipped()
    vi.spyOn(fakes.processor, 'addParts').mockRejectedValue(new Error('offline'))
    const { user } = renderWithApp(`/pieces/${MARCH}`, { fakes })
    await screen.findByRole('heading', { level: 1 })

    await user.click(within(screen.getByRole('alert')).getByRole('button', { name: strings.common.retry }))

    expect(await screen.findByText(hub.skippedRetryFailed)).toBeInTheDocument()
  })
})
