import { act, render } from '@testing-library/react'
import { demoDoc } from '@/domain/pieceFixtures'
import { buildTimeline } from '@/domain/tempo'
import { DEFAULT_SETTINGS, type FollowSettings } from '@/lib/dataClient'
import { createFollowClock } from './followClock'
import { FollowLayer } from './FollowLayer'

const doc = demoDoc()
const timeline = buildTimeline(doc.timing)
const part = doc.pages[0]
const SLOT_SEC = 3.6
const startOf = (position: number) => 1 + SLOT_SEC * position
const boxOf = (bar: number) => part.bars.find((box) => box.bar === bar)!
const BAR_17 = 24
const BAR_9_SECOND_TIME = 16

/** The distance a line is moved along its bar, from its transform. */
const shift = (element: HTMLElement | null) => Number(/translateX\((.*)px\)/.exec(element!.style.transform)![1])

function setup(follow: FollowSettings = DEFAULT_SETTINGS.follow, timeSec = 0, pageIndex?: number, scale = 1, inset?: number) {
  const clock = createFollowClock(timeSec)
  const page = pageIndex ?? boxOf(17).pageIndex
  const view = render(<FollowLayer clock={clock} pageIndex={page} scale={scale} page={part} timeline={timeline} follow={follow} inset={inset} />)
  const box = () => view.container.querySelector<HTMLElement>('[data-slot="follow-box"]')
  const line = () => view.container.querySelector<HTMLElement>('[data-slot="follow-line"]')
  return { clock, view, box, line, at: (sec: number) => act(() => clock.set(sec)) }
}

describe('FollowLayer', () => {
  it('draws the box inside the bar box by the inset, in screen pixels at any zoom (the Editor, over its selection)', () => {
    const { box } = setup(DEFAULT_SETTINGS.follow, startOf(BAR_17) + SLOT_SEC / 2, undefined, 0.5, 3)

    const target = boxOf(17)
    expect(box()).toHaveStyle({ left: `${target.x + 6}px`, top: `${target.y + 6}px`, width: `${target.w - 12}px`, height: `${target.h - 12}px` })
  })

  it('draws the box around the playing bar, in the bar box of the page', () => {
    const { box } = setup(DEFAULT_SETTINGS.follow, startOf(BAR_17) + SLOT_SEC / 2)

    const target = boxOf(17)
    expect(box()).toHaveStyle({ left: `${target.x}px`, top: `${target.y}px`, width: `${target.w}px`, height: `${target.h}px` })
    expect(box()).toHaveAttribute('data-bar', '17')
  })

  it('is as tall as the bar box, with no vertical padding of its own, and so is the gliding line', () => {
    const { box, line } = setup(DEFAULT_SETTINGS.follow, startOf(BAR_17) + SLOT_SEC / 2)

    const target = boxOf(17)
    expect(box()!.style.height).toBe(`${target.h}px`)
    expect(line()!.style.height).toBe(`${target.h}px`)
  })

  it('puts the gliding line half way along the bar at the middle of the bar', () => {
    const { line } = setup(DEFAULT_SETTINGS.follow, startOf(BAR_17) + SLOT_SEC / 2)

    const target = boxOf(17)
    expect(line()).toHaveStyle({ left: `${target.x}px`, top: `${target.y}px`, height: `${target.h}px` })
    expect(shift(line())).toBeCloseTo(target.w / 2)
  })

  it('glides: the line moves with the clock without a new render of the page', () => {
    const { line, at } = setup(DEFAULT_SETTINGS.follow, startOf(BAR_17))
    const target = boxOf(17)
    expect(shift(line())).toBeCloseTo(0)

    at(startOf(BAR_17) + SLOT_SEC / 4)

    expect(shift(line())).toBeCloseTo(target.w / 4)
  })

  it('moves the box to the next bar when the clock crosses into it', () => {
    const { box, at } = setup(DEFAULT_SETTINGS.follow, startOf(BAR_17) + 0.5)

    at(startOf(BAR_17 + 1) + 0.5)

    expect(box()).toHaveAttribute('data-bar', '18')
  })

  it('draws nothing on a page that does not hold the cursor, and nothing outside the recorded bars', () => {
    const other = boxOf(17).pageIndex === 0 ? 1 : 0
    const { box, line, at } = setup(DEFAULT_SETTINGS.follow, startOf(BAR_17) + 1, other)
    expect(box()).toBeNull()
    expect(line()).toBeNull()

    at(0)
    expect(box()).toBeNull()
  })

  it('follows the second time through a repeat, on the page of the repeated bar', () => {
    const { box } = setup(DEFAULT_SETTINGS.follow, startOf(BAR_9_SECOND_TIME) + 1, boxOf(9).pageIndex)

    expect(box()).toHaveAttribute('data-bar', '9')
    expect(box()).toHaveStyle({ left: `${boxOf(9).x}px`, top: `${boxOf(9).y}px` })
  })

  it('takes each colour from the settings tokens, the box and the line apart', () => {
    const { box, line } = setup({ scroll: 'line', box: true, boxColour: 'amber', line: true, lineColour: 'pink' }, startOf(BAR_17) + 1)

    expect(box()!.style.borderColor).toBe('var(--lp-cursor-amber)')
    expect(line()!.style.backgroundColor).toBe('var(--lp-cursor-pink)')
  })

  it('draws violet from the loop token: the box and the line', () => {
    const { box, line } = setup({ scroll: 'line', box: true, boxColour: 'violet', line: true, lineColour: 'violet' }, startOf(BAR_17) + 1)

    expect(box()!.style.borderColor).toBe('var(--lp-loop)')
    expect(line()!.style.backgroundColor).toBe('var(--lp-loop)')
  })

  it('keeps React from warning about mixed border styles when the box is redrawn at another scale or colour', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const clock = createFollowClock(startOf(BAR_17) + 1)
    const draw = (follow: FollowSettings, scale: number) => (
      <FollowLayer clock={clock} pageIndex={boxOf(17).pageIndex} scale={scale} page={part} timeline={timeline} follow={follow} />
    )
    const view = render(draw(DEFAULT_SETTINGS.follow, 1))

    // The width changes alone (zoom), then the colour alone, then both.
    view.rerender(draw(DEFAULT_SETTINGS.follow, 0.5))
    view.rerender(draw({ ...DEFAULT_SETTINGS.follow, boxColour: 'amber' }, 0.5))
    view.rerender(draw({ ...DEFAULT_SETTINGS.follow, boxColour: 'pink' }, 2))

    expect(error).not.toHaveBeenCalled()
    const box = view.container.querySelector<HTMLElement>('[data-slot="follow-box"]')!
    expect(box.style.borderColor).toBe('var(--lp-cursor-pink)')
    expect(box.style.borderWidth).toBe('1px')
    error.mockRestore()
  })

  it('draws the box and the line each only when it is on', () => {
    const base = DEFAULT_SETTINGS.follow
    const t = startOf(BAR_17) + 1

    const boxOnly = setup({ ...base, line: false }, t)
    expect(boxOnly.box()).not.toBeNull()
    expect(boxOnly.line()).toBeNull()
    boxOnly.view.unmount()

    const lineOnly = setup({ ...base, box: false }, t)
    expect(lineOnly.box()).toBeNull()
    expect(lineOnly.line()).not.toBeNull()
    lineOnly.view.unmount()

    const neither = setup({ ...base, box: false, line: false }, t)
    expect(neither.view.container).toBeEmptyDOMElement()
  })

  it('keeps the box and the line the same size on screen at any scale', () => {
    const { box, line } = setup(DEFAULT_SETTINGS.follow, startOf(BAR_17) + 1, undefined, 0.5)

    expect(box()!.style.borderWidth).toBe('4px')
    expect(line()!.style.width).toBe('4px')
  })

  it('takes no pointer', () => {
    const { box, line } = setup(DEFAULT_SETTINGS.follow, startOf(BAR_17) + 1)

    expect(box()!.className).toContain('pointer-events-none')
    expect(line()!.className).toContain('pointer-events-none')
  })
})
