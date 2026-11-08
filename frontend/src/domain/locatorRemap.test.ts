import { describe, expect, it } from 'vitest'
import { emptyRunsCannotFit, relabelInPlayOrder, remapLocators } from './locatorRemap'
import { type EditorDoc } from './pieceEdits'
import { unmatchedSlots } from './renumber'
import { expandPlayOrder } from './playOrder'
import { type Locator } from './types'

const loc = (bar: number, passIndex: number, timeSec: number): Locator => ({ bar, passIndex, timeSec, confirmed: true })

describe('remapLocators', () => {
  it('maps locators onto the slots in play order, keeping their times', () => {
    const slots = expandPlayOrder([{ from: 1, to: 3 }], 3)
    const { kept, dropped } = remapLocators(slots, [loc(1, 0, 1), loc(2, 0, 2), loc(3, 0, 3)])
    expect(kept.map((l) => [l.bar, l.passIndex, l.timeSec])).toEqual([[1, 0, 1], [2, 0, 2], [3, 0, 3]])
    expect(dropped).toEqual([])
  })

  it('on a tie each locator takes the earliest slot it can', () => {
    // One locator of bar 2, two slots of bar 2: the first slot gets it.
    const slots = expandPlayOrder([{ from: 1, to: 2 }, { from: 2, to: 2 }], 2)
    const { kept } = remapLocators(slots, [loc(1, 0, 1), loc(2, 0, 2)])
    expect(kept.map((l) => `${l.bar}:${l.passIndex}`)).toEqual(['1:0', '2:0'])
  })

  it('drops a locator whose bar is not played, and leaves the others where they fit', () => {
    const slots = expandPlayOrder([{ from: 1, to: 2 }], 3)
    const { kept, dropped } = remapLocators(slots, [loc(1, 0, 1), loc(3, 0, 2), loc(2, 0, 3)])
    expect(kept.map((l) => l.bar)).toEqual([1, 2])
    expect(dropped.map((l) => l.bar)).toEqual([3])
  })

  it('works on time order whatever order the locators come in, and does not change them', () => {
    const slots = expandPlayOrder([{ from: 1, to: 3 }], 3)
    const given = [loc(3, 0, 3), loc(1, 0, 1), loc(2, 0, 2)]
    const frozen = JSON.stringify(given)
    const { kept } = remapLocators(slots, given)
    expect(kept.map((l) => l.bar)).toEqual([1, 2, 3])
    expect(JSON.stringify(given)).toBe(frozen)
  })

  it('drops a second locator at the same time', () => {
    const slots = expandPlayOrder([{ from: 1, to: 2 }], 2)
    const { kept, dropped } = remapLocators(slots, [loc(1, 0, 1), loc(2, 0, 1)])
    expect(kept).toHaveLength(1)
    expect(dropped).toHaveLength(1)
  })

  it('has nothing to do with no locators or no slots', () => {
    expect(remapLocators(expandPlayOrder([{ from: 1, to: 2 }], 2), [])).toEqual({ kept: [], dropped: [] })
    expect(remapLocators([], [loc(1, 0, 1)]).dropped).toHaveLength(1)
  })
})

/** A doc whose play order is 1-4, 1-4, 5-8 (12 slots) with the given locators. */
function docWith(locators: Locator[], moved?: EditorDoc['moved'], filled?: EditorDoc['filled']): EditorDoc {
  return {
    timing: { barCount: 8, playOrder: [{ from: 1, to: 4 }, { from: 1, to: 4 }, { from: 5, to: 8 }], meters: [{ fromBar: 1, numerator: 4, denominator: 4 }], marks: [], locators },
    pages: [],
    ...(moved === undefined ? {} : { moved }),
    ...(filled === undefined ? {} : { filled }),
  }
}
/** Eight locators labelled as the order 1-8 once, at 1..8 s: the first four are right under 1-4, 1-4, 5-8. */
const straight = (): Locator[] => Array.from({ length: 8 }, (_, i) => loc(i + 1, 0, i + 1))
const key = (l: { bar: number; passIndex: number }) => `${l.bar}:${l.passIndex}`

describe('relabelInPlayOrder', () => {
  it('lays the locators, in time order, along the slots in play order, and never changes a time', () => {
    const doc = docWith(straight())
    const result = relabelInPlayOrder(doc)
    if (!result.ok) throw new Error(result.reason)
    expect(result.doc.timing.locators.map(key)).toEqual(['1:0', '2:0', '3:0', '4:0', '1:1', '2:1', '3:1', '4:1'])
    expect(result.doc.timing.locators.map((l) => l.timeSec)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect(result.droppedLocators).toEqual([])
    expect(result.label).toEqual({ kind: 'relabel-in-order', count: 4 })
    expect(unmatchedSlots(result.doc.timing).map(key)).toEqual(['5:0', '6:0', '7:0', '8:0'])
  })

  it('a locator whose label changes loses confirmed and checked; one whose label stays keeps them; flags stay', () => {
    const flag = { kind: 'low-confidence' } as unknown as NonNullable<Locator['flags']>[number]
    const locators = straight().map((l) => ({ ...l, checked: true, flags: [flag] }))
    const result = relabelInPlayOrder(docWith(locators))
    if (!result.ok) throw new Error(result.reason)
    const out = result.doc.timing.locators
    expect(out.slice(0, 4).every((l) => l.confirmed && l.checked === true)).toBe(true)
    expect(out.slice(4).every((l) => !l.confirmed && l.checked !== true)).toBe(true)
    expect(out.every((l) => l.flags?.[0] === flag)).toBe(true)
  })

  it('works on time order whatever order the locators come in, and does not change its input', () => {
    const given = straight().reverse()
    const doc = docWith(given)
    const frozen = JSON.stringify(doc)
    const result = relabelInPlayOrder(doc)
    if (!result.ok) throw new Error(result.reason)
    expect(result.doc.timing.locators.map((l) => l.timeSec)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect(JSON.stringify(doc)).toBe(frozen)
  })

  it('drops the surplus locators at the end and reports them', () => {
    const many = Array.from({ length: 14 }, (_, i) => loc((i % 8) + 1, Math.floor(i / 8), i + 1))
    const result = relabelInPlayOrder(docWith(many))
    if (!result.ok) throw new Error(result.reason)
    expect(result.doc.timing.locators).toHaveLength(12)
    expect(result.droppedLocators.map((l) => l.timeSec)).toEqual([13, 14])
    expect(unmatchedSlots(result.doc.timing)).toEqual([])
  })

  it('refuses when every locator already sits on its slot', () => {
    const inStep = [loc(1, 0, 1), loc(2, 0, 2), loc(3, 0, 3), loc(4, 0, 4), loc(1, 1, 5)]
    expect(relabelInPlayOrder(docWith(inStep))).toEqual({ ok: false, reason: 'already-in-order' })
    expect(relabelInPlayOrder(docWith([]))).toEqual({ ok: false, reason: 'already-in-order' })
  })

  it('moved and filled follow their locator by time to its new label', () => {
    const doc = docWith(straight(), [{ bar: 5, passIndex: 0, fromSec: 4.5, wasConfirmed: true }], [{ bar: 6, passIndex: 0 }])
    const result = relabelInPlayOrder(doc)
    if (!result.ok) throw new Error(result.reason)
    expect(result.doc.moved).toEqual([{ bar: 1, passIndex: 1, fromSec: 4.5, wasConfirmed: true }])
    expect(result.doc.filled).toEqual([{ bar: 2, passIndex: 1 }])
  })

  it('drops a locator that shares its time with the one before it', () => {
    const result = relabelInPlayOrder(docWith([loc(5, 0, 1), loc(6, 0, 1), loc(7, 0, 2)]))
    if (!result.ok) throw new Error(result.reason)
    expect(result.doc.timing.locators.map((l) => [key(l), l.timeSec])).toEqual([['1:0', 1], ['2:0', 2]])
    expect(result.droppedLocators.map(key)).toEqual(['6:0'])
  })
})

describe('emptyRunsCannotFit', () => {
  const eight = Array.from({ length: 8 }, (_, i) => loc(i + 1, 0, i + 1)) // 1 s median
  const longer = expandPlayOrder([{ from: 1, to: 8 }, { from: 5, to: 8 }], 8)

  it('measures an empty run between two locators against the bars it needs at the median', () => {
    const slots = expandPlayOrder([{ from: 1, to: 4 }, { from: 1, to: 4 }, { from: 5, to: 8 }], 8)
    const kept = (gapAfter4: number) => [1, 2, 3, 4].map((b) => loc(b, 0, b)).concat([5, 6, 7, 8].map((b) => loc(b, 0, b + gapAfter4)))
    // four empty bars and the bar before them: 5 bars, of which 3.75 s must be there at a 1 s median
    expect(emptyRunsCannotFit(slots, eight, kept(0), undefined)).toBe(true)
    expect(emptyRunsCannotFit(slots, eight, kept(1), undefined)).toBe(true) // a 2 s gap
    expect(emptyRunsCannotFit(slots, eight, kept(2.5), undefined)).toBe(true) // a 3.5 s gap
    expect(emptyRunsCannotFit(slots, eight, kept(3), undefined)).toBe(false) // a 4 s gap
  })

  it('counts the run at the end against the recording when its length is known, and leaves it out when not', () => {
    const kept = eight
    expect(emptyRunsCannotFit(longer, eight, kept, 9)).toBe(true) // 1 s left for 4 bars
    expect(emptyRunsCannotFit(longer, eight, kept, 30)).toBe(false)
    expect(emptyRunsCannotFit(longer, eight, kept, undefined)).toBe(false)
  })

  it('counts the run at the start against the time of the first locator when the recording length is known', () => {
    const slots = expandPlayOrder([{ from: 1, to: 8 }], 8)
    const kept = [5, 6, 7, 8].map((b) => loc(b, 0, b - 4.5)) // bars 1-4 have no time, and the first locator is at 0.5 s: no room for 4 bars before it
    expect(emptyRunsCannotFit(slots, eight, kept, 30)).toBe(true)
    expect(emptyRunsCannotFit(slots, eight, kept, undefined)).toBe(false)
  })

  it('cannot tell with fewer than two locators', () => {
    expect(emptyRunsCannotFit(longer, [loc(1, 0, 1)], [loc(1, 0, 1)], 30)).toBe(false)
  })
})
