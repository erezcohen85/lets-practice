import { act, fireEvent, screen, within } from '@testing-library/react'
import { createFakes } from '@/lib/fakes'
import { strings } from '@/strings'
import { stubPhoneWindow } from '@/test/phoneWindow'
import { renderWithApp } from '@/test/render'

const text = strings.practice
const CLARK = 'piece-clark-county'

async function open(phone = true) {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(358)
  const window = stubPhoneWindow(phone)
  const made: unknown[] = []
  const view = renderWithApp(`/pieces/${CLARK}/practice`, { fakes: createFakes({ seed: 'demo' }), playerSec: 271, onMedia: (media) => made.push(media) })
  // A long wait: real timers here, and the first render of the page is slow on a busy machine.
  await screen.findAllByRole('img', { name: /^Page \d of 4$/ }, { timeout: 15000 })
  return { ...view, window, made }
}

const toolbar = () => screen.getByRole('region', { name: text.toolbar })
const inToolbar = (name: string) => within(toolbar()).queryByRole('button', { name })
const metronome = () => screen.queryByRole('switch', { name: text.metronomeSwitch })
const strip = () => screen.queryByRole('slider', { name: text.overview })

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('Practice on a phone', () => {
  it('opens with the player, the loop and the speed on the screen and the rest folded away', async () => {
    await open()

    expect(inToolbar(strings.player.play)).toBeInTheDocument()
    expect(inToolbar(text.restart)).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: text.loopRange })).toBeInTheDocument()
    expect(inToolbar(strings.player.speed(1))).toBeInTheDocument()
    expect(document.querySelector('[data-slot="position"]')).toBeInTheDocument()
    expect(metronome()).toBeNull()
    expect(strip()).toBeNull()
    expect(inToolbar(text.moreControls)).toHaveAttribute('aria-expanded', 'false')
  })

  it('folds the other controls away and back, and Play stays on the screen', async () => {
    await open()

    fireEvent.click(inToolbar(text.moreControls)!)

    expect(metronome()).toBeInTheDocument()
    expect(strip()).toBeInTheDocument()
    expect(inToolbar(strings.player.play)).toBeInTheDocument()
    expect(inToolbar(text.fewerControls)).toHaveAttribute('aria-expanded', 'true')

    fireEvent.click(inToolbar(text.fewerControls)!)

    expect(metronome()).toBeNull()
    expect(strip()).toBeNull()
    expect(inToolbar(strings.player.play)).toBeInTheDocument()
  })

  it('draws few enough waveform bars that each has width on the narrowest phone', async () => {
    await open()
    fireEvent.click(inToolbar(text.moreControls)!)

    const bars = document.querySelectorAll('[data-slot="wave-bar"]').length
    // A 320 px phone leaves the strip 276 px, and the bars stand 2 px apart.
    expect(bars).toBeGreaterThan(0)
    expect((276 - 2 * (bars - 1)) / bars).toBeGreaterThanOrEqual(2)
  })

  it('keeps every control of the full toolbar one tap away', async () => {
    await open()
    fireEvent.click(inToolbar(text.moreControls)!)

    expect(inToolbar(text.muteMusic)).toBeInTheDocument()
    expect(screen.getByRole('slider', { name: text.musicVolume })).toBeInTheDocument()
    expect(inToolbar(text.tone(text.tones.wood))).toBeInTheDocument()
    expect(inToolbar(text.countInSettings)).toBeInTheDocument()
    expect(inToolbar(text.playback)).toBeInTheDocument()
    expect(inToolbar('Clarinet in B♭ 1')).toBeInTheDocument()
    expect(within(toolbar()).getByRole('button', { name: new RegExp(text.stems) })).toBeDisabled()
  })

  it('leaves the part chip to the part menu, so the title has the line', async () => {
    await open()

    expect(screen.getByRole('heading', { level: 1, name: 'Clark County Celebration' })).toBeInTheDocument()
    expect(document.querySelector('[data-slot="part-chip"]')).toBeNull()
  })

  it('keeps the Practice and Edit links, with their names, as icons', async () => {
    await open()
    const links = within(screen.getByRole('group', { name: strings.common.viewSwitch }))

    expect(links.getByRole('link', { name: strings.common.viewPractice })).toHaveAttribute('aria-current', 'page')
    expect(links.getByRole('link', { name: strings.common.viewEdit })).toHaveAttribute('href', expect.stringContaining(`/pieces/${CLARK}/edit`))
    expect(links.getByText(strings.common.viewEdit)).toHaveClass('sr-only')
  })

  it('gives every button of the toolbar a target of at least 44 px', async () => {
    await open()
    fireEvent.click(inToolbar(text.moreControls)!)

    for (const button of within(toolbar()).getAllByRole('button')) {
      expect(button.className, button.textContent ?? button.getAttribute('aria-label') ?? '').toMatch(/min-h-11|size-11|size-12|h-11/)
    }
  })

  it('changes layout with the window and keeps the same player', async () => {
    const { window, made } = await open()
    expect(inToolbar(text.moreControls)).toBeInTheDocument()
    const madeBefore = made.length

    act(() => window.resize(false))

    expect(inToolbar(text.collapse)).toBeInTheDocument()
    expect(inToolbar(text.moreControls)).toBeNull()
    expect(made).toHaveLength(madeBefore)
  })
})

describe('Practice in a window that is not a phone', () => {
  it('keeps the full toolbar, the strip, the part chip and the handle that folds everything', async () => {
    await open(false)

    expect(metronome()).toBeInTheDocument()
    expect(strip()).toBeInTheDocument()
    expect(document.querySelectorAll('[data-slot="wave-bar"]')).toHaveLength(160)
    expect(document.querySelector('[data-slot="part-chip"]')).toBeInTheDocument()
    expect(inToolbar(text.moreControls)).toBeNull()

    fireEvent.click(inToolbar(text.collapse)!)

    expect(inToolbar(strings.player.play)).toBeNull()
    expect(strip()).toBeNull()
  })
})

describe('Practice: pinch on the score, on a phone and on an iPad', () => {
  const scroll = () => document.querySelector<HTMLElement>('[data-slot="score-scroll"]')!
  const pageWidth = () => parseFloat(document.querySelector<HTMLElement>('[data-slot="score-page"]')!.style.width)
  const fingers = (...xs: number[]) => ({ touches: xs.map((x) => ({ clientX: x, clientY: 200 })) })
  const fit = () => screen.queryByRole('button', { name: text.fitScore })

  it.each([
    ['a phone', true],
    ['an iPad', false],
  ])('on %s two fingers zoom the score, and Fit brings it back to the width', async (_name, phone) => {
    await open(phone)
    const fitted = pageWidth()
    expect(fit()).toBeNull()

    fireEvent.touchStart(scroll(), fingers(100, 200))
    fireEvent.touchMove(scroll(), fingers(50, 250))
    fireEvent.touchEnd(scroll(), fingers())

    expect(pageWidth()).toBeCloseTo(fitted * 2)
    fireEvent.click(fit()!)
    expect(pageWidth()).toBeCloseTo(fitted)
    expect(fit()).toBeNull()
  })

  it('keeps the browser from zooming the page anywhere on the screen, and from zooming on a double tap', async () => {
    await open()

    // touch-action stops a pinch and a double tap on Chrome and on Safari from iOS 13; iOS also gets its gesture events stopped.
    expect(fireEvent(document, new Event('gesturestart', { cancelable: true }))).toBe(false)
    expect(fireEvent(document, new Event('gesturechange', { cancelable: true }))).toBe(false)
    expect(document.querySelector('main')).toHaveClass('touch-pan-x', 'touch-pan-y')
  })

  it('gives the page its zoom back when Practice closes', async () => {
    const { unmount } = await open()

    unmount()

    expect(fireEvent(document, new Event('gesturestart', { cancelable: true }))).toBe(true)
  })
})
