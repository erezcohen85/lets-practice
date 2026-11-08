import { expectOrdered, repeatMap, straightMap, voltaMap } from '@/domain/fixtures'
import {
  addLocator,
  chainedLocators,
  confirmLocator,
  deleteBar,
  deleteBarFromTiming,
  deleteFromRests,
  deleteLocator,
  insertBar,
  insertBarInTiming,
  insertIntoRests,
  locatorsBySlot,
  meterAt,
  moveLocator,
  relabelLocator,
  splitBar,
  splitBox,
  unmatchedSlots,
} from '@/domain/renumber'
import { demoDoc } from '@/domain/pieceFixtures'
import { type BarBox, type Locator, type MeterChange, type PageLayer, type ReviewFlag, type TimingLayer } from '@/domain/types'

/** "bar:pass" labels, sorted, so a test compares which locators without caring about their order. */
function ids(locators: Locator[]): string[] {
  return locators.map((l) => `${l.bar}:${l.passIndex}`).sort()
}

function withMeters(timing: TimingLayer, meters: MeterChange[]): TimingLayer {
  return { ...timing, meters }
}

function withRows(timing: TimingLayer, playOrder: TimingLayer['playOrder']): TimingLayer {
  return { ...timing, playOrder }
}

/** The timing layer without the locator of one (bar, pass): that slot is unmatched. */
function withoutLocator(timing: TimingLayer, bar: number, passIndex: number): TimingLayer {
  return { ...timing, locators: timing.locators.filter((l) => !(l.bar === bar && l.passIndex === passIndex)) }
}

/** The box a bar split would leave behind for the old bar, put into the page layer. */
function withBox(page: PageLayer, box: BarBox): PageLayer {
  return { ...page, bars: page.bars.map((b) => (b.bar === box.bar ? box : b)) }
}

const FOUR_FOUR = { numerator: 4, denominator: 4 }
const THREE_FOUR = { numerator: 3, denominator: 4 }

describe('meterAt', () => {
  it('returns the only meter for every bar', () => {
    const meters: MeterChange[] = [{ fromBar: 1, ...FOUR_FOUR }]

    expect(meterAt(meters, 1)).toEqual(FOUR_FOUR)
    expect(meterAt(meters, 9)).toEqual(FOUR_FOUR)
  })

  it('switches at the bar of a meter change and holds until the next change', () => {
    const meters: MeterChange[] = [
      { fromBar: 1, ...FOUR_FOUR },
      { fromBar: 5, ...THREE_FOUR },
      { fromBar: 8, numerator: 6, denominator: 8 },
    ]

    expect(meterAt(meters, 4)).toEqual(FOUR_FOUR)
    expect(meterAt(meters, 5)).toEqual(THREE_FOUR)
    expect(meterAt(meters, 7)).toEqual(THREE_FOUR)
    expect(meterAt(meters, 8)).toEqual({ numerator: 6, denominator: 8 })
  })

  it('returns a plain meter without fromBar', () => {
    expect(meterAt([{ fromBar: 1, ...THREE_FOUR }], 2)).toStrictEqual(THREE_FOUR)
  })

  it('falls back to 4/4 when there are no meter changes', () => {
    expect(meterAt([], 3)).toEqual(FOUR_FOUR)
  })
})

describe('locatorsBySlot', () => {
  it('lists the locator of each slot by play position', () => {
    const { timing } = repeatMap()

    const bySlot = locatorsBySlot(timing)

    expect(bySlot).toHaveLength(12)
    expect(bySlot[0]).toEqual({ bar: 1, passIndex: 0, timeSec: 1, confirmed: false })
    expect(bySlot[4]).toEqual({ bar: 1, passIndex: 1, timeSec: 9, confirmed: false })
    expect(bySlot[11]).toEqual({ bar: 8, passIndex: 0, timeSec: 23, confirmed: false })
  })

  it('puts null where a slot has no locator', () => {
    const { timing } = repeatMap()

    const bySlot = locatorsBySlot(withoutLocator(timing, 2, 1))

    expect(bySlot).toHaveLength(12)
    expect(bySlot[5]).toBeNull()
    expect(bySlot.filter((l) => l === null)).toHaveLength(1)
  })
})

describe('unmatchedSlots', () => {
  it('is empty when every slot has a locator', () => {
    expect(unmatchedSlots(repeatMap().timing)).toEqual([])
  })

  it('lists the slots without a locator, in play order', () => {
    const { timing } = repeatMap()
    const edited = withoutLocator(withoutLocator(timing, 3, 0), 2, 1)

    expect(unmatchedSlots(edited)).toEqual([
      { position: 2, bar: 3, passIndex: 0 },
      { position: 5, bar: 2, passIndex: 1 },
    ])
  })
})

describe('splitBox', () => {
  const box: BarBox = { bar: 3, pageIndex: 1, x: 900, y: 500, w: 400, h: 200 }

  it('cuts a box in two at x: the left keeps the bar, the right is a new box on the same page', () => {
    const { left, right } = splitBox(box, 1100)

    expect(left).toEqual({ bar: 3, pageIndex: 1, x: 900, y: 500, w: 200, h: 200 })
    expect(right).toEqual({ pageIndex: 1, x: 1100, y: 500, w: 200, h: 200 })
    expect('bar' in right).toBe(false)
  })

  it('throws a RangeError when x is not inside the box', () => {
    expect(() => splitBox(box, 900)).toThrow(RangeError)
    expect(() => splitBox(box, 1300)).toThrow(RangeError)
    expect(() => splitBox(box, 100)).toThrow(RangeError)
  })

  it('does not mutate its input', () => {
    const before = structuredClone(box)

    splitBox(box, 1000)

    expect(box).toEqual(before)
  })
})

describe('insertBar (plain)', () => {
  it('splits bar 3 of a straight map: new bar 4 has a box, old bars shift, locators keep their numbers', () => {
    const { timing, page } = straightMap(8)
    const { left, right } = splitBox(page.bars[2], page.bars[2].x + 200)

    const result = insertBar(timing, withBox(page, left), 4, right, 'plain')

    expectOrdered(result.timing)
    expect(result.timing.barCount).toBe(9)
    expect(result.timing.playOrder).toEqual([{ from: 1, to: 9 }])
    expect(result.page.bars.map((b) => b.bar)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(result.page.bars[2]).toEqual(left)
    expect(result.page.bars[3]).toEqual({ ...right, bar: 4 })
    expect(result.page.bars[4]).toEqual({ ...page.bars[3], bar: 5 })
    expect(result.page.bars[8]).toEqual({ ...page.bars[7], bar: 9 })
    // plain: the locators stay on their numbers; bar 4's locator still says bar 4
    expect(result.timing.locators).toEqual(timing.locators)
    expect(result.timing.locators.find((l) => l.bar === 4)?.timeSec).toBe(7)
    expect(result.droppedLocators).toEqual([])
    expect(unmatchedSlots(result.timing)).toEqual([{ position: 8, bar: 9, passIndex: 0 }])
    expect(result.page.partId).toBe(page.partId)
  })

  it('inserts before bar 1: every box shifts, rows widen, the first meter stays at bar 1', () => {
    const { timing, page } = straightMap(8)
    const meters: MeterChange[] = [
      { fromBar: 1, ...FOUR_FOUR },
      { fromBar: 5, ...THREE_FOUR },
    ]
    const newBox = { pageIndex: 0, x: 0, y: 200, w: 100, h: 200 }

    const result = insertBar(withMeters(timing, meters), page, 1, newBox, 'plain')

    expectOrdered(result.timing)
    expect(result.timing.barCount).toBe(9)
    expect(result.timing.playOrder).toEqual([{ from: 1, to: 9 }])
    expect(result.timing.meters).toEqual([
      { fromBar: 1, ...FOUR_FOUR },
      { fromBar: 6, ...THREE_FOUR },
    ])
    expect(result.page.bars.map((b) => b.bar)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(result.page.bars[0]).toEqual({ ...newBox, bar: 1 })
    expect(result.page.bars[1]).toEqual({ ...page.bars[0], bar: 2 })
    expect(result.page.bars[8]).toEqual({ ...page.bars[7], bar: 9 })
    expect(result.timing.locators).toEqual(timing.locators)
    expect(result.droppedLocators).toEqual([])
    expect(unmatchedSlots(result.timing)).toEqual([{ position: 8, bar: 9, passIndex: 0 }])
  })

  it('appends a bar at barCount + 1', () => {
    const { timing, page } = straightMap(8)
    const newBox = { pageIndex: 1, x: 100, y: 200, w: 400, h: 200 }

    const result = insertBar(timing, page, 9, newBox, 'plain')

    expectOrdered(result.timing)
    expect(result.timing.barCount).toBe(9)
    expect(result.timing.playOrder).toEqual([{ from: 1, to: 9 }])
    expect(result.page.bars[8]).toEqual({ ...newBox, bar: 9 })
    expect(result.page.bars.slice(0, 8)).toEqual(page.bars)
    expect(unmatchedSlots(result.timing)).toEqual([{ position: 8, bar: 9, passIndex: 0 }])
  })

  it('plays both halves of a split bar inside a repeat', () => {
    const { timing, page } = repeatMap()
    const newBox = { pageIndex: 0, x: 0, y: 0, w: 10, h: 10 }

    const result = insertBar(timing, page, 3, newBox, 'plain')

    expectOrdered(result.timing)
    expect(result.timing.barCount).toBe(9)
    expect(result.timing.playOrder).toEqual([
      { from: 1, to: 5 },
      { from: 1, to: 5 },
      { from: 6, to: 9 },
    ])
  })

  it('drops the second-pass locators that fall out of time order after the rows widen', () => {
    const { timing, page } = repeatMap()
    const newBox = { pageIndex: 0, x: 0, y: 0, w: 10, h: 10 }

    const result = insertBar(timing, page, 3, newBox, 'plain')

    // new slots: 1-5, 1-5, 6-9. (5, pass 0) keeps time 17, so the second-pass bars 1-4 (9, 11, 13, 15) come too late.
    expect(ids(result.droppedLocators)).toEqual(['1:1', '2:1', '3:1', '4:1'])
    expect(ids(result.timing.locators)).toEqual(['1:0', '2:0', '3:0', '4:0', '5:0', '6:0', '7:0', '8:0'])
  })

  it('moves a mark on or after the new bar and leaves earlier marks alone', () => {
    const { timing, page } = straightMap(8)
    const marked: TimingLayer = {
      ...timing,
      marks: [
        { bar: 3, kind: 'fermata' },
        { bar: 5, kind: 'rit' },
      ],
    }
    const newBox = { pageIndex: 0, x: 0, y: 0, w: 10, h: 10 }

    const atFour = insertBar(marked, page, 4, newBox, 'plain')
    const atThree = insertBar(marked, page, 3, newBox, 'plain')

    expect(atFour.timing.marks).toEqual([
      { bar: 3, kind: 'fermata' },
      { bar: 6, kind: 'rit' },
    ])
    expect(atThree.timing.marks).toEqual([
      { bar: 4, kind: 'fermata' },
      { bar: 6, kind: 'rit' },
    ])
  })

  it('moves the rests of the page on or after the new bar and leaves earlier rests alone', () => {
    const { timing, page } = straightMap(8)
    const resting: PageLayer = { ...page, rests: [3, 5, 6] }
    const newBox = { pageIndex: 0, x: 0, y: 0, w: 10, h: 10 }

    expect(insertBar(timing, resting, 4, newBox, 'plain').page.rests).toEqual([3, 6, 7])
    expect(insertBar(timing, resting, 3, newBox, 'ripple').page.rests).toEqual([4, 6, 7])
    expect(resting.rests).toEqual([3, 5, 6])
  })

  it('shifts a later meter change to make room: insert at 5 (split bar 4) puts the new bar in 4/4', () => {
    const { timing, page } = straightMap(8)
    const meters: MeterChange[] = [
      { fromBar: 1, ...FOUR_FOUR },
      { fromBar: 5, ...THREE_FOUR },
    ]
    const newBox = { pageIndex: 0, x: 0, y: 0, w: 10, h: 10 }

    const result = insertBar(withMeters(timing, meters), page, 5, newBox, 'plain')

    expect(result.timing.meters).toEqual([
      { fromBar: 1, ...FOUR_FOUR },
      { fromBar: 6, ...THREE_FOUR },
    ])
    expect(meterAt(result.timing.meters, 5)).toEqual(FOUR_FOUR)
    expect(meterAt(result.timing.meters, 6)).toEqual(THREE_FOUR)
  })

  it('throws a RangeError when the bar number is outside 1..barCount + 1 or not whole', () => {
    const { timing, page } = straightMap(8)
    const newBox = { pageIndex: 0, x: 0, y: 0, w: 10, h: 10 }

    expect(() => insertBar(timing, page, 0, newBox, 'plain')).toThrow(RangeError)
    expect(() => insertBar(timing, page, 10, newBox, 'plain')).toThrow(RangeError)
    expect(() => insertBar(timing, page, 2.5, newBox, 'plain')).toThrow(RangeError)
  })

  it('does not mutate its inputs', () => {
    const { timing, page } = repeatMap()
    const newBox = { pageIndex: 0, x: 0, y: 0, w: 10, h: 10 }
    const beforeTiming = structuredClone(timing)
    const beforePage = structuredClone(page)
    const beforeBox = structuredClone(newBox)

    insertBar(timing, page, 3, newBox, 'plain')

    expect(timing).toEqual(beforeTiming)
    expect(page).toEqual(beforePage)
    expect(newBox).toEqual(beforeBox)
  })
})

describe('deleteBar (plain)', () => {
  it('deletes the last bar: its locator is dropped and the box before it grows to cover it', () => {
    const { timing, page } = straightMap(8)

    const result = deleteBar(timing, page, 8, 'plain')

    expectOrdered(result.timing)
    expect(result.timing.barCount).toBe(7)
    expect(result.timing.playOrder).toEqual([{ from: 1, to: 7 }])
    expect(result.droppedLocators).toEqual([{ bar: 8, passIndex: 0, timeSec: 15, confirmed: false }])
    expect(result.timing.locators).toEqual(timing.locators.slice(0, 7))
    expect(result.page.bars.map((b) => b.bar)).toEqual([1, 2, 3, 4, 5, 6, 7])
    // bar 7 (x 900) and bar 8 (x 1300) share a line: the union is x 900..1700
    expect(result.page.bars[6]).toEqual({ bar: 7, pageIndex: 0, x: 900, y: 500, w: 800, h: 200 })
    expect(result.page.bars.slice(0, 6)).toEqual(page.bars.slice(0, 6))
  })

  it('deletes bar 1: the box after it grows into bar 1 and every box shifts down', () => {
    const { timing, page } = straightMap(8)

    const result = deleteBar(timing, page, 1, 'plain')

    expectOrdered(result.timing)
    expect(result.timing.barCount).toBe(7)
    expect(result.timing.playOrder).toEqual([{ from: 1, to: 7 }])
    expect(result.page.bars.map((b) => b.bar)).toEqual([1, 2, 3, 4, 5, 6, 7])
    // old bars 1 (x 100) and 2 (x 500) share a line: the union is x 100..900
    expect(result.page.bars[0]).toEqual({ bar: 1, pageIndex: 0, x: 100, y: 200, w: 800, h: 200 })
    expect(result.page.bars[1]).toEqual({ ...page.bars[2], bar: 2 })
    expect(result.page.bars[6]).toEqual({ ...page.bars[7], bar: 7 })
    expect(ids(result.droppedLocators)).toEqual(['8:0'])
  })

  it('deletes in the middle: boxes after it shift down and the neighbour on the same line grows', () => {
    const { timing, page } = straightMap(8)

    const result = deleteBar(timing, page, 3, 'plain')

    expect(result.page.bars.map((b) => b.bar)).toEqual([1, 2, 3, 4, 5, 6, 7])
    // old bars 2 (x 500) and 3 (x 900) share a line: bar 2 grows to x 500..1300
    expect(result.page.bars[1]).toEqual({ bar: 2, pageIndex: 0, x: 500, y: 200, w: 800, h: 200 })
    expect(result.page.bars[2]).toEqual({ ...page.bars[3], bar: 3 })
    expect(result.page.bars[6]).toEqual({ ...page.bars[7], bar: 7 })
  })

  it('does not merge with the box before it when that box is on another line', () => {
    const { timing, page } = straightMap(8)

    const result = deleteBar(timing, page, 5, 'plain')

    expect(result.page.bars.map((b) => b.bar)).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(result.page.bars[3]).toEqual(page.bars[3])
    expect(result.page.bars[4]).toEqual({ ...page.bars[5], bar: 5 })
  })

  it('does not merge with a box on another page, even when the heights overlap', () => {
    const { timing } = straightMap(2)
    const page: PageLayer = {
      partId: 'part-1',
      bars: [
        { bar: 1, pageIndex: 0, x: 100, y: 200, w: 400, h: 200 },
        { bar: 2, pageIndex: 1, x: 100, y: 200, w: 400, h: 200 },
      ],
      rests: [],
    }

    const result = deleteBar(timing, page, 2, 'plain')

    expect(result.page.bars).toEqual([{ bar: 1, pageIndex: 0, x: 100, y: 200, w: 400, h: 200 }])
  })

  it('deletes bar 3 of a repeat: rows shrink and the locators that no longer fit are dropped', () => {
    const { timing, page } = repeatMap()

    const result = deleteBar(timing, page, 3, 'plain')

    expectOrdered(result.timing)
    expect(result.timing.barCount).toBe(7)
    expect(result.timing.playOrder).toEqual([
      { from: 1, to: 3 },
      { from: 1, to: 3 },
      { from: 4, to: 7 },
    ])
    // bars 1-3 keep their numbers in both passes; the locators of old bar 3 stay on number 3
    const keptIds = ids(result.timing.locators)
    expect(keptIds).toEqual(['1:0', '1:1', '2:0', '2:1', '3:0', '3:1', '5:0', '6:0', '7:0'])
    // (4, pass 1) and (8, pass 0) have no slot any more; (4, pass 0) at 7 s would follow (3, pass 1) at 13 s
    expect(ids(result.droppedLocators)).toEqual(['4:0', '4:1', '8:0'])
    expect(result.page.bars.map((b) => b.bar)).toEqual([1, 2, 3, 4, 5, 6, 7])
  })

  it('removes a row that only held the deleted bar and shifts the rows after it', () => {
    const { timing, page } = straightMap(8)
    const rows = withRows(timing, [
      { from: 1, to: 2 },
      { from: 3, to: 3 },
      { from: 4, to: 8 },
    ])

    const result = deleteBar(rows, page, 3, 'plain')

    expect(result.timing.playOrder).toEqual([
      { from: 1, to: 2 },
      { from: 3, to: 7 },
    ])
  })

  it('moves a meter change that sits on the deleted bar to the next bar', () => {
    const { timing, page } = straightMap(8)
    const meters: MeterChange[] = [
      { fromBar: 1, ...FOUR_FOUR },
      { fromBar: 5, ...THREE_FOUR },
    ]

    const atFive = deleteBar(withMeters(timing, meters), page, 5, 'plain')
    const atFour = deleteBar(withMeters(timing, meters), page, 4, 'plain')

    // delete bar 5: old bar 6 is now bar 5 and is still 3/4
    expect(atFive.timing.meters).toEqual([
      { fromBar: 1, ...FOUR_FOUR },
      { fromBar: 5, ...THREE_FOUR },
    ])
    // delete bar 4: the 3/4 change moves one bar down
    expect(atFour.timing.meters).toEqual([
      { fromBar: 1, ...FOUR_FOUR },
      { fromBar: 4, ...THREE_FOUR },
    ])
  })

  it('lets the next bar own meter change win over the one on the deleted bar', () => {
    const { timing, page } = straightMap(8)
    const meters: MeterChange[] = [
      { fromBar: 1, ...FOUR_FOUR },
      { fromBar: 4, ...THREE_FOUR },
      { fromBar: 5, numerator: 2, denominator: 4 },
    ]

    const result = deleteBar(withMeters(timing, meters), page, 4, 'plain')

    expect(result.timing.meters).toEqual([
      { fromBar: 1, ...FOUR_FOUR },
      { fromBar: 4, numerator: 2, denominator: 4 },
    ])
  })

  it('drops a meter change whose only bar was deleted', () => {
    const { timing, page } = straightMap(8)
    const meters: MeterChange[] = [
      { fromBar: 1, ...FOUR_FOUR },
      { fromBar: 8, ...THREE_FOUR },
    ]

    const result = deleteBar(withMeters(timing, meters), page, 8, 'plain')

    expect(result.timing.meters).toEqual([{ fromBar: 1, ...FOUR_FOUR }])
  })

  it('merges neighbouring meter changes that end up equal', () => {
    const { timing, page } = straightMap(8)
    const meters: MeterChange[] = [
      { fromBar: 1, ...FOUR_FOUR },
      { fromBar: 3, ...THREE_FOUR },
      { fromBar: 4, ...FOUR_FOUR },
    ]

    const result = deleteBar(withMeters(timing, meters), page, 3, 'plain')

    expect(result.timing.meters).toEqual([{ fromBar: 1, ...FOUR_FOUR }])
  })

  it('keeps the first meter at bar 1 when bar 1 is deleted', () => {
    const { timing, page } = straightMap(8)
    const meters: MeterChange[] = [
      { fromBar: 1, ...FOUR_FOUR },
      { fromBar: 2, ...THREE_FOUR },
    ]

    const result = deleteBar(withMeters(timing, meters), page, 1, 'plain')

    expect(result.timing.meters).toEqual([{ fromBar: 1, ...THREE_FOUR }])
  })

  it('drops the marks on the deleted bar and shifts the marks after it', () => {
    const { timing, page } = straightMap(8)
    const marked: TimingLayer = {
      ...timing,
      marks: [
        { bar: 2, kind: 'rit' },
        { bar: 3, kind: 'fermata' },
        { bar: 5, kind: 'rit' },
      ],
    }

    const result = deleteBar(marked, page, 3, 'plain')

    expect(result.timing.marks).toEqual([
      { bar: 2, kind: 'rit' },
      { bar: 4, kind: 'rit' },
    ])
  })

  it('drops the rest on the deleted bar and moves the rests after it down', () => {
    const { timing, page } = straightMap(8)
    const resting: PageLayer = { ...page, rests: [2, 3, 5] }

    expect(deleteBar(timing, resting, 3, 'plain').page.rests).toEqual([2, 4])
    expect(deleteBar(timing, resting, 3, 'ripple').page.rests).toEqual([2, 4])
  })

  it('throws a RangeError for a bar outside 1..barCount or for a one-bar piece', () => {
    const { timing, page } = straightMap(8)
    const single = straightMap(1)

    expect(() => deleteBar(timing, page, 0, 'plain')).toThrow(RangeError)
    expect(() => deleteBar(timing, page, 9, 'plain')).toThrow(RangeError)
    expect(() => deleteBar(timing, page, 1.5, 'plain')).toThrow(RangeError)
    expect(() => deleteBar(single.timing, single.page, 1, 'plain')).toThrow(RangeError)
  })

  it('does not mutate its inputs', () => {
    const { timing, page } = repeatMap()
    const beforeTiming = structuredClone(timing)
    const beforePage = structuredClone(page)

    deleteBar(timing, page, 3, 'plain')

    expect(timing).toEqual(beforeTiming)
    expect(page).toEqual(beforePage)
  })
})

describe('addLocator (plain)', () => {
  it('fills the unmatched slot and marks the new locator confirmed', () => {
    const { timing } = straightMap(4)
    const gap = withoutLocator(timing, 2, 0)

    const result = addLocator(gap, 3.25, 'plain')

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expectOrdered(result.timing)
    expect(result.timing.locators).toHaveLength(4)
    expect(result.timing.locators[1]).toEqual({ bar: 2, passIndex: 0, timeSec: 3.25, confirmed: true })
    expect(unmatchedSlots(result.timing)).toEqual([])
    expect(result.droppedLocators).toEqual([])
  })

  it('takes the first unmatched slot after the previous locator when several are free', () => {
    const { timing } = straightMap(6)
    const gaps = withoutLocator(withoutLocator(timing, 3, 0), 4, 0)

    const result = addLocator(gaps, 6, 'plain')

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expectOrdered(result.timing)
    expect(result.timing.locators.find((l) => l.timeSec === 6)).toEqual({
      bar: 3,
      passIndex: 0,
      timeSec: 6,
      confirmed: true,
    })
    expect(unmatchedSlots(result.timing)).toEqual([{ position: 3, bar: 4, passIndex: 0 }])
  })

  it('fills slot 0 when there is no locator before the new time', () => {
    const { timing } = straightMap(4)
    const gap = withoutLocator(timing, 1, 0)

    const result = addLocator(gap, 0.5, 'plain')

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expectOrdered(result.timing)
    expect(result.timing.locators[0]).toEqual({ bar: 1, passIndex: 0, timeSec: 0.5, confirmed: true })
  })

  it('fills the last slot when there is no locator after the new time', () => {
    const { timing } = straightMap(4)
    const gap = withoutLocator(timing, 4, 0)

    const result = addLocator(gap, 100, 'plain')

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expectOrdered(result.timing)
    expect(result.timing.locators[3]).toEqual({ bar: 4, passIndex: 0, timeSec: 100, confirmed: true })
  })

  it('fills the second pass of a repeated bar', () => {
    const { timing } = repeatMap()
    const gap = withoutLocator(timing, 2, 1)

    const result = addLocator(gap, 11.5, 'plain')

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expectOrdered(result.timing)
    expect(result.timing.locators.find((l) => l.timeSec === 11.5)).toEqual({
      bar: 2,
      passIndex: 1,
      timeSec: 11.5,
      confirmed: true,
    })
  })

  it('returns no-free-slot for a second add once the only free slot is taken', () => {
    const { timing } = straightMap(4)
    const gap = withoutLocator(timing, 2, 0)

    const first = addLocator(gap, 3.25, 'plain')
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const second = addLocator(first.timing, 3.5, 'plain')

    expect(second).toEqual({ ok: false, reason: 'no-free-slot' })
  })

  it('returns no-free-slot when the free slot lies outside the neighbours of the new time', () => {
    const { timing } = straightMap(4)
    const gap = withoutLocator(timing, 4, 0)

    // 2 s lies between bar 1 (1 s) and bar 2 (3 s); the only free slot is after bar 3
    expect(addLocator(gap, 2, 'plain')).toEqual({ ok: false, reason: 'no-free-slot' })
  })

  it('returns duplicate-time when a locator already has exactly that time', () => {
    const { timing } = straightMap(4)

    expect(addLocator(timing, 5, 'plain')).toEqual({ ok: false, reason: 'duplicate-time' })
  })

  it('returns out-of-range for a negative or non-finite time', () => {
    const { timing } = straightMap(4)
    const gap = withoutLocator(timing, 1, 0)

    expect(addLocator(gap, -0.5, 'plain')).toEqual({ ok: false, reason: 'out-of-range' })
    expect(addLocator(gap, Number.NaN, 'plain')).toEqual({ ok: false, reason: 'out-of-range' })
    expect(addLocator(gap, Number.POSITIVE_INFINITY, 'plain')).toEqual({ ok: false, reason: 'out-of-range' })
  })

  it('does not mutate its input', () => {
    const { timing } = straightMap(4)
    const gap = withoutLocator(timing, 2, 0)
    const before = structuredClone(gap)

    addLocator(gap, 3.25, 'plain')

    expect(gap).toEqual(before)
  })
})

describe('deleteLocator (plain)', () => {
  it('removes only that locator and leaves its slot unmatched', () => {
    const { timing } = straightMap(4)

    const result = deleteLocator(timing, 2, 0, 'plain')

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expectOrdered(result.timing)
    expect(ids(result.timing.locators)).toEqual(['1:0', '3:0', '4:0'])
    expect(result.timing.locators.map((l) => l.timeSec)).toEqual([1, 5, 7])
    expect(unmatchedSlots(result.timing)).toEqual([{ position: 1, bar: 2, passIndex: 0 }])
    expect(result.droppedLocators).toEqual([])
  })

  it('removes one pass of a repeated bar and keeps the other', () => {
    const { timing } = repeatMap()

    const result = deleteLocator(timing, 3, 1, 'plain')

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expectOrdered(result.timing)
    expect(result.timing.locators).toHaveLength(11)
    expect(result.timing.locators.some((l) => l.bar === 3 && l.passIndex === 0)).toBe(true)
    expect(unmatchedSlots(result.timing)).toEqual([{ position: 6, bar: 3, passIndex: 1 }])
  })

  it('returns not-found when there is no such locator', () => {
    const { timing } = straightMap(4)

    expect(deleteLocator(timing, 9, 0, 'plain')).toEqual({ ok: false, reason: 'not-found' })
    expect(deleteLocator(timing, 2, 1, 'plain')).toEqual({ ok: false, reason: 'not-found' })
    expect(deleteLocator(withoutLocator(timing, 2, 0), 2, 0, 'plain')).toEqual({ ok: false, reason: 'not-found' })
  })

  it('does not mutate its input', () => {
    const { timing } = straightMap(4)
    const before = structuredClone(timing)

    deleteLocator(timing, 2, 0, 'plain')

    expect(timing).toEqual(before)
  })
})

/** [bar, passIndex, timeSec] triples in the order the layer lists them, so a test reads the whole locator list at a glance. */
function triples(locators: Locator[]): [number, number, number][] {
  return locators.map((l) => [l.bar, l.passIndex, l.timeSec])
}

/** Pairs of bars whose boxes share a page, overlap vertically (same line) and also overlap horizontally. */
function overlappingBars(boxes: BarBox[]): [number, number][] {
  const pairs: [number, number][] = []
  boxes.forEach((a, i) => {
    for (const b of boxes.slice(i + 1)) {
      const sameLine = a.pageIndex === b.pageIndex && a.y < b.y + b.h && b.y < a.y + a.h
      if (sameLine && a.x < b.x + b.w && b.x < a.x + a.w) pairs.push([a.bar, b.bar])
    }
  })
  return pairs
}

describe('insertBar (ripple)', () => {
  it('splits bar 3 of a straight map: the following locators move up a bar and the new bar 4 is unmatched', () => {
    const { timing, page } = straightMap(8)
    const { left, right } = splitBox(page.bars[2], page.bars[2].x + 200)

    const result = insertBar(timing, withBox(page, left), 4, right, 'ripple')

    expectOrdered(result.timing)
    expect(result.timing.barCount).toBe(9)
    expect(result.timing.playOrder).toEqual([{ from: 1, to: 9 }])
    // old bar 4's locator (7 s) is now bar 5; nothing sits on bar 4
    expect(result.timing.locators.find((l) => l.timeSec === 7)?.bar).toBe(5)
    expect(triples(result.timing.locators)).toEqual([
      [1, 0, 1],
      [2, 0, 3],
      [3, 0, 5],
      [5, 0, 7],
      [6, 0, 9],
      [7, 0, 11],
      [8, 0, 13],
      [9, 0, 15],
    ])
    expect(unmatchedSlots(result.timing)).toEqual([{ position: 3, bar: 4, passIndex: 0 }])
    expect(result.droppedLocators).toEqual([])
    expect(result.page.bars.map((b) => b.bar)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(result.page.bars[3]).toEqual({ ...right, bar: 4 })
  })

  it('plain vs ripple, same split: plain keeps bar 4 on its locator and leaves bar 9 unmatched', () => {
    const { timing, page } = straightMap(8)
    const { left, right } = splitBox(page.bars[2], page.bars[2].x + 200)
    const split = withBox(page, left)

    const plain = insertBar(timing, split, 4, right, 'plain')
    const ripple = insertBar(timing, split, 4, right, 'ripple')

    expectOrdered(plain.timing)
    expectOrdered(ripple.timing)
    expect(plain.timing.locators.find((l) => l.timeSec === 7)?.bar).toBe(4)
    expect(unmatchedSlots(plain.timing)).toEqual([{ position: 8, bar: 9, passIndex: 0 }])
    expect(ripple.timing.locators.find((l) => l.timeSec === 7)?.bar).toBe(5)
    expect(unmatchedSlots(ripple.timing)).toEqual([{ position: 3, bar: 4, passIndex: 0 }])
  })

  it('renumbers boxes, rows, meters and marks exactly as plain does', () => {
    const { timing, page } = straightMap(8)
    const marked: TimingLayer = {
      ...timing,
      meters: [
        { fromBar: 1, ...FOUR_FOUR },
        { fromBar: 5, ...THREE_FOUR },
      ],
      marks: [
        { bar: 3, kind: 'fermata' },
        { bar: 5, kind: 'rit' },
      ],
    }
    const newBox = { pageIndex: 0, x: 0, y: 0, w: 10, h: 10 }

    for (const at of [1, 4, 5, 9]) {
      const plain = insertBar(marked, page, at, newBox, 'plain')
      const ripple = insertBar(marked, page, at, newBox, 'ripple')

      expect(ripple.timing.barCount).toBe(plain.timing.barCount)
      expect(ripple.timing.playOrder).toEqual(plain.timing.playOrder)
      expect(ripple.timing.meters).toEqual(plain.timing.meters)
      expect(ripple.timing.marks).toEqual(plain.timing.marks)
      expect(ripple.page).toEqual(plain.page)
    }
  })

  it('inserts before bar 1: every locator moves up one bar, bar 1 is unmatched and the rows widen', () => {
    const { timing, page } = straightMap(8)
    const newBox = { pageIndex: 0, x: 0, y: 200, w: 100, h: 200 }

    const result = insertBar(timing, page, 1, newBox, 'ripple')

    expectOrdered(result.timing)
    expect(result.timing.barCount).toBe(9)
    expect(result.timing.playOrder).toEqual([{ from: 1, to: 9 }])
    expect(triples(result.timing.locators)).toEqual([
      [2, 0, 1],
      [3, 0, 3],
      [4, 0, 5],
      [5, 0, 7],
      [6, 0, 9],
      [7, 0, 11],
      [8, 0, 13],
      [9, 0, 15],
    ])
    expect(unmatchedSlots(result.timing)).toEqual([{ position: 0, bar: 1, passIndex: 0 }])
    expect(result.droppedLocators).toEqual([])
    expect(result.page.bars[0]).toEqual({ ...newBox, bar: 1 })
  })

  it('appends a bar at barCount + 1: no locator moves and the new last bar is unmatched', () => {
    const { timing, page } = straightMap(8)
    const newBox = { pageIndex: 1, x: 100, y: 200, w: 400, h: 200 }

    const result = insertBar(timing, page, 9, newBox, 'ripple')

    expectOrdered(result.timing)
    expect(result.timing.locators).toEqual(timing.locators)
    expect(unmatchedSlots(result.timing)).toEqual([{ position: 8, bar: 9, passIndex: 0 }])
    expect(result.droppedLocators).toEqual([])
  })

  it('keeps passIndex, timeSec and confirmed of the locators that move', () => {
    const { timing, page } = repeatMap()
    const confirmed: TimingLayer = {
      ...timing,
      locators: timing.locators.map((l) => (l.bar === 4 && l.passIndex === 1 ? { ...l, confirmed: true } : l)),
    }
    const newBox = { pageIndex: 0, x: 0, y: 0, w: 10, h: 10 }

    const result = insertBar(confirmed, page, 3, newBox, 'ripple')

    expect(result.timing.locators.find((l) => l.timeSec === 15)).toEqual({
      bar: 5,
      passIndex: 1,
      timeSec: 15,
      confirmed: true,
    })
  })

  it('splits bar 2 of a repeat: both passes of every later bar move and the new bar 3 is unmatched in both', () => {
    const { timing, page } = repeatMap()
    const newBox = { pageIndex: 0, x: 0, y: 0, w: 10, h: 10 }

    const result = insertBar(timing, page, 3, newBox, 'ripple')

    expectOrdered(result.timing)
    expect(result.timing.playOrder).toEqual([
      { from: 1, to: 5 },
      { from: 1, to: 5 },
      { from: 6, to: 9 },
    ])
    expect(result.droppedLocators).toEqual([])
    expect(result.timing.locators).toHaveLength(12)
    expect(unmatchedSlots(result.timing)).toEqual([
      { position: 2, bar: 3, passIndex: 0 },
      { position: 7, bar: 3, passIndex: 1 },
    ])
  })

  it('splits the 1st ending of a volta map: the 2nd-ending locators move up and new bar 9 is unmatched', () => {
    const { timing, page } = voltaMap()
    const { left, right } = splitBox(page.bars[7], page.bars[7].x + 200)

    const result = insertBar(timing, withBox(page, left), 9, right, 'ripple')

    expectOrdered(result.timing)
    expect(result.timing.barCount).toBe(13)
    expect(result.timing.playOrder).toEqual([
      { from: 1, to: 9 },
      { from: 1, to: 7 },
      { from: 10, to: 13 },
    ])
    // old bar 9 (the 2nd ending) located at 31 s is now bar 10; the 1st ending (bar 8, 15 s) did not move
    expect(result.timing.locators.find((l) => l.timeSec === 31)).toEqual({
      bar: 10,
      passIndex: 0,
      timeSec: 31,
      confirmed: false,
    })
    expect(result.timing.locators.find((l) => l.timeSec === 15)?.bar).toBe(8)
    expect(result.timing.locators).toHaveLength(19)
    expect(result.droppedLocators).toEqual([])
    expect(unmatchedSlots(result.timing)).toEqual([{ position: 8, bar: 9, passIndex: 0 }])
  })

  it('throws a RangeError when the bar number is outside 1..barCount + 1', () => {
    const { timing, page } = straightMap(8)
    const newBox = { pageIndex: 0, x: 0, y: 0, w: 10, h: 10 }

    expect(() => insertBar(timing, page, 0, newBox, 'ripple')).toThrow(RangeError)
    expect(() => insertBar(timing, page, 10, newBox, 'ripple')).toThrow(RangeError)
  })

  it('does not mutate its inputs', () => {
    const { timing, page } = repeatMap()
    const newBox = { pageIndex: 0, x: 0, y: 0, w: 10, h: 10 }
    const beforeTiming = structuredClone(timing)
    const beforePage = structuredClone(page)
    const beforeBox = structuredClone(newBox)

    insertBar(timing, page, 3, newBox, 'ripple')

    expect(timing).toEqual(beforeTiming)
    expect(page).toEqual(beforePage)
    expect(newBox).toEqual(beforeBox)
  })
})

describe('deleteBar (ripple)', () => {
  it('deletes the last bar: its locator is dropped and the others stay as they were', () => {
    const { timing, page } = straightMap(8)

    const result = deleteBar(timing, page, 8, 'ripple')

    expectOrdered(result.timing)
    expect(result.timing.barCount).toBe(7)
    expect(result.timing.playOrder).toEqual([{ from: 1, to: 7 }])
    expect(result.droppedLocators).toEqual([{ bar: 8, passIndex: 0, timeSec: 15, confirmed: false }])
    expect(result.timing.locators).toEqual(timing.locators.slice(0, 7))
    expect(result.page.bars.map((b) => b.bar)).toEqual([1, 2, 3, 4, 5, 6, 7])
  })

  it('deletes bar 1: its locator is dropped and old bar 2 carries the locator that is now bar 1', () => {
    const { timing, page } = straightMap(8)

    const result = deleteBar(timing, page, 1, 'ripple')

    expectOrdered(result.timing)
    expect(result.timing.barCount).toBe(7)
    expect(result.timing.playOrder).toEqual([{ from: 1, to: 7 }])
    expect(result.droppedLocators).toEqual([{ bar: 1, passIndex: 0, timeSec: 1, confirmed: false }])
    expect(triples(result.timing.locators)).toEqual([
      [1, 0, 3],
      [2, 0, 5],
      [3, 0, 7],
      [4, 0, 9],
      [5, 0, 11],
      [6, 0, 13],
      [7, 0, 15],
    ])
    expect(unmatchedSlots(result.timing)).toEqual([])
  })

  it('plain vs ripple, same delete of bar 3: plain keeps the locator numbers, ripple moves them down', () => {
    const { timing, page } = straightMap(8)

    const plain = deleteBar(timing, page, 3, 'plain')
    const ripple = deleteBar(timing, page, 3, 'ripple')

    expectOrdered(plain.timing)
    expectOrdered(ripple.timing)
    expect(triples(plain.timing.locators).map(([bar, , timeSec]) => [bar, timeSec])).toEqual([
      [1, 1],
      [2, 3],
      [3, 5],
      [4, 7],
      [5, 9],
      [6, 11],
      [7, 13],
    ])
    expect(ids(plain.droppedLocators)).toEqual(['8:0'])
    expect(triples(ripple.timing.locators).map(([bar, , timeSec]) => [bar, timeSec])).toEqual([
      [1, 1],
      [2, 3],
      [3, 7],
      [4, 9],
      [5, 11],
      [6, 13],
      [7, 15],
    ])
    expect(ripple.droppedLocators).toEqual([{ bar: 3, passIndex: 0, timeSec: 5, confirmed: false }])
  })

  it('renumbers boxes, rows, meters and marks exactly as plain does', () => {
    const { timing, page } = straightMap(8)
    const marked: TimingLayer = {
      ...timing,
      meters: [
        { fromBar: 1, ...FOUR_FOUR },
        { fromBar: 5, ...THREE_FOUR },
      ],
      marks: [
        { bar: 3, kind: 'fermata' },
        { bar: 5, kind: 'rit' },
      ],
    }

    for (const bar of [1, 3, 4, 5, 8]) {
      const plain = deleteBar(marked, page, bar, 'plain')
      const ripple = deleteBar(marked, page, bar, 'ripple')

      expect(ripple.timing.barCount).toBe(plain.timing.barCount)
      expect(ripple.timing.playOrder).toEqual(plain.timing.playOrder)
      expect(ripple.timing.meters).toEqual(plain.timing.meters)
      expect(ripple.timing.marks).toEqual(plain.timing.marks)
      expect(ripple.page).toEqual(plain.page)
    }
  })

  it('deletes bar 3 of a repeat: both passes of bar 3 are dropped and both passes of later bars move down', () => {
    const { timing, page } = repeatMap()

    const result = deleteBar(timing, page, 3, 'ripple')

    expectOrdered(result.timing)
    expect(result.timing.playOrder).toEqual([
      { from: 1, to: 3 },
      { from: 1, to: 3 },
      { from: 4, to: 7 },
    ])
    expect(ids(result.droppedLocators)).toEqual(['3:0', '3:1'])
    expect(result.timing.locators).toHaveLength(10)
    expect(result.timing.locators.find((l) => l.timeSec === 7)).toMatchObject({ bar: 3, passIndex: 0 })
    expect(result.timing.locators.find((l) => l.timeSec === 15)).toMatchObject({ bar: 3, passIndex: 1 })
    expect(unmatchedSlots(result.timing)).toEqual([])
  })

  it('keeps passIndex, timeSec and confirmed of the locators that move', () => {
    const { timing, page } = straightMap(8)
    const confirmed: TimingLayer = {
      ...timing,
      locators: timing.locators.map((l) => (l.bar === 6 ? { ...l, confirmed: true } : l)),
    }

    const result = deleteBar(confirmed, page, 2, 'ripple')

    expect(result.timing.locators.find((l) => l.timeSec === 11)).toEqual({
      bar: 5,
      passIndex: 0,
      timeSec: 11,
      confirmed: true,
    })
  })

  it('throws a RangeError for a bar outside 1..barCount or for a one-bar piece', () => {
    const { timing, page } = straightMap(8)
    const single = straightMap(1)

    expect(() => deleteBar(timing, page, 0, 'ripple')).toThrow(RangeError)
    expect(() => deleteBar(timing, page, 9, 'ripple')).toThrow(RangeError)
    expect(() => deleteBar(single.timing, single.page, 1, 'ripple')).toThrow(RangeError)
  })

  it('does not mutate its inputs', () => {
    const { timing, page } = repeatMap()
    const beforeTiming = structuredClone(timing)
    const beforePage = structuredClone(page)

    deleteBar(timing, page, 3, 'ripple')

    expect(timing).toEqual(beforeTiming)
    expect(page).toEqual(beforePage)
  })
})

describe('addLocator (ripple)', () => {
  it('takes the slot after the previous locator, shifts the rest and drops the last one of a full map', () => {
    const { timing } = straightMap(4)

    const result = addLocator(timing, 4, 'ripple')

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expectOrdered(result.timing)
    expect(triples(result.timing.locators)).toEqual([
      [1, 0, 1],
      [2, 0, 3],
      [3, 0, 4],
      [4, 0, 5],
    ])
    expect(result.timing.locators[2].confirmed).toBe(true)
    expect(result.droppedLocators).toEqual([{ bar: 4, passIndex: 0, timeSec: 7, confirmed: false }])
    expect(unmatchedSlots(result.timing)).toEqual([])
  })

  it('takes slot 0 when no locator comes before the new time', () => {
    const { timing } = straightMap(4)

    const result = addLocator(timing, 0.5, 'ripple')

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expectOrdered(result.timing)
    expect(triples(result.timing.locators)).toEqual([
      [1, 0, 0.5],
      [2, 0, 1],
      [3, 0, 3],
      [4, 0, 5],
    ])
    expect(result.droppedLocators).toEqual([{ bar: 4, passIndex: 0, timeSec: 7, confirmed: false }])
  })

  it('drops nothing when the last slot was free', () => {
    const { timing } = straightMap(4)
    const gap = withoutLocator(timing, 4, 0)

    const result = addLocator(gap, 4, 'ripple')

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expectOrdered(result.timing)
    expect(triples(result.timing.locators)).toEqual([
      [1, 0, 1],
      [2, 0, 3],
      [3, 0, 4],
      [4, 0, 5],
    ])
    expect(result.droppedLocators).toEqual([])
  })

  it('moves locators across the rows of a repeat: they take the next slot bar and passIndex', () => {
    const { timing } = repeatMap()

    const result = addLocator(timing, 4, 'ripple')

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expectOrdered(result.timing)
    expect(triples(result.timing.locators)).toEqual([
      [1, 0, 1],
      [2, 0, 3],
      [3, 0, 4],
      [4, 0, 5],
      [1, 1, 7],
      [2, 1, 9],
      [3, 1, 11],
      [4, 1, 13],
      [5, 0, 15],
      [6, 0, 17],
      [7, 0, 19],
      [8, 0, 21],
    ])
    expect(result.droppedLocators).toEqual([{ bar: 8, passIndex: 0, timeSec: 23, confirmed: false }])
  })

  it('keeps timeSec and confirmed of the locators that move', () => {
    const { timing } = straightMap(4)
    const confirmed: TimingLayer = {
      ...timing,
      locators: timing.locators.map((l) => (l.bar === 3 ? { ...l, confirmed: true } : l)),
    }

    const result = addLocator(confirmed, 4, 'ripple')

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.timing.locators.find((l) => l.timeSec === 5)).toEqual({
      bar: 4,
      passIndex: 0,
      timeSec: 5,
      confirmed: true,
    })
  })

  it('returns no-free-slot when the previous locator already sits on the last slot', () => {
    const { timing } = straightMap(4)

    expect(addLocator(timing, 100, 'ripple')).toEqual({ ok: false, reason: 'no-free-slot' })
  })

  it('returns duplicate-time when a locator already has exactly that time', () => {
    const { timing } = straightMap(4)

    expect(addLocator(timing, 5, 'ripple')).toEqual({ ok: false, reason: 'duplicate-time' })
  })

  it('returns out-of-range for a negative or non-finite time', () => {
    const { timing } = straightMap(4)

    expect(addLocator(timing, -0.5, 'ripple')).toEqual({ ok: false, reason: 'out-of-range' })
    expect(addLocator(timing, Number.NaN, 'ripple')).toEqual({ ok: false, reason: 'out-of-range' })
    expect(addLocator(timing, Number.POSITIVE_INFINITY, 'ripple')).toEqual({ ok: false, reason: 'out-of-range' })
  })

  it('does not mutate its input', () => {
    const { timing } = repeatMap()
    const before = structuredClone(timing)

    addLocator(timing, 4, 'ripple')

    expect(timing).toEqual(before)
  })
})

describe('deleteLocator (ripple)', () => {
  it('removes the locator, shifts the later ones back and leaves the last slot unmatched', () => {
    const { timing } = straightMap(4)

    const result = deleteLocator(timing, 2, 0, 'ripple')

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expectOrdered(result.timing)
    expect(triples(result.timing.locators)).toEqual([
      [1, 0, 1],
      [2, 0, 5],
      [3, 0, 7],
    ])
    expect(unmatchedSlots(result.timing)).toEqual([{ position: 3, bar: 4, passIndex: 0 }])
    expect(result.droppedLocators).toEqual([])
  })

  it('moves locators back across the rows of a repeat: they take the previous slot bar and passIndex', () => {
    const { timing } = repeatMap()

    const result = deleteLocator(timing, 3, 0, 'ripple')

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expectOrdered(result.timing)
    expect(triples(result.timing.locators)).toEqual([
      [1, 0, 1],
      [2, 0, 3],
      [3, 0, 7],
      [4, 0, 9],
      [1, 1, 11],
      [2, 1, 13],
      [3, 1, 15],
      [4, 1, 17],
      [5, 0, 19],
      [6, 0, 21],
      [7, 0, 23],
    ])
    expect(unmatchedSlots(result.timing)).toEqual([{ position: 11, bar: 8, passIndex: 0 }])
  })

  it('keeps timeSec and confirmed of the locators that move', () => {
    const { timing } = straightMap(4)
    const confirmed: TimingLayer = {
      ...timing,
      locators: timing.locators.map((l) => (l.bar === 3 ? { ...l, confirmed: true } : l)),
    }

    const result = deleteLocator(confirmed, 1, 0, 'ripple')

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.timing.locators.find((l) => l.timeSec === 5)).toEqual({
      bar: 2,
      passIndex: 0,
      timeSec: 5,
      confirmed: true,
    })
  })

  it('removes only the last locator when nothing follows it', () => {
    const { timing } = straightMap(4)

    const result = deleteLocator(timing, 4, 0, 'ripple')

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expectOrdered(result.timing)
    expect(result.timing.locators).toEqual(timing.locators.slice(0, 3))
    expect(unmatchedSlots(result.timing)).toEqual([{ position: 3, bar: 4, passIndex: 0 }])
  })

  it('returns not-found when there is no such locator', () => {
    const { timing } = straightMap(4)

    expect(deleteLocator(timing, 9, 0, 'ripple')).toEqual({ ok: false, reason: 'not-found' })
    expect(deleteLocator(timing, 2, 1, 'ripple')).toEqual({ ok: false, reason: 'not-found' })
  })

  it('does not mutate its input', () => {
    const { timing } = repeatMap()
    const before = structuredClone(timing)

    deleteLocator(timing, 3, 0, 'ripple')

    expect(timing).toEqual(before)
  })
})

describe('splitBar', () => {
  it('moves the rests after the split bar up and keeps the others', () => {
    const { timing, page } = straightMap(8)

    const result = splitBar(timing, { ...page, rests: [2, 3, 6] }, 3, 1100, 'plain')

    expect(result.page.rests).toEqual([2, 3, 7])
  })

  it('ripple: no two boxes on a line overlap, bar 3 ends at x and the new bar 4 starts at x', () => {
    const { timing, page } = straightMap(8)
    const x = 1100

    const result = splitBar(timing, page, 3, x, 'ripple')

    expectOrdered(result.timing)
    expect(result.timing.barCount).toBe(9)
    expect(result.page.bars.map((b) => b.bar)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(overlappingBars(result.page.bars)).toEqual([])
    expect(result.page.bars[2].x + result.page.bars[2].w).toBe(x)
    expect(result.page.bars[3].x).toBe(x)
    expect(result.page.bars[3].x + result.page.bars[3].w).toBe(page.bars[2].x + page.bars[2].w)
    expect(result.page.bars[4]).toEqual({ ...page.bars[3], bar: 5 })
    // ripple: old bar 4's locator (7 s) follows its physical bar to bar 5
    expect(result.timing.locators.find((l) => l.timeSec === 7)?.bar).toBe(5)
    expect(unmatchedSlots(result.timing)).toEqual([{ position: 3, bar: 4, passIndex: 0 }])
    expect(result.droppedLocators).toEqual([])
  })

  it('plain: the same boxes, but the locators keep their numbers', () => {
    const { timing, page } = straightMap(8)

    const plain = splitBar(timing, page, 3, 1100, 'plain')
    const ripple = splitBar(timing, page, 3, 1100, 'ripple')

    expectOrdered(plain.timing)
    expect(plain.page).toEqual(ripple.page)
    expect(overlappingBars(plain.page.bars)).toEqual([])
    expect(plain.timing.locators).toEqual(timing.locators)
    expect(unmatchedSlots(plain.timing)).toEqual([{ position: 8, bar: 9, passIndex: 0 }])
  })

  it('splits the last bar: the new bar is appended after it', () => {
    const { timing, page } = straightMap(8)

    const result = splitBar(timing, page, 8, 1500, 'ripple')

    expectOrdered(result.timing)
    expect(result.timing.barCount).toBe(9)
    expect(result.page.bars[7]).toEqual({ ...page.bars[7], w: 200 })
    expect(result.page.bars[8]).toEqual({ bar: 9, pageIndex: 0, x: 1500, y: 500, w: 200, h: 200 })
    expect(overlappingBars(result.page.bars)).toEqual([])
    expect(result.timing.locators).toEqual(timing.locators)
    expect(unmatchedSlots(result.timing)).toEqual([{ position: 8, bar: 9, passIndex: 0 }])
  })

  it('splits bar 1: the new bar 2 takes the right part and later locators move up', () => {
    const { timing, page } = straightMap(8)

    const result = splitBar(timing, page, 1, 300, 'ripple')

    expectOrdered(result.timing)
    expect(result.page.bars[0]).toEqual({ ...page.bars[0], w: 200 })
    expect(result.page.bars[1]).toEqual({ bar: 2, pageIndex: 0, x: 300, y: 200, w: 200, h: 200 })
    expect(overlappingBars(result.page.bars)).toEqual([])
    expect(unmatchedSlots(result.timing)).toEqual([{ position: 1, bar: 2, passIndex: 0 }])
  })

  it('throws a RangeError when the bar has no box or x is not inside the box', () => {
    const { timing, page } = straightMap(8)

    expect(() => splitBar(timing, page, 0, 1100, 'ripple')).toThrow(RangeError)
    expect(() => splitBar(timing, page, 9, 1100, 'ripple')).toThrow(RangeError)
    expect(() => splitBar(timing, page, 3, 900, 'ripple')).toThrow(RangeError)
    expect(() => splitBar(timing, page, 3, 1300, 'ripple')).toThrow(RangeError)
  })

  it('does not mutate its inputs', () => {
    const { timing, page } = repeatMap()
    const beforeTiming = structuredClone(timing)
    const beforePage = structuredClone(page)

    splitBar(timing, page, 3, 1100, 'ripple')

    expect(timing).toEqual(beforeTiming)
    expect(page).toEqual(beforePage)
  })
})

describe('chained locators', () => {
  const NEW_BOX = { pageIndex: 0, x: 0, y: 0, w: 10, h: 10 }

  /** The locator of one (bar, pass), or undefined. */
  function locatorOf(timing: TimingLayer, bar: number, passIndex: number): Locator | undefined {
    return timing.locators.find((l) => l.bar === bar && l.passIndex === passIndex)
  }

  /** The timing layer with one locator's confirmed flag set. */
  function withConfirmed(timing: TimingLayer, bar: number, passIndex: number, confirmed: boolean): TimingLayer {
    return {
      ...timing,
      locators: timing.locators.map((l) => (l.bar === bar && l.passIndex === passIndex ? { ...l, confirmed } : l)),
    }
  }

  /** Every locator of the timing layer except the one at (bar, pass), for "only that locator changed" checks. */
  function othersOf(timing: TimingLayer, bar: number, passIndex: number): Locator[] {
    return timing.locators.filter((l) => !(l.bar === bar && l.passIndex === passIndex))
  }

  describe('chainedLocators', () => {
    it('returns both passes of a repeated bar, ordered by passIndex', () => {
      const { timing } = repeatMap()

      expect(chainedLocators(timing, 3)).toEqual([
        { bar: 3, passIndex: 0, timeSec: 5, confirmed: false },
        { bar: 3, passIndex: 1, timeSec: 13, confirmed: false },
      ])
    })

    it('orders by passIndex whatever the order of the locator list', () => {
      const { timing } = repeatMap()
      const shuffled = { ...timing, locators: [...timing.locators].reverse() }

      expect(chainedLocators(shuffled, 3).map((l) => l.passIndex)).toEqual([0, 1])
    })

    it('returns a single locator for a bar played once, and none for a bar without a locator', () => {
      const repeat = repeatMap().timing
      const volta = voltaMap().timing

      expect(chainedLocators(repeat, 6)).toEqual([{ bar: 6, passIndex: 0, timeSec: 19, confirmed: false }])
      expect(chainedLocators(volta, 8)).toEqual([{ bar: 8, passIndex: 0, timeSec: 15, confirmed: false }])
      expect(chainedLocators(withoutLocator(repeat, 6, 0), 6)).toEqual([])
      expect(chainedLocators(repeat, 99)).toEqual([])
    })

    it('does not mutate its input and returns copies', () => {
      const { timing } = repeatMap()
      const before = structuredClone(timing)

      const chain = chainedLocators(timing, 3)
      chain[0].timeSec = 999

      expect(timing).toEqual(before)
    })
  })

  describe('structural edits move every pass together', () => {
    it('ripple insert at 3 (split bar 2): both locators of old bar 3 are now bar 4, new bar 3 is unmatched in both passes', () => {
      const { timing, page } = repeatMap()

      const result = insertBar(timing, page, 3, NEW_BOX, 'ripple')

      expectOrdered(result.timing)
      expect(chainedLocators(result.timing, 4)).toEqual([
        { bar: 4, passIndex: 0, timeSec: 5, confirmed: false },
        { bar: 4, passIndex: 1, timeSec: 13, confirmed: false },
      ])
      expect(chainedLocators(result.timing, 3)).toEqual([])
      expect(unmatchedSlots(result.timing)).toEqual([
        { position: 2, bar: 3, passIndex: 0 },
        { position: 7, bar: 3, passIndex: 1 },
      ])
      // bars 1-2 keep both passes; every bar from old 3 on moved up one in both passes
      expect(chainedLocators(result.timing, 2).map((l) => l.timeSec)).toEqual([3, 11])
      expect(chainedLocators(result.timing, 5).map((l) => l.timeSec)).toEqual([7, 15])
      expect(result.droppedLocators).toEqual([])
    })

    it('ripple delete of bar 2: both locators of bar 2 are dropped, both of old bar 3 are now bar 2', () => {
      const { timing, page } = repeatMap()

      const result = deleteBar(timing, page, 2, 'ripple')

      expectOrdered(result.timing)
      expect(result.droppedLocators).toEqual([
        { bar: 2, passIndex: 0, timeSec: 3, confirmed: false },
        { bar: 2, passIndex: 1, timeSec: 11, confirmed: false },
      ])
      expect(chainedLocators(result.timing, 2)).toEqual([
        { bar: 2, passIndex: 0, timeSec: 5, confirmed: false },
        { bar: 2, passIndex: 1, timeSec: 13, confirmed: false },
      ])
      expect(result.timing.playOrder).toEqual([
        { from: 1, to: 3 },
        { from: 1, to: 3 },
        { from: 4, to: 7 },
      ])
      expect(result.timing.locators).toHaveLength(10)
      expect(unmatchedSlots(result.timing)).toEqual([])
    })

    it('plain delete of bar 4 in the repeat: bars 1-3 keep both passes, both locators of bar 4 are dropped and returned', () => {
      const { timing, page } = repeatMap()

      const result = deleteBar(timing, page, 4, 'plain')

      expectOrdered(result.timing)
      expect(result.timing.playOrder).toEqual([
        { from: 1, to: 3 },
        { from: 1, to: 3 },
        { from: 4, to: 7 },
      ])
      for (const bar of [1, 2, 3]) {
        expect(chainedLocators(result.timing, bar)).toEqual(chainedLocators(timing, bar))
      }
      // pass 1 of bar 4 has no slot any more; pass 0 (7 s) would follow (3, pass 1) at 13 s
      expect(chainedLocators(result.timing, 4)).toEqual([])
      expect(result.droppedLocators).toEqual(
        expect.arrayContaining([
          { bar: 4, passIndex: 0, timeSec: 7, confirmed: false },
          { bar: 4, passIndex: 1, timeSec: 15, confirmed: false },
        ]),
      )
      // bar 8 had a locator too, and bar 8 no longer exists
      expect(ids(result.droppedLocators)).toEqual(['4:0', '4:1', '8:0'])
    })

    it('volta: ripple delete of bar 8 (1st ending) leaves rows [1-7, 1-7, 8-11] and every 2nd-ending locator moves down', () => {
      const { timing, page } = voltaMap()

      const result = deleteBar(timing, page, 8, 'ripple')

      expectOrdered(result.timing)
      expect(result.timing.barCount).toBe(11)
      expect(result.timing.playOrder).toEqual([
        { from: 1, to: 7 },
        { from: 1, to: 7 },
        { from: 8, to: 11 },
      ])
      expect(result.droppedLocators).toEqual([{ bar: 8, passIndex: 0, timeSec: 15, confirmed: false }])
      // old 2nd ending bars 9-12 (31, 33, 35, 37 s) are now bars 8-11
      for (const [bar, timeSec] of [[8, 31], [9, 33], [10, 35], [11, 37]]) {
        expect(chainedLocators(result.timing, bar)).toEqual([{ bar, passIndex: 0, timeSec, confirmed: false }])
      }
      // bars 1-7 keep both passes
      for (const bar of [1, 2, 3, 4, 5, 6, 7]) {
        expect(chainedLocators(result.timing, bar)).toEqual(chainedLocators(timing, bar))
      }
      expect(result.timing.locators).toHaveLength(18)
      expect(unmatchedSlots(result.timing)).toEqual([])
    })

    it('volta: ripple insert at 3 (split bar 2) moves both passes of bars 3-7 and the single locator of the endings', () => {
      const { timing, page } = voltaMap()

      const result = insertBar(timing, page, 3, NEW_BOX, 'ripple')

      expectOrdered(result.timing)
      expect(result.timing.playOrder).toEqual([
        { from: 1, to: 9 },
        { from: 1, to: 8 },
        { from: 10, to: 13 },
      ])
      expect(chainedLocators(result.timing, 4).map((l) => [l.passIndex, l.timeSec])).toEqual([
        [0, 5],
        [1, 21],
      ])
      expect(chainedLocators(result.timing, 9)).toEqual([{ bar: 9, passIndex: 0, timeSec: 15, confirmed: false }])
      expect(chainedLocators(result.timing, 10)).toEqual([{ bar: 10, passIndex: 0, timeSec: 31, confirmed: false }])
      expect(unmatchedSlots(result.timing)).toEqual([
        { position: 2, bar: 3, passIndex: 0 },
        { position: 11, bar: 3, passIndex: 1 },
      ])
    })
  })

  describe('moveLocator', () => {
    it('sets the new time and confirmed: true', () => {
      const { timing } = repeatMap()

      const result = moveLocator(timing, 3, 0, 5.5)

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expectOrdered(result.timing)
      expect(locatorOf(result.timing, 3, 0)).toEqual({ bar: 3, passIndex: 0, timeSec: 5.5, confirmed: true })
      expect(result.droppedLocators).toEqual([])
      expect(result.timing.locators).toHaveLength(12)
      expect(result.timing.barCount).toBe(timing.barCount)
      expect(result.timing.playOrder).toEqual(timing.playOrder)
    })

    it('changes only the given locator: every other locator, including the chained twin, stays as it was', () => {
      const { timing } = repeatMap()

      const result = moveLocator(timing, 3, 0, 5.5)

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(othersOf(result.timing, 3, 0)).toEqual(othersOf(timing, 3, 0))
    })

    it.each([false, true])('moves one pass of a repeated bar: the twin keeps its time and confirmed flag (%s)', (twinConfirmed) => {
      const base = withConfirmed(repeatMap().timing, 3, 0, twinConfirmed)

      const result = moveLocator(base, 3, 1, 13.5)

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expectOrdered(result.timing)
      expect(chainedLocators(result.timing, 3)).toEqual([
        { bar: 3, passIndex: 0, timeSec: 5, confirmed: twinConfirmed },
        { bar: 3, passIndex: 1, timeSec: 13.5, confirmed: true },
      ])
    })

    it('accepts any time strictly between the neighbouring located slots, also the locator\'s own time', () => {
      const { timing } = repeatMap()

      // (3, pass 0) sits at 5 s between (2, pass 0) at 3 s and (4, pass 0) at 7 s
      expect(moveLocator(timing, 3, 0, 3.001).ok).toBe(true)
      expect(moveLocator(timing, 3, 0, 6.999).ok).toBe(true)
      expect(moveLocator(timing, 3, 0, 5).ok).toBe(true)
    })

    it('returns out-of-range when the time reaches or passes a neighbour', () => {
      const { timing } = repeatMap()

      expect(moveLocator(timing, 3, 0, 7.5)).toEqual({ ok: false, reason: 'out-of-range' })
      expect(moveLocator(timing, 3, 0, 2.5)).toEqual({ ok: false, reason: 'out-of-range' })
      // exactly the time of a neighbour breaks "strictly increasing"
      expect(moveLocator(timing, 3, 0, 7)).toEqual({ ok: false, reason: 'out-of-range' })
      expect(moveLocator(timing, 3, 0, 3)).toEqual({ ok: false, reason: 'out-of-range' })
    })

    it('orders along the play order, not by bar number: the second pass of bar 1 sits between (4, pass 0) and (2, pass 1)', () => {
      const { timing } = repeatMap()

      // (1, pass 1) is at 9 s between (4, pass 0) at 7 s and (2, pass 1) at 11 s
      expect(moveLocator(timing, 1, 1, 6)).toEqual({ ok: false, reason: 'out-of-range' })
      expect(moveLocator(timing, 1, 1, 12)).toEqual({ ok: false, reason: 'out-of-range' })
      expect(moveLocator(timing, 1, 1, 8).ok).toBe(true)
      // (1, pass 0) is the first slot: it may not jump over (2, pass 0) at 3 s even though its twin is at 9 s
      expect(moveLocator(timing, 1, 0, 8)).toEqual({ ok: false, reason: 'out-of-range' })
    })

    it('measures against the nearest located slots and skips unmatched ones', () => {
      const { timing } = repeatMap()
      const gap = withoutLocator(timing, 4, 0)

      // (4, pass 0) at 7 s is gone, so (3, pass 0) may now move up to just below (1, pass 1) at 9 s
      expect(moveLocator(timing, 3, 0, 8.9)).toEqual({ ok: false, reason: 'out-of-range' })
      expect(moveLocator(gap, 3, 0, 8.9).ok).toBe(true)
      expect(moveLocator(gap, 3, 0, 9)).toEqual({ ok: false, reason: 'out-of-range' })
    })

    it('is bounded on one side only at the first and the last slot', () => {
      const { timing } = repeatMap()

      expect(moveLocator(timing, 1, 0, 0).ok).toBe(true)
      expect(moveLocator(timing, 1, 0, 3)).toEqual({ ok: false, reason: 'out-of-range' })
      expect(moveLocator(timing, 8, 0, 1000).ok).toBe(true)
      expect(moveLocator(timing, 8, 0, 21)).toEqual({ ok: false, reason: 'out-of-range' })
    })

    it('returns out-of-range for a negative or non-finite time', () => {
      const { timing } = repeatMap()

      expect(moveLocator(timing, 1, 0, -0.5)).toEqual({ ok: false, reason: 'out-of-range' })
      expect(moveLocator(timing, 3, 0, Number.NaN)).toEqual({ ok: false, reason: 'out-of-range' })
      expect(moveLocator(timing, 8, 0, Number.POSITIVE_INFINITY)).toEqual({ ok: false, reason: 'out-of-range' })
    })

    it('returns not-found when the bar or the pass has no locator', () => {
      const { timing } = repeatMap()

      expect(moveLocator(timing, 9, 0, 5)).toEqual({ ok: false, reason: 'not-found' })
      expect(moveLocator(timing, 6, 1, 5)).toEqual({ ok: false, reason: 'not-found' })
      expect(moveLocator(withoutLocator(timing, 3, 0), 3, 0, 5)).toEqual({ ok: false, reason: 'not-found' })
    })

    it('does not mutate its input', () => {
      const { timing } = repeatMap()
      const before = structuredClone(timing)

      moveLocator(timing, 3, 0, 5.5)
      moveLocator(timing, 3, 0, 99)

      expect(timing).toEqual(before)
    })
  })

  describe('confirmLocator', () => {
    it('sets confirmed: true and keeps the time ("Sounds right")', () => {
      const { timing } = repeatMap()

      const result = confirmLocator(timing, 3, 1)

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expectOrdered(result.timing)
      expect(locatorOf(result.timing, 3, 1)).toEqual({ bar: 3, passIndex: 1, timeSec: 13, confirmed: true })
      expect(result.droppedLocators).toEqual([])
      expect(result.timing.locators).toHaveLength(12)
    })

    it('changes only the given locator, not its chained twin', () => {
      const { timing } = repeatMap()

      const result = confirmLocator(timing, 3, 1)

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(locatorOf(result.timing, 3, 0)).toEqual({ bar: 3, passIndex: 0, timeSec: 5, confirmed: false })
      expect(othersOf(result.timing, 3, 1)).toEqual(othersOf(timing, 3, 1))
    })

    it('keeps an already confirmed locator confirmed', () => {
      const confirmed = withConfirmed(repeatMap().timing, 3, 0, true)

      const result = confirmLocator(confirmed, 3, 0)

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.timing).toEqual(confirmed)
    })

    it('returns not-found when the bar or the pass has no locator', () => {
      const { timing } = repeatMap()

      expect(confirmLocator(timing, 9, 0)).toEqual({ ok: false, reason: 'not-found' })
      expect(confirmLocator(timing, 6, 1)).toEqual({ ok: false, reason: 'not-found' })
    })

    it('does not mutate its input', () => {
      const { timing } = repeatMap()
      const before = structuredClone(timing)

      confirmLocator(timing, 3, 1)

      expect(timing).toEqual(before)
    })
  })
})

describe('insertBarInTiming and deleteBarFromTiming', () => {
  const maps = [
    ['straight', straightMap(8)],
    ['repeat', repeatMap()],
    ['volta', voltaMap()],
  ] as const

  describe.each(maps)('on the %s map', (_name, { timing, page }) => {
    it.each(['plain', 'ripple'] as const)('insertBarInTiming equals the timing of insertBar (%s)', (mode) => {
      for (let at = 1; at <= timing.barCount + 1; at++) {
        const whole = insertBar(timing, page, at, { pageIndex: 0, x: 0, y: 0, w: 10, h: 10 }, mode)

        const half = insertBarInTiming(timing, at, mode)

        expect(half.timing).toEqual(whole.timing)
        expect(half.droppedLocators).toEqual(whole.droppedLocators)
      }
    })

    it.each(['plain', 'ripple'] as const)('deleteBarFromTiming equals the timing of deleteBar (%s)', (mode) => {
      for (let bar = 1; bar <= timing.barCount; bar++) {
        const whole = deleteBar(timing, page, bar, mode)

        const half = deleteBarFromTiming(timing, bar, mode)

        expect(half.timing).toEqual(whole.timing)
        expect(half.droppedLocators).toEqual(whole.droppedLocators)
      }
    })
  })

  it('refuses the same bars as the whole edits', () => {
    const { timing } = straightMap(4)

    expect(() => insertBarInTiming(timing, 0, 'plain')).toThrow(RangeError)
    expect(() => insertBarInTiming(timing, 6, 'plain')).toThrow(RangeError)
    expect(() => deleteBarFromTiming(timing, 5, 'plain')).toThrow(RangeError)
    expect(() => deleteBarFromTiming(straightMap(1).timing, 1, 'plain')).toThrow(RangeError)
  })
})

describe('relabelLocator', () => {
  const edited = (timing: TimingLayer, bar: number, pass: number, newBar: number, newPass: number) => {
    const edit = relabelLocator(timing, bar, pass, newBar, newPass)
    if (!edit.ok) throw new Error(`expected a relabel, got ${edit.reason}`)
    return edit
  }
  const at = (timing: TimingLayer, bar: number, pass: number) =>
    timing.locators.find((l) => l.bar === bar && l.passIndex === pass)

  it('relabels 12 (pass 0) as 13 and shifts every later locator one slot, both passes of the repeat', () => {
    const { timing } = demoDoc()

    const edit = edited(timing, 12, 0, 13, 0)

    // the locator keeps its time under the new label; the one it displaces and all later ones move one slot on
    expect(at(edit.timing, 13, 0)?.timeSec).toBe(at(timing, 12, 0)?.timeSec)
    expect(at(edit.timing, 14, 0)?.timeSec).toBe(at(timing, 13, 0)?.timeSec)
    expect(at(edit.timing, 9, 1)?.timeSec).toBe(at(timing, 16, 0)?.timeSec)
    expect(at(edit.timing, 10, 1)?.timeSec).toBe(at(timing, 9, 1)?.timeSec)
    expect(at(edit.timing, 17, 0)?.timeSec).toBe(at(timing, 16, 1)?.timeSec)
    // the locators before 12 stay, and slot 12:0 is now unmatched
    expect(at(edit.timing, 11, 0)).toEqual(at(timing, 11, 0))
    expect(at(edit.timing, 12, 0)).toBeUndefined()
  })

  it('drops the locator pushed past the last slot', () => {
    const { timing } = demoDoc()

    const edit = edited(timing, 12, 0, 13, 0)

    expect(edit.droppedLocators.map((l) => `${l.bar}:${l.passIndex}`)).toEqual(['64:0'])
    expect(edit.timing.locators).toHaveLength(timing.locators.length - 1)
    expect(at(edit.timing, 64, 0)?.timeSec).toBe(at(timing, 63, 0)?.timeSec)
  })

  it('moving back overwrites the locators in between, which are dropped', () => {
    const { timing } = demoDoc()

    const edit = edited(timing, 20, 0, 18, 0)

    expect(at(edit.timing, 18, 0)?.timeSec).toBe(at(timing, 20, 0)?.timeSec)
    expect(at(edit.timing, 19, 0)?.timeSec).toBe(at(timing, 21, 0)?.timeSec)
    expect(edit.droppedLocators.map((l) => `${l.bar}:${l.passIndex}`)).toEqual(['18:0', '19:0'])
    // the end of the piece is now unmatched, two slots from the end
    expect(at(edit.timing, 63, 0)).toBeUndefined()
    expect(at(edit.timing, 64, 0)).toBeUndefined()
  })

  it('relabelling to its own label changes nothing', () => {
    const { timing } = demoDoc()

    const edit = edited(timing, 12, 0, 12, 0)

    expect(edit.timing.locators).toEqual(timing.locators)
    expect(edit.droppedLocators).toEqual([])
  })

  it('carries confirmed, flags and checked with the shifted locators', () => {
    const { timing } = demoDoc()
    const flag: ReviewFlag = { kind: 'crowded', severity: 1, expected: 3.6, found: 1.8, factor: 0.5, explainedBy: null, uncertainLine: null }
    const flagged = {
      ...timing,
      locators: timing.locators.map((l) => (l.bar === 14 && l.passIndex === 0 ? { ...l, flags: [flag], checked: true } : l)),
    }

    const edit = edited(flagged, 12, 0, 13, 0)

    expect(at(edit.timing, 15, 0)).toMatchObject({ confirmed: true, flags: [flag], checked: true })
    expect(at(edit.timing, 15, 1)).toMatchObject({ confirmed: true })
    expect(at(edit.timing, 14, 1)).toMatchObject({ confirmed: false })
    expect(at(edit.timing, 14, 0)).not.toHaveProperty('flags')
  })

  it('refuses a locator that does not exist and a label that is not in the play order', () => {
    const { timing } = demoDoc()

    expect(relabelLocator(withoutLocator(timing, 12, 0), 12, 0, 13, 0)).toEqual({ ok: false, reason: 'not-found' })
    expect(relabelLocator(timing, 12, 0, 13, 2)).toEqual({ ok: false, reason: 'out-of-range' })
    expect(relabelLocator(timing, 12, 0, 70, 0)).toEqual({ ok: false, reason: 'out-of-range' })
  })

  it('does not change its input', () => {
    const { timing } = demoDoc()
    const copy = structuredClone(timing)

    relabelLocator(timing, 12, 0, 13, 0)

    expect(timing).toEqual(copy)
  })
})

describe('short bars follow their bars through an insert and a delete', () => {
  function shortened(): TimingLayer {
    const { timing } = straightMap(8)
    return {
      ...timing,
      playOrder: [{ from: 0, to: 8 }],
      shortBars: [{ bar: 0, units: 1 }, { bar: 5, units: 3 }],
      locators: [{ bar: 0, passIndex: 0, timeSec: 0.5, confirmed: false }, ...timing.locators],
    }
  }

  it('moves a short bar up with its bar, and leaves the pickup at 0', () => {
    const { timing } = insertBarInTiming(shortened(), 3, 'ripple')

    expect(timing.shortBars).toEqual([{ bar: 0, units: 1 }, { bar: 6, units: 3 }])
    expect(timing.playOrder).toEqual([{ from: 0, to: 9 }])
  })

  it('inserting before bar 1 keeps the pickup in front', () => {
    const { timing } = insertBarInTiming(shortened(), 1, 'ripple')

    expect(timing.shortBars).toEqual([{ bar: 0, units: 1 }, { bar: 6, units: 3 }])
    expect(timing.locators[0]).toMatchObject({ bar: 0, timeSec: 0.5 })
  })

  it('moves a short bar down when an earlier bar goes, and drops its length when its own bar goes', () => {
    expect(deleteBarFromTiming(shortened(), 2, 'ripple').timing.shortBars).toEqual([{ bar: 0, units: 1 }, { bar: 4, units: 3 }])
    expect(deleteBarFromTiming(shortened(), 5, 'ripple').timing.shortBars).toEqual([{ bar: 0, units: 1 }])
  })

  it('leaves no list behind when the last short bar goes', () => {
    const { timing } = straightMap(8)
    const one: TimingLayer = { ...timing, shortBars: [{ bar: 5, units: 3 }] }

    expect(deleteBarFromTiming(one, 5, 'plain').timing).not.toHaveProperty('shortBars')
  })

  it('does not add a list to a map that has none', () => {
    expect(insertBarInTiming(straightMap(8).timing, 3, 'plain').timing).not.toHaveProperty('shortBars')
  })
})

describe('insertIntoRests and deleteFromRests', () => {
  it('insert: the rests on or after the new bar follow their bars up', () => {
    expect(insertIntoRests([2, 3, 4, 9], 3)).toEqual([2, 4, 5, 10])
    expect(insertIntoRests([], 3)).toEqual([])
  })

  it('delete: the rest on the deleted bar goes and later rests follow their bars down', () => {
    expect(deleteFromRests([2, 3, 4, 9], 3)).toEqual([2, 3, 8])
    expect(deleteFromRests([3], 3)).toEqual([])
  })
})
