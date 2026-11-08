import { fireEvent, render, screen } from '@testing-library/react'
import { strings } from '@/strings'
import { PlayRing } from './PlayRing'

const ticks = () => [...document.querySelectorAll<HTMLElement>('[data-slot="play-ring"] [data-tick]')]

describe('PlayRing', () => {
  it('offers Play when paused and calls the toggle', () => {
    const onToggle = vi.fn()
    render(<PlayRing state={{ phase: 'paused', count: null }} onToggle={onToggle} />)

    fireEvent.click(screen.getByRole('button', { name: strings.player.play }))

    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it('offers Pause while playing and while counting in, and shows the beat number during the count', () => {
    const { rerender } = render(<PlayRing state={{ phase: 'playing', count: null }} onToggle={() => {}} />)
    expect(screen.getByRole('button', { name: strings.player.pause })).toBeInTheDocument()

    rerender(<PlayRing state={{ phase: 'counting', count: { beat: 3, of: 4 } }} onToggle={() => {}} />)

    expect(screen.getByRole('button', { name: strings.player.pause })).toHaveTextContent('3')
    expect(screen.getByRole('status')).toHaveTextContent(strings.practice.countBeat(3, 4))
  })

  it('names the button with the labels it is given, for Play and for Pause', () => {
    const labels = { play: 'Play the recording', pause: 'Pause the recording' }
    const { rerender } = render(<PlayRing playing={false} labels={labels} onToggle={() => {}} />)
    expect(screen.getByRole('button', { name: 'Play the recording' })).toBeInTheDocument()

    rerender(<PlayRing playing labels={labels} onToggle={() => {}} />)
    expect(screen.getByRole('button', { name: 'Pause the recording' })).toBeInTheDocument()
  })

  it('is ringed in 48 ticks that take their colours from the aurora tokens, not from raw colours', () => {
    render(<PlayRing state={{ phase: 'idle', count: null }} onToggle={() => {}} />)

    expect(ticks()).toHaveLength(48)
    const colours = ticks().map((tick) => tick.getAttribute('style') ?? '')
    for (const stop of [1, 2, 3, 4]) expect(colours.some((style) => style.includes(`var(--lp-aurora-${stop})`))).toBe(true)
    for (const style of colours) expect(style).not.toMatch(/#|rgb|hsl|oklch\(/)
    expect(ticks()[0].style.backgroundColor).toBe('var(--lp-aurora-1)')
    expect(ticks()[12].style.backgroundColor).toBe('var(--lp-aurora-2)')
  })

  it('lights the ticks in proportion to the progress, the last lit one the head, the rest dim', () => {
    render(<PlayRing state={{ phase: 'playing', count: null }} progress={0.25} onToggle={() => {}} />)

    expect(ticks().filter((tick) => tick.dataset.tick === 'filled')).toHaveLength(11)
    expect(ticks()[11].dataset.tick).toBe('head')
    expect(ticks().filter((tick) => tick.dataset.tick === 'empty')).toHaveLength(36)
    expect(ticks()[5].className).toContain('opacity-100')
    expect(ticks()[11].className).toContain('opacity-100')
    expect(ticks()[30].className).toContain('opacity-25')
  })

  it('lights nothing at the start and every tick at the end, and keeps a stray progress on the ring', () => {
    const { rerender } = render(<PlayRing state={{ phase: 'playing', count: null }} progress={0} onToggle={() => {}} />)
    expect(ticks().filter((tick) => tick.dataset.tick !== 'empty')).toHaveLength(0)

    rerender(<PlayRing state={{ phase: 'playing', count: null }} progress={7} onToggle={() => {}} />)
    expect(ticks().filter((tick) => tick.dataset.tick === 'empty')).toHaveLength(0)

    rerender(<PlayRing state={{ phase: 'playing', count: null }} progress={Number.NaN} onToggle={() => {}} />)
    expect(ticks().filter((tick) => tick.dataset.tick !== 'empty')).toHaveLength(0)
  })

  it('shows the same fill dim and still while paused or idle', () => {
    const { rerender } = render(<PlayRing state={{ phase: 'playing', count: null }} progress={0.5} onToggle={() => {}} />)
    const playing = ticks().map((tick) => tick.dataset.tick)

    for (const phase of ['paused', 'idle'] as const) {
      rerender(<PlayRing state={{ phase, count: null }} progress={0.5} onToggle={() => {}} />)
      expect(ticks().map((tick) => tick.dataset.tick)).toEqual(playing)
      expect(ticks()[3].className).toContain('opacity-55')
      expect(ticks()[3].className).not.toContain('opacity-100')
      expect(ticks()[23].className).toContain('opacity-55')
      expect(ticks()[30].className).toContain('opacity-25')
      for (const tick of ticks()) expect(tick.className).not.toMatch(/animate-/)
    }
  })

  it('pulses the whole ring once per count, only where motion is welcome', () => {
    const { rerender } = render(<PlayRing state={{ phase: 'counting', count: { beat: 1, of: 4 } }} onToggle={() => {}} />)

    const pulse = () => document.querySelector('[data-slot="play-ring-ticks"]') as HTMLElement
    const classes = pulse().className.split(/\s+/)
    expect(classes.some((name) => name.startsWith('motion-safe:animate-'))).toBe(true)
    expect(classes.filter((name) => name.startsWith('animate-'))).toEqual([])

    // The next beat is a new element, so its pulse starts again.
    const first = pulse()
    rerender(<PlayRing state={{ phase: 'counting', count: { beat: 2, of: 4 } }} onToggle={() => {}} />)
    expect(pulse()).not.toBe(first)
    expect(pulse().className).toContain('motion-safe:animate-')
  })

  it('does not pulse outside a count-in', () => {
    for (const phase of ['idle', 'paused', 'playing'] as const) {
      const { unmount } = render(<PlayRing state={{ phase, count: null }} progress={0.3} onToggle={() => {}} />)
      expect(document.querySelector('[data-slot="play-ring-ticks"]')?.className).not.toMatch(/animate-/)
      unmount()
    }
  })

  it('keeps the ticks out of the accessibility tree and the button named', () => {
    render(<PlayRing state={{ phase: 'paused', count: null }} progress={0.5} onToggle={() => {}} />)

    expect(document.querySelector('[data-slot="play-ring-ticks"]')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByRole('button', { name: strings.player.play })).toBeInTheDocument()
  })

  describe('size', () => {
    const ring = () => document.querySelector('[data-slot="play-ring"]') as HTMLElement
    const disc = () => screen.getByRole('button')

    it('shrinks from 88 to 60 px at lg by default, as Practice has it', () => {
      render(<PlayRing state={{ phase: 'paused', count: null }} onToggle={() => {}} />)

      expect(ring()).toHaveClass('size-[88px]', 'lg:size-[60px]')
      expect(disc()).toHaveClass('size-[72px]', 'lg:size-12')
      expect(ticks()[0].className).toContain('lg:')
    })

    it('stays 88 px at every width when the size is fixed, ticks and button included', () => {
      render(<PlayRing size="fixed" state={{ phase: 'paused', count: null }} onToggle={() => {}} />)

      expect(ring()).toHaveClass('size-[88px]')
      expect(disc()).toHaveClass('size-[72px]')
      for (const element of [ring(), disc(), ticks()[0], disc().querySelector('svg')!]) expect(element.className).not.toContain('lg:')
      expect(ring().className).not.toContain('lg:')
    })

    it('stays 60 px at every width when the size is compact, for a phone', () => {
      render(<PlayRing size="compact" state={{ phase: 'paused', count: null }} onToggle={() => {}} />)

      expect(ring()).toHaveClass('size-[60px]')
      expect(disc()).toHaveClass('size-12')
      for (const element of [ring(), disc(), ticks()[0], disc().querySelector('svg')!]) expect(element.className).not.toContain('lg:')
    })
  })

  describe('playing in place of a state', () => {
    it('shows Pause while playing, Play when not, and calls the toggle', () => {
      const onToggle = vi.fn()
      const { rerender } = render(<PlayRing playing progress={0.5} onToggle={onToggle} />)
      expect(screen.getByRole('button', { name: strings.player.pause })).toBeInTheDocument()
      expect(ticks().filter((tick) => tick.dataset.tick !== 'empty')).toHaveLength(24)
      expect(ticks()[10].className).toContain('opacity-100')

      rerender(<PlayRing playing={false} progress={0.5} onToggle={onToggle} />)
      fireEvent.click(screen.getByRole('button', { name: strings.player.play }))

      expect(onToggle).toHaveBeenCalledTimes(1)
      expect(ticks()[10].className).toContain('opacity-55')
      expect(screen.getByRole('status')).toBeEmptyDOMElement()
    })
  })
})
