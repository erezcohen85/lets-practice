import { ArrowLeftToLine, ArrowRightToLine, FoldHorizontal, Minus, Plus } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { refusalText } from '@/components/editor/useRefusalHint'
import { isTextField } from '@/components/score/useScoreZoom'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { BeatGridControls, type RegridEdit } from '@/components/waveform/BeatGridControls'
import { ContinuePrompt } from '@/components/waveform/ContinuePrompt'
import { DockCanvas } from '@/components/waveform/DockCanvas'
import { type DockLocator, dockLocators } from '@/components/waveform/dockLayout'
import { DOCK_HEIGHT, LABEL_ROW } from '@/components/waveform/LocatorLayer'
import { RelabelField } from '@/components/waveform/RelabelField'
import { TransportRow } from '@/components/waveform/Transport'
import { dockZoomKeyDirection, timeToX, useDockView, xToTime } from '@/components/waveform/useDockView'
import { useDockWheel } from '@/components/waveform/useDockWheel'
import { CLICK_SLOP_PX, type Gesture, useLocatorGestures } from '@/components/waveform/useLocatorGestures'
import { parseBarLabel } from '@/domain/barLabel'
import { type DetectedBeat, type SnapDirection, snapToBeat } from '@/domain/beats'
import { planSnap } from '@/domain/groupMove'
import { Hint } from '@/components/ui/hint'
import { isSelected, slotsBetween, toggleSlot } from '@/domain/locatorSelection'
import { type EditRefusal, type FilledLocator, type MovedLocator } from '@/domain/pieceEdits'
import { type RegridPlan } from '@/domain/regridEdits'
import { reviewCounts, type ReviewItem } from '@/domain/reviewQueue'
import { buildTimeline, slotIndexAt, type SlotTiming } from '@/domain/tempo'
import { type BarNumber, type TimingLayer } from '@/domain/types'
import { useBarNames } from '@/lib/barNamesContext'
import { type ContinueMode } from '@/lib/dataClient'
import { type Transport } from '@/lib/useTransport'
import { cn } from '@/lib/utils'
import { barWithPass, strings } from '@/strings'

const text = strings.dock

/** The Add locator button's icon: a vertical line with a small plus (the prototype's own drawing; lucide has no such icon). */
function AddLocatorIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="size-4">
      <path d="M12 3v18" />
      <path d="M19 6v6" />
      <path d="M16 9h6" />
    </svg>
  )
}

/** One played bar: the bar number and which time it is played. */
export interface SlotRef { bar: BarNumber; passIndex: number }

/** A locator edit the dock asks for. The answer is the reason it was refused, or null when it was applied. */
export type DockEdit =
  | { kind: 'drag'; slot: SlotRef; timeSec: number }
  | { kind: 'drag-group'; slots: SlotRef[]; deltaSec: number }
  | { kind: 'snap-group'; slots: SlotRef[]; direction: SnapDirection; beats: readonly DetectedBeat[]; durationSec: number }
  | RegridEdit
  | { kind: 'add'; timeSec: number; shift: boolean }
  | { kind: 'delete'; slot: SlotRef; shift: boolean }
  | { kind: 'relabel'; slot: SlotRef; bar: BarNumber; passIndex: number }

const NO_FILLED: readonly FilledLocator[] = []
const NO_SLOTS: readonly SlotRef[] = []

export type DockFilter = 'all' | 'review'

export interface WaveformDockProps {
  peaks: readonly number[]
  durationSec: number
  timing: TimingLayer
  /** The beats the beat tracker found, in time order; null or empty: the beat lines divide each bar by its meter and Snap is off. */
  beats?: readonly DetectedBeat[] | null
  items: ReviewItem[]
  moved: readonly MovedLocator[]
  /** The locators the app filled in after an edit and nobody has looked at yet; drawn as changed. */
  filled?: readonly FilledLocator[]
  transport: Transport
  selected: SlotRef | null
  onSelect(slot: SlotRef): void
  /** Every selected line when several are (`selected` is one of them); empty or one line long: just `selected`. */
  group?: readonly SlotRef[]
  /** Shift + click and Shift + drag on the label row choose several lines, Esc clears: the whole selection, in order. Without it the dock selects one line at a time. */
  onSelectGroup?(slots: SlotRef[]): void
  filter: DockFilter
  onFilterChange(filter: DockFilter): void
  beatLines: boolean
  onBeatLinesChange(on: boolean): void
  /** The Renumber switch itself, shown in the dock's toolbar where its Add and Delete act (Decisions 2026-11-03). */
  renumberSwitch?: ReactNode
  /** The recording cannot be played here (still processing): Play is off and a note replaces the hint. */
  unavailable?: boolean
  /** The locator edits: drag a line, click to add, Delete, type a bar number (Shift does the other of renumbering the later bars or leaving them). Without it the dock only selects. */
  onEdit?(edit: DockEdit): EditRefusal | null
  /** Settings > Editing > Continue from my bars: 'ask' offers Continue in a panel over the waveform once 3 bars in a row are checked, 'auto' does it, 'button' leaves it to the toolbar. Left out: 'button'. */
  continueMode?: ContinueMode
  /** Why the last edit was refused, for a few seconds; it takes the place of the hint. */
  refusal?: string | null
  /** Pointer events in seconds. */
  onPointer?(event: { type: 'down' | 'move' | 'up'; timeSec: number; shiftKey: boolean; locator: SlotRef | null }): void
}

/** Until the dock has been measured (and in tests, which have no layout) it is this wide. */
const DEFAULT_WIDTH = 1000
/** A locator line is selectable within this many pixels either side. */
const HIT_PX = 6

const sameSlot = (a: SlotRef | null, b: SlotRef | null) => a !== null && b !== null && a.bar === b.bar && a.passIndex === b.passIndex

function slotTiming(timing: TimingLayer, durationSec: number): SlotTiming[] {
  try {
    return buildTimeline(timing, durationSec)
  } catch {
    // Meters that do not fit the bars (mid-edit) leave the dock without bar spans rather than crashing the editor.
    return []
  }
}

/** Where the lines of a group being dragged would be, in pixels of the stage. */
function groupPreviewXs(selection: readonly SlotRef[], locators: readonly DockLocator[], deltaSec: number, view: { startSec: number; spanSec: number }, width: number): number[] {
  return locators.filter((locator) => isSelected(selection, locator)).map((locator) => timeToX(locator.timeSec + deltaSec, view, width))
}

/** The locator line nearest to x within the hit distance, or null. */
function locatorAt(locators: readonly DockLocator[], x: number, view: { startSec: number; spanSec: number }, width: number): DockLocator | null {
  let best: DockLocator | null = null
  let bestDistance = HIT_PX + Number.EPSILON
  for (const locator of locators) {
    const distance = Math.abs(timeToX(locator.timeSec, view, width) - x)
    if (distance <= bestDistance) {
      best = locator
      bestDistance = distance
    }
  }
  return best
}

/**
 * The waveform dock at the bottom of the Editor (board: Editor.png): the transport row, the All / Review queue filter,
 * the beat lines switch and the zoom, the recording's waveform with the locator lines. Drawn by the app
 * (no wavesurfer.js), always left to right. The window, the filter and the selection are view state and are never recorded.
 */
const SNAP_NAMES: Record<SnapDirection, string> = { previous: strings.dock.snapPrevious, closest: strings.dock.snapClosest, next: strings.dock.snapNext }
const SNAP_KEYS: Record<SnapDirection, string> = { previous: ',', closest: '/', next: '.' }

export function WaveformDock({
  peaks,
  durationSec,
  timing,
  beats = null,
  items,
  moved,
  filled = NO_FILLED,
  transport,
  selected,
  onSelect,
  group = NO_SLOTS,
  onSelectGroup,
  filter,
  onFilterChange,
  beatLines,
  onBeatLinesChange,
  renumberSwitch,
  unavailable = false,
  onEdit,
  continueMode = 'button',
  refusal = null,
  onPointer,
}: WaveformDockProps) {
  const names = useBarNames()
  const { view, zoomIn, zoomOut, zoomAt, centreOn, scrollBy, follow } = useDockView(durationSec)
  const [width, setWidth] = useState(DEFAULT_WIDTH)
  const [stageHeight, setStageHeight] = useState(DOCK_HEIGHT)
  const wrapRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const element = wrapRef.current
    if (element === null || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => setWidth(Math.max(1, Math.round(element.clientWidth))))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  // The stage takes the room the dock region has left under the transport row, so its height is measured, not set.
  useEffect(() => {
    const element = stageRef.current
    if (element === null || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      const measured = Math.round(element.clientHeight)
      if (measured > 0) setStageHeight(measured)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const timeline = useMemo(() => slotTiming(timing, durationSec), [timing, durationSec])
  const locators = useMemo(() => dockLocators(timing, items, moved, filled), [timing, items, moved, filled])
  const shown = useMemo(() => (filter === 'review' ? locators.filter((locator) => locator.open) : locators), [filter, locators])
  // Every selected line: the group when there are several, else the one selected.
  const selectedBar0 = selected?.bar
  const selectedPass0 = selected?.passIndex
  const selection = useMemo<readonly SlotRef[]>(() => {
    if (group.length > 1) return group
    return selectedBar0 === undefined || selectedPass0 === undefined ? NO_SLOTS : [{ bar: selectedBar0, passIndex: selectedPass0 }]
  }, [group, selectedBar0, selectedPass0])
  const open = useMemo(() => reviewCounts(items).open, [items])

  // The window follows the playhead while it plays, and centres on a selection that came from outside the dock (the
  // score, the Review Queue). A line selected here stays under the pointer: the window must not jump while it is clicked.
  // A pan or zoom by wheel takes the window out of the playhead's hands until the next Play or the next selection.
  const { playing, timeSec } = transport
  const byHand = useRef(false)
  useEffect(() => {
    if (playing) byHand.current = false
  }, [playing])
  useEffect(() => {
    if (playing && !byHand.current) follow(timeSec)
  }, [playing, timeSec, follow])
  useDockWheel(stageRef, { view, width, scrollBy, zoomAt, onManual: () => (byHand.current = true) })

  const selfSelected = useRef<SlotRef | null>(null)
  const selectedBar = selected?.bar
  const selectedPass = selected?.passIndex
  const selectedTime = useMemo(() => {
    if (selectedBar === undefined || selectedPass === undefined) return null
    const locator = locators.find((candidate) => candidate.bar === selectedBar && candidate.passIndex === selectedPass)
    if (locator !== undefined) return locator.timeSec
    return timeline.find((entry) => entry.slot.bar === selectedBar && entry.slot.passIndex === selectedPass)?.startSec ?? null
  }, [selectedBar, selectedPass, locators, timeline])
  useEffect(() => {
    if (selectedBar === undefined || selectedPass === undefined || selectedTime === null) return
    byHand.current = false
    if (sameSlot(selfSelected.current, { bar: selectedBar, passIndex: selectedPass })) {
      selfSelected.current = null
      return
    }
    centreOn(selectedTime)
    // Only a change of the selection moves the window, not a later edit of the time it sits at.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBar, selectedPass, centreOn])

  const selectHere = useCallback(
    (slot: SlotRef) => {
      // Only a selection that changes is marked as ours: the effect above clears the mark when it runs, and a press on
      // the line that is already selected (to drag it) makes no change, so a mark left behind would swallow a later one.
      if (!sameSlot(slot, selected)) selfSelected.current = slot
      onSelect(slot)
    },
    [onSelect, selected],
  )

  // A group chosen here keeps the window where it is, like a single line selected here; the page follows its last line.
  const chooseSlots = useCallback(
    (slots: SlotRef[]) => {
      const last = slots.at(-1)
      if (last !== undefined && !sameSlot(last, selected)) selfSelected.current = last
      onSelectGroup?.(slots)
    },
    [onSelectGroup, selected],
  )

  // The locator edits: the gestures on the stage, the field for typing a bar number, and the pointer hint.
  const editing = onEdit !== undefined
  // Add locator: while it is on a click on empty waveform adds a locator; off, it moves the play line (view state, never recorded).
  const [addLocator, setAddLocator] = useState(false)
  const collapse = useRef<SlotRef | null>(null)
  // Shift + drag on the label row: where it started and where the pointer is now, in pixels of the stage.
  const rangePress = useRef<{ x0: number | null; slot: SlotRef | null } | null>(null)
  const [range, setRange] = useState<{ x0: number; x1: number } | null>(null)
  const [relabel, setRelabel] = useState<{ slot: SlotRef; value: string; error: string | null } | null>(null)
  // What the bar-lines-on-the-beats control under the pointer would do: its new lines are drawn dashed, the guesses it moves or removes dimmed.
  const [gridPreview, setGridPreview] = useState<RegridPlan | null>(null)
  const gestures = useLocatorGestures({
    enabled: editing,
    addLocator,
    locators,
    selection,
    visible: shown,
    canSelect: onSelectGroup !== undefined,
    beats,
    durationSec,
    view,
    width,
    onGesture: (gesture: Gesture) => {
      // A band dragged over empty waveform: the lines inside are the selection (none clears it).
      if (gesture.kind === 'select') return chooseSlots(gesture.slots)
      // A group that was dragged stays a group; one that was only pressed on becomes the pressed line when the button is released.
      if (gesture.kind === 'drag-group') collapse.current = null
      if (gesture.kind === 'seek') transport.seek(Math.min(durationSec, Math.max(0, gesture.timeSec)))
      else onEdit?.(gesture)
    },
  })

  const openRelabel = (slot: SlotRef) => {
    if (!editing || !locators.some((locator) => sameSlot(locator, slot))) return
    setRelabel({ slot, value: barWithPass(names.label(slot.bar), slot.passIndex), error: null })
  }
  const closeRelabel = (refocus: boolean) => {
    setRelabel(null)
    if (refocus) stageRef.current?.focus()
  }
  const submitRelabel = () => {
    if (relabel === null || onEdit === undefined) return
    const label = parseBarLabel(relabel.value, names)
    if (label === null) return setRelabel({ ...relabel, error: text.relabelInvalid })
    if (label.bar === relabel.slot.bar && label.passIndex === relabel.slot.passIndex) return closeRelabel(true)
    const reason = onEdit({ kind: 'relabel', slot: relabel.slot, ...label })
    if (reason !== null) return setRelabel({ ...relabel, error: reason === 'out-of-range' ? text.relabelUnknown : refusalText(reason) })
    selectHere(label)
    closeRelabel(true)
  }

  // Snap moves the selected line to the detected beat before it, after it or closest to it, as a drag to that time would:
  // it becomes a fixed point. With no beat that way, or no beats at all, nothing happens.
  const hasBeats = beats !== null && beats.length > 0
  const selectedTimeSec = selected === null ? null : (locators.find((locator) => sameSlot(locator, selected))?.timeSec ?? null)
  const several = selection.length > 1
  // With several lines selected each goes to its own beat; the buttons are on when at least one would.
  const groupPlans = useMemo(
    () =>
      several && beats !== null
        ? {
            previous: planSnap(locators, selection, beats, 'previous', durationSec),
            closest: planSnap(locators, selection, beats, 'closest', durationSec),
            next: planSnap(locators, selection, beats, 'next', durationSec),
          }
        : null,
    [several, beats, locators, selection, durationSec],
  )
  const snapTarget = useCallback(
    (direction: SnapDirection): number | null => (beats === null || selectedTimeSec === null ? null : snapToBeat(selectedTimeSec, beats, direction)),
    [beats, selectedTimeSec],
  )
  const canSnap = (direction: SnapDirection) => editing && (groupPlans === null ? snapTarget(direction) !== null : groupPlans[direction].moves.length > 0)
  // The hover text names the button and its key, and when it is off, why.
  const snapHint = (direction: SnapDirection): string => {
    if (!hasBeats) return text.snapNoBeats
    const name = `${SNAP_NAMES[direction]} (${SNAP_KEYS[direction]})`
    if (canSnap(direction)) return name
    if (!several && selected === null) return `${name}. ${text.snapPickLine}`
    if (several) return `${name}. ${direction === 'closest' ? text.snapNoneClosest : text.snapNone}`
    return `${name}. ${text.snapNoBeatWay[direction]}`
  }
  const snap = useCallback(
    (direction: SnapDirection) => {
      if (onEdit === undefined) return
      if (several) {
        if (beats !== null) onEdit({ kind: 'snap-group', slots: selection.map(({ bar, passIndex }) => ({ bar, passIndex })), direction, beats, durationSec })
        return
      }
      const timeSec = snapTarget(direction)
      if (selected === null || timeSec === null) return
      onEdit({ kind: 'drag', slot: { bar: selected.bar, passIndex: selected.passIndex }, timeSec })
    },
    [snapTarget, onEdit, selected, several, beats, selection, durationSec],
  )
  // The bar lines on the beats controls send their own kind of edit.
  const onEditRegrid = useCallback((edit: RegridEdit): EditRefusal | null => onEdit?.(edit) ?? null, [onEdit])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const direction = event.key === ',' ? 'previous' : event.key === '.' ? 'next' : event.key === '/' ? 'closest' : null
      if (direction === null || event.ctrlKey || event.metaKey || event.altKey || isTextField(event.target)) return
      event.preventDefault()
      snap(direction)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [snap])

  // Escape during a press cancels it (the gestures do that); a group that was pressed on then stays a group.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') collapse.current = null
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // L turns Add locator on and off from anywhere outside a text field; Escape turns it off. While it is on the first Escape does
  // only that (the effect below leaves the selection alone), so the selection stays until the next one.
  useEffect(() => {
    if (!editing) return
    const onKey = (event: KeyboardEvent) => {
      if (isTextField(event.target)) return
      if (event.key === 'Escape') {
        if (addLocator) setAddLocator(false)
      } else if (event.key.toLowerCase() === 'l' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.repeat) {
        event.preventDefault()
        setAddLocator((on) => !on)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editing, addLocator])

  // Escape clears the selection (a drag in progress is cancelled by Escape first and keeps it).
  const dragging = gestures.drag !== null || gestures.band !== null || range !== null
  useEffect(() => {
    if (onSelectGroup === undefined || selection.length === 0 || dragging || addLocator) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || isTextField(event.target)) return
      chooseSlots([])
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onSelectGroup, chooseSlots, selection.length, dragging, addLocator])

  // Delete and Backspace remove the selected locator (Shift is the other of moving the later bars back one or leaving them); never while typing.
  useEffect(() => {
    if (onEdit === undefined || selected === null) return
    const slot = { bar: selected.bar, passIndex: selected.passIndex }
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Delete' && event.key !== 'Backspace') return
      if (event.ctrlKey || event.metaKey || event.altKey || isTextField(event.target)) return
      event.preventDefault()
      onEdit({ kind: 'delete', slot, shift: event.shiftKey })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onEdit, selected])

  // Space plays and pauses, Shift + / - zooms the waveform; neither while typing. A focused button presses itself on
  // Space, so the key is left to it.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const direction = dockZoomKeyDirection(event)
      if (direction > 0) zoomIn()
      else if (direction < 0) zoomOut()
      if (direction !== 0) return
      if ((event.key !== ' ' && event.code !== 'Space') || event.ctrlKey || event.metaKey || event.altKey || event.repeat) return
      if (isTextField(event.target)) return
      if (event.target instanceof HTMLElement && event.target.closest('button, [role="checkbox"], a[href], summary') !== null) return
      event.preventDefault()
      transport.toggle()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [zoomIn, zoomOut, transport])

  const pointer = (type: 'down' | 'move' | 'up', event: React.PointerEvent<HTMLDivElement>) => {
    const stage = stageRef.current
    if (stage === null) return
    const box = stage.getBoundingClientRect()
    const x = event.clientX - box.left
    const hit = locatorAt(shown, x, view, width)
    const slot = hit === null ? null : { bar: hit.bar, passIndex: hit.passIndex }
    if (type === 'move') stage.style.cursor = slot === null ? '' : editing ? 'ew-resize' : 'pointer'
    const point = { x, shiftKey: event.shiftKey }
    const choosing = onSelectGroup !== undefined && (rangePress.current !== null || (type === 'down' && event.shiftKey && (event.clientY - box.top < LABEL_ROW || slot !== null)))
    if (choosing) chooseSeveral(type, event, x, event.clientY - box.top < LABEL_ROW, slot)
    else {
      if (type === 'down') {
        collapse.current = null
        if (slot !== null && isSelected(selection, slot) && several) collapse.current = slot
        else if (slot !== null) selectHere(slot)
        if (editing) {
          try {
            stage.setPointerCapture?.(event.pointerId)
          } catch {
            // A pointer that is already gone cannot be captured; the press then ends on its own.
          }
        }
        gestures.onDown(point, slot)
      } else if (type === 'move') gestures.onMove(point)
      else {
        gestures.onUp(point)
        const pressed = collapse.current
        collapse.current = null
        if (pressed !== null) selectHere(pressed)
      }
    }
    onPointer?.({ type, timeSec: xToTime(x, view, width), shiftKey: event.shiftKey, locator: slot })
  }

  // Shift + click on a line adds it to the selection or takes it out; Shift + drag along the label row selects every line in the range.
  const chooseSeveral = (type: 'down' | 'move' | 'up', event: React.PointerEvent<HTMLDivElement>, x: number, inLabelRow: boolean, slot: SlotRef | null) => {
    if (type === 'down') {
      rangePress.current = { x0: inLabelRow ? x : null, slot }
      if (!inLabelRow) return
      try {
        stageRef.current?.setPointerCapture?.(event.pointerId)
      } catch {
        // A pointer that is already gone cannot be captured; the press then ends on its own.
      }
      return
    }
    const press = rangePress.current
    if (press === null) return
    const swept = press.x0 !== null && Math.abs(x - press.x0) > CLICK_SLOP_PX
    if (type === 'move') {
      if (swept && press.x0 !== null) setRange({ x0: press.x0, x1: x })
      return
    }
    rangePress.current = null
    setRange(null)
    if (swept && press.x0 !== null) {
      const chosen = slotsBetween(shown, xToTime(press.x0, view, width), xToTime(x, view, width))
      if (chosen.length > 0) chooseSlots(chosen)
    } else if (press.slot !== null) {
      chooseSlots(toggleSlot(selection, press.slot))
    }
  }

  // Arrow keys step through the lines the filter shows, from the selected one.
  const onStageKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' && selected !== null && editing) {
      event.preventDefault()
      openRelabel(selected)
      return
    }
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    if (step === 0 || shown.length === 0) return
    event.preventDefault()
    const current = shown.findIndex((locator) => sameSlot(locator, selected))
    const next = shown[current === -1 ? (step > 0 ? 0 : shown.length - 1) : Math.min(shown.length - 1, Math.max(0, current + step))]
    selectHere({ bar: next.bar, passIndex: next.passIndex })
    if (next.timeSec < view.startSec || next.timeSec > view.startSec + view.spanSec) centreOn(next.timeSec)
  }

  // While the band is dragged the lines inside it show as selected, and the old selection steps aside.
  const bandSlots = gestures.band === null ? null : gestures.band.slots
  const selectedLocator = selected === null ? null : selected
  const relabelX = relabel === null ? 0 : timeToX(locators.find((locator) => sameSlot(locator, relabel.slot))?.timeSec ?? 0, view, width)
  const playheadSlot = (() => {
    const index = slotIndexAt(timeline, timeSec)
    return index === -1 ? null : timeline[index].slot
  })()
  const chipSlot = !playing && selectedLocator !== null ? selectedLocator : playheadSlot

  const playheadX = timeToX(timeSec, view, width)
  const playheadVisible = timeSec >= view.startSec && timeSec <= view.startSec + view.spanSec

  return (
    <section aria-label={text.region} className="flex h-full flex-col gap-2 px-6 pb-2" dir="ltr">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <TransportRow transport={transport} unavailable={unavailable} bar={chipSlot?.bar ?? null} passIndex={chipSlot?.passIndex ?? 0} refusal={refusal} movedCount={moved.length} />
        {/* A small basis, so that the controls sit beside the transport and wrap among themselves (two rows fit its height) before they drop below it as one block. */}
        <div className="flex max-w-full grow basis-[26rem] flex-wrap items-center justify-end gap-x-3 gap-y-2">
          {/* The toolbar is crowded below 1700 px; the group keeps its name. */}
          <span className="text-sm text-text-soft max-[1699px]:hidden">{text.locators}</span>
          <div role="group" aria-label={text.locators} className="flex rounded-lg border border-border bg-surface p-0.5">
            {(
              [
                ['all', text.filterAll(locators.length)],
                ['review', text.filterReview(open)],
              ] as const
            ).map(([value, label]) => (
              <Button
                key={value}
                variant={filter === value ? 'default' : 'ghost'}
                size="sm"
                aria-pressed={filter === value}
                onClick={() => onFilterChange(value)}
              >
                {label}
              </Button>
            ))}
          </div>
          {editing && (
            <Button
              variant={addLocator ? 'default' : 'outline'}
              size="lg"
              aria-pressed={addLocator}
              title={text.addLocator}
              className="px-3 text-sm font-semibold"
              onClick={() => setAddLocator((on) => !on)}
            >
              <AddLocatorIcon />
              {text.addLocator}
            </Button>
          )}
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <Checkbox checked={beatLines} onCheckedChange={onBeatLinesChange} />
            <span>{text.beatLines}</span>
          </label>
          {renumberSwitch}
          <div role="group" aria-label={text.snapGroup} className="flex items-center gap-1">
            <Hint text={snapHint('previous')}>
              <Button variant="outline" size="icon-sm" aria-label={text.snapPrevious} disabled={!canSnap('previous')} onClick={() => snap('previous')}>
                <ArrowLeftToLine aria-hidden />
              </Button>
            </Hint>
            <Hint text={snapHint('closest')}>
              <Button variant="outline" size="icon-sm" aria-label={text.snapClosest} disabled={!canSnap('closest')} onClick={() => snap('closest')}>
                <FoldHorizontal aria-hidden />
              </Button>
            </Hint>
            <Hint text={snapHint('next')}>
              <Button variant="outline" size="icon-sm" aria-label={text.snapNext} disabled={!canSnap('next')} onClick={() => snap('next')}>
                <ArrowRightToLine aria-hidden />
              </Button>
            </Hint>
          </div>
          <BeatGridControls timing={timing} lines={locators} selection={selection} beats={beats} durationSec={durationSec} editing={editing} onEdit={onEditRegrid} onPreview={setGridPreview} />
          <div role="group" aria-label={text.zoom} className="flex items-center gap-2 text-sm">
            {/* Between these widths the label alone would push the buttons onto a row of their own, out of the waveform's height. */}
            <span className="text-text-soft min-[960px]:max-[1339px]:hidden">{text.zoom}</span>
            <Hint text={text.zoomOut}>
              <Button variant="outline" size="icon-sm" aria-label={text.zoomOut} onClick={zoomOut}>
                <Minus aria-hidden />
              </Button>
            </Hint>
            <Hint text={text.zoomIn}>
              <Button variant="outline" size="icon-sm" aria-label={text.zoomIn} onClick={zoomIn}>
                <Plus aria-hidden />
              </Button>
            </Hint>
          </div>
        </div>
      </div>

      <div ref={wrapRef} className="relative flex min-h-0 flex-1 flex-col">
        <div
          ref={stageRef}
          data-slot="dock-stage"
          data-view-start={view.startSec}
          data-view-span={view.spanSec}
          role="group"
          aria-label={text.graph}
          tabIndex={0}
          className={cn('min-h-28 flex-1 touch-none overflow-hidden rounded-md outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/50', addLocator && 'cursor-copy')}
          onPointerDown={(event) => pointer('down', event)}
          onPointerMove={(event) => pointer('move', event)}
          onPointerUp={(event) => pointer('up', event)}
          onPointerCancel={gestures.cancel}
          onDoubleClick={(event) => {
            const stageBox = event.currentTarget.getBoundingClientRect()
            const hit = locatorAt(shown, event.clientX - stageBox.left, view, width)
            if (hit !== null) openRelabel({ bar: hit.bar, passIndex: hit.passIndex })
          }}
          onKeyDown={onStageKey}
        >
          <DockCanvas
            peaks={peaks}
            durationSec={durationSec}
            view={view}
            width={width}
            height={stageHeight}
            timeline={timeline}
            beats={beats}
            locators={shown}
            moved={moved}
            selected={bandSlots === null ? selected : (bandSlots.at(-1) ?? null)}
            group={bandSlots ?? selection}
            dimmed={gridPreview?.deletes ?? NO_SLOTS}
            beatLines={beatLines}
          />
        </div>
        {/* Over the top of the waveform, never in the flow: the stage keeps its height whether it shows or not. */}
        <ContinuePrompt timing={timing} beats={beats} durationSec={durationSec} mode={continueMode} editing={editing} onEdit={onEditRegrid} onPreview={setGridPreview} />
        {gestures.drag !== null &&
          (gestures.drag.deltaSec === null ? [gestures.drag.x] : groupPreviewXs(selection, locators, gestures.drag.deltaSec, view, width)).map((previewX, index) => (
            <div
              key={index}
              data-slot="dock-drag-preview"
              aria-hidden="true"
              className="pointer-events-none absolute w-0.5 bg-selected"
              style={{ left: 0, top: 0, height: stageHeight, transform: `translateX(${previewX}px)` }}
            />
          ))}
        {gridPreview?.adds
          .filter((timeSec) => timeSec >= view.startSec && timeSec <= view.startSec + view.spanSec)
          .map((timeSec) => (
            <div
              key={timeSec}
              data-slot="dock-grid-preview"
              aria-hidden="true"
              className="pointer-events-none absolute w-0 border-s-2 border-dashed border-text-soft opacity-60"
              style={{ left: 0, top: 0, height: stageHeight, transform: `translateX(${timeToX(timeSec, view, width)}px)` }}
            />
          ))}
        {gestures.band !== null && (
          <div
            data-slot="dock-band"
            role="presentation"
            className="pointer-events-none absolute border border-selected bg-selected/15"
            style={{ left: Math.min(gestures.band.x0, gestures.band.x1), width: Math.abs(gestures.band.x1 - gestures.band.x0), top: 0, height: stageHeight }}
          />
        )}
        {range !== null && (
          <div
            data-slot="dock-range-preview"
            role="presentation"
            title={text.rangePreview}
            className="pointer-events-none absolute bg-selected/15"
            style={{ left: Math.min(range.x0, range.x1), width: Math.abs(range.x1 - range.x0), top: 0, height: stageHeight }}
          />
        )}
        {relabel !== null && (
          <RelabelField
            x={relabelX}
            width={width}
            value={relabel.value}
            error={relabel.error}
            onChange={(value) => setRelabel({ ...relabel, value, error: null })}
            onSubmit={submitRelabel}
            onCancel={() => closeRelabel(true)}
            onBlur={() => closeRelabel(false)}
          />
        )}
        {/* Its own element, so the frame loop moves one div and never redraws the waveform. */}
        <div
          data-slot="dock-playhead"
          aria-hidden="true"
          className={cn('pointer-events-none absolute inset-y-0 w-0.5 bg-foreground')}
          style={{ left: 0, transform: `translateX(${playheadX}px)`, display: playheadVisible ? undefined : 'none' }}
        />
      </div>
    </section>
  )
}
