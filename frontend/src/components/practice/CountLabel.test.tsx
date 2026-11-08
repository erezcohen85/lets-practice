import { act, render } from '@testing-library/react'
import { createFollowClock } from './followClock'
import { CountLabel } from './CountLabel'

const spot = { pageIndex: 1, x: 900, y: 500 }

function setup(options: { beat?: number; pageIndex?: number; scale?: number; colour?: 'violet' | 'teal' | 'amber' | 'pink'; spot?: typeof spot | null } = {}) {
  const clock = createFollowClock(options.beat ?? 0)
  const view = render(
    <CountLabel
      clock={clock}
      pageIndex={options.pageIndex ?? 1}
      scale={options.scale ?? 1}
      spot={options.spot === undefined ? spot : options.spot}
      colour={options.colour ?? 'teal'}
    />,
  )
  const label = () => view.container.querySelector<HTMLElement>('[data-slot="count-label"]')
  return { clock, label, at: (beat: number) => act(() => clock.set(beat)) }
}

describe('CountLabel', () => {
  it('shows nothing when there is no count', () => {
    expect(setup({ beat: 0 }).label()).toBeNull()
  })

  it('shows the beat above the top edge of the bar box, centred on the start of the bar', () => {
    const { label } = setup({ beat: 3 })

    expect(label()).toHaveTextContent('3')
    expect(label()).toHaveStyle({ left: '900px' })
    // Its bottom edge is a little above the box: it never reaches down onto the staff.
    const top = Number.parseFloat(label()!.style.top)
    expect(top).toBeLessThan(spot.y)
  })

  it('follows the beat without a new render of the page', () => {
    const { label, at } = setup({ beat: 1 })

    at(2)
    expect(label()).toHaveTextContent('2')
    at(0)
    expect(label()).toBeNull()
  })

  it('is drawn only on the page that holds the bar', () => {
    expect(setup({ beat: 1, pageIndex: 0 }).label()).toBeNull()
  })

  it('shows nothing when the part has no place for it', () => {
    expect(setup({ beat: 1, spot: null }).label()).toBeNull()
  })

  it('is in the colour of the cursor', () => {
    expect(setup({ beat: 1, colour: 'pink' }).label()).toHaveStyle({ color: 'var(--lp-cursor-pink)' })
    expect(setup({ beat: 1, colour: 'amber' }).label()).toHaveStyle({ color: 'var(--lp-cursor-amber)' })
    expect(setup({ beat: 1, colour: 'violet' }).label()).toHaveStyle({ color: 'var(--lp-loop)' })
  })

  it('keeps its size on the screen at every zoom: image pixels are divided by the scale', () => {
    const full = setup({ beat: 1, scale: 1 }).label()!
    const half = setup({ beat: 1, scale: 0.5 }).label()!

    expect(Number.parseFloat(half.style.fontSize)).toBeCloseTo(Number.parseFloat(full.style.fontSize) * 2)
    expect(Number.parseFloat(full.style.fontSize)).toBeGreaterThanOrEqual(36) // large enough for a music stand
  })

  it('stays inside the page when the bar is at the very top or left edge', () => {
    const { label } = setup({ beat: 1, spot: { pageIndex: 1, x: 5, y: 5 } })

    expect(Number.parseFloat(label()!.style.left)).toBeGreaterThan(5)
    expect(Number.parseFloat(label()!.style.top)).toBeGreaterThanOrEqual(0)
  })

  it('does not take clicks or get read out twice: the play button already announces the count', () => {
    const { label } = setup({ beat: 1 })

    expect(label()).toHaveClass('pointer-events-none')
    expect(label()).toHaveAttribute('aria-hidden', 'true')
  })
})
