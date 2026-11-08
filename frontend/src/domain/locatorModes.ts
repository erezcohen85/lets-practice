import { expandPlayOrder } from './playOrder'
import { type ClickMode, type TimingLayer } from './types'

// How the locator edits on the waveform choose between renumbering the later bars and leaving them (UX part 10).

/** The mode of one Delete or Add on the waveform: the "Renumber the bars after" switch decides, and Shift does the other one for that action. */
export function lineModeFor(barLineMode: ClickMode, shift: boolean): ClickMode {
  if (!shift) return barLineMode
  return barLineMode === 'ripple' ? 'plain' : 'ripple'
}

/** The locators an edit moved to another bar, by the bars they had (first and last in play order). They keep their time. */
export interface ShiftedBars {
  first: { bar: number; passIndex: number }
  last: { bar: number; passIndex: number }
  count: number
  direction: 'back' | 'forward'
}

/** Which locators sit on another bar after the edit (found by their time, which a ripple keeps); null when none do. */
export function shiftedBars(before: TimingLayer, after: TimingLayer): ShiftedBars | null {
  const position = new Map(expandPlayOrder(before.playOrder, before.barCount).map((slot) => [`${slot.bar}:${slot.passIndex}`, slot.position]))
  const nowAt = new Map(after.locators.map((locator) => [locator.timeSec, locator]))
  const moved = before.locators.flatMap((locator) => {
    const now = nowAt.get(locator.timeSec)
    if (now === undefined || (now.bar === locator.bar && now.passIndex === locator.passIndex)) return []
    const from = position.get(`${locator.bar}:${locator.passIndex}`)
    const to = position.get(`${now.bar}:${now.passIndex}`)
    return from === undefined || to === undefined ? [] : [{ locator, from, to }]
  })
  if (moved.length === 0) return null
  moved.sort((a, b) => a.from - b.from)
  const slotOf = ({ locator }: { locator: { bar: number; passIndex: number } }) => ({ bar: locator.bar, passIndex: locator.passIndex })
  return { first: slotOf(moved[0]), last: slotOf(moved[moved.length - 1]), count: moved.length, direction: moved[0].to < moved[0].from ? 'back' : 'forward' }
}
