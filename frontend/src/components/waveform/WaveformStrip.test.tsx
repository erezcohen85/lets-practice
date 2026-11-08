import { render } from '@testing-library/react'
import { WaveformStrip } from '@/components/waveform/WaveformStrip'
import { tokens, waveColor } from '@/design/tokens'

const barsOf = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>('[data-slot="wave-bar"]')]

const colourClassOf = (bar: HTMLElement) => ['bg-wave-low', 'bg-wave-mid', 'bg-wave-high'].filter((name) => bar.classList.contains(name))

describe('WaveformStrip', () => {
  it('draws one bar for each peak', () => {
    const { container } = render(<WaveformStrip peaks={[0.1, 0.5, 0.9, 0.3]} height={56} />)

    expect(barsOf(container)).toHaveLength(4)
  })

  it('draws nothing but the baseline for no peaks', () => {
    const { container } = render(<WaveformStrip peaks={[]} height={56} />)

    expect(barsOf(container)).toHaveLength(0)
  })

  it('colours each bar by amplitude: low below 0.35, mid below 0.7, high from there up', () => {
    const { container } = render(<WaveformStrip peaks={[0, 0.34, 0.35, 0.69, 0.7, 1]} height={56} />)

    expect(barsOf(container).map(colourClassOf)).toEqual([
      ['bg-wave-low'],
      ['bg-wave-low'],
      ['bg-wave-mid'],
      ['bg-wave-mid'],
      ['bg-wave-high'],
      ['bg-wave-high'],
    ])
  })

  it('uses the same thresholds as the design tokens', () => {
    const classFor: Record<string, string> = {
      [tokens.wave.low.dark]: 'bg-wave-low',
      [tokens.wave.mid.dark]: 'bg-wave-mid',
      [tokens.wave.high.dark]: 'bg-wave-high',
    }
    const peaks = Array.from({ length: 101 }, (_, index) => index / 100)
    const { container } = render(<WaveformStrip peaks={peaks} height={56} />)

    barsOf(container).forEach((bar, index) => {
      expect(colourClassOf(bar), `amplitude ${peaks[index]}`).toEqual([classFor[waveColor(peaks[index])]])
    })
  })

  it('rises from the bottom baseline, never below 4 px and never above the strip', () => {
    const { container } = render(<WaveformStrip peaks={[0, 0.5, 1]} height={56} />)

    expect(barsOf(container).map((bar) => bar.style.height)).toEqual(['4px', '27px', '54px'])
    expect(container.firstElementChild).toHaveClass('items-end')
    expect(container.firstElementChild).toHaveStyle({ height: '56px' })
  })

  it('separates the bars by 2 px', () => {
    const { container } = render(<WaveformStrip peaks={[0.1, 0.2]} height={56} />)

    expect(container.firstElementChild).toHaveClass('gap-0.5')
  })

  it('draws every bar as played when there is no playedFraction', () => {
    const { container } = render(<WaveformStrip peaks={[0.2, 0.4, 0.6, 0.8]} height={56} />)

    expect(barsOf(container).map((bar) => bar.dataset.played)).toEqual(['true', 'true', 'true', 'true'])
  })

  it('dims the bars after the played fraction with the unplayed opacity of the tokens', () => {
    const { container } = render(<WaveformStrip peaks={[0.2, 0.4, 0.6, 0.8]} playedFraction={0.5} height={56} />)
    const bars = barsOf(container)

    expect(bars.map((bar) => bar.dataset.played)).toEqual(['true', 'true', 'false', 'false'])
    expect(bars[0]).not.toHaveClass('opacity-(--lp-wave-unplayed-opacity)')
    expect(bars[2]).toHaveClass('opacity-(--lp-wave-unplayed-opacity)')
    expect(tokens.wave.unplayedOpacity).toBe(0.4)
  })

  it('plays nothing at fraction 0 and everything at fraction 1', () => {
    const none = render(<WaveformStrip peaks={[0.2, 0.4]} playedFraction={0} height={56} />)
    expect(barsOf(none.container).map((bar) => bar.dataset.played)).toEqual(['false', 'false'])

    const all = render(<WaveformStrip peaks={[0.2, 0.4]} playedFraction={1} height={56} />)
    expect(barsOf(all.container).map((bar) => bar.dataset.played)).toEqual(['true', 'true'])
  })

  it('draws only the bars inside a played range at full strength, before and after it dimmed', () => {
    const { container } = render(<WaveformStrip peaks={[0.2, 0.4, 0.6, 0.8]} playedRange={[0.25, 0.75]} height={56} />)
    const bars = barsOf(container)

    expect(bars.map((bar) => bar.dataset.played)).toEqual(['false', 'true', 'true', 'false'])
    expect(bars[0]).toHaveClass('opacity-(--lp-wave-unplayed-opacity)')
    expect(bars[1]).not.toHaveClass('opacity-(--lp-wave-unplayed-opacity)')
    expect(bars[3]).toHaveClass('opacity-(--lp-wave-unplayed-opacity)')
  })

  it('reduces the peaks to a wanted number of bars', () => {
    const { container } = render(<WaveformStrip peaks={[0.1, 0.9, 0.2, 0.3]} bars={2} height={56} />)

    expect(barsOf(container)).toHaveLength(2)
    expect(barsOf(container).map(colourClassOf)).toEqual([['bg-wave-high'], ['bg-wave-low']])
  })

  it('is hidden from assistive technology', () => {
    const { container } = render(<WaveformStrip peaks={[0.1, 0.2]} height={56} />)

    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true')
  })

  it('keeps time running left to right, also in a right-to-left page', () => {
    const { container } = render(<WaveformStrip peaks={[0.1, 0.2]} height={56} />)

    expect(container.firstElementChild).toHaveAttribute('dir', 'ltr')
  })
})
