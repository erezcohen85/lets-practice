import { fireEvent, render } from '@testing-library/react'
import { ScoreView, type BarState } from '@/components/score/ScoreView'
import { type BarNumber } from '@/domain/types'
import { DEMO_SPEC, PAGE_WIDTH, syntheticPageLayer, syntheticPages } from '@/lib/fakes/syntheticPiece'

const layer = syntheticPageLayer(DEMO_SPEC, 'part-x')
const pages = syntheticPages(DEMO_SPEC, layer)

function renderView({ pinch = true }: { pinch?: boolean } = {}) {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(PAGE_WIDTH + 32)
  const onPinchZoom = vi.fn()
  const onPointer = vi.fn()
  render(
    <ScoreView
      pages={pages}
      page={layer}
      barStates={new Map<BarNumber, BarState>()}
      zoom={1}
      currentPage={0}
      onPageInView={() => {}}
      onPointer={onPointer}
      {...(pinch ? { onPinchZoom } : {})}
    />,
  )
  const scroll = document.querySelector<HTMLElement>('[data-slot="score-scroll"]')!
  const content = scroll.firstElementChild as HTMLElement
  return { scroll, content, onPinchZoom, onPointer }
}

/** Fingers on one line, at these x positions. */
const fingers = (...xs: number[]) => ({ touches: xs.map((x) => ({ clientX: x, clientY: 100 })) })

afterEach(() => vi.restoreAllMocks())

describe('ScoreView: pinch to zoom', () => {
  it('zooms by the spread of two fingers once they lift', () => {
    const { scroll, onPinchZoom } = renderView()

    fireEvent.touchStart(scroll, fingers(100, 200))
    fireEvent.touchMove(scroll, fingers(50, 250))
    expect(onPinchZoom).not.toHaveBeenCalled()
    fireEvent.touchEnd(scroll, fingers(50))

    expect(onPinchZoom).toHaveBeenCalledWith(2)
  })

  it('scales the pages on the screen while the fingers move, without laying them out again', () => {
    const { scroll, content } = renderView()

    fireEvent.touchStart(scroll, fingers(100, 200))
    fireEvent.touchMove(scroll, fingers(75, 225))

    expect(content.style.transform).toContain('scale(1.5)')
  })

  it('keeps the browser from zooming the page or scrolling under two fingers', () => {
    const { scroll } = renderView()

    fireEvent.touchStart(scroll, fingers(100, 200))

    expect(fireEvent.touchMove(scroll, fingers(50, 250))).toBe(false)
  })

  it('leaves one finger to scroll the score', () => {
    const { scroll } = renderView()

    fireEvent.touchStart(scroll, fingers(100))

    expect(fireEvent.touchMove(scroll, fingers(120))).toBe(true)
  })

  it('ends a press on the score when the second finger lands, so a pinch is not a tap or a long press', () => {
    const { scroll, onPointer } = renderView()

    fireEvent.touchStart(scroll, fingers(100, 200))

    expect(onPointer).toHaveBeenCalledWith(expect.objectContaining({ type: 'leave' }))
  })

  it('does nothing with two fingers where no pinch is asked for (the editor)', () => {
    const { scroll, content } = renderView({ pinch: false })

    fireEvent.touchStart(scroll, fingers(100, 200))

    expect(fireEvent.touchMove(scroll, fingers(50, 250))).toBe(true)
    expect(content.style.transform).toBe('')
  })
})
