import { memo } from 'react'
import { baselineY, type DockLocator, windowBars } from '@/components/waveform/dockLayout'
import { BeatLines, LABEL_ROW, LocatorLayer } from '@/components/waveform/LocatorLayer'
import { type DockView } from '@/components/waveform/useDockView'
import { tokens } from '@/design/tokens'
import { type DetectedBeat } from '@/domain/beats'
import { type MovedLocator } from '@/domain/pieceEdits'
import { type SlotTiming } from '@/domain/tempo'

/** One bar of the waveform is this many pixels apart, 3 drawn and 1 gap. */
const BAR_PITCH = 4
const BAR_WIDTH = 3

// The thresholds are the ones of tokens.wave, as in WaveformStrip. Complete class names, so Tailwind finds them.
function fillClass(amplitude: number): string {
  if (amplitude >= tokens.wave.highFrom) return 'fill-wave-high'
  if (amplitude >= tokens.wave.midFrom) return 'fill-wave-mid'
  return 'fill-wave-low'
}

export interface DockCanvasProps {
  peaks: readonly number[]
  durationSec: number
  view: DockView
  width: number
  height: number
  timeline: readonly SlotTiming[]
  /** The beats the tracker found; null draws each bar divided by its meter. */
  beats: readonly DetectedBeat[] | null
  locators: readonly DockLocator[]
  moved: readonly MovedLocator[]
  selected: { bar: number; passIndex: number } | null
  /** Every selected line (the selected one among them); each is drawn as selected. */
  group: readonly { bar: number; passIndex: number }[]
  /** Lines drawn faint: the guesses a preview of the bar lines on the beats would move or remove. */
  dimmed?: readonly { bar: number; passIndex: number }[]
  beatLines: boolean
}

/**
 * Everything the dock draws except the playhead. It is memoised on purpose: the playhead moves on every frame while
 * playing, the drawing only when the window, the map or the selection changes.
 */
export const DockCanvas = memo(function DockCanvas({ peaks, durationSec, view, width, height, timeline, beats, locators, moved, selected, group, dimmed, beatLines }: DockCanvasProps) {
  const baseline = baselineY(height)
  const peakHeight = Math.max(0, baseline - LABEL_ROW - 4)
  const bars = windowBars(peaks, durationSec, view, width, BAR_PITCH)
  const spans = timeline
    .filter((entry) => group.some((chosen) => chosen.bar === entry.slot.bar && chosen.passIndex === entry.slot.passIndex))
    .map((entry) => ({ startSec: entry.startSec, endSec: entry.endSec }))
  return (
    <svg aria-hidden="true" width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="block">
      <line x1={0} x2={width} y1={baseline} y2={baseline} className="stroke-border-strong" strokeWidth={1} />
      {beatLines && <BeatLines timeline={timeline} beats={beats} view={view} width={width} height={height} />}
      <g>
        {bars.map((bar) => {
          const height = Math.max(2, bar.amplitude * peakHeight)
          return (
            <rect
              key={bar.x}
              data-slot="dock-wave-bar"
              className={fillClass(bar.amplitude)}
              x={bar.x}
              y={baseline - height}
              width={BAR_WIDTH}
              height={height}
              rx={1}
            />
          )
        })}
      </g>
      <LocatorLayer
        locators={locators}
        moved={moved}
        selectedSpans={spans}
        selected={selected}
        group={group}
        dimmed={dimmed}
        view={view}
        width={width}
        height={height}
      />
    </svg>
  )
})
