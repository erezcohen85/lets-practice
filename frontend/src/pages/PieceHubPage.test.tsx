import { screen, waitFor, within } from '@testing-library/react'
import { createFakes } from '@/lib/fakes'
import { latestJobOf } from '@/lib/fakes/store'
import { SentenceError } from '@/lib/processorClient'
import { strings } from '@/strings'
import { chooseFromPieceMenu, openMoreMenu } from '@/test/hubMenu'
import { renderWithApp } from '@/test/render'

const hub = strings.hub
const lib = strings.library

const CLARK = 'piece-clark-county'
const CLARK_TITLE = 'Clark County Celebration'
const MARCH = 'piece-concert-march'
const JAZZ = 'piece-jazz-combo'

/** The hub of a piece of the demo seed, once its title has loaded. */
async function openHub(id = CLARK, options: Parameters<typeof renderWithApp>[1] = {}) {
  const view = renderWithApp(`/pieces/${id}`, { seed: 'demo', ...options })
  await screen.findByRole('heading', { level: 1 })
  return view
}

const partRows = () => within(screen.getByRole('list', { name: hub.parts })).getAllByRole('listitem')

describe('Piece hub: the top of the page', () => {
  it('has a level-1 heading with the title and says how many parts and how long the recording is', async () => {
    await openHub()

    expect(screen.getByRole('heading', { level: 1, name: CLARK_TITLE })).toBeInTheDocument()
    expect(screen.getByText(hub.summary(3, '4:31'))).toBeInTheDocument()
    expect(hub.summary(3, '4:31')).toBe('3 parts, recording 4:31')
  })

  it('writes "1 part" and leaves the length out until it is known', () => {
    expect(hub.summary(1, '3:12')).toBe('1 part, recording 3:12')
    expect(hub.summary(2, '')).toBe('2 parts')
  })

  it('goes back to the library with the back link', async () => {
    const { user, router } = await openHub()

    const back = screen.getByRole('link', { name: strings.common.backToLibrary })
    expect(back).toHaveAttribute('href', '/library')
    await user.click(back)

    expect(router.state.location.pathname).toBe('/library')
  })

  it('has a big Practice link to the practice route', async () => {
    await openHub()

    const practice = screen.getByRole('link', { name: hub.practice })
    expect(practice).toHaveAttribute('href', expect.stringMatching(new RegExp(`^/pieces/${CLARK}/practice\\?part=part-\\d+$`)))
    expect(practice).toHaveClass('min-h-16')
  })

  it('has a three-dot menu of 44 px at the end of the title row, with Rename and a danger Delete and nothing else', async () => {
    const { user } = await openHub()

    const heading = screen.getByRole('heading', { level: 1 })
    const trigger = screen.getByRole('button', { name: hub.moreFor(CLARK_TITLE) })
    expect(trigger).toHaveClass('size-11')
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(heading.parentElement).toContainElement(trigger)
    // The summary sits under the row, not beside the dots.
    expect(heading.parentElement).not.toContainElement(screen.getByText(hub.summary(3, '4:31')))
    expect(screen.queryByRole('button', { name: hub.rename })).not.toBeInTheDocument()

    await user.click(trigger)

    const items = await screen.findAllByRole('menuitem')
    expect(items.map((item) => item.textContent)).toEqual([hub.rename, hub.delete])
    expect(items[0]).toHaveClass('h-11', 'text-text')
    expect(items[1]).toHaveClass('h-11', 'text-problem')
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
  })

  it('closes the menu with Escape and puts the focus back on the dots', async () => {
    const { user } = await openHub()
    const trigger = screen.getByRole('button', { name: hub.moreFor(CLARK_TITLE) })
    await user.click(trigger)
    await screen.findByRole('menu')

    await user.keyboard('{Escape}')

    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
    expect(trigger).toHaveFocus()
  })

  it('lays the three big actions out as Edit map, Share, Practice: one column on a phone, three from sm', async () => {
    await openHub()

    const edit = screen.getByRole('link', { name: hub.editMap })
    const share = screen.getByRole('button', { name: hub.shareButton })
    const practice = screen.getByRole('link', { name: hub.practice })
    const grid = edit.parentElement!
    expect(grid).toHaveClass('grid', 'grid-cols-1', 'sm:grid-cols-3')
    expect([...grid.children]).toEqual([edit, share, practice])
    for (const action of [edit, share, practice]) expect(action).toHaveClass('min-h-16', 'justify-center')
    // Palette A1: each big button is its own colour with its own dark label and a glow of its own colour; the Edit map
    // fill is the edit role, not the loop, and no label reads the page background (that was near-white on pastel in light).
    expect(edit).toHaveClass('bg-edit', 'text-on-edit')
    expect(edit.className).toContain('--lp-glow-colour:var(--lp-edit)')
    expect(share).toHaveClass('bg-share', 'text-on-share')
    expect(share.className).toContain('--lp-glow-colour:var(--lp-share)')
    expect(practice).toHaveClass('bg-primary', 'text-on-primary')
    for (const action of [edit, share, practice]) expect(action).not.toHaveClass('text-background')
  })

  it('opens the Share dialog from the pink Share button', async () => {
    const { user } = await openHub()

    await user.click(screen.getByRole('button', { name: hub.shareButton }))

    expect(await screen.findByRole('dialog', { name: strings.share.title })).toBeInTheDocument()
  })
})

describe('Piece hub: the review banner', () => {
  it('shows the banner for Clark County: 7 of 13 checked, the hint and an Edit map link', async () => {
    await openHub()

    // The twelve shared items plus Trumpet's bar-count problem, counted once for the piece.
    expect(screen.getByText(hub.reviewTitle(7, 13))).toBeInTheDocument()
    expect(hub.reviewTitle(7, 13)).toBe('Needs review: 7 of 13 checked')
    expect(screen.getByText(hub.reviewText)).toBeInTheDocument()
    // The banner keeps its words and loses its button: Edit map sits beside Practice, once.
    const banner = screen.getByText(hub.reviewTitle(7, 13)).closest('[data-slot="review-banner"]') as HTMLElement
    expect(within(banner).queryByRole('link')).not.toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: hub.editMap })).toHaveLength(1)
  })

  it('uses the warning colours', async () => {
    await openHub()

    expect(screen.getByText(hub.reviewTitle(7, 13))).toHaveClass('text-warning-text')
    expect(screen.getByText(hub.reviewText)).toHaveClass('text-warning-text-soft')
    expect(screen.getByText(hub.reviewTitle(7, 13)).closest('[data-slot="review-banner"]')).toHaveClass(
      'bg-warning-bg',
      'border-warning-border',
    )
  })

  it('shows no banner for a ready piece, only a quiet Edit map link', async () => {
    await openHub(MARCH)

    expect(screen.queryByText(/Needs review/)).not.toBeInTheDocument()
    expect(screen.queryByText(hub.reviewText)).not.toBeInTheDocument()
    const links = screen.getAllByRole('link', { name: hub.editMap })
    expect(links).toHaveLength(1)
    expect(links[0]).toHaveAttribute('href', expect.stringMatching(new RegExp(`^/pieces/${MARCH}/edit\\?part=part-\\d+$`)))
    expect(links[0]).not.toHaveClass('bg-selected')
  })
})

describe('Piece hub: the main buttons and the last opened part', () => {
  const partsOfClark = async (fakes: ReturnType<typeof createFakes>) => (await fakes.data.getPiece(CLARK))!.parts

  it('puts Edit map beside the big Practice link, as big as it, in another colour (Erez, 2026-11-03)', async () => {
    await openHub()

    const practice = screen.getByRole('link', { name: hub.practice })
    const edit = screen.getByRole('link', { name: hub.editMap })
    expect(edit.parentElement).toBe(practice.parentElement)
    expect(edit).toHaveClass('min-h-16', 'text-xl', 'bg-edit')
    expect(practice).toHaveClass('min-h-16', 'text-xl', 'bg-primary')
    expect(edit).not.toHaveClass('bg-primary')
  })

  it('opens the first part when no part was opened yet', async () => {
    const fakes = createFakes({ seed: 'demo' })
    const parts = await partsOfClark(fakes)
    await openHub(CLARK, { fakes })

    expect(screen.getByRole('link', { name: hub.practice })).toHaveAttribute('href', `/pieces/${CLARK}/practice?part=${parts[0].id}`)
    expect(screen.getByRole('link', { name: hub.editMap })).toHaveAttribute('href', `/pieces/${CLARK}/edit?part=${parts[0].id}`)
  })

  it('opens the last opened part with both main buttons', async () => {
    const fakes = createFakes({ seed: 'demo' })
    const parts = await partsOfClark(fakes)
    await fakes.data.setLastPart(CLARK, parts[2].id)
    await openHub(CLARK, { fakes })

    expect(screen.getByRole('link', { name: hub.practice })).toHaveAttribute('href', `/pieces/${CLARK}/practice?part=${parts[2].id}`)
    expect(screen.getByRole('link', { name: hub.editMap })).toHaveAttribute('href', `/pieces/${CLARK}/edit?part=${parts[2].id}`)
  })

  it('falls back to the first part when the remembered part is gone', async () => {
    const fakes = createFakes({ seed: 'demo' })
    const parts = await partsOfClark(fakes)
    fakes.store.pieces.get(CLARK)!.lastPartId = 'part-deleted'
    await openHub(CLARK, { fakes })

    expect(screen.getByRole('link', { name: hub.practice })).toHaveAttribute('href', `/pieces/${CLARK}/practice?part=${parts[0].id}`)
  })

  it('remembers the part a part button opens', async () => {
    const { user, fakes } = await openHub()
    const parts = await partsOfClark(fakes)

    await user.click(screen.getByRole('link', { name: hub.editPart(parts[1].name) }))

    await waitFor(() => expect(fakes.store.pieces.get(CLARK)?.lastPartId).toBe(parts[1].id))
  })
})

describe('Piece hub: the recording', () => {
  it('shows the Recording card with the recording name and a waveform of 80 bars', async () => {
    const { container } = await openHub()

    expect(screen.getByRole('heading', { level: 2, name: hub.recording })).toBeInTheDocument()
    expect(screen.getByText('clark-county-celebration.mp3')).toBeInTheDocument()
    await waitFor(() => expect(container.querySelectorAll('[data-slot="wave-bar"]')).toHaveLength(80))
  })

  it('shows a skeleton while the waveform loads', async () => {
    const fakes = createFakes({ seed: 'demo' })
    fakes.data.getPeaks = () => new Promise(() => {})
    const { container } = await openHub(CLARK, { fakes })

    expect(screen.getByRole('status', { name: hub.waveformLoading })).toBeInTheDocument()
    expect(container.querySelector('[data-slot="skeleton"]')).toBeInTheDocument()
    expect(container.querySelector('[data-slot="wave-bar"]')).not.toBeInTheDocument()
  })

  it('says so when the piece has no waveform', async () => {
    const fakes = createFakes({ seed: 'demo' })
    fakes.data.getPeaks = async () => null
    await openHub(CLARK, { fakes })

    expect(await screen.findByText(hub.waveformMissing)).toBeInTheDocument()
  })

  it('says so when the waveform cannot be loaded, and keeps the rest of the page', async () => {
    const fakes = createFakes({ seed: 'demo' })
    fakes.data.getPeaks = () => Promise.reject(new Error('offline'))
    await openHub(CLARK, { fakes })

    expect(await screen.findByText(hub.waveformError)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: hub.practice })).toBeInTheDocument()
  })
})

describe('Piece hub: the parts', () => {
  it('lists the three parts of Clark County in order, with their review status', async () => {
    await openHub()

    expect(screen.getByRole('heading', { level: 2, name: hub.parts })).toBeInTheDocument()
    const rows = partRows()
    expect(rows).toHaveLength(3)
    expect(rows[0]).toHaveTextContent('Clarinet in B♭ 1')
    expect(rows[0]).toHaveTextContent(hub.partStatus.reviewed(7, 12))
    expect(rows[1]).toHaveTextContent('Trumpet in B♭ 2')
    expect(rows[1]).toHaveTextContent(hub.partStatus.reviewed(7, 13))
    expect(rows[2]).toHaveTextContent('Flute 1')
    expect(rows[2]).toHaveTextContent(hub.partStatus.reviewed(7, 12))
  })

  it('shows "not reviewed" on every part of a piece with nothing checked', async () => {
    await openHub(JAZZ)

    expect(partRows()).toHaveLength(4)
    expect(screen.getAllByText(hub.partStatus.notReviewed)).toHaveLength(4)
  })

  it('writes the three statuses as the board does', () => {
    expect(hub.partStatus.reviewed(7, 12)).toBe('Reviewed 7 of 12')
    expect(hub.partStatus.notReviewed).toBe('Not reviewed yet')
    expect(hub.partStatus.allChecked).toBe('Reviewed, all checked')
  })

  it('colours the status: amber when partly reviewed, muted when not, green when all checked', async () => {
    await openHub()

    expect(screen.getByText(hub.partStatus.reviewed(7, 13))).toHaveClass('text-selected')
    expect(screen.getAllByText(hub.partStatus.reviewed(7, 12))[0]).toHaveClass('text-selected')
  })

  it('colours the other two statuses on the pieces that show them: muted when not reviewed, green when all checked', async () => {
    const jazz = await openHub(JAZZ)
    expect(screen.getAllByText(hub.partStatus.notReviewed)[0]).toHaveClass('text-text-muted')
    jazz.unmount()

    await openHub(MARCH)
    expect(screen.getAllByText(hub.partStatus.allChecked)[0]).toHaveClass('text-anchor')
  })

  it('links each part to Practice and to Edit with its own part id, as icon-only buttons of 44 px', async () => {
    const { fakes } = await openHub()
    const detail = await fakes.data.getPiece(CLARK)

    for (const part of detail?.parts ?? []) {
      const practice = screen.getByRole('link', { name: hub.practicePart(part.name) })
      expect(practice).toHaveAttribute('href', `/pieces/${CLARK}/practice?part=${part.id}`)
      expect(practice).toHaveAttribute('title', hub.practice)
      expect(practice).toHaveTextContent('')
      expect(practice.querySelector('svg')).not.toBeNull()
      expect(practice).toHaveClass('size-11', 'text-primary-strong', 'border-primary-strong')
      const edit = screen.getByRole('link', { name: hub.editPart(part.name) })
      expect(edit).toHaveAttribute('href', `/pieces/${CLARK}/edit?part=${part.id}`)
      expect(edit).toHaveAttribute('title', hub.edit)
      expect(edit).toHaveTextContent('')
      expect(edit.querySelector('svg')).not.toBeNull()
      expect(edit).toHaveClass('size-11', 'text-loop', 'border-loop')
    }
    expect(detail?.parts).toHaveLength(3)
    expect(hub.practicePart('Clarinet in B♭ 1')).toBe('Practice Clarinet in B♭ 1')
    expect(hub.editPart('Clarinet in B♭ 1')).toBe('Edit Clarinet in B♭ 1')
  })

  it('has no part colours: a row is the name and status, then the two buttons', async () => {
    await openHub()

    for (const row of partRows()) {
      expect(row.firstElementChild).toHaveTextContent(/\S/)
      expect(row.children).toHaveLength(2)
    }
  })

  it('has an Add part button of 44 px beside the Parts heading', async () => {
    await openHub()

    const add = screen.getByRole('button', { name: hub.addPart })
    expect(add).toHaveClass('h-11')
    expect(add.parentElement).toBe(screen.getByRole('heading', { level: 2, name: hub.parts }).parentElement)
  })

  it('shows every part of a ready piece as all checked', async () => {
    await openHub(MARCH)

    expect(partRows()).toHaveLength(2)
    expect(screen.getAllByText(hub.partStatus.allChecked)).toHaveLength(2)
  })

  it('goes to the practice route for a part', async () => {
    const { user, router } = await openHub()

    await user.click(screen.getByRole('link', { name: hub.practicePart('Flute 1') }))

    expect(router.state.location.pathname).toBe(`/pieces/${CLARK}/practice`)
    expect(router.state.location.search).toMatch(/^\?part=part-\d+$/)
  })

  it('goes to the edit route for a part', async () => {
    const { user, router } = await openHub()

    await user.click(screen.getByRole('link', { name: hub.editPart('Flute 1') }))

    expect(router.state.location.pathname).toBe(`/pieces/${CLARK}/edit`)
    expect(router.state.location.search).toMatch(/^\?part=part-\d+$/)
  })
})

describe('Piece hub: navigation', () => {
  it('goes to the practice route with the big Practice link', async () => {
    const { user, router } = await openHub()

    await user.click(screen.getByRole('link', { name: hub.practice }))

    expect(router.state.location.pathname).toBe(`/pieces/${CLARK}/practice`)
    expect(router.state.location.search).toMatch(/^\?part=part-\d+$/)
  })

  it('goes to the edit route with Edit map', async () => {
    const { user, router } = await openHub()

    await user.click(screen.getByRole('link', { name: hub.editMap }))

    expect(router.state.location.pathname).toBe(`/pieces/${CLARK}/edit`)
    expect(router.state.location.search).toMatch(/^\?part=part-\d+$/)
  })

  it('shows the not found page for an unknown piece', async () => {
    renderWithApp('/pieces/piece-nobody', { seed: 'demo' })

    expect(await screen.findByRole('heading', { name: strings.common.notFoundTitle })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: strings.common.goToLibrary })).toHaveAttribute('href', '/library')
  })

  it('redirects a piece that is still processing to its processing screen, replacing the hub in the history', async () => {
    const { router } = renderWithApp('/pieces/piece-slow-waltz', { seed: 'demo' })

    await waitFor(() => expect(router.state.location.pathname).toBe('/pieces/piece-slow-waltz/processing'))
    expect(router.state.historyAction).toBe('REPLACE')
  })
})

describe('Piece hub: loading and errors', () => {
  it('shows the back link and a loading state while the piece loads', async () => {
    const fakes = createFakes({ seed: 'demo' })
    fakes.data.getPiece = () => new Promise(() => {})
    renderWithApp(`/pieces/${CLARK}`, { fakes })

    expect(await screen.findByText(hub.loading)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: strings.common.backToLibrary })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument()
  })

  it('shows the error state when the piece cannot be loaded, and Try again loads it', async () => {
    const fakes = createFakes({ seed: 'demo' })
    const getPiece = fakes.data.getPiece
    fakes.data.getPiece = () => Promise.reject(new Error('offline'))
    const { user } = renderWithApp(`/pieces/${CLARK}`, { fakes })

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(hub.loadErrorTitle)
    expect(alert).toHaveTextContent(hub.loadErrorText)

    fakes.data.getPiece = getPiece
    await user.click(screen.getByRole('button', { name: strings.common.retry }))

    expect(await screen.findByRole('heading', { level: 1, name: CLARK_TITLE })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  describe('a piece whose processing failed', () => {
    const failed = () => createFakes({ seed: 'demo', failStage: 'play order' })
    const jobsOf = (fakes: ReturnType<typeof createFakes>) =>
      [...fakes.store.jobs.values()].filter((stored) => stored.job.pieceId === 'piece-slow-waltz')

    it('shows the error state with the title, the job error and the ways on', async () => {
      renderWithApp('/pieces/piece-slow-waltz', { fakes: failed() })

      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent(hub.failedTitle)
      expect(alert).toHaveTextContent('play order failed: fake failure')
      expect(screen.getByRole('heading', { level: 1, name: 'Slow Waltz in G' })).toBeInTheDocument()
      expect(within(alert).getByRole('button', { name: strings.common.retry })).toBeInTheDocument()
      expect(within(alert).getByRole('link', { name: strings.common.goToLibrary })).toHaveAttribute('href', '/library')
      expect(screen.queryByRole('link', { name: hub.practice })).not.toBeInTheDocument()
    })

    it('starts a new job with Try again and goes to the processing screen', async () => {
      const fakes = failed()
      const { user, router } = renderWithApp('/pieces/piece-slow-waltz', { fakes })
      await screen.findByRole('alert')
      expect(jobsOf(fakes)).toHaveLength(1)
      const failedJobId = jobsOf(fakes)[0].job.id

      await user.click(screen.getByRole('button', { name: strings.common.retry }))

      await waitFor(() => expect(router.state.location.pathname).toBe('/pieces/piece-slow-waltz/processing'))
      // The hub starts the job; the processing screen then reads it, which moves the fake job on, so only "not failed" is
      // asserted of its state (queued and running are both right).
      expect(jobsOf(fakes)).toHaveLength(2)
      const latest = latestJobOf(fakes.store, 'piece-slow-waltz')?.job
      expect(latest?.id).not.toBe(failedJobId)
      expect(latest?.status).not.toBe('error')
    })

    it('says so and stays when the job cannot be started', async () => {
      const fakes = failed()
      fakes.processor.processPiece = () => Promise.reject(new Error('offline'))
      const { user, router } = renderWithApp('/pieces/piece-slow-waltz', { fakes })
      await screen.findByRole('alert')

      await user.click(screen.getByRole('button', { name: strings.common.retry }))

      expect(await screen.findByText(hub.retryFailed)).toBeInTheDocument()
      expect(router.state.location.pathname).toBe('/pieces/piece-slow-waltz')
    })

    it('lets the user delete a failed piece', async () => {
      const fakes = failed()
      const { user, router } = renderWithApp('/pieces/piece-slow-waltz', { fakes })
      await screen.findByRole('alert')

      // The title row's menu has Delete and no Rename: a piece that never read has nothing to rename yet.
      await openMoreMenu(user, screen.getByRole('heading', { level: 1 }).textContent ?? '')
      expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([hub.delete])
      await user.click(screen.getByRole('menuitem', { name: hub.delete }))
      const dialog = await screen.findByRole('alertdialog')
      await user.click(within(dialog).getByRole('button', { name: hub.delete }))

      await waitFor(() => expect(router.state.location.pathname).toBe('/library'))
      expect(fakes.store.pieces.has('piece-slow-waltz')).toBe(false)
    })
  })
})

describe('Piece hub: Rename', () => {
  const openRename = async (options: Parameters<typeof renderWithApp>[1] = {}) => {
    const view = await openHub(CLARK, options)
    await chooseFromPieceMenu(view.user, hub.rename)
    const dialog = await screen.findByRole('dialog', { name: hub.renameTitle })
    const field = within(dialog).getByRole('textbox', { name: hub.renameLabel })
    return { ...view, dialog, field }
  }
  const gone = () => waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

  it('opens a dialog with the title field filled in and focused', async () => {
    const { field } = await openRename()

    expect(field).toHaveValue(CLARK_TITLE)
    await waitFor(() => expect(field).toHaveFocus())
  })

  it('renames the piece: the heading changes and the dialog closes', async () => {
    const { user, dialog, field } = await openRename()

    await user.clear(field)
    await user.type(field, 'Clark County Suite')
    await user.click(within(dialog).getByRole('button', { name: hub.renameSave }))

    expect(await screen.findByRole('heading', { level: 1, name: 'Clark County Suite' })).toBeInTheDocument()
    await gone()
  })

  it('saves with Enter in the field', async () => {
    const { user, field } = await openRename()

    await user.clear(field)
    await user.type(field, 'Clark County Suite{Enter}')

    expect(await screen.findByRole('heading', { level: 1, name: 'Clark County Suite' })).toBeInTheDocument()
  })

  it('trims the new title', async () => {
    const { user, field, fakes } = await openRename()

    await user.clear(field)
    await user.type(field, '   Spaced out   {Enter}')

    expect(await screen.findByRole('heading', { level: 1, name: 'Spaced out' })).toBeInTheDocument()
    expect(fakes.store.pieces.get(CLARK)?.title).toBe('Spaced out')
  })

  it('shows the new title in the Library after going back', async () => {
    const { user, dialog, field } = await openRename()
    await user.clear(field)
    await user.type(field, 'Clark County Suite')
    await user.click(within(dialog).getByRole('button', { name: hub.renameSave }))
    await screen.findByRole('heading', { level: 1, name: 'Clark County Suite' })
    await gone()

    await user.click(screen.getByRole('link', { name: strings.common.backToLibrary }))

    expect(await screen.findByRole('link', { name: /Clark County Suite/ })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: new RegExp(CLARK_TITLE) })).not.toBeInTheDocument()
    expect(await screen.findByText(lib.pieceCount(5))).toBeInTheDocument()
  })

  it('refuses an empty title: the dialog stays, the field says why and nothing is saved', async () => {
    const { user, dialog, field, fakes } = await openRename()

    await user.clear(field)
    await user.click(within(dialog).getByRole('button', { name: hub.renameSave }))

    const message = await within(dialog).findByText(hub.renameEmpty)
    expect(field).toHaveAttribute('aria-invalid', 'true')
    expect(field).toHaveAccessibleDescription(hub.renameEmpty)
    expect(message).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(fakes.store.pieces.get(CLARK)?.title).toBe(CLARK_TITLE)
    // The page behind a modal dialog is hidden from assistive technology, so the heading is looked up as hidden.
    expect(screen.getByRole('heading', { level: 1, name: CLARK_TITLE, hidden: true })).toBeInTheDocument()
  })

  it('refuses a title of spaces only', async () => {
    const { user, field } = await openRename()

    await user.clear(field)
    await user.type(field, '    {Enter}')

    expect(await screen.findByText(hub.renameEmpty)).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('takes the error away once the user types again', async () => {
    const { user, field } = await openRename()
    await user.clear(field)
    await user.type(field, '{Enter}')
    await screen.findByText(hub.renameEmpty)

    await user.type(field, 'A')

    expect(screen.queryByText(hub.renameEmpty)).not.toBeInTheDocument()
    expect(field).not.toHaveAttribute('aria-invalid', 'true')
  })

  it('leaves the title alone with Cancel, and shows the old title again next time', async () => {
    const { user, dialog, field } = await openRename()
    await user.clear(field)
    await user.type(field, 'Something else')

    await user.click(within(dialog).getByRole('button', { name: hub.cancel }))
    await gone()

    expect(screen.getByRole('heading', { level: 1, name: CLARK_TITLE })).toBeInTheDocument()
    await chooseFromPieceMenu(user, hub.rename)
    const again = within(await screen.findByRole('dialog')).getByRole('textbox', { name: hub.renameLabel })
    expect(again).toHaveValue(CLARK_TITLE)
  })

  it('closes with Escape', async () => {
    const { user } = await openRename()

    await user.keyboard('{Escape}')

    await gone()
    expect(screen.getByRole('heading', { level: 1, name: CLARK_TITLE })).toBeInTheDocument()
  })

  it('says so and stays open when the title cannot be saved', async () => {
    const fakes = createFakes({ seed: 'demo' })
    fakes.data.renamePiece = () => Promise.reject(new Error('offline'))
    const { user, field } = await openRename({ fakes })

    await user.clear(field)
    await user.type(field, 'Clark County Suite{Enter}')

    expect(await screen.findByText(hub.renameFailed)).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: CLARK_TITLE, hidden: true })).toBeInTheDocument()
  })

  it('refuses a title of more than 200 characters in the dialog, with a sentence', async () => {
    const { user, field } = await openRename()

    await user.clear(field)
    await user.click(field)
    await user.paste('x'.repeat(201))
    await user.keyboard('{Enter}')

    expect(await screen.findByText(hub.renameTooLong)).toBeInTheDocument()
    expect(screen.queryByText(hub.renameFailed)).not.toBeInTheDocument()
  })

  it('has buttons of 44 px and a label for the field', async () => {
    const { dialog } = await openRename()

    expect(within(dialog).getByRole('button', { name: hub.renameSave })).toHaveClass('h-11')
    expect(within(dialog).getByRole('button', { name: hub.cancel })).toHaveClass('h-11')
    expect(within(dialog).getByLabelText(hub.renameLabel)).toBeInTheDocument()
  })
})

describe('Piece hub: Delete', () => {
  const openDelete = async (options: Parameters<typeof renderWithApp>[1] = {}) => {
    const view = await openHub(CLARK, options)
    await chooseFromPieceMenu(view.user, hub.delete)
    const dialog = await screen.findByRole('alertdialog', { name: hub.deleteTitle(CLARK_TITLE) })
    return { ...view, dialog }
  }

  it('asks first, with the title and what is removed', async () => {
    const { dialog, fakes } = await openDelete()

    expect(hub.deleteTitle(CLARK_TITLE)).toBe('Delete Clark County Celebration?')
    expect(within(dialog).getByText(hub.deleteText)).toBeInTheDocument()
    expect(hub.deleteText).toBe('This removes its recording, parts and map.')
    expect(fakes.store.pieces.has(CLARK)).toBe(true)
  })

  it('keeps the piece with Cancel', async () => {
    const { user, dialog, fakes, router } = await openDelete()

    await user.click(within(dialog).getByRole('button', { name: hub.cancel }))

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(fakes.store.pieces.has(CLARK)).toBe(true)
    expect(router.state.location.pathname).toBe(`/pieces/${CLARK}`)
  })

  it('keeps the piece with Escape', async () => {
    const { user, fakes } = await openDelete()

    await user.keyboard('{Escape}')

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(fakes.store.pieces.has(CLARK)).toBe(true)
  })

  it('removes the piece and lands on the Library without it', async () => {
    const { user, dialog, fakes, router } = await openDelete()

    await user.click(within(dialog).getByRole('button', { name: hub.delete }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/library'))
    expect(fakes.store.pieces.has(CLARK)).toBe(false)
    expect(await screen.findByText(lib.pieceCount(4))).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: new RegExp(CLARK_TITLE) })).not.toBeInTheDocument()
  })

  it('says so and stays when the piece cannot be deleted', async () => {
    const fakes = createFakes({ seed: 'demo' })
    fakes.data.deletePiece = () => Promise.reject(new Error('offline'))
    const { user, dialog, router } = await openDelete({ fakes })

    await user.click(within(dialog).getByRole('button', { name: hub.delete }))

    expect(await within(screen.getByRole('alertdialog')).findByText(hub.deleteFailed)).toBeInTheDocument()
    expect(router.state.location.pathname).toBe(`/pieces/${CLARK}`)
    expect(fakes.store.pieces.has(CLARK)).toBe(true)
  })

  it('shows the sentence when the piece is still being prepared', async () => {
    const fakes = createFakes({ seed: 'demo' })
    fakes.data.deletePiece = () => Promise.reject(new SentenceError(strings.realServices.stillPreparing))
    const { user, dialog } = await openDelete({ fakes })

    await user.click(within(dialog).getByRole('button', { name: hub.delete }))

    expect(await within(screen.getByRole('alertdialog')).findByText(strings.realServices.stillPreparing)).toBeInTheDocument()
    expect(screen.queryByText(hub.deleteFailed)).not.toBeInTheDocument()
  })

  it('has buttons of 44 px', async () => {
    const { dialog } = await openDelete()

    expect(within(dialog).getByRole('button', { name: hub.delete })).toHaveClass('h-11')
    expect(within(dialog).getByRole('button', { name: hub.cancel })).toHaveClass('h-11')
  })
})
