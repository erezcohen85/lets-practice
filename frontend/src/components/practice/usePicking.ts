import { useCallback, useEffect, useRef, useState } from 'react'
import { barUnderPoint } from '@/domain/barLineHits'
import { passesOf, positionOfPass, rangeFromTaps, type LoopRange } from '@/domain/practice'
import { positionNearTime } from '@/domain/rangeEdges'
import { type SlotTiming } from '@/domain/tempo'
import { type BarBox, type BarNumber } from '@/domain/types'
import { type ScorePointerEvent } from '@/components/score/ScoreView'
import { type PracticeControls } from '@/lib/usePractice'
import { strings } from '@/strings'

/** How long a press is held before it starts a range (UX answer 2, 2026-10-30). */
export const LONG_PRESS_MS = 500
// A press that moves further than this, in image pixels, is a scroll and picks nothing.
const MOVE_TOLERANCE = 12

/** One time through a bar (0-based); `timed` is false when it has no locator, so there is no time in the recording to go to. */
export interface PassOption { pass: number; timed: boolean }

/** A tap on a bar played more than once offers "1st time / 2nd time": the passes of that bar. */
export interface PassToggle { bar: BarNumber; passes: PassOption[] }

interface View { pending: BarNumber | null; toggle: PassToggle | null; notice: string | null }
const NOTHING: View = { pending: null, toggle: null, notice: null }

// `bar` is null for a press off the bars, which has no long press to wait for.
interface Press { bar: BarNumber | null; x: number; y: number; fired: boolean; timer: ReturnType<typeof setTimeout> | undefined }

export interface Picking {
  /** The bar a long press started a range at, while the range waits for its last bar. */
  pending: BarNumber | null
  /** The "1st time / 2nd time" control a tap on a repeated bar opened, until something else is done. */
  toggle: PassToggle | null
  /** The line for the score's hint row: what to do next, or why the taps made no range. */
  hint: string | undefined
  onPointer(event: ScorePointerEvent): void
  /** Moves the play line to the start of a pass (0-based) of the toggle's bar; the toggle stays open. */
  choose(pass: number): void
  cancel(): void
}

/**
 * Picking on the score: a tap on a bar selects it (the playhead moves there, nothing starts); a bar played more than once
 * also shows the "1st time / 2nd time" toggle, which closes on Play, on a tap elsewhere, on Escape and on starting a range.
 * A long press starts a range and the next tap ends it, on the same bar for a loop of one bar; on a computer Shift+click
 * after a tap is a long press on that bar and a tap on this one. Escape or a tap off the bars cancels. A range asks nothing:
 * it starts at the pass of its first bar nearest the play line. A long press discards the loop in place (on or off) while a
 * new one is picked; every way out of the pick without a range puts it back as it was.
 */
export function usePicking({
  timeline,
  bars,
  getTimeSec,
  getLoop,
  controls,
  playing,
}: {
  timeline: SlotTiming[]
  bars: readonly BarBox[]
  getTimeSec(): number
  /** The loop now: its range and whether it is on. */
  getLoop(): { range: LoopRange | null; looping: boolean }
  controls: Pick<PracticeControls, 'selectBar' | 'setRange' | 'setLoop'>
  /** The music is playing or counting in: Play starting it closes the toggle, a tap while it plays does not. */
  playing: boolean
}): Picking {
  const [view, setView] = useState<View>(NOTHING)
  // The same view for the handlers that outlive a render (the long press timer), kept in step by commit().
  const viewRef = useRef<View>(NOTHING)
  const pressRef = useRef<Press | null>(null)
  const lastTapRef = useRef<BarNumber | null>(null)
  // The loop a long press discarded, until a new range replaces it or the pick is cancelled.
  const heldLoopRef = useRef<{ range: LoopRange | null; looping: boolean } | null>(null)

  const commit = useCallback((next: View) => {
    viewRef.current = next
    setView(next)
  }, [])

  const barAt = useCallback(
    (pageIndex: number, x: number, y: number) => barUnderPoint(bars, pageIndex, x, y)?.bar ?? null,
    [bars],
  )

  /** The pick ended without a range: the discarded loop comes back, on or off as it was. */
  const restoreLoop = useCallback(() => {
    const held = heldLoopRef.current
    heldLoopRef.current = null
    if (held !== null) controls.setLoop(held.range, held.looping)
  }, [controls])

  const clearPress = useCallback(() => {
    if (pressRef.current !== null) clearTimeout(pressRef.current.timer)
    pressRef.current = null
  }, [])

  const finishRange = useCallback(
    (startBar: BarNumber, endBar: BarNumber) => {
      lastTapRef.current = null
      // The first bar of the range, in the pass nearest the play line; the first pass when the line is nowhere near it.
      const firstBar = Math.min(startBar, endBar)
      // A pass with no locator has no time of its own: the start takes one that has, and only then any.
      const near = positionNearTime(timeline, firstBar, getTimeSec(), { timedOnly: true }) ?? positionNearTime(timeline, firstBar, getTimeSec())
      const range = rangeFromTaps(timeline, startBar, endBar, near === null ? 0 : timeline[near].slot.passIndex)
      if (range === null) {
        restoreLoop()
        commit({ pending: null, toggle: null, notice: strings.practice.rangeNotPlayed })
        return
      }
      heldLoopRef.current = null
      controls.setRange(range)
      commit(NOTHING)
    },
    [timeline, getTimeSec, controls, commit, restoreLoop],
  )

  const tap = useCallback(
    (bar: BarNumber, shiftKey: boolean) => {
      const { pending } = viewRef.current
      if (pending !== null) {
        finishRange(pending, bar)
        return
      }
      const lastTap = lastTapRef.current
      if (shiftKey && lastTap !== null) {
        finishRange(lastTap, bar)
        return
      }
      const passes = passesOf(timeline, bar)
      const timed = positionNearTime(timeline, bar, getTimeSec(), { timedOnly: true })
      // Never land on a pass with no time (the seek would go to the recording's end). A bar played more than once whose
      // passes all lack one is not gone to, but its toggle still shows them, disabled.
      const position = timed ?? (passes.length > 1 ? null : positionNearTime(timeline, bar, getTimeSec()))
      if (position === null && passes.length === 0) return
      lastTapRef.current = bar
      if (position !== null) controls.selectBar(position)
      const options = passes.map((pass) => ({ pass, timed: timeline[positionOfPass(timeline, bar, pass)].interpolated === false }))
      commit({ pending: null, toggle: passes.length > 1 ? { bar, passes: options } : null, notice: null })
    },
    [timeline, getTimeSec, controls, commit, finishRange],
  )

  const onPointer = useCallback(
    (event: ScorePointerEvent) => {
      if (event.type === 'down') {
        clearPress()
        const bar = barAt(event.pageIndex, event.x, event.y)
        if (bar === null) {
          // A press off the bars closes the toggle.
          if (viewRef.current.toggle !== null) commit(NOTHING)
          // A tap off the bars cancels a pick. Only the lift tells: a press that moves is a scroll looking for the last bar.
          if (viewRef.current.pending !== null) pressRef.current = { bar: null, x: event.x, y: event.y, fired: false, timer: undefined }
          return
        }
        const timer = setTimeout(() => {
          const press = pressRef.current
          if (press === null) return
          press.fired = true
          lastTapRef.current = null
          if (heldLoopRef.current === null) {
            heldLoopRef.current = getLoop()
            controls.setLoop(null, false)
          }
          commit({ pending: press.bar, toggle: null, notice: null })
        }, LONG_PRESS_MS)
        pressRef.current = { bar, x: event.x, y: event.y, fired: false, timer }
      } else if (event.type === 'move') {
        const press = pressRef.current
        if (press !== null && !press.fired && Math.hypot(event.x - press.x, event.y - press.y) > MOVE_TOLERANCE) clearPress()
      } else if (event.type === 'up') {
        const press = pressRef.current
        clearPress()
        // A long press already started its range: lifting the finger is not a tap.
        if (press === null || press.fired) return
        if (press.bar === null) {
          restoreLoop()
          commit(NOTHING)
        } else if (barAt(event.pageIndex, event.x, event.y) === press.bar) tap(press.bar, event.shiftKey)
      } else {
        clearPress()
      }
    },
    [barAt, clearPress, commit, tap, getLoop, controls, restoreLoop],
  )

  const cancel = useCallback(() => {
    clearPress()
    lastTapRef.current = null
    restoreLoop()
    commit(NOTHING)
  }, [clearPress, commit, restoreLoop])

  const choose = useCallback(
    (pass: number) => {
      const { toggle } = viewRef.current
      if (toggle === null) return
      const position = positionOfPass(timeline, toggle.bar, pass)
      if (position === -1 || timeline[position].interpolated) return
      lastTapRef.current = toggle.bar
      controls.selectBar(position)
    },
    [timeline, controls],
  )

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && (viewRef.current.pending !== null || viewRef.current.toggle !== null)) cancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [cancel])

  // Play starting the music closes the toggle; a tap while the music plays does not (it was playing already).
  const wasPlayingRef = useRef(playing)
  useEffect(() => {
    if (playing && !wasPlayingRef.current && viewRef.current.toggle !== null) commit({ ...viewRef.current, toggle: null })
    wasPlayingRef.current = playing
  }, [playing, commit])

  useEffect(() => clearPress, [clearPress])

  const hint = view.pending !== null ? strings.practice.pickHint : (view.notice ?? undefined)
  return { pending: view.pending, toggle: view.toggle, hint, onPointer, choose, cancel }
}
