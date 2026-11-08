import { act, screen, within } from '@testing-library/react'
import { createFakes } from '@/lib/fakes'
import { strings } from '@/strings'
import { renderWithApp } from '@/test/render'

const lib = strings.library
const TITLES = ['Clark County Celebration', 'Concert March', 'Slow Waltz in G', 'Etude No. 4', 'Jazz Combo Chart']

const demo = () => renderWithApp('/library', { seed: 'demo' })

/** The cards of the grid, once the first load has finished. */
async function findCards() {
  const list = await screen.findByRole('list')
  return within(list).getAllByRole('listitem')
}

const cardLink = (title: string) => screen.getByRole('link', { name: new RegExp(title) })
const percentOf = (title: string) => Number(/Processing (\d+)%/.exec(cardLink(title).textContent ?? '')?.[1])

describe('Library: the page', () => {
  it('has a level-1 heading, the piece count and a New piece link', async () => {
    demo()

    expect(await screen.findByRole('heading', { level: 1, name: lib.title })).toBeInTheDocument()
    expect(await screen.findByText(lib.pieceCount(5))).toBeInTheDocument()
    expect(screen.getByRole('link', { name: lib.newPiece })).toHaveAttribute('href', '/pieces/new')
  })

  it('says "1 piece" for a single piece', () => {
    expect(lib.pieceCount(1)).toBe('1 piece')
    expect(lib.pieceCount(0)).toBe('0 pieces')
  })

  it('shows the top bar with Settings', async () => {
    demo()

    expect(await screen.findByRole('link', { name: strings.common.settings })).toBeInTheDocument()
  })

  it('has touch targets of 48 px: New piece, the search field and the four filters', async () => {
    demo()
    await findCards()

    expect(screen.getByRole('link', { name: lib.newPiece })).toHaveClass('h-12')
    expect(screen.getByRole('textbox', { name: lib.searchLabel })).toHaveClass('h-12')
    expect(screen.getByRole('button', { name: lib.filterAll })).toHaveClass('h-12')
    expect(screen.getByRole('button', { name: lib.filterNeedsReview })).toHaveClass('h-12')
    expect(screen.getByRole('button', { name: lib.filterReady })).toHaveClass('h-12')
    expect(screen.getByRole('button', { name: lib.filterShared })).toHaveClass('h-12')
  })
})

describe('Library: the cards', () => {
  it('shows the five pieces of the demo seed, newest first', async () => {
    demo()

    const cards = await findCards()

    expect(cards).toHaveLength(5)
    cards.forEach((card, index) => expect(card).toHaveTextContent(TITLES[index]))
  })

  it('shows "N parts, m:ss" under each title and no part colours', async () => {
    demo()
    await findCards()

    expect(cardLink('Clark County Celebration')).toHaveTextContent(lib.cardSubtitle(3, '4:31'))
    expect(cardLink('Concert March')).toHaveTextContent('2 parts, 3:12')
    expect(cardLink('Slow Waltz in G')).toHaveTextContent('1 part, 5:02')
    expect(cardLink('Jazz Combo Chart')).toHaveTextContent('4 parts, 6:20')
    // The only coloured thing on a card is its status line.
    expect(cardLink('Clark County Celebration').querySelectorAll('[class*="bg-"]')).toHaveLength(1)
  })

  it('leaves the duration out while it is not known', () => {
    expect(lib.cardSubtitle(2, '')).toBe('2 parts')
    expect(lib.cardSubtitle(1, '')).toBe('1 part')
  })

  it('shows the status of each piece', async () => {
    demo()
    await findCards()

    expect(cardLink('Clark County Celebration')).toHaveTextContent(lib.status.needsReview(7, 13))
    expect(cardLink('Concert March')).toHaveTextContent(lib.status.ready)
    expect(cardLink('Etude No. 4')).toHaveTextContent(lib.status.ready)
    expect(cardLink('Jazz Combo Chart')).toHaveTextContent(lib.status.needsReview(0, 9))
    expect(cardLink('Slow Waltz in G')).toHaveTextContent(/^Slow Waltz in G1 part, 5:02Processing \d+%$/)
  })

  it('colours the status line by its state: primary, amber, green', async () => {
    demo()
    await findCards()

    expect(screen.getByText(lib.status.needsReview(7, 13))).toHaveClass('text-selected')
    // "Ready to practice" is also the name of a filter, so the status is looked for inside its card.
    expect(within(cardLink('Concert March')).getByText(lib.status.ready)).toHaveClass('text-anchor')
    expect(screen.getByText(/^Processing \d+%$/)).toHaveClass('text-primary-strong')
  })

  it('shows the colour of a failed piece as the problem colour', async () => {
    renderWithApp('/library', { seed: 'demo', failStage: 'play order' })
    await findCards()

    expect(screen.getByText(lib.status.failed)).toHaveClass('text-problem')
  })

  it('shows a progress bar only on a processing card, with its percentage', async () => {
    demo()
    await findCards()

    const bars = screen.getAllByRole('progressbar')
    expect(bars).toHaveLength(1)
    expect(bars[0]).toHaveAccessibleName(lib.progressLabel)
    expect(bars[0]).toHaveAttribute('aria-valuenow', String(percentOf('Slow Waltz in G')))
    expect(within(cardLink('Etude No. 4')).queryByRole('progressbar')).not.toBeInTheDocument()
  })

  it('links a processing card to its processing screen and every other card to the hub', async () => {
    demo()
    await findCards()

    expect(cardLink('Slow Waltz in G')).toHaveAttribute('href', '/pieces/piece-slow-waltz/processing')
    expect(cardLink('Clark County Celebration')).toHaveAttribute('href', '/pieces/piece-clark-county')
    expect(cardLink('Etude No. 4')).toHaveAttribute('href', '/pieces/piece-etude-4')
  })

  it('links a failed card to the hub, where the failure is explained', async () => {
    renderWithApp('/library', { seed: 'demo', failStage: 'play order' })
    await findCards()

    expect(cardLink('Slow Waltz in G')).toHaveTextContent(lib.status.failed)
    expect(cardLink('Slow Waltz in G')).toHaveAttribute('href', '/pieces/piece-slow-waltz')
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
  })

  it('opens the hub when a card is clicked', async () => {
    const { user, router } = demo()
    await findCards()

    await user.click(cardLink('Etude No. 4'))

    expect(router.state.location.pathname).toBe('/pieces/piece-etude-4')
  })
})

describe('Library: search and the review filter', () => {
  it('narrows the list as the user types', async () => {
    const { user } = demo()
    await findCards()

    await user.type(screen.getByRole('textbox', { name: lib.searchLabel }), 'etude')

    const cards = await findCards()
    expect(cards).toHaveLength(1)
    expect(cards[0]).toHaveTextContent('Etude No. 4')
  })

  it('has a placeholder and finds a title ignoring case', async () => {
    const { user } = demo()
    await findCards()
    const search = screen.getByRole('textbox', { name: lib.searchLabel })

    expect(search).toHaveAttribute('placeholder', lib.searchPlaceholder)
    await user.type(search, 'JAZZ')

    expect(await findCards()).toHaveLength(1)
    expect(cardLink('Jazz Combo Chart')).toBeInTheDocument()
  })

  it('shows All as pressed at first', async () => {
    demo()
    await findCards()

    expect(screen.getByRole('button', { name: lib.filterAll })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: lib.filterNeedsReview })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('group', { name: lib.filterLabel })).toBeInTheDocument()
  })

  it('shows only the two pieces that need review', async () => {
    const { user } = demo()
    await findCards()

    await user.click(screen.getByRole('button', { name: lib.filterNeedsReview }))

    const cards = await findCards()
    expect(cards).toHaveLength(2)
    expect(cards[0]).toHaveTextContent('Clark County Celebration')
    expect(cards[1]).toHaveTextContent('Jazz Combo Chart')
    expect(screen.getByRole('button', { name: lib.filterNeedsReview })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: lib.filterAll })).toHaveAttribute('aria-pressed', 'false')
  })

  it('goes back to every piece with All', async () => {
    const { user } = demo()
    await findCards()
    await user.click(screen.getByRole('button', { name: lib.filterNeedsReview }))

    await user.click(screen.getByRole('button', { name: lib.filterAll }))

    expect(await findCards()).toHaveLength(5)
  })

  it('is a single choice: pressing the pressed filter again keeps it', async () => {
    const { user } = demo()
    await findCards()
    await user.click(screen.getByRole('button', { name: lib.filterNeedsReview }))

    await user.click(screen.getByRole('button', { name: lib.filterNeedsReview }))

    expect(screen.getByRole('button', { name: lib.filterNeedsReview })).toHaveAttribute('aria-pressed', 'true')
    expect(await findCards()).toHaveLength(2)
  })

  it('combines the search with the filter', async () => {
    const { user } = demo()
    await findCards()
    await user.click(screen.getByRole('button', { name: lib.filterNeedsReview }))

    await user.type(screen.getByRole('textbox', { name: lib.searchLabel }), 'jazz')

    const cards = await findCards()
    expect(cards).toHaveLength(1)
    expect(cards[0]).toHaveTextContent('Jazz Combo Chart')
  })

  it('keeps the total in the heading while the list is narrowed', async () => {
    const { user } = demo()
    await findCards()

    await user.type(screen.getByRole('textbox', { name: lib.searchLabel }), 'etude')

    expect(screen.getByText(lib.pieceCount(5))).toBeInTheDocument()
  })

  it('says no piece matches, and Show all pieces clears the search and the filter', async () => {
    const { user } = demo()
    await findCards()
    await user.click(screen.getByRole('button', { name: lib.filterNeedsReview }))
    await user.type(screen.getByRole('textbox', { name: lib.searchLabel }), 'zzz')

    expect(await screen.findByRole('heading', { name: lib.noMatchTitle })).toBeInTheDocument()
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
    // The search and the filter stay on screen, so the user can change them.
    expect(screen.getByRole('textbox', { name: lib.searchLabel })).toHaveValue('zzz')

    await user.click(screen.getByRole('button', { name: lib.showAll }))

    expect(await findCards()).toHaveLength(5)
    expect(screen.getByRole('textbox', { name: lib.searchLabel })).toHaveValue('')
    expect(screen.getByRole('button', { name: lib.filterAll })).toHaveAttribute('aria-pressed', 'true')
  })
})

describe('Library: polling while a piece is processing', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const advance = (ms: number) =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(ms)
    })

  it('moves the percentage of a processing card on every 1.5 seconds', async () => {
    demo()
    await findCards()
    const first = percentOf('Slow Waltz in G')

    await advance(1500)
    const second = percentOf('Slow Waltz in G')
    await advance(1500)
    const third = percentOf('Slow Waltz in G')

    expect(first).toBeGreaterThan(0)
    expect(second).toBeGreaterThan(first)
    expect(third).toBeGreaterThan(second)
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', String(third))
  })

  it('does not load again before 1.5 seconds have passed', async () => {
    const fakes = createFakes({ seed: 'demo' })
    const listPieces = vi.spyOn(fakes.data, 'listPieces')
    renderWithApp('/library', { fakes })
    await findCards()
    expect(listPieces).toHaveBeenCalledTimes(1)

    await advance(1400)

    expect(listPieces).toHaveBeenCalledTimes(1)
    await advance(200)
    expect(listPieces).toHaveBeenCalledTimes(2)
  })

  it('turns the card into Needs review when the job is done, links it to the hub and stops polling', async () => {
    const fakes = createFakes({ seed: 'demo' })
    const listPieces = vi.spyOn(fakes.data, 'listPieces')
    renderWithApp('/library', { fakes })
    await findCards()

    await advance(10_000)

    expect(cardLink('Slow Waltz in G')).toHaveTextContent(/Needs review: 0 of \d+ checked/)
    expect(cardLink('Slow Waltz in G')).toHaveAttribute('href', '/pieces/piece-slow-waltz')
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    const calls = listPieces.mock.calls.length
    await advance(10_000)
    expect(listPieces).toHaveBeenCalledTimes(calls)
  })

  it('does not poll at all when nothing is processing', async () => {
    const fakes = createFakes({ seed: 'empty', signedIn: true, termsAccepted: true })
    const listPieces = vi.spyOn(fakes.data, 'listPieces')
    renderWithApp('/library', { fakes })
    await screen.findByRole('heading', { name: lib.emptyTitle })

    await advance(10_000)

    expect(listPieces).toHaveBeenCalledTimes(1)
  })

  it('stops polling when the user leaves the page', async () => {
    const fakes = createFakes({ seed: 'demo' })
    const listPieces = vi.spyOn(fakes.data, 'listPieces')
    const { unmount } = renderWithApp('/library', { fakes })
    await findCards()
    unmount()
    const calls = listPieces.mock.calls.length

    await advance(10_000)

    expect(listPieces).toHaveBeenCalledTimes(calls)
  })
})

describe('Library: loading, empty and error', () => {
  const signedIn = { signedIn: true, termsAccepted: true } as const

  it('shows skeleton cards while the pieces load, and the heading already', async () => {
    const fakes = createFakes({ seed: 'demo' })
    fakes.data.listPieces = () => new Promise(() => {})
    const { container } = renderWithApp('/library', { fakes })

    expect(await screen.findByText(lib.loading)).toBeInTheDocument()
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThanOrEqual(3)
    expect(screen.getByRole('heading', { level: 1, name: lib.title })).toBeInTheDocument()
    expect(screen.queryByText(lib.pieceCount(5))).not.toBeInTheDocument()
  })

  it('shows the empty state with a New piece link on the empty seed', async () => {
    const { user, router } = renderWithApp('/library', signedIn)

    expect(await screen.findByRole('heading', { name: lib.emptyTitle })).toBeInTheDocument()
    expect(screen.getByText(lib.emptyText)).toBeInTheDocument()
    // One New piece link only: the empty state carries it, the heading row does not.
    const link = screen.getByRole('link', { name: lib.newPiece })
    expect(link).toHaveAttribute('href', '/pieces/new')
    expect(screen.queryByRole('textbox', { name: lib.searchLabel })).not.toBeInTheDocument()
    // No "0 pieces" under the heading: the empty state already says it.
    expect(screen.queryByText(lib.pieceCount(0))).not.toBeInTheDocument()

    await user.click(link)

    expect(router.state.location.pathname).toBe('/pieces/new')
  })

  it('shows the error state when the pieces cannot be loaded, and Try again loads them', async () => {
    const fakes = createFakes({ seed: 'demo' })
    const listPieces = fakes.data.listPieces
    fakes.data.listPieces = () => Promise.reject(new Error('offline'))
    const { user } = renderWithApp('/library', { fakes })

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(lib.errorTitle)
    expect(alert).toHaveTextContent(lib.errorText)
    expect(screen.queryByRole('list')).not.toBeInTheDocument()

    fakes.data.listPieces = listPieces
    await user.click(screen.getByRole('button', { name: strings.common.retry }))

    expect(await findCards()).toHaveLength(5)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows the error state, not stale cards, when a later poll fails', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const fakes = createFakes({ seed: 'demo' })
      const listPieces = fakes.data.listPieces
      renderWithApp('/library', { fakes })
      await findCards()
      fakes.data.listPieces = () => Promise.reject(new Error('offline'))

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1500)
      })

      expect(await screen.findByRole('alert')).toHaveTextContent(lib.errorTitle)
      fakes.data.listPieces = listPieces
    } finally {
      vi.useRealTimers()
    }
  })
})
