import { barNamesOf } from './barNames'
import {
  expandPlayOrder,
  formatPlayOrder,
  parsePlayOrder,
  slotOf,
  straightThrough,
  twinsOf,
  unplayedBars,
} from '@/domain/playOrder'
import { type PlayOrderRow } from '@/domain/types'

describe('straightThrough', () => {
  it('is one row from bar 1 to the last bar', () => {
    expect(straightThrough(8)).toEqual([{ from: 1, to: 8 }])
  })
})

describe('expandPlayOrder', () => {
  it('expands a plain piece into one slot per bar, all on the first pass', () => {
    const slots = expandPlayOrder(straightThrough(8), 8)

    expect(slots).toHaveLength(8)
    expect(slots.map((s) => s.bar)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect(slots.map((s) => s.position)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    expect(slots.every((s) => s.passIndex === 0)).toBe(true)
  })

  it('counts the second pass of a simple repeat and finds the twins', () => {
    const rows: PlayOrderRow[] = [
      { from: 1, to: 4 },
      { from: 1, to: 4 },
      { from: 5, to: 8 },
    ]
    const slots = expandPlayOrder(rows, 8)

    expect(slots).toHaveLength(12)
    expect(slots[4]).toEqual({ position: 4, bar: 1, passIndex: 1 })
    expect(twinsOf(slots, 3)).toEqual([
      { position: 2, bar: 3, passIndex: 0 },
      { position: 6, bar: 3, passIndex: 1 },
    ])
  })

  it('plays the first ending once and the second ending after the repeat', () => {
    const rows: PlayOrderRow[] = [
      { from: 1, to: 8 },
      { from: 1, to: 7 },
      { from: 9, to: 12 },
    ]
    const slots = expandPlayOrder(rows, 12)

    expect(slots).toHaveLength(19)
    expect(slots.filter((s) => s.bar === 8)).toEqual([
      { position: 7, bar: 8, passIndex: 0 },
    ])
    for (let bar = 1; bar <= 7; bar++) {
      expect(slots.filter((s) => s.bar === bar)).toHaveLength(2)
    }
    expect(slots[14]).toEqual({ position: 14, bar: 7, passIndex: 1 })
    expect(slots[15]).toEqual({ position: 15, bar: 9, passIndex: 0 })
  })

  it('replays the section after a D.S. al coda jump on its second pass', () => {
    const rows: PlayOrderRow[] = [
      { from: 1, to: 12 },
      { from: 5, to: 8 },
      { from: 13, to: 16 },
    ]
    const slots = expandPlayOrder(rows, 16)

    expect(slots).toHaveLength(20)
    expect(slots.slice(12, 16)).toEqual([
      { position: 12, bar: 5, passIndex: 1 },
      { position: 13, bar: 6, passIndex: 1 },
      { position: 14, bar: 7, passIndex: 1 },
      { position: 15, bar: 8, passIndex: 1 },
    ])
  })

  it('does not mutate its input', () => {
    const rows: PlayOrderRow[] = [
      { from: 1, to: 4 },
      { from: 1, to: 4 },
    ]
    const before = structuredClone(rows)

    expandPlayOrder(rows, 4)

    expect(rows).toEqual(before)
  })

  it('throws a RangeError for a row that starts below bar 0', () => {
    expect(() => expandPlayOrder([{ from: -1, to: 3 }], 8)).toThrow(RangeError)
  })

  it('throws a RangeError for a row that runs backwards', () => {
    expect(() => expandPlayOrder([{ from: 5, to: 3 }], 8)).toThrow(RangeError)
  })

  it('throws a RangeError for a row that ends past the last bar', () => {
    expect(() => expandPlayOrder([{ from: 1, to: 9 }], 8)).toThrow(RangeError)
  })

  it('throws a RangeError for a row with a non-integer bar', () => {
    expect(() => expandPlayOrder([{ from: 1.5, to: 3 }], 8)).toThrow(
      RangeError,
    )
    expect(() => expandPlayOrder([{ from: 1, to: 2.5 }], 8)).toThrow(
      RangeError,
    )
  })

  it('throws a RangeError when the bar count is below 1', () => {
    expect(() => expandPlayOrder([], 0)).toThrow(RangeError)
  })
})

describe('slotOf', () => {
  it('finds the slot of a bar on a given pass', () => {
    const slots = expandPlayOrder(
      [
        { from: 1, to: 2 },
        { from: 1, to: 2 },
      ],
      2,
    )

    expect(slotOf(slots, 2, 1)).toEqual({ position: 3, bar: 2, passIndex: 1 })
    expect(slotOf(slots, 2, 2)).toBeUndefined()
  })
})

describe('twinsOf', () => {
  it('lists every pass of a bar in order', () => {
    const slots = expandPlayOrder(
      [
        { from: 1, to: 2 },
        { from: 1, to: 2 },
        { from: 1, to: 2 },
      ],
      2,
    )

    expect(twinsOf(slots, 1).map((s) => s.passIndex)).toEqual([0, 1, 2])
    expect(twinsOf(slots, 1).map((s) => s.position)).toEqual([0, 2, 4])
  })
})

describe('unplayedBars', () => {
  it('lists the bars no row plays', () => {
    expect(
      unplayedBars(
        [
          { from: 1, to: 4 },
          { from: 7, to: 8 },
        ],
        8,
      ),
    ).toEqual([5, 6])
  })
})

describe('parsePlayOrder', () => {
  it('parses rows with an end keyword', () => {
    expect(parsePlayOrder('1-9, 10-15, 10-15, 16-end', 20, 1, PLAIN)).toEqual([
      { from: 1, to: 9 },
      { from: 10, to: 15 },
      { from: 10, to: 15 },
      { from: 16, to: 20 },
    ])
  })

  it('parses a single bar as a one-bar row', () => {
    expect(parsePlayOrder('3', 20, 1, PLAIN)).toEqual([{ from: 3, to: 3 }])
  })

  it('accepts an en dash and newlines between rows', () => {
    expect(parsePlayOrder('1–4\n1–4', 8, 1, PLAIN)).toEqual([
      { from: 1, to: 4 },
      { from: 1, to: 4 },
    ])
  })

  it('accepts semicolons between rows and ignores whitespace', () => {
    expect(parsePlayOrder(' 1 - 4 ; 5 - end ', 8, 1, PLAIN)).toEqual([
      { from: 1, to: 4 },
      { from: 5, to: 8 },
    ])
  })

  it('reads empty text as a straight run through the piece', () => {
    expect(parsePlayOrder('', 20, 1, PLAIN)).toEqual([{ from: 1, to: 20 }])
  })

  it('throws a RangeError on a row it cannot read', () => {
    expect(() => parsePlayOrder('1-x', 20, 1, PLAIN)).toThrow(RangeError)
  })
})

const PLAIN = barNamesOf(undefined)
const TOP = barNamesOf([{ bar: 0, units: 1 }])
// internal 0..12; the pickup is bar 0 and bar 7 an unnumbered pickup: p1, 1..6, p7, 7..11
const MID = barNamesOf([{ bar: 0, units: 1 }, { bar: 7, units: 2, unnumbered: true }])

describe('p labels in the play order', () => {
  it('reads p labels and numbers, so "p1-6, p7-9" covers the pickup and "1-6, 7-9" skips it', () => {
    expect(parsePlayOrder('p1-6, p7-9', 12, 0, MID)).toEqual([{ from: 0, to: 6 }, { from: 7, to: 10 }])
    expect(parsePlayOrder('1-6, 7-9', 12, 0, MID)).toEqual([{ from: 1, to: 6 }, { from: 8, to: 10 }])
    expect(parsePlayOrder('P7', 12, 0, MID)).toEqual([{ from: 7, to: 7 }])
    expect(parsePlayOrder('p7-end', 12, 0, MID)).toEqual([{ from: 7, to: 12 }])
  })

  it('writes the same labels back, and a range that spans a pickup covers it', () => {
    const rows = [{ from: 0, to: 6 }, { from: 7, to: 10 }, { from: 1, to: 8 }, { from: 7, to: 12 }]
    expect(formatPlayOrder(rows, 12, MID)).toBe('p1-6, p7-9, 1-7, p7-end')
    expect(parsePlayOrder(formatPlayOrder(rows, 12, MID), 12, 0, MID)).toEqual(rows)
  })

  it('refuses a p label where the piece has no such pickup', () => {
    expect(() => parsePlayOrder('p9-12', 12, 0, MID)).toThrow(RangeError)
    expect(() => parsePlayOrder('p2', 12, 1, PLAIN)).toThrow(RangeError)
  })
})

describe('formatPlayOrder', () => {
  it('writes ranges, single bars and end', () => {
    expect(
      formatPlayOrder(
        [
          { from: 1, to: 9 },
          { from: 10, to: 15 },
          { from: 16, to: 20 },
        ],
        20,
        PLAIN,
      ),
    ).toBe('1-9, 10-15, 16-end')
    expect(formatPlayOrder([{ from: 3, to: 3 }], 20, PLAIN)).toBe('3')
  })

  it('round-trips through parsePlayOrder', () => {
    const rows: PlayOrderRow[] = [
      { from: 1, to: 9 },
      { from: 10, to: 15 },
      { from: 10, to: 15 },
      { from: 16, to: 20 },
      { from: 20, to: 20 },
    ]

    expect(parsePlayOrder(formatPlayOrder(rows, 20, PLAIN), 20, 1, PLAIN)).toEqual(rows)
  })
})

describe('a pickup (bar 0)', () => {
  it('starts straight through at bar 0 and expands bar 0 as the first slot', () => {
    expect(straightThrough(8, 0)).toEqual([{ from: 0, to: 8 }])
    expect(expandPlayOrder([{ from: 0, to: 3 }, { from: 2, to: 3 }], 3).map((s) => `${s.bar}:${s.passIndex}`)).toEqual([
      '0:0', '1:0', '2:0', '3:0', '2:1', '3:1',
    ])
  })

  it('reads and writes rows from 0', () => {
    expect(parsePlayOrder('p1-42, 21-end', 55, 0, TOP)).toEqual([{ from: 0, to: 42 }, { from: 21, to: 55 }])
    expect(formatPlayOrder([{ from: 0, to: 42 }, { from: 21, to: 55 }], 55, TOP)).toBe('p1-42, 21-end')
    expect(parsePlayOrder('', 8, 0, TOP)).toEqual([{ from: 0, to: 8 }])
  })

  it('lists bar 0 among the unplayed bars only when told the piece has it', () => {
    expect(unplayedBars([{ from: 1, to: 3 }], 3, 0)).toEqual([0])
    expect(unplayedBars([{ from: 1, to: 3 }], 3)).toEqual([])
  })
})
