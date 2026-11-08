import { Pause, Play } from 'lucide-react'
import { auroraTickColour } from '@/components/shell/auroraTickColour'
import { TickRing, type TickKind } from '@/components/shell/TickRing'
import { type PracticeState } from '@/lib/usePractice'
import { cn } from '@/lib/utils'
import { strings } from '@/strings'
import './PlayRing.css'

const TICKS = 48
const GLOW = 'shadow-[0_0_8px_color-mix(in_oklab,var(--lp-text)_35%,transparent)]'

// The aurora is for brand moments: this is the one of Practice. Ticks lit as the music goes, brightest where it is now;
// when nothing plays they stay put and dim, so nothing moves on a music stand.
const tickClass: Record<'playing' | 'still', Record<TickKind, string>> = {
  playing: { head: `opacity-100 ${GLOW}`, filled: 'opacity-100', empty: 'opacity-25' },
  still: { head: 'opacity-55', filled: 'opacity-55', empty: 'opacity-25' },
}

// Outer 88 px around the 72 px button (ticks 38 to 44 px out), 60 px around the 48 px one at lg (ticks 25 to 30 px out).
// A fixed ring is the 88 px one at every width: the recording on the piece hub, which is not a music stand.
const SIZE = {
  responsive: {
    ring: 'size-[88px] lg:size-[60px]',
    tick: '-start-[1.5px] -top-11 h-1.5 w-[3px] rounded-[1.5px] lg:-start-px lg:-top-[30px] lg:h-[5px] lg:w-0.5 lg:rounded-[1px]',
    button: 'size-[72px] lg:size-12',
    beat: 'text-3xl lg:text-2xl',
    icon: 'size-7 lg:size-5',
  },
  fixed: {
    ring: 'size-[88px]',
    tick: '-start-[1.5px] -top-11 h-1.5 w-[3px] rounded-[1.5px]',
    button: 'size-[72px]',
    beat: 'text-3xl',
    icon: 'size-7',
  },
  // The lg sizes at every width: Practice on a phone, where the score needs the height.
  compact: {
    ring: 'size-[60px]',
    tick: '-start-px -top-[30px] h-[5px] w-0.5 rounded-[1px]',
    button: 'size-12',
    beat: 'text-2xl',
    icon: 'size-5',
  },
} as const

const tickStyle = (playing: boolean) => (index: number, kind: TickKind) => {
  const colour = auroraTickColour(index, TICKS)
  // The head is the brightest: its colour is pulled towards the text colour.
  return { backgroundColor: playing && kind === 'head' ? `color-mix(in oklab, ${colour} 45%, var(--lp-text))` : colour }
}

/**
 * The play / pause button in a ring of aurora ticks, the family of the logo and the Processing ring. The ticks fill
 * clockwise from the top with `progress` (0 to 1, through the loop or the recording); during a count-in the whole ring
 * pulses once per beat and the beat number takes the icon's place.
 *
 * Practice gives it the engine's `state`. Anything with only a playing or paused state (the recording on the hub, a transport)
 * gives `playing` instead; `size="fixed"` keeps the ring 88 px at every width, where Practice's shrinks to 60 px from lg.
 */
export function PlayRing({
  state: engineState,
  playing: isPlaying = false,
  progress = 0,
  size = 'responsive',
  labels = { play: strings.player.play, pause: strings.player.pause },
  disabled = false,
  onToggle,
}: {
  state?: Pick<PracticeState, 'phase' | 'count'>
  playing?: boolean
  progress?: number
  size?: 'responsive' | 'fixed' | 'compact'
  /** The button's name for screen readers; Practice says Play and Pause, the hub names the recording. */
  labels?: { play: string; pause: string }
  /** Nothing to play yet (the recording is still loading): the button is off. */
  disabled?: boolean
  onToggle(): void
}) {
  const state = engineState ?? { phase: isPlaying ? 'playing' : 'paused', count: null }
  const classes = SIZE[size]
  const running = state.phase === 'playing' || state.phase === 'counting'
  const playing = state.phase === 'playing'
  const lit = Math.round(TICKS * Math.min(1, Math.max(0, Number.isFinite(progress) ? progress : 0)))
  return (
    <span data-slot="play-ring" className={cn('relative inline-flex shrink-0 items-center justify-center', classes.ring)}>
      <span
        // A new element for each beat, so the pulse starts again.
        key={state.count?.beat ?? 'rest'}
        aria-hidden="true"
        data-slot="play-ring-ticks"
        className={cn('pointer-events-none absolute inset-0', state.count !== null && 'motion-safe:animate-[play-ring-pulse_0.45s_ease-out]')}
      >
        <TickRing count={TICKS} lit={lit} tickClassName={classes.tick} kindClassName={tickClass[playing ? 'playing' : 'still']} tickStyle={tickStyle(playing)} />
      </span>
      <button
        type="button"
        aria-label={running ? labels.pause : labels.play}
        onClick={onToggle}
        disabled={disabled}
        className={cn(
          'relative inline-flex items-center justify-center rounded-full bg-background text-primary-strong outline-none transition-colors hover:bg-surface focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50',
          classes.button,
        )}
      >
        {state.count !== null ? (
          <span aria-hidden="true" data-slot="count-beat" className={cn('font-bold tabular-nums', classes.beat)}>
            {state.count.beat}
          </span>
        ) : running ? (
          <Pause className={cn('fill-current', classes.icon)} aria-hidden="true" />
        ) : (
          <Play className={cn('fill-current', classes.icon)} aria-hidden="true" />
        )}
      </button>
      <span role="status" className="sr-only">
        {state.count === null ? '' : strings.practice.countBeat(state.count.beat, state.count.of)}
      </span>
    </span>
  )
}
