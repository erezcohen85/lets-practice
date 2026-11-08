import { type PointerEvent as ReactPointerEvent, useRef } from 'react'
import { WaveformStrip } from '@/components/waveform/WaveformStrip'
import { cn } from '@/lib/utils'
import { strings } from '@/strings'
import { loopClass } from './loopColour'
import { usePhoneLayout } from './usePhoneLayout'

const STRIP_HEIGHT = 64
const STRIP_BARS = 160
// The bars stand 2 px apart, so 160 of them need 318 px for the gaps alone: on a phone that leaves them no width at all.
const PHONE_STRIP_BARS = 64
// An arrow key on the strip moves the playhead this far, in seconds.
const KEY_STEP_SEC = 5

/**
 * The whole recording as a strip under the score: the loop as a band with its label, the playhead as a line. A press on
 * it moves the playhead there, and dragging along it scrubs. No section letters (Phase 7 default 2).
 */
export function OverviewStrip({
  peaks,
  durationSec,
  timeSec,
  loop,
  loopLabel,
  showFill = true,
  onSeek,
}: {
  peaks: readonly number[] | null
  durationSec: number
  timeSec: number
  /** The loop's start and end in recording seconds. */
  loop: { startSec: number; endSec: number } | null
  loopLabel: string | null
  /** The band is filled (Settings: show the loop); off leaves its two edges and its label. */
  showFill?: boolean
  onSeek(timeSec: number): void
}) {
  const phone = usePhoneLayout()
  const ref = useRef<HTMLDivElement>(null)
  const percent = (sec: number) => `${Math.min(100, Math.max(0, (sec / durationSec) * 100))}%`

  const seekTo = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    if (rect.width <= 0 || !(durationSec > 0)) return
    onSeek(Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)) * durationSec)
  }

  return (
    <div className="pt-5">
      <div
        ref={ref}
        role="slider"
        tabIndex={0}
        aria-label={strings.practice.overview}
        aria-valuemin={0}
        aria-valuemax={Math.round(durationSec)}
        aria-valuenow={Math.round(timeSec)}
        data-slot="overview"
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
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
          event.preventDefault()
          onSeek(Math.min(durationSec, Math.max(0, timeSec + (event.key === 'ArrowRight' ? KEY_STEP_SEC : -KEY_STEP_SEC))))
        }}
      >
        <WaveformStrip peaks={peaks ?? []} height={STRIP_HEIGHT} bars={peaks === null ? undefined : phone ? PHONE_STRIP_BARS : STRIP_BARS} />
        {loop !== null && (
          <div
            data-slot="loop-band"
            className={cn('pointer-events-none absolute inset-y-0 border-x', loopClass.handleBorder, showFill && loopClass.tint)}
            style={{ left: percent(loop.startSec), width: `calc(${percent(loop.endSec)} - ${percent(loop.startSec)})` }}
          >
            {loopLabel !== null && (
              <span className={cn('absolute -top-5 start-0 text-xs font-medium whitespace-nowrap', loopClass.soft)}>{strings.practice.loopBand(loopLabel)}</span>
            )}
          </div>
        )}
        <div data-slot="playhead" className="pointer-events-none absolute inset-y-0 w-0.5 bg-foreground" style={{ left: percent(timeSec) }} />
      </div>
    </div>
  )
}
