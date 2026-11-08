import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { pageScale } from '@/components/score/pageScale'
import { ScoreView, type BarState } from '@/components/score/ScoreView'
import { type BarNumber } from '@/domain/types'
import { DEMO_SPEC, PAGE_HEIGHT, PAGE_WIDTH, syntheticPageLayer, syntheticPages } from '@/lib/fakes/syntheticPiece'

const layer = syntheticPageLayer(DEMO_SPEC, 'part-x')
const pages = syntheticPages(DEMO_SPEC, layer)

// The column is the scroll container minus its padding (16 px on each side); this makes it exactly one page wide.
const PADDING = 16
const COLUMN = PAGE_WIDTH + 2 * PADDING

function stubColumnWidth(width: number) {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(width)
}

function renderView(props: Partial<Parameters<typeof ScoreView>[0]> = {}) {
  const onPageInView = vi.fn()
  const view = render(
    <ScoreView
      pages={pages}
      page={layer}
      barStates={new Map<BarNumber, BarState>()}
      zoom={1}
      currentPage={0}
      onPageInView={onPageInView}
      {...props}
    />,
  )
  return { ...view, onPageInView }
}

const boxOf = (bar: number) => document.querySelector<HTMLElement>(`[data-slot="bar-box"][data-bar="${bar}"]`)!
const pageEl = (index: number) => document.querySelector<HTMLElement>(`[data-slot="score-page"][data-page-index="${index}"]`)!

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('pageScale', () => {
  const image = { pageIndex: 0, width: 1240, height: 1754, url: 'x' }

  it('is the column width over the image width at zoom 1', () => {
    expect(pageScale(image, 620, 1)).toBe(0.5)
    expect(pageScale(image, 1240, 1)).toBe(1)
  })

  it('multiplies by the zoom', () => {
    expect(pageScale(image, 620, 2)).toBe(1)
    expect(pageScale(image, 620, 0.5)).toBe(0.25)
  })
})

describe('ScoreView', () => {
  beforeEach(() => stubColumnWidth(COLUMN))

  it('draws one image per page, alt "Page N of M", and one box per bar with its number', () => {
    renderView()

    for (let n = 1; n <= 4; n++) {
      expect(screen.getByRole('img', { name: `Page ${n} of 4` })).toBeInTheDocument()
    }
    expect(document.querySelectorAll('[data-slot="bar-box"]')).toHaveLength(64)
    expect(within(boxOf(41)).getByText('41')).toBeInTheDocument()
    // Bar 41 is on page 3 (index 2), in the page that holds its box.
    expect(pageEl(2).contains(boxOf(41))).toBe(true)
  })

  it('writes one range label on a multi-bar rest, whose bars share one box, and none on its other bars', () => {
    const rest = layer.bars.map((box) => (box.bar >= 6 && box.bar <= 8 ? { ...layer.bars[5], bar: box.bar } : box))
    renderView({ page: { ...layer, bars: rest } })

    const numbers = (bar: number) => [...boxOf(bar).querySelectorAll('[data-slot="bar-number"]')].map((el) => el.textContent)
    expect(numbers(6)).toEqual(['6–8'])
    expect(numbers(7)).toEqual([])
    expect(numbers(8)).toEqual([])
    expect(numbers(5)).toEqual(['5'])
    expect(numbers(9)).toEqual(['9'])
    // The boxes themselves stay, one per bar.
    expect(document.querySelectorAll('[data-slot="bar-box"]')).toHaveLength(64)
  })

  it('draws no bar numbers and no rest ranges when the numbers are off, and keeps the boxes', () => {
    const rest = layer.bars.map((box) => (box.bar >= 6 && box.bar <= 8 ? { ...layer.bars[5], bar: box.bar } : box))
    renderView({ page: { ...layer, bars: rest }, showBarNumbers: false })

    expect(document.querySelectorAll('[data-slot="bar-number"]')).toHaveLength(0)
    expect(document.querySelectorAll('[data-slot="bar-box"]')).toHaveLength(64)
  })

  it('runs left to right whatever the page direction', () => {
    renderView()

    expect(document.querySelector('[data-slot="score-scroll"]')).toHaveAttribute('dir', 'ltr')
  })

  it('sizes each page at the scale and puts every box at its image rectangle times the scale', () => {
    renderView()
    const box = layer.bars[40] // bar 41

    expect(pageEl(0).style.width).toBe(`${PAGE_WIDTH}px`)
    expect(pageEl(0).style.height).toBe(`${PAGE_HEIGHT}px`)
    expect(boxOf(41).style.left).toBe(`${box.x}px`)
    expect(boxOf(41).style.top).toBe(`${box.y}px`)
    expect(boxOf(41).style.width).toBe(`${box.w}px`)
    expect(boxOf(41).style.height).toBe(`${box.h}px`)
  })

  it('keeps the boxes on the bars at another zoom: screen rectangle = image rectangle x scale', () => {
    renderView({ zoom: 0.5 })
    const box = layer.bars[40]

    expect(pageEl(2).style.width).toBe(`${PAGE_WIDTH / 2}px`)
    expect(boxOf(41).style.left).toBe(`${box.x / 2}px`)
    expect(boxOf(41).style.top).toBe(`${box.y / 2}px`)
    expect(boxOf(41).style.width).toBe(`${box.w / 2}px`)
    expect(boxOf(41).style.height).toBe(`${box.h / 2}px`)
  })

  it('follows the column width at zoom 1', () => {
    stubColumnWidth(PAGE_WIDTH / 2 + 2 * PADDING)
    renderView()

    expect(pageEl(0).style.width).toBe(`${PAGE_WIDTH / 2}px`)
  })

  it('draws plain, unmatched and selected bars differently', () => {
    renderView({
      barStates: new Map<BarNumber, BarState>([
        [5, 'unmatched'],
        [6, 'selected'],
      ]),
    })

    expect(boxOf(4)).toHaveAttribute('data-state', 'plain')
    expect(boxOf(5)).toHaveAttribute('data-state', 'unmatched')
    expect(boxOf(6)).toHaveAttribute('data-state', 'selected')
    expect(boxOf(4).className).not.toBe(boxOf(5).className)
    expect(boxOf(5).className).not.toBe(boxOf(6).className)
    expect(boxOf(6).className).toContain('border-paper-selected')
    expect(boxOf(6).className).toContain('bg-paper-selected/')
    expect(boxOf(6).className).not.toContain('paper-cursor')
    // Only an unmatched bar has the dot.
    expect(boxOf(5).querySelector('[data-slot="bar-dot"]')).not.toBeNull()
    expect(boxOf(4).querySelector('[data-slot="bar-dot"]')).toBeNull()
    expect(boxOf(6).querySelector('[data-slot="bar-dot"]')).toBeNull()
  })

  describe('the page label', () => {
    it('is left out with showPageLabel off, and the hint stays', () => {
      renderView({ showPageLabel: false, hint: 'Tap the last bar of the loop' })

      expect(document.querySelector('[data-slot="page-label"]')).toBeNull()
      expect(screen.getByText('Tap the last bar of the loop')).toBeInTheDocument()
    })

    it('leaves no empty row with showPageLabel off and nothing else to say', () => {
      renderView({ showPageLabel: false })

      expect(screen.queryByText(/^Page \d of 4/)).toBeNull()
      expect(document.querySelector('[data-slot="edit-hint"]')).toBeNull()
      expect(document.querySelector('[data-slot="score-scroll"]')?.previousElementSibling).toBeNull()
    })

    it('names the first page and its bars', () => {
      renderView()

      expect(screen.getByText('Page 1 of 4 · bars 1–16')).toBeInTheDocument()
    })

    it('follows currentPage', () => {
      const { rerender, onPageInView } = renderView({ currentPage: 1 })
      expect(screen.getByText('Page 2 of 4 · bars 17–32')).toBeInTheDocument()

      rerender(
        <ScoreView
          pages={pages}
          page={layer}
          barStates={new Map()}
          zoom={1}
          currentPage={2}
          onPageInView={onPageInView}
        />,
      )

      expect(screen.getByText('Page 3 of 4 · bars 33–48')).toBeInTheDocument()
    })

    it('follows the page the observer reports most in view, and says so through onPageInView', () => {
      let callback: IntersectionObserverCallback = () => {}
      const observed: Element[] = []
      class FakeObserver {
        constructor(cb: IntersectionObserverCallback) {
          callback = cb
        }
        observe(el: Element) {
          observed.push(el)
        }
        unobserve() {}
        disconnect() {}
      }
      vi.stubGlobal('IntersectionObserver', FakeObserver)
      const { onPageInView } = renderView()
      expect(observed).toHaveLength(4)

      const entry = (index: number, ratio: number) =>
        ({ target: pageEl(index), intersectionRatio: ratio, isIntersecting: ratio > 0 }) as unknown as IntersectionObserverEntry
      act(() => callback([entry(0, 0.2), entry(1, 0.8)], {} as IntersectionObserver))

      expect(onPageInView).toHaveBeenCalledWith(1)
      expect(screen.getByText('Page 2 of 4 · bars 17–32')).toBeInTheDocument()
    })

    it('writes "bar" for a page with a single bar and leaves the bars out for a page with none', () => {
      const one = { partId: 'p', bars: [{ bar: 5, pageIndex: 0, x: 0, y: 0, w: 10, h: 10 }], rests: [] }
      const { rerender, onPageInView } = renderView({ page: one })
      expect(screen.getByText('Page 1 of 4 · bar 5')).toBeInTheDocument()

      rerender(
        <ScoreView pages={pages} page={one} barStates={new Map()} zoom={1} currentPage={1} onPageInView={onPageInView} />,
      )
      expect(screen.getByText('Page 2 of 4')).toBeInTheDocument()
    })
  })

  it('scrolls the current page to the top of the column when it changes', () => {
    vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockImplementation(function (this: HTMLElement) {
      return 100 * (Number(this.dataset.pageIndex ?? 0) + 1)
    })
    renderView({ currentPage: 2 })

    expect(document.querySelector('[data-slot="score-scroll"]')!.scrollTop).toBe(300 - PADDING)
  })

  it('keeps the moved tint on a selected moved bar and puts the amber outline over it', () => {
    renderView({ barStates: new Map<BarNumber, BarState>([[7, 'moved']]), selectedBar: 7 })

    expect(boxOf(7)).toHaveAttribute('data-state', 'moved')
    expect(boxOf(7).className).toContain('bg-paper-moved/')
    expect(boxOf(7).className).toContain('border-paper-selected')
    expect(boxOf(7).className).not.toContain('border-paper-moved')
    // A moved bar that is not the selected one keeps its own outline.
    expect(boxOf(8).className).not.toContain('border-paper-selected')
  })

  describe('focusBar', () => {
    // The pages sit 100 px apart in the column; the view is 400 px tall; one image pixel is one screen pixel.
    beforeEach(() => {
      vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockImplementation(function (this: HTMLElement) {
        return 100 + 1000 * Number(this.dataset.pageIndex ?? 0)
      })
      vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(400)
    })
    const scroller = () => document.querySelector<HTMLElement>('[data-slot="score-scroll"]')!

    it('centres the bar vertically in the column, on its own page', () => {
      const bar = layer.bars.find((box) => box.pageIndex === 2)!
      const { onPageInView } = renderView({ focusBar: { bar: bar.bar } })

      expect(scroller().scrollTop).toBe(100 + 2000 + bar.y + bar.h / 2 - 200)
      expect(onPageInView).toHaveBeenCalledWith(2)
      expect(screen.getByText(/^Page 3 of 4/)).toBeInTheDocument()
    })

    it('scrolls again when the same bar is asked for again', () => {
      const bar = layer.bars.find((box) => box.pageIndex === 1)!
      const first = { bar: bar.bar }
      const { rerender, onPageInView } = renderView({ focusBar: first })
      scroller().scrollTop = 0

      rerender(<ScoreView pages={pages} page={layer} barStates={new Map()} zoom={1} currentPage={0} onPageInView={onPageInView} focusBar={{ bar: bar.bar }} />)

      expect(scroller().scrollTop).toBeGreaterThan(0)
    })

    it('does not move for a bar the part does not have', () => {
      renderView({ focusBar: { bar: 999 } })

      // Only the first page's own scroll to the top happened.
      expect(scroller().scrollTop).toBe(100 - PADDING)
    })
  })

  describe('scrollTo', () => {
    // The pages sit 1000 px apart in the column; the view is 400 px tall; one image pixel is one screen pixel.
    beforeEach(() => {
      vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockImplementation(function (this: HTMLElement) {
        return 100 + 1000 * Number(this.dataset.pageIndex ?? 0)
      })
      vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(400)
    })
    const scroller = () => document.querySelector<HTMLElement>('[data-slot="score-scroll"]')!
    /** jsdom has no Element.scrollTo: this one records the call and moves the scroller. */
    function stubScrollTo() {
      const scrollTo = vi.fn(function (this: HTMLElement, options: ScrollToOptions) {
        this.scrollTop = options.top ?? 0
      })
      Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: scrollTo })
      return scrollTo
    }
    afterEach(() => {
      delete (HTMLElement.prototype as { scrollTo?: unknown }).scrollTo
      vi.unstubAllGlobals()
    })

    it('puts the point of the page at the share of the column asked for, smoothly', () => {
      const scrollTo = stubScrollTo()
      renderView({ scrollTo: { pageIndex: 2, y: 300, at: 0.25 } })

      expect(scrollTo).toHaveBeenLastCalledWith({ top: 100 + 2000 + 300 - 100, behavior: 'smooth' })
      expect(scroller().scrollTop).toBe(2300)
    })

    it('puts the top of a page at the top of the column', () => {
      const scrollTo = stubScrollTo()
      renderView({ scrollTo: { pageIndex: 1, y: 0, at: 0 } })

      expect(scrollTo).toHaveBeenLastCalledWith({ top: 1100, behavior: 'smooth' })
    })

    it('scrolls at once when the user asks for less motion', () => {
      const scrollTo = stubScrollTo()
      vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce'), media: query, addEventListener() {}, removeEventListener() {} }))
      renderView({ scrollTo: { pageIndex: 1, y: 0, at: 0 } })

      expect(scrollTo).toHaveBeenLastCalledWith({ top: 1100, behavior: 'auto' })
    })

    it('scales the point with the zoom and never goes above the top of the column', () => {
      renderView({ zoom: 2, scrollTo: { pageIndex: 0, y: 10, at: 0.5 } })

      expect(scroller().scrollTop).toBe(0)
    })

    it('scrolls again for a new request with the same values, not for a re-render', () => {
      const scrollTo = stubScrollTo()
      const request = { pageIndex: 1, y: 0, at: 0 }
      const { rerender, onPageInView } = renderView({ scrollTo: request })
      const draw = (scrollToRequest: typeof request) =>
        rerender(<ScoreView pages={pages} page={layer} barStates={new Map()} zoom={1} currentPage={0} onPageInView={onPageInView} scrollTo={scrollToRequest} />)
      expect(scrollTo).toHaveBeenCalledTimes(1)

      draw(request)
      expect(scrollTo).toHaveBeenCalledTimes(1)

      draw({ ...request })
      expect(scrollTo).toHaveBeenCalledTimes(2)
    })

    it('does not move for a page the part does not have', () => {
      const scrollTo = stubScrollTo()
      renderView({ scrollTo: { pageIndex: 9, y: 0, at: 0 } })

      expect(scrollTo).not.toHaveBeenCalled()
    })
  })

  describe('pointer events', () => {
    // The page image is drawn at half size on screen: 620 x 877 for a 1240 x 1754 image.
    function stubRect(el: HTMLElement) {
      el.getBoundingClientRect = () => ({ left: 100, top: 50, width: 620, height: 877, right: 720, bottom: 927, x: 100, y: 50, toJSON() {} })
    }

    it('reports down, move, up and leave in image pixels of the page', () => {
      const onPointer = vi.fn()
      renderView({ onPointer })
      const page = pageEl(1)
      stubRect(page)

      fireEvent.pointerDown(page, { clientX: 150, clientY: 100 })
      fireEvent.pointerMove(page, { clientX: 400, clientY: 250, shiftKey: true })
      fireEvent.pointerUp(page, { clientX: 720, clientY: 927 })
      fireEvent.pointerLeave(page, { clientX: 0, clientY: 0 })

      expect(onPointer.mock.calls.map(([event]) => event)).toEqual([
        { type: 'down', pageIndex: 1, x: 100, y: 100, shiftKey: false },
        { type: 'move', pageIndex: 1, x: 600, y: 400, shiftKey: true },
        { type: 'up', pageIndex: 1, x: 1240, y: 1754, shiftKey: false },
        { type: 'leave', pageIndex: 1, x: -200, y: -100, shiftKey: false },
      ])
    })

    it('is quiet without a handler', () => {
      renderView()

      expect(() => fireEvent.pointerDown(pageEl(0), { clientX: 1, clientY: 1 })).not.toThrow()
    })
  })

  describe('the overlay slot', () => {
    it('draws a given node on every page, inside the image-pixel layer', () => {
      renderView({ overlay: <i data-testid="extra" /> })

      expect(screen.getAllByTestId('extra')).toHaveLength(4)
    })

    it('calls a given function once per page, so the Edit sheet can draw on one', () => {
      renderView({ overlay: (pageIndex: number) => (pageIndex === 2 ? <i data-testid="extra" /> : null) })

      expect(screen.getAllByTestId('extra')).toHaveLength(1)
      expect(pageEl(2).contains(screen.getByTestId('extra'))).toBe(true)
    })

    it('gives the function the scale of the page, so a handle can stay one size on screen', () => {
      const overlay = vi.fn(() => null)
      renderView({ zoom: 2, overlay })

      expect(overlay).toHaveBeenCalledWith(0, 2)
      expect(overlay).toHaveBeenCalledWith(3, 2)
    })

    it('scales the layer so that its children use image pixels', () => {
      renderView({ zoom: 2, overlay: <i data-testid="extra" /> })
      const layerEl = screen.getAllByTestId('extra')[0].parentElement!

      expect(layerEl.style.width).toBe(`${PAGE_WIDTH}px`)
      expect(layerEl.style.transform).toBe('scale(2)')
    })
  })

  it('draws nothing but an empty column while there are no pages', () => {
    renderView({ pages: [] })

    expect(document.querySelectorAll('[data-slot="score-page"]')).toHaveLength(0)
    expect(screen.queryByText(/^Page /)).toBeNull()
  })
})
