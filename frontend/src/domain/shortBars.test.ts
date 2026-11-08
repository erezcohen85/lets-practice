import { barTally, barsInPiece, firstBar, hasPickup, pieceTally, shortUnits, tidyShortBars, validateShortBars } from '@/domain/shortBars'
import { type MeterChange, type TimingLayer } from '@/domain/types'

const SIX_EIGHT: MeterChange[] = [{ fromBar: 1, numerator: 6, denominator: 8 }]

function timing(shortBars?: TimingLayer['shortBars']): TimingLayer {
  return { barCount: 55, playOrder: [], meters: SIX_EIGHT, marks: [], locators: [], ...(shortBars === undefined ? {} : { shortBars }) }
}

describe('the pickup', () => {
  it('is bar 0, there exactly when the short bars have a bar 0', () => {
    expect(hasPickup(timing())).toBe(false)
    expect(hasPickup(timing([{ bar: 44, units: 3 }]))).toBe(false)
    expect(hasPickup(timing([{ bar: 0, units: 1 }]))).toBe(true)
  })

  it('starts the numbering at 0, and the piece then has one bar more than its printed count', () => {
    expect(firstBar(timing())).toBe(1)
    expect(firstBar(timing([{ bar: 0, units: 1 }]))).toBe(0)
    expect(barsInPiece(timing())).toBe(55)
    expect(barsInPiece(timing([{ bar: 0, units: 1 }]))).toBe(56)
  })
})

describe('the bar tally', () => {
  const boxes = (...numbers: number[]) => numbers.map((bar) => ({ bar }))

  it('counts the printed bars 1..N and names the pickup apart, for the piece and for a part alike', () => {
    expect(pieceTally(timing())).toEqual({ printed: 55, pickup: false })
    expect(pieceTally(timing([{ bar: 0, units: 1 }]))).toEqual({ printed: 55, pickup: true })
    expect(barTally(boxes(1, 2, 3))).toEqual({ printed: 3, pickup: false })
    expect(barTally(boxes(0, 1, 2, 3))).toEqual({ printed: 3, pickup: true })
  })

  it('is the same for a part and a piece that agree on the printed bars and on the pickup', () => {
    const piece = pieceTally({ ...timing([{ bar: 0, units: 1 }]), barCount: 3 })

    expect(barTally(boxes(0, 1, 2, 3))).toEqual(piece)
    expect(barTally(boxes(1, 2, 3))).not.toEqual(piece)
  })
})

describe('shortUnits', () => {
  it('is the length of a short bar, and undefined for a bar as long as its meter', () => {
    const t = timing([{ bar: 0, units: 1 }, { bar: 44, units: 3 }])

    expect(shortUnits(t, 0)).toBe(1)
    expect(shortUnits(t, 44)).toBe(3)
    expect(shortUnits(t, 1)).toBeUndefined()
    expect(shortUnits(timing(), 0)).toBeUndefined()
  })
})

describe('the tally with unnumbered bars', () => {
  const shortBars = [{ bar: 0, units: 1 }, { bar: 7, units: 2, unnumbered: true as const }, { bar: 20, units: 1, unnumbered: true as const }]
  const boxes = (...bars: number[]) => bars.map((bar) => ({ bar }))

  it('counts the numbered bars apart from the pickups: 55 bars, two of them pickups, are 53 numbered bars + the top pickup + 2 pickups', () => {
    expect(pieceTally({ ...timing(shortBars) })).toEqual({ printed: 53, pickup: true, pickups: 2 })
  })

  it('counts a part the same way, so an agreeing part has an equal tally', () => {
    const all = Array.from({ length: 56 }, (_, bar) => bar)
    expect(barTally(boxes(...all), shortBars)).toEqual(pieceTally(timing(shortBars)))
  })
})

describe('validateShortBars', () => {
  it('accepts a pickup and a bar shorter than its meter', () => {
    expect(validateShortBars([{ bar: 0, units: 1 }, { bar: 44, units: 5 }], SIX_EIGHT, 55)).toEqual([])
  })

  it('refuses a bar outside the piece, twice, or as long as (or longer than) its meter', () => {
    const errors = validateShortBars(
      [{ bar: 56, units: 1 }, { bar: 3, units: 2 }, { bar: 3, units: 4 }, { bar: 4, units: 6 }, { bar: 5, units: 0 }, { bar: 6, units: 1.5 }],
      SIX_EIGHT,
      55,
    )

    expect(errors).toEqual([
      { index: 0, problem: 'out-of-range' },
      { index: 2, problem: 'duplicate' },
      { index: 3, problem: 'not-shorter' },
      { index: 4, problem: 'not-shorter' },
      { index: 5, problem: 'out-of-range' },
    ])
  })

  it('judges a bar against the meter in force there', () => {
    const meters: MeterChange[] = [...SIX_EIGHT, { fromBar: 10, numerator: 3, denominator: 4 }]

    expect(validateShortBars([{ bar: 12, units: 3 }], meters, 55)).toEqual([{ index: 0, problem: 'not-shorter' }])
    expect(validateShortBars([{ bar: 9, units: 3 }], meters, 55)).toEqual([])
  })
})

describe('validateShortBars with unnumbered bars', () => {
  it('accepts an unnumbered pickup in the middle, next to a numbered bar', () => {
    expect(validateShortBars([{ bar: 0, units: 1 }, { bar: 7, units: 2, unnumbered: true }, { bar: 20, units: 2, unnumbered: true }], SIX_EIGHT, 55)).toEqual([])
  })

  it('refuses an unnumbered bar that is the first bar (that is the top pickup), the last bar (no numbered bar follows), or next to another one (two would read the same label)', () => {
    const errors = validateShortBars(
      [{ bar: 1, units: 1, unnumbered: true }, { bar: 10, units: 1, unnumbered: true }, { bar: 11, units: 1, unnumbered: true }, { bar: 55, units: 1, unnumbered: true }],
      SIX_EIGHT,
      55,
    )

    expect(errors).toEqual([
      { index: 0, problem: 'bad-unnumbered' },
      { index: 1, problem: 'bad-unnumbered' },
      { index: 2, problem: 'bad-unnumbered' },
      { index: 3, problem: 'bad-unnumbered' },
    ])
  })
})

describe('tidyShortBars', () => {
  it('sorts by bar and gives undefined for none', () => {
    expect(tidyShortBars([{ bar: 9, units: 1 }, { bar: 0, units: 2 }])).toEqual([{ bar: 0, units: 2 }, { bar: 9, units: 1 }])
    expect(tidyShortBars([])).toBeUndefined()
  })
})
