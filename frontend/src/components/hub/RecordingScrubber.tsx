import { type PointerEvent as ReactPointerEvent } from 'react'
import { WaveformStrip } from '@/components/waveform/WaveformStrip'
import { strings } from '@/strings'

// An arrow key on the focused waveform moves the playhead this far, in seconds.
const KEY_STEP_SEC = 5

/**
 * The waveform of the Recording card with a playhead line. A press on it seeks to the time under the pointer and dragging
 * scrubs, with the pointer captured so that it can leave the strip. The line is placed with an inline percentage, and the
 * strip reads left to right whatever the page direction.
 */
export function RecordingScrubber({
  peaks,
  bars,
  height,
  durationSec,
  timeSec,
  onSeek,
}: {
  peaks: readonly number[]
  bars: number
  height: number
  durationSec: number
  timeSec: number
  onSeek(timeSec: number): void
}) {
  const known = durationSec > 0
  const seekTo = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    if (rect.width <= 0 || !known) return
    onSeek(Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)) * durationSec)
  }
  const percent = known ? Math.min(100, Math.max(0, (timeSec / durationSec) * 100)) : 0

  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label={strings.hub.recordingPosition}
      aria-valuemin={0}
      aria-valuemax={Math.round(durationSec)}
      aria-valuenow={Math.round(timeSec)}
      data-slot="recording-scrubber"
      dir="ltr"
      className="relative cursor-pointer touch-none outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture?.(event.pointerId)
        seekTo(event)
      }}
      onPointerMove={(event) => {
        if (event.buttons !== 0) seekTo(event)
      }}
      onKeyDown={(event) => {
        if (!known || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return
        event.preventDefault()
        onSeek(Math.min(durationSec, Math.max(0, timeSec + (event.key === 'ArrowRight' ? KEY_STEP_SEC : -KEY_STEP_SEC))))
      }}
    >
      <WaveformStrip peaks={peaks} bars={bars} height={height} />
      <div data-slot="playhead" className="pointer-events-none absolute inset-y-0 w-0.5 bg-foreground" style={{ left: `${percent}%` }} />
    </div>
  )
}
