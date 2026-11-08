import { render } from '@testing-library/react'
import { auroraTickColour } from '@/components/shell/auroraTickColour'
import { TickRing } from '@/components/shell/TickRing'

const ticks = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>('[data-tick]')]

describe('TickRing', () => {
  it('draws the ticks it is given, the lit ones first, the last lit one the head', () => {
    const { container } = render(
      <TickRing count={48} lit={12} tickClassName="" kindClassName={{ head: 'h', filled: 'f', empty: 'e' }} />,
    )

    const all = ticks(container)
    expect(all).toHaveLength(48)
    expect(all.filter((tick) => tick.dataset.tick === 'filled')).toHaveLength(11)
    expect(all[11].dataset.tick).toBe('head')
    expect(all[12].dataset.tick).toBe('empty')
    expect(all[11]).toHaveClass('h')
  })

  it('turns each tick to its own angle, hidden from assistive technology', () => {
    const { container } = render(
      <TickRing count={48} lit={0} tickClassName="" kindClassName={{ head: '', filled: '', empty: '' }} />,
    )

    const boxes = ticks(container).map((tick) => tick.parentElement)
    expect(boxes[1]).toHaveStyle({ transform: 'rotate(7.5deg)' })
    expect(boxes[47]).toHaveStyle({ transform: 'rotate(352.5deg)' })
    for (const box of boxes) expect(box).toHaveAttribute('aria-hidden', 'true')
  })
})

describe('auroraTickColour', () => {
  it('starts on the first aurora token and mixes towards the next as the ring turns', () => {
    expect(auroraTickColour(0, 48)).toBe('var(--lp-aurora-1)')
    expect(auroraTickColour(12, 48)).toBe('var(--lp-aurora-2)')
    expect(auroraTickColour(24, 48)).toBe('var(--lp-aurora-3)')
    expect(auroraTickColour(36, 48)).toBe('var(--lp-aurora-4)')
    expect(auroraTickColour(6, 48)).toBe('color-mix(in oklab, var(--lp-aurora-1) 50%, var(--lp-aurora-2))')
  })

  it('comes back round to the first token, so the ring has no seam', () => {
    expect(auroraTickColour(42, 48)).toBe('color-mix(in oklab, var(--lp-aurora-4) 50%, var(--lp-aurora-1))')
  })
})
