import { tokens } from '@/design/tokens'
import { resamplePeaks } from '@/domain/peaks'
import { cn } from '@/lib/utils'

// The thresholds are the ones of tokens.wave (low below midFrom, mid below highFrom, high from there up).
// Complete class names, so Tailwind finds them.
function colourClass(amplitude: number): string {
  if (amplitude >= tokens.wave.highFrom) return 'bg-wave-high'
  if (amplitude >= tokens.wave.midFrom) return 'bg-wave-mid'
  return 'bg-wave-low'
}

/**
 * One-sided amplitude bars standing on a baseline (landing demo, piece hub). `peaks` are 0..1, one bar each; pass `bars`
 * to reduce a long list to that many. The first `playedFraction` of the bars is drawn at full strength and the rest at
 * the unplayed opacity of the tokens; without it every bar is played. `playedRange` (fractions of the width, from and to)
 * instead keeps full strength inside a range, as a loop does, and dims the bars before and after it; it wins over
 * `playedFraction`. Decorative, so hidden from assistive technology.
 */
export function WaveformStrip({
  peaks,
  playedFraction,
  playedRange,
  height,
  bars,
}: {
  peaks: readonly number[]
  playedFraction?: number
  playedRange?: readonly [number, number]
  height: number
  bars?: number
}) {
  const shown = bars === undefined ? peaks : resamplePeaks(peaks, bars)
  return (
    // Time runs left to right whatever the page direction.
    <div
      aria-hidden="true"
      dir="ltr"
      className="flex items-end gap-0.5 border-b border-border-strong"
      style={{ height }}
    >
      {shown.map((amplitude, index) => {
        const middle = index + 0.5
        const played = playedRange
          ? middle >= playedRange[0] * shown.length && middle < playedRange[1] * shown.length
          : playedFraction === undefined || index < playedFraction * shown.length
        return (
          <div
            key={index}
            data-slot="wave-bar"
            data-played={played}
            className={cn(
              'min-w-0 flex-1 rounded-t-[2px]',
              colourClass(amplitude),
              !played && 'opacity-(--lp-wave-unplayed-opacity)',
            )}
            style={{ height: Math.max(4, Math.round(amplitude * (height - 2))) }}
          />
        )
      })}
    </div>
  )
}
