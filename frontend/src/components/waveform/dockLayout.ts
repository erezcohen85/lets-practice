import { type DockView } from '@/components/waveform/useDockView'
import { type FilledLocator, type MovedLocator } from '@/domain/pieceEdits'
import { expandPlayOrder } from '@/domain/playOrder'
import { locatorsBySlot } from '@/domain/renumber'
import { type ReviewItem } from '@/domain/reviewQueue'
import { type BarNumber, type TimingLayer } from '@/domain/types'

/** A locator as the dock draws it. open: an item of the Review Queue that is not checked; moved: dragged by hand; filled: given its time by the app after an edit and not looked at yet. */
export interface DockLocator {
  bar: BarNumber
  passIndex: number
  timeSec: number
  confirmed: boolean
  open: boolean
  moved: boolean
  filled: boolean
}

export type LocatorState = 'selected' | 'problem' | 'filled' | 'anchor' | 'plain'

const slotKey = (bar: BarNumber, passIndex: number) => `${bar}:${passIndex}`

/** The locators of the piece, one per play slot that has one, in play order. */
export function dockLocators(timing: TimingLayer, items: readonly ReviewItem[], moved: readonly MovedLocator[], filled: readonly FilledLocator[] = []): DockLocator[] {
  const openItems = new Set(items.flatMap((item) => (item.kind === 'flag' && !item.checked ? [slotKey(item.bar, item.passIndex)] : [])))
  const movedSlots = new Set(moved.map((entry) => slotKey(entry.bar, entry.passIndex)))
  const filledSlots = new Set(filled.map((entry) => slotKey(entry.bar, entry.passIndex)))
  const located = locatorsBySlot(timing)
  return expandPlayOrder(timing.playOrder, timing.barCount).flatMap((slot): DockLocator[] => {
    const locator = located[slot.position]
    if (locator === null) return []
    const key = slotKey(slot.bar, slot.passIndex)
    return [{ bar: slot.bar, passIndex: slot.passIndex, timeSec: locator.timeSec, confirmed: locator.confirmed, open: openItems.has(key), moved: movedSlots.has(key), filled: filledSlots.has(key) }]
  })
}

/** How a locator is coloured: selected, then problem (an open flag), then filled (changed by the app, in the colour of the hand-moved ones), then anchor (confirmed, which a hand-moved one is). */
export function locatorState(locator: DockLocator, selected: { bar: BarNumber; passIndex: number } | null): LocatorState {
  if (selected !== null && selected.bar === locator.bar && selected.passIndex === locator.passIndex) return 'selected'
  if (locator.open && !locator.moved) return 'problem'
  if (locator.filled && !locator.confirmed) return 'filled'
  return locator.confirmed ? 'anchor' : 'plain'
}

/** One bar of the waveform: its left edge in pixels and the loudest peak of its time (0..1). */
export interface WaveBar { x: number; amplitude: number }

/** The peaks of the window as columns `pitch` pixels apart; each takes the loudest peak of its time, so a short loud sound still shows. */
export function windowBars(peaks: readonly number[], durationSec: number, view: DockView, width: number, pitch = 4): WaveBar[] {
  const count = Math.floor(width / pitch)
  if (peaks.length === 0 || !(durationSec > 0) || count < 1) return []
  const bars: WaveBar[] = []
  for (let column = 0; column < count; column++) {
    const from = view.startSec + (column * view.spanSec) / count
    const to = view.startSec + ((column + 1) * view.spanSec) / count
    if (to <= 0 || from >= durationSec) continue
    const first = Math.min(peaks.length - 1, Math.max(0, Math.floor((from * peaks.length) / durationSec)))
    const last = Math.min(peaks.length, Math.max(first + 1, Math.ceil((to * peaks.length) / durationSec)))
    let amplitude = 0
    for (let i = first; i < last; i++) if (peaks[i] > amplitude) amplitude = peaks[i]
    bars.push({ x: column * pitch, amplitude })
  }
  return bars
}

/** Seconds as m:ss.s (tenths cut off, not rounded, so 59.96 s reads 0:59.9 and never 0:60.0). */
export function formatClock(sec: number): string {
  const tenths = Math.floor(Math.max(0, sec) * 10 + 1e-6)
  const whole = Math.floor(tenths / 10)
  const minutes = Math.floor(whole / 60)
  const seconds = whole % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}.${tenths % 10}`
}

const BASELINE_INSET = 14

/** Where the baseline and the handles sit in a stage of this height. */
export const baselineY = (height: number) => height - BASELINE_INSET
