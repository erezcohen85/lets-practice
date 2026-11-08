import { baselineY, type DockLocator, type LocatorState, locatorState } from '@/components/waveform/dockLayout'
import { type DockView, timeToX } from '@/components/waveform/useDockView'
import { type MovedLocator } from '@/domain/pieceEdits'
import { type DetectedBeat, isDownbeat } from '@/domain/beats'
import { beatTimes, type SlotTiming } from '@/domain/tempo'
import { formatOffset } from '@/domain/barLabel'
import { useBarNames } from '@/lib/barNamesContext'
import { barWithPass, strings } from '@/strings'

/** The rows of the dock's drawing, top to bottom: a label row, the lines and bars, the baseline with its handles. */
export const LABEL_ROW = 18
/** The height of the stage until the dock has been measured (and in tests, which have no layout); the stage then takes the room the dock has. */
export const DOCK_HEIGHT = 150
const HANDLE_RADIUS = 5
// Labels need this much room each; in a crowded window only the selected line keeps its label.
const LABEL_PX = 26
// A moved tag is about this wide per character at 11 px, plus its padding.
const TAG_CHAR_PX = 6.2
const TAG_PAD_PX = 12

// Complete class names, so Tailwind finds them.
const STATE_CLASSES: Record<LocatorState, { line: string; handle: string; label: string }> = {
  selected: { line: 'stroke-selected', handle: 'fill-selected', label: 'fill-selected' },
  problem: { line: 'stroke-problem', handle: 'fill-problem', label: 'fill-problem' },
  filled: { line: 'stroke-moved', handle: 'fill-moved', label: 'fill-moved' },
  anchor: { line: 'stroke-anchor', handle: 'fill-anchor', label: 'fill-anchor' },
  plain: { line: 'stroke-border-strong', handle: 'fill-text-muted', label: 'fill-text-muted' },
}

interface LocatorLayerProps {
  /** The locators the filter lets through. */
  locators: readonly DockLocator[]
  moved: readonly MovedLocator[]
  /** The start and end of each selected slot, to tint its span. */
  selectedSpans: readonly { startSec: number; endSec: number }[]
  selected: { bar: number; passIndex: number } | null
  /** Every selected line; with several, each is drawn as the selected one. */
  group: readonly { bar: number; passIndex: number }[]
  /** Lines drawn faint (a preview says they would move or go). */
  dimmed?: readonly { bar: number; passIndex: number }[]
  view: DockView
  width: number
  height: number
}

/** The selected bar's span, the dashed "was" lines of moved locators, and the locator lines with their handles and labels. */
export function LocatorLayer({ locators, moved, selectedSpans, selected, group, dimmed = [], view, width, height }: LocatorLayerProps) {
  const names = useBarNames()
  const baseline = baselineY(height)
  const end = view.startSec + view.spanSec
  const inView = locators.filter((locator) => locator.timeSec >= view.startSec - 0.5 && locator.timeSec <= end + 0.5)
  const labelled = inView.length * LABEL_PX <= width
  return (
    <>
      {selectedSpans.map((selectedSpan) => (
        <rect
          key={selectedSpan.startSec}
          data-slot="dock-selected-span"
          className="fill-selected stroke-selected"
          fillOpacity={0.14}
          strokeWidth={1.5}
          x={timeToX(selectedSpan.startSec, view, width)}
          y={LABEL_ROW}
          width={timeToX(selectedSpan.endSec, view, width) - timeToX(selectedSpan.startSec, view, width)}
          height={baseline - LABEL_ROW}
        />
      ))}
      {moved
        .filter((entry) => entry.fromSec >= view.startSec - 0.5 && entry.fromSec <= end + 0.5)
        .map((entry) => {
          const x = timeToX(entry.fromSec, view, width)
          return (
            <g key={`${entry.bar}:${entry.passIndex}`} data-slot="dock-was" className="pointer-events-none">
              <line x1={x} x2={x} y1={LABEL_ROW} y2={baseline} className="stroke-moved" strokeWidth={1.5} strokeDasharray="4 3" />
              <text x={x + 4} y={LABEL_ROW + 24} fontSize={11} className="fill-moved">
                {strings.dock.was}
              </text>
            </g>
          )
        })}
      {moved.flatMap((entry) => {
        const locator = inView.find((candidate) => candidate.bar === entry.bar && candidate.passIndex === entry.passIndex)
        if (locator === undefined) return []
        const label = strings.dock.movedTag(barWithPass(names.label(locator.bar), locator.passIndex), formatOffset(locator.timeSec - entry.fromSec))
        const x = timeToX(locator.timeSec, view, width)
        return [
          <g key={`tag:${entry.bar}:${entry.passIndex}`} data-slot="dock-moved-tag" className="pointer-events-none">
            <rect x={x + 3} y={LABEL_ROW + 3} width={label.length * TAG_CHAR_PX + TAG_PAD_PX} height={17} rx={4} className="fill-moved-bg stroke-moved" strokeWidth={1} />
            <text x={x + 3 + TAG_PAD_PX / 2} y={LABEL_ROW + 15} fontSize={11} fontWeight={600} className="fill-moved-text">
              {label}
            </text>
          </g>,
        ]
      })}
      {filledRuns(inView).map((run) => {
        const first = run[0]
        const last = run[run.length - 1]
        const from = barWithPass(names.label(first.bar), first.passIndex)
        const label = run.length === 1 ? strings.dock.filledTag(from) : strings.dock.filledRunTag(from, barWithPass(names.label(last.bar), last.passIndex))
        const x = timeToX(first.timeSec, view, width)
        return (
          <g key={`filled:${first.bar}:${first.passIndex}`} data-slot="dock-filled-tag" className="pointer-events-none">
            <rect x={x + 3} y={LABEL_ROW + 3} width={label.length * TAG_CHAR_PX + TAG_PAD_PX} height={17} rx={4} className="fill-moved-bg stroke-moved" strokeWidth={1} />
            <text x={x + 3 + TAG_PAD_PX / 2} y={LABEL_ROW + 15} fontSize={11} fontWeight={600} className="fill-moved-text">
              {label}
            </text>
          </g>
        )
      })}
      {inView.map((locator) => {
        const state = group.length > 1 && group.some((chosen) => chosen.bar === locator.bar && chosen.passIndex === locator.passIndex) ? 'selected' : locatorState(locator, selected)
        const classes = STATE_CLASSES[state]
        const x = timeToX(locator.timeSec, view, width)
        return (
          <g
            key={`${locator.bar}:${locator.passIndex}`}
            data-slot="dock-locator"
            data-bar={locator.bar}
            data-pass={locator.passIndex}
            data-state={state}
            data-dimmed={dimmed.some((faint) => faint.bar === locator.bar && faint.passIndex === locator.passIndex) ? 'true' : undefined}
            className="pointer-events-none data-[dimmed=true]:opacity-30"
          >
            <line x1={x} x2={x} y1={LABEL_ROW} y2={baseline} className={classes.line} strokeWidth={state === 'selected' ? 2 : 1} />
            <circle cx={x} cy={baseline} r={state === 'selected' ? HANDLE_RADIUS + 1.5 : HANDLE_RADIUS} className={classes.handle} />
            {(labelled || state === 'selected') && (
              <text x={x + 4} y={LABEL_ROW - 5} fontSize={11} fontWeight={600} className={classes.label}>
                {barWithPass(names.label(locator.bar), locator.passIndex)}
              </text>
            )}
          </g>
        )
      })}
    </>
  )
}

/** The filled-in locators that follow each other in play order, as runs: one tag names a whole run, so the tags do not pile up on narrow bars. */
function filledRuns(locators: readonly DockLocator[]): DockLocator[][] {
  const runs: DockLocator[][] = []
  let previousFilled = false
  for (const locator of locators) {
    const filled = locator.filled && !locator.confirmed
    if (filled) {
      if (previousFilled) runs[runs.length - 1].push(locator)
      else runs.push([locator])
    }
    previousFilled = filled
  }
  return runs
}

/**
 * Thin lines at the beats in the window. With the beats the tracker found they are drawn where it heard them, the
 * downbeats stronger; without them (an older run) each bar is divided by its meter, after the first beat (the bar line
 * itself is the locator or the ruler mark).
 */
export function BeatLines({
  timeline,
  beats,
  view,
  width,
  height,
}: {
  timeline: readonly SlotTiming[]
  beats: readonly DetectedBeat[] | null
  view: DockView
  width: number
  height: number
}) {
  const baseline = baselineY(height)
  const end = view.startSec + view.spanSec
  const lines: Array<{ x: number; strong: boolean }> = []
  if (beats !== null && beats.length > 0) {
    for (const beat of beats) {
      if (beat.t < view.startSec) continue
      if (beat.t > end) break
      lines.push({ x: timeToX(beat.t, view, width), strong: isDownbeat(beat) })
    }
  } else {
    for (const entry of timeline) {
      if (entry.endSec < view.startSec) continue
      if (entry.startSec > end) break
      for (const t of beatTimes(entry).slice(1)) if (t >= view.startSec && t <= end) lines.push({ x: timeToX(t, view, width), strong: false })
    }
  }
  return (
    <g className="pointer-events-none">
      {lines.map(({ x, strong }, index) => (
        <line
          key={index}
          data-slot="dock-beat"
          data-strong={strong ? 'true' : undefined}
          x1={x}
          x2={x}
          y1={LABEL_ROW + 6}
          y2={baseline}
          className={strong ? 'stroke-border-strong' : 'stroke-border'}
          strokeWidth={strong ? 1.5 : 1}
        />
      ))}
    </g>
  )
}
