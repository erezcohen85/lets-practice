import { TickRing, type TickKind } from '@/components/shell/TickRing'
import { cn } from '@/lib/utils'
import { strings } from '@/strings'
import './ProgressRing.css'

const TICKS = 60
// The unfilled ticks beat one after the other around the ring, each 20 ms behind the one before.
const STAGGER_SEC = 0.02

const tickClass: Record<TickKind, string> = {
  // The head, the last lit tick, is the brightest; the lit ticks glow in the primary colour.
  head: 'bg-foreground shadow-[0_0_10px_color-mix(in_oklab,var(--lp-primary)_55%,transparent)]',
  filled: 'bg-primary-strong shadow-[0_0_10px_color-mix(in_oklab,var(--lp-primary)_55%,transparent)]',
  // Only motion-safe pulses: under prefers-reduced-motion the ticks stand still.
  empty: 'bg-border-strong motion-safe:animate-[ring-beat_1.6s_ease-in-out_infinite]',
}

/**
 * A ring of 60 ticks that fills clockwise from the top with the percentage in the middle. The ring is one image for a
 * screen reader ("Progress 62%"); the ticks are decoration.
 */
export function ProgressRing({ percent, className }: { percent: number; className?: string }) {
  const whole = Math.min(100, Math.max(0, Math.round(percent)))
  const lit = Math.round((TICKS * whole) / 100)

  return (
    <div role="img" aria-label={strings.processing.progressLabel(whole)} className={cn('relative size-[168px] shrink-0', className)}>
      <TickRing
        count={TICKS}
        lit={lit}
        // Each tick sits 64 to 80 px out from the centre.
        tickClassName="-start-0.5 -top-20 h-4 w-1 rounded-[2px]"
        kindClassName={tickClass}
        tickStyle={(index, kind) => (kind === 'empty' ? { animationDelay: `${Number((index * STAGGER_SEC).toFixed(2))}s` } : undefined)}
      />
      <div className="absolute inset-0 flex items-center justify-center text-[34px] font-bold">{whole}%</div>
    </div>
  )
}
