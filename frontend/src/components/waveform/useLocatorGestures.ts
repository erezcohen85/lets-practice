import { useCallback, useEffect, useRef, useState } from 'react'
import { timeToX, type DockView, xToTime } from '@/components/waveform/useDockView'
import { DRAG_SNAP_SEC, type DetectedBeat, nearestBeat } from '@/domain/beats'
import { deltaLimits } from '@/domain/groupMove'
import { isSelected, slotsBetween, type Slot as SelectedSlot } from '@/domain/locatorSelection'
import { type BarNumber } from '@/domain/types'

interface Slot { bar: BarNumber; passIndex: number }
interface Placed extends Slot { timeSec: number }

/** A press must travel this many pixels to be a drag; a press that stays within it is a click. */
export const CLICK_SLOP_PX = 3
/** A dragged line stays this far (in seconds) from its neighbours, so a drop never lands on one. */
const NEIGHBOUR_GAP_SEC = 0.01

/** What a gesture on the waveform asks for. The dock turns these into edits. */
export type Gesture =
  | { kind: 'drag'; slot: Slot; timeSec: number }
  | { kind: 'drag-group'; slots: SelectedSlot[]; deltaSec: number }
  | { kind: 'add'; timeSec: number; shift: boolean }
  /** A plain click on empty waveform with Add locator off: the play line goes there. */
  | { kind: 'seek'; timeSec: number }
  /** A band dragged over the waveform: these lines (in this order) are the selection; none clears it. */
  | { kind: 'select'; slots: SelectedSlot[] }

interface Press {
  x: number
  slot: Slot | null
  /** Where the line may go, in seconds: between its neighbours. */
  low: number
  high: number
  dragging: boolean
  /** A press on a selected line while several are selected drags them all: the pressed line's time and how far the group may move (seconds). */
  group: { slots: SelectedSlot[]; anchorSec: number; min: number; max: number } | null
}

/** The selection band while it is dragged: its two edges in pixels of the stage, and the lines that would be selected. */
export interface Band { x0: number; x1: number; slots: SelectedSlot[] }

export interface PointerPoint { x: number; shiftKey: boolean }

/**
 * The pointer gestures of the locator edits: a press within reach of a line and then a move is a drag (the preview line
 * follows the pointer between the neighbouring locators, release applies it, Escape cancels); a press away from any
 * line that is released in place is a click: it moves the play line (`seek`, Shift or not), or with `addLocator` on it
 * adds a locator instead (Decisions 2026-11-06). A seek needs no editing rights; a drag and an add do (`enabled`). A press and release in place on a line only selects it. A press on empty waveform that moves past the slop draws a selection band instead of seeking or adding: the visible lines inside it become the selection (`select`; Shift keeps the current one and adds, none inside clears it, Escape cancels); it needs `enabled` and `canSelect`. A drag
 * lands on a detected beat close to the pointer; Shift drags freely. A press on one of several selected lines drags them
 * all by the same offset, which stops where one of them would meet a line that is not selected. All view state: nothing
 * here is recorded until `onGesture` is answered with an edit.
 */
export function useLocatorGestures({
  enabled,
  addLocator,
  locators,
  selection,
  visible,
  canSelect = true,
  beats,
  durationSec,
  view,
  width,
  onGesture,
}: {
  /** The dock can edit: lines can be dragged and, with `addLocator`, added. Without it a click still moves the play line. */
  enabled: boolean
  /** The Add locator button is on: a click on empty waveform adds a locator instead of moving the play line. */
  addLocator: boolean
  /** Every locator in time order (the filter does not apply to neighbours). */
  locators: readonly Placed[]
  /** Every selected line; with more than one, a press on one of them drags them all. */
  selection: readonly SelectedSlot[]
  /** The lines the filter shows: only these can be selected by a band. Defaults to every locator. */
  visible?: readonly Placed[]
  /** Several lines can be selected (the dock has a way to take the choice). Without it a drag on empty waveform does nothing. */
  canSelect?: boolean
  /** The beats the tracker found; a dragged line takes one within DRAG_SNAP_SEC of the pointer unless Shift is held. Null: no snapping. */
  beats: readonly DetectedBeat[] | null
  durationSec: number
  view: DockView
  width: number
  onGesture(gesture: Gesture): void
}) {
  const press = useRef<Press | null>(null)
  const [drag, setDrag] = useState<{ slot: Slot; x: number; timeSec: number; deltaSec: number | null } | null>(null)

  const [band, setBand] = useState<Band | null>(null)
  const shown = visible ?? locators

  const cancel = useCallback(() => {
    press.current = null
    setDrag(null)
    setBand(null)
  }, [])

  useEffect(() => {
    if (!enabled) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && press.current !== null) cancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enabled, cancel])

  const onDown = useCallback(
    ({ x }: PointerPoint, slot: Slot | null) => {
      // Without editing rights only a press on empty waveform is followed: it can still be a click that seeks.
      if (!enabled && slot !== null) return
      let low = 0
      let high = durationSec
      let group: Press['group'] = null
      if (slot !== null) {
        const index = locators.findIndex((locator) => locator.bar === slot.bar && locator.passIndex === slot.passIndex)
        if (index > 0) low = locators[index - 1].timeSec + NEIGHBOUR_GAP_SEC
        if (index !== -1 && index < locators.length - 1) high = locators[index + 1].timeSec - NEIGHBOUR_GAP_SEC
        if (index !== -1 && selection.length > 1 && isSelected(selection, slot)) {
          group = { slots: selection.map(({ bar, passIndex }) => ({ bar, passIndex })), anchorSec: locators[index].timeSec, ...deltaLimits(locators, selection, durationSec) }
        }
      }
      press.current = { x, slot, low, high, dragging: false, group }
    },
    [enabled, locators, selection, durationSec],
  )

  /** The line's place under the pointer, clamped between its neighbours. */
  const place = useCallback(
    (current: Press, x: number, free: boolean) => {
      const clampedX = Math.min(timeToX(current.high, view, width), Math.max(timeToX(current.low, view, width), x))
      const pointerSec = clampedX === x ? xToTime(x, view, width) : x < clampedX ? current.low : current.high
      const beatSec = free || beats === null ? null : nearestBeat(pointerSec, beats, DRAG_SNAP_SEC)
      const snapped = beatSec !== null && beatSec >= current.low && beatSec <= current.high
      const timeSec = snapped ? beatSec : pointerSec
      return { x: snapped ? timeToX(timeSec, view, width) : clampedX, timeSec, deltaSec: null as number | null }
    },
    [view, width, beats],
  )

  /** The pressed line of a group drag under the pointer: it and the rest move by one offset, within the group's limits, onto a beat when one is near. */
  const placeGroup = useCallback(
    (group: NonNullable<Press['group']>, x: number, free: boolean) => {
      const within = (delta: number) => Math.min(group.max, Math.max(group.min, delta))
      let deltaSec = within(xToTime(x, view, width) - group.anchorSec)
      const beatSec = free || beats === null ? null : nearestBeat(group.anchorSec + deltaSec, beats, DRAG_SNAP_SEC)
      if (beatSec !== null && beatSec - group.anchorSec >= group.min && beatSec - group.anchorSec <= group.max) deltaSec = beatSec - group.anchorSec
      const timeSec = group.anchorSec + deltaSec
      return { x: timeToX(timeSec, view, width), timeSec, deltaSec }
    },
    [view, width, beats],
  )

  /** The band from the press to x, both clamped to the waveform, and the selection it makes: the visible lines inside, with Shift after the current selection. */
  const bandAt = useCallback(
    (current: Press, x: number, shiftKey: boolean): Band => {
      const x0 = Math.min(width, Math.max(0, current.x))
      const x1 = Math.min(width, Math.max(0, x))
      const inside = slotsBetween(shown, xToTime(x0, view, width), xToTime(x1, view, width))
      const kept = shiftKey ? selection.map(({ bar, passIndex }) => ({ bar, passIndex })) : []
      return { x0, x1, slots: [...kept, ...inside.filter((slot) => !isSelected(kept, slot))] }
    },
    [shown, selection, view, width],
  )

  const onMove = useCallback(
    ({ x, shiftKey }: PointerPoint) => {
      const current = press.current
      if (current === null) return
      if (!current.dragging && Math.abs(x - current.x) <= CLICK_SLOP_PX) return
      if (current.slot === null) {
        if (!enabled || !canSelect) return
        current.dragging = true
        setBand(bandAt(current, x, shiftKey))
        return
      }
      current.dragging = true
      setDrag({ slot: current.slot, ...(current.group === null ? place(current, x, shiftKey) : placeGroup(current.group, x, shiftKey)) })
    },
    [place, placeGroup, bandAt, enabled, canSelect],
  )

  const onUp = useCallback(
    ({ x, shiftKey }: PointerPoint) => {
      const current = press.current
      press.current = null
      setDrag(null)
      setBand(null)
      if (current === null) return
      const moved = Math.abs(x - current.x) > CLICK_SLOP_PX
      if (current.slot !== null) {
        if (current.dragging && current.group !== null) onGesture({ kind: 'drag-group', slots: current.group.slots, deltaSec: placeGroup(current.group, x, shiftKey).deltaSec })
        else if (current.dragging) onGesture({ kind: 'drag', slot: current.slot, timeSec: place(current, x, shiftKey).timeSec })
      } else if (current.dragging) {
        onGesture({ kind: 'select', slots: bandAt(current, x, shiftKey).slots })
      } else if (!moved) {
        const timeSec = xToTime(x, view, width)
        onGesture(enabled && addLocator ? { kind: 'add', timeSec, shift: shiftKey } : { kind: 'seek', timeSec })
      }
    },
    [place, placeGroup, bandAt, onGesture, view, width, enabled, addLocator],
  )

  return { drag, band, onDown, onMove, onUp, cancel }
}
