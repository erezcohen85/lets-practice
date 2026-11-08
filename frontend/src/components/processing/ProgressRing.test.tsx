import { render, screen } from '@testing-library/react'
import { ProgressRing } from '@/components/processing/ProgressRing'
import { strings } from '@/strings'

const t = strings.processing

const ticks = (container: HTMLElement, kind?: string) =>
  [...container.querySelectorAll<HTMLElement>(kind === undefined ? '[data-tick]' : `[data-tick="${kind}"]`)]

describe('ProgressRing', () => {
  it('is an image with the progress as its name and the percentage in the middle', () => {
    render(<ProgressRing percent={62} />)

    expect(screen.getByRole('img', { name: t.progressLabel(62) })).toBeInTheDocument()
    expect(screen.getByText('62%')).toBeInTheDocument()
  })

  it('draws 60 ticks, the filled share of them lit, the last lit one the head', () => {
    const { container } = render(<ProgressRing percent={62} />)

    // 62% of 60 ticks is 37.2: 37 are lit, the 37th being the head.
    expect(ticks(container)).toHaveLength(60)
    expect(ticks(container, 'filled')).toHaveLength(36)
    expect(ticks(container, 'head')).toHaveLength(1)
    expect(ticks(container, 'empty')).toHaveLength(23)
    expect(ticks(container).indexOf(ticks(container, 'head')[0])).toBe(36)
  })

  it('has no head and no lit tick at 0%, and every tick lit at 100%', () => {
    const empty = render(<ProgressRing percent={0} />)
    expect(ticks(empty.container, 'head')).toHaveLength(0)
    expect(ticks(empty.container, 'filled')).toHaveLength(0)
    empty.unmount()

    const full = render(<ProgressRing percent={100} />)
    expect(ticks(full.container, 'empty')).toHaveLength(0)
    expect(ticks(full.container, 'head')).toHaveLength(1)
    expect(ticks(full.container, 'filled')).toHaveLength(59)
  })

  it('keeps a percentage outside 0 to 100 on the ring', () => {
    const { container } = render(<ProgressRing percent={140} />)

    expect(screen.getByRole('img', { name: t.progressLabel(100) })).toBeInTheDocument()
    expect(ticks(container, 'empty')).toHaveLength(0)
  })

  it('spaces the ticks 6 degrees apart around the centre', () => {
    const { container } = render(<ProgressRing percent={50} />)
    const [first, second, last] = [0, 1, 59].map((index) => ticks(container)[index].parentElement)

    expect(first).toHaveStyle({ transform: 'rotate(0deg)' })
    expect(second).toHaveStyle({ transform: 'rotate(6deg)' })
    expect(last).toHaveStyle({ transform: 'rotate(354deg)' })
  })

  it('pulses the unfilled ticks only where motion is welcome, and never the lit ones', () => {
    const { container } = render(<ProgressRing percent={30} />)

    for (const tick of ticks(container, 'empty')) {
      const classes = tick.className.split(/\s+/)
      expect(classes.some((name) => name.startsWith('motion-safe:animate-'))).toBe(true)
      // A bare animate-* class would run under prefers-reduced-motion too.
      expect(classes.filter((name) => name.startsWith('animate-'))).toEqual([])
    }
    for (const tick of [...ticks(container, 'filled'), ...ticks(container, 'head')]) {
      expect(tick.className).not.toMatch(/animate-/)
    }
  })

  it('staggers the pulse from tick to tick', () => {
    const { container } = render(<ProgressRing percent={0} />)

    expect(ticks(container)[0]).toHaveStyle({ animationDelay: '0s' })
    expect(ticks(container)[10]).toHaveStyle({ animationDelay: '0.2s' })
  })

  it('is hidden from the accessibility tree apart from its label: the ticks are decoration', () => {
    const { container } = render(<ProgressRing percent={62} />)

    for (const tick of ticks(container)) expect(tick.parentElement).toHaveAttribute('aria-hidden', 'true')
  })
})
