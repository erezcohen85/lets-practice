import { type Fakes } from '@/lib/fakes'

/**
 * The demo piece as if its recording played the repeat of bars 9-16 a second time without locators for it: every
 * locator after the second pass sits 8 bars of time later. A play order edit that adds that third pass then finds room
 * for it between its neighbours (and keeps the labels), as opposed to a recording that has no such repeat (setPlayOrder).
 */
export function makeRoomForRepeat(fakes: Fakes, pieceId: string): void {
  const map = fakes.store.maps.get(pieceId)!
  const bar = map.timing.locators[1].timeSec - map.timing.locators[0].timeSec
  map.timing = { ...map.timing, locators: map.timing.locators.map((locator, i) => (i >= 24 ? { ...locator, timeSec: locator.timeSec + 8 * bar } : locator)) }
}
