import { useCallback, useMemo, useState } from 'react'
import { isTextField } from '@/components/score/useScoreZoom'

/** The visible window of the dock: a start and a length, in recording seconds. */
export interface DockView { startSec: number; spanSec: number }

/** The zoom steps of the waveform in seconds; the last step is always the whole recording. */
const SPAN_LADDER = [5, 8, 12, 20, 30, 60, 120] as const
export const DEFAULT_SPAN_SEC = 12

// When the playhead leaves the window, the next window puts it this fraction of the span from the left edge.
const PAGE_MARGIN = 0.1

export function spanSteps(durationSec: number): number[] {
  if (!(durationSec > 0)) return [DEFAULT_SPAN_SEC]
  return [...SPAN_LADDER.filter((span) => span < durationSec), durationSec]
}

export function timeToX(t: number, view: DockView, width: number): number {
  return ((t - view.startSec) / view.spanSec) * width
}

export function xToTime(x: number, view: DockView, width: number): number {
  return width > 0 ? view.startSec + (x / width) * view.spanSec : view.startSec
}

/** What a key press asks of the waveform zoom: Shift + (or =) is 1, Shift - (or _) is -1, anything else 0. The plain keys are the score's. */
export function dockZoomKeyDirection(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'target'>): -1 | 0 | 1 {
  if (!event.shiftKey || event.ctrlKey || event.metaKey || event.altKey || isTextField(event.target)) return 0
  if (event.key === '+' || event.key === '=') return 1
  if (event.key === '-' || event.key === '_' || event.key === '−') return -1
  return 0
}

const clampStart = (startSec: number, spanSec: number, durationSec: number) =>
  Math.max(0, Math.min(startSec, durationSec - spanSec))

/**
 * The window of the waveform dock: 12 s at the start, zoom steps from 5 s to the whole recording, centred or scrolled by
 * time, and paged to the playhead while it plays. View state only; nothing here is recorded in the history.
 */
export function useDockView(durationSec: number) {
  const steps = useMemo(() => spanSteps(durationSec), [durationSec])
  const [state, setState] = useState({ startSec: 0, spanSec: DEFAULT_SPAN_SEC })

  // Derived on every read, so a recording that turns out shorter than the window still shows inside it.
  const spanSec = Math.min(state.spanSec, steps[steps.length - 1])
  const view = useMemo<DockView>(
    () => ({ startSec: clampStart(state.startSec, spanSec, durationSec), spanSec }),
    [state.startSec, spanSec, durationSec],
  )

  // `fraction` is the point of the window (0 left edge, 1 right edge) whose time stays where it is; the middle by default.
  const zoomTo = useCallback(
    (pick: (current: number) => number | undefined, fraction = 0.5) =>
      setState((previous) => {
        const current = Math.min(previous.spanSec, steps[steps.length - 1])
        const next = pick(current)
        if (next === undefined) return previous
        const anchor = clampStart(previous.startSec, current, durationSec) + fraction * current
        return { spanSec: next, startSec: clampStart(anchor - fraction * next, next, durationSec) }
      }),
    [steps, durationSec],
  )
  const zoomIn = useCallback(() => zoomTo((current) => [...steps].reverse().find((span) => span < current)), [zoomTo, steps])
  const zoomOut = useCallback(() => zoomTo((current) => steps.find((span) => span > current)), [zoomTo, steps])

  const zoomAt = useCallback(
    (direction: 1 | -1, fraction: number) =>
      zoomTo(
        (current) => (direction > 0 ? [...steps].reverse().find((span) => span < current) : steps.find((span) => span > current)),
        fraction,
      ),
    [zoomTo, steps],
  )

  const centreOn = useCallback(
    (t: number) => setState((previous) => ({ ...previous, startSec: clampStart(t - Math.min(previous.spanSec, durationSec) / 2, Math.min(previous.spanSec, durationSec), durationSec) })),
    [durationSec],
  )
  const scrollBy = useCallback(
    (sec: number) =>
      setState((previous) => {
        const span = Math.min(previous.spanSec, durationSec)
        return { ...previous, startSec: clampStart(previous.startSec + sec, span, durationSec) }
      }),
    [durationSec],
  )
  const follow = useCallback(
    (t: number) =>
      setState((previous) => {
        const span = Math.min(previous.spanSec, durationSec)
        const start = clampStart(previous.startSec, span, durationSec)
        if (t >= start && t < start + span) return previous
        return { ...previous, startSec: clampStart(t - PAGE_MARGIN * span, span, durationSec) }
      }),
    [durationSec],
  )

  return { view, zoomIn, zoomOut, zoomAt, centreOn, scrollBy, follow }
}
