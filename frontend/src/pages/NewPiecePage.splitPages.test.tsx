import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { vi } from 'vitest'
import { strings } from '@/strings'
import { renderWithApp } from '@/test/render'

const t = strings.newPiece
const s = strings.split
const pdf = (name: string) => new File(['%PDF-1.4'], name, { type: 'application/pdf' })
const audio = (name: string) => new File(['ID3'], name, { type: 'audio/mpeg' })

/** The split screen on the fake's proposal: Flute pages 1-2, Oboe page 3, Clarinet in B♭ pages 4-6. */
async function onSplitScreen() {
  const view = renderWithApp('/pieces/new', { signedIn: true, termsAccepted: true })
  await screen.findByRole('heading', { level: 1, name: t.title })
  await view.user.click(screen.getByRole('button', { name: s.modeSplit }))
  await view.user.upload(screen.getByLabelText(s.dropZone), pdf('band.pdf'))
  await screen.findByRole('list', { name: s.partsList })
  return view
}

const discard = (page: number) => screen.getByRole('button', { name: s.discardPage(page) })
const restore = (page: number) => screen.getByRole('button', { name: s.restorePage(page) })
const startHere = (page: number) => screen.queryByRole('button', { name: s.startHere(page) })
const card = (name: string) => screen.getAllByRole('textbox', { name: s.partName }).find((field) => (field as HTMLInputElement).value === name)!.closest('li')!
const tileOf = (page: number) => screen.getByAltText(s.page(page)).parentElement!.parentElement!
const preview = () => document.querySelector<HTMLElement>('[data-page-preview]')

describe('the split screen: discarding a page from its thumbnail', () => {
  it('puts an X on every page, named by the page', async () => {
    await onSplitScreen()

    for (const page of [1, 2, 3, 4, 5, 6]) expect(discard(page)).toBeInTheDocument()
    // All but Oboe's only page, which its part cannot do without.
    for (const page of [1, 2, 4, 5, 6]) expect(discard(page)).toBeEnabled()
  })

  it('drops the page from its part: the tile stays, its button becomes Restore, and the pages text leaves it out', async () => {
    const { user } = await onSplitScreen()
    expect(within(card('Clarinet in B♭')).getByText('pages 4-6')).toBeInTheDocument()

    await user.click(discard(5))

    expect(screen.getByAltText(s.page(5))).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: s.discardPage(5) })).not.toBeInTheDocument()
    expect(restore(5)).toBeInTheDocument()
    expect(within(card('Clarinet in B♭')).getByText('pages 4, 6')).toBeInTheDocument()
    // The dimmed tile is also struck through, so the colour is not the only sign.
    expect(tileOf(5).querySelector('svg line')).not.toBeNull()
    expect(tileOf(4).querySelector('svg line')).toBeNull()
  })

  it('has no "New part here" on a discarded page, and has it back on restore', async () => {
    const { user } = await onSplitScreen()
    expect(startHere(5)).toBeInTheDocument()

    await user.click(discard(5))
    expect(startHere(5)).not.toBeInTheDocument()

    await user.click(restore(5))
    expect(startHere(5)).toBeInTheDocument()
    expect(within(card('Clarinet in B♭')).getByText('pages 4-6')).toBeInTheDocument()
  })

  it('does not offer a new part at a page that would leave the first one with discarded pages only', async () => {
    const { user } = await onSplitScreen()

    await user.click(discard(4))

    // Page 4 alone would start Clarinet as a part that is all discarded
    expect(startHere(5)).not.toBeInTheDocument()
    expect(startHere(6)).toBeInTheDocument()
  })

  it('cannot discard the last kept page of a part: the X is disabled and says why', async () => {
    const { user } = await onSplitScreen()
    // Oboe is the one page 3
    expect(discard(3)).toBeDisabled()
    expect(discard(3)).toHaveAttribute('title', 'Untick the part to leave it out')

    await user.click(discard(1))

    expect(discard(2)).toBeDisabled()
    expect(discard(2)).toHaveAttribute('title', s.lastPageKept)
    // The discarded page itself can always be restored.
    expect(restore(1)).toBeEnabled()
    expect(discard(4)).toBeEnabled()
  })

  it('takes the discard along when a page moves to the neighbouring part, and when parts merge', async () => {
    const { user } = await onSplitScreen()
    await user.click(discard(4))

    // Page 4 goes up to Oboe, still discarded
    await user.click(screen.getByRole('button', { name: s.pageUp(4, 'Oboe') }))

    expect(within(card('Oboe')).getByText('page 3')).toBeInTheDocument()
    expect(within(card('Oboe')).getByAltText(s.page(4))).toBeInTheDocument()
    expect(restore(4)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: s.mergeLabel('Oboe', 'Clarinet in B♭') }))

    expect(within(card('Oboe')).getByText('pages 3, 5-6')).toBeInTheDocument()
    expect(restore(4)).toBeInTheDocument()
  })

  it('reads "pages 1-3, 5-6" in the summary and sends the discarded pages with the part', async () => {
    const { user, fakes } = await onSplitScreen()
    await user.click(discard(5))
    await user.click(screen.getByRole('button', { name: s.mergeLabel('Oboe', 'Clarinet in B♭') }))
    await user.click(screen.getByRole('button', { name: s.mergeLabel('Flute', 'Oboe') }))
    expect(within(card('Flute')).getByText('pages 1-4, 6')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: s.confirm }))

    expect(screen.getByText('pages 1-4, 6', { exact: false })).toBeInTheDocument()
    const create = vi.spyOn(fakes.data, 'createPiece')
    await user.type(screen.getByRole('textbox', { name: t.titleLabel }), 'Band')
    await user.upload(screen.getByLabelText(t.audioChoose), audio('take.mp3'))
    await user.click(screen.getByRole('button', { name: t.start }))
    await waitFor(() => expect(create).toHaveBeenCalled())
    expect(create.mock.calls[0][0].split?.parts).toEqual([{ name: 'Flute', fromPage: 1, toPage: 6, skipPages: [5] }])
  })
})

describe('the split screen: a page picture beside its tile', () => {
  it('floats the page about 320 px wide while the pointer is on the tile, and takes it away when it leaves', async () => {
    const { user } = await onSplitScreen()
    expect(preview()).toBeNull()

    await user.hover(screen.getByAltText(s.page(5)))

    const floating = preview()!
    expect(floating).not.toBeNull()
    expect(floating).toHaveStyle({ width: '320px' })
    expect(floating.querySelector('img')).toHaveAttribute('src', screen.getByAltText(s.page(5)).getAttribute('src'))
    // It is drawn in the body, so no card can clip it, and a screen reader hears the tile only.
    expect(floating.parentElement).toBe(document.body)
    expect(floating).toHaveAttribute('aria-hidden', 'true')

    await user.unhover(screen.getByAltText(s.page(5)))

    expect(preview()).toBeNull()
  })

  it('shows with keyboard focus on the tile too, and goes when the focus leaves', async () => {
    await onSplitScreen()

    act(() => discard(2).focus())
    expect(preview()).not.toBeNull()

    act(() => discard(2).blur())
    expect(preview()).toBeNull()
  })

  it('stays out of the way on a touch screen', async () => {
    await onSplitScreen()

    fireEvent.pointerEnter(screen.getByAltText(s.page(2)), { pointerType: 'touch' })

    expect(preview()).toBeNull()
  })

  it('keeps inside the window: beside the tile on the right, else on its left', async () => {
    await onSplitScreen()
    const picture = screen.getByAltText(s.page(1)).parentElement!
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1000)
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(800)
    const place = (left: number) => vi.spyOn(picture, 'getBoundingClientRect').mockReturnValue(new DOMRect(left, 300, 72, 94))

    place(100)
    fireEvent.pointerEnter(screen.getByAltText(s.page(1)), { pointerType: 'mouse' })
    expect(preview()!.style.left).toBe('184px') // 100 + 72 + 12
    fireEvent.pointerLeave(screen.getByAltText(s.page(1)), { pointerType: 'mouse' })

    place(900)
    fireEvent.pointerEnter(screen.getByAltText(s.page(1)), { pointerType: 'mouse' })
    expect(preview()!.style.left).toBe('568px') // 900 - 12 - 320
    const top = Number.parseFloat(preview()!.style.top)
    expect(top).toBeGreaterThanOrEqual(8)
    expect(top + 320 * 1.3).toBeLessThanOrEqual(800 - 8)
  })
})
