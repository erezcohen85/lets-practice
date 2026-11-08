import { type CSSProperties } from 'react'
import { cn } from '@/lib/utils'

export type TickKind = 'head' | 'filled' | 'empty'

interface TickRingProps {
  count: number
  /** How many ticks are lit, from the top, clockwise; the last of them is the head. */
  lit: number
  /** The size and shape every tick shares: the box of one tick, set out from the centre of the ring. */
  tickClassName: string
  kindClassName: Record<TickKind, string>
  tickStyle?(index: number, kind: TickKind): CSSProperties | undefined
}

/**
 * The ring of radial ticks of the logo (LogoRing), the Processing ring and the play button: `count` ticks round a centre,
 * clockwise from the top. Each tick is drawn in a zero-size box at the centre of the parent (which must be positioned),
 * turned to the tick's angle, and the tick sits out from the centre by its own `top`. Decoration only.
 */
export function TickRing({ count, lit, tickClassName, kindClassName, tickStyle }: TickRingProps) {
  return Array.from({ length: count }, (_, index) => {
    const kind: TickKind = index >= lit ? 'empty' : index === lit - 1 ? 'head' : 'filled'
    return (
      <span
        key={index}
        aria-hidden="true"
        className="absolute start-1/2 top-1/2 size-0"
        style={{ transform: `rotate(${index * (360 / count)}deg)` }}
      >
        <span data-tick={kind} className={cn('absolute', tickClassName, kindClassName[kind])} style={tickStyle?.(index, kind)} />
      </span>
    )
  })
}
