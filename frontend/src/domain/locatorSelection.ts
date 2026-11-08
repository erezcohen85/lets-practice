import { type BarNumber } from './types'

/** One played bar: the bar number and which time it is played. */
export interface Slot { bar: BarNumber; passIndex: number }

export function sameSlot(a: Slot, b: Slot): boolean {
  return a.bar === b.bar && a.passIndex === b.passIndex
}

export function isSelected(selection: readonly Slot[], slot: Slot): boolean {
  return selection.some((chosen) => sameSlot(chosen, slot))
}

/** Shift + click: the slot leaves the selection when it is in it, else it joins at the end (the last one is the one the score follows). */
export function toggleSlot(selection: readonly Slot[], slot: Slot): Slot[] {
  return isSelected(selection, slot) ? selection.filter((chosen) => !sameSlot(chosen, slot)) : [...selection, { bar: slot.bar, passIndex: slot.passIndex }]
}

/** Shift + drag on the label row: every locator whose time is in the range (either end first, ends included), in time order. */
export function slotsBetween(locators: readonly (Slot & { timeSec: number })[], fromSec: number, toSec: number): Slot[] {
  const low = Math.min(fromSec, toSec)
  const high = Math.max(fromSec, toSec)
  return locators
    .filter((locator) => locator.timeSec >= low && locator.timeSec <= high)
    .sort((a, b) => a.timeSec - b.timeSec)
    .map(({ bar, passIndex }) => ({ bar, passIndex }))
}
