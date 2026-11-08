import { barNamesOf } from './barNames'
import { type EditorDoc } from './pieceEdits'
import { markPickupBar, setPickupBarUnits, unmarkPickupBar } from './pickup'
import { type BarBox } from './types'

const BARS = 20

function box(bar: number, over: Partial<BarBox> = {}): BarBox {
  return { bar, pageIndex: 0, x: 10 * bar, y: 20, w: 9, h: 40, ...over }
}

function doc(shortBars?: EditorDoc['timing']['shortBars']): EditorDoc {
  // the oboe rests bars 10-12 in one box
  const oboe = Array.from({ length: BARS }, (_, i) => box(i + 1)).map((b) => (b.bar >= 10 && b.bar <= 12 ? box(b.bar, { x: 100, w: 30 }) : b))
  return {
    timing: {
      barCount: BARS,
      playOrder: [{ from: 1, to: BARS }],
      meters: [{ fromBar: 1, numerator: 4, denominator: 4 }],
      marks: [],
      locators: [{ bar: 7, passIndex: 0, timeSec: 12, confirmed: true }],
      ...(shortBars === undefined ? {} : { shortBars }),
    },
    pages: [
      { partId: 'flute', bars: Array.from({ length: BARS }, (_, i) => box(i + 1)), rests: [] },
      { partId: 'oboe', bars: oboe, rests: [10, 11, 12] },
    ],
  }
}

function ok(result: ReturnType<typeof markPickupBar>): EditorDoc {
  if (!result.ok) throw new Error(`refused: ${result.reason}`)
  return result.doc
}

describe('markPickupBar', () => {
  it('flags the bar as short and unnumbered and changes nothing else: boxes, locators and the play order keep their internal numbers', () => {
    const before = doc()
    const after = ok(markPickupBar(before, 7, 2))

    expect(after.timing.shortBars).toEqual([{ bar: 7, units: 2, unnumbered: true }])
    expect(after.timing.locators).toBe(before.timing.locators)
    expect(after.timing.playOrder).toBe(before.timing.playOrder)
    expect(after.timing.barCount).toBe(BARS)
    expect(after.pages).toBe(before.pages)
  })

  it('numbers return and shift: the bar reads p7 and the bars after it read one lower', () => {
    const names = barNamesOf(ok(markPickupBar(doc(), 7, 2)).timing.shortBars)

    expect([6, 7, 8].map((bar) => names.label(bar))).toEqual(['6', 'p7', '7'])
  })

  it('keeps the length of a bar that is already short as the starting value, and keeps the list in bar order', () => {
    const after = ok(markPickupBar(doc([{ bar: 3, units: 3 }, { bar: 15, units: 1 }]), 15))

    expect(after.timing.shortBars).toEqual([{ bar: 3, units: 3 }, { bar: 15, units: 1, unnumbered: true }])
    const from = ok(markPickupBar(doc([{ bar: 9, units: 3 }]), 9))
    expect(from.timing.shortBars).toEqual([{ bar: 9, units: 3, unnumbered: true }])
  })

  it('records one undo step named for the bar', () => {
    const result = markPickupBar(doc(), 7, 1)
    expect(result.ok && result.label).toEqual({ kind: 'add-pickup-bar', bar: 7 })
  })

  it('refuses the first bar (that is the top of the piece), the last bar, a bar in a multi-rest, a bar already a pickup, and a bar next to one', () => {
    const reasons = [
      markPickupBar(doc(), 1, 1),
      markPickupBar(doc(), BARS, 1),
      markPickupBar(doc(), 11, 1),
      markPickupBar(doc([{ bar: 7, units: 1, unnumbered: true }]), 7, 1),
      markPickupBar(doc([{ bar: 7, units: 1, unnumbered: true }]), 8, 1),
      markPickupBar(doc(), 0, 1),
      markPickupBar(doc(), BARS + 3, 1),
    ].map((result) => (result.ok ? 'ok' : result.reason))

    expect(reasons).toEqual(['pickup-edge', 'pickup-edge', 'in-multi-rest', 'already-pickup', 'next-to-pickup', 'invalid', 'invalid'])
  })

  it('refuses a length that is not shorter than the meter', () => {
    const result = markPickupBar(doc(), 7, 4)
    expect(result).toEqual({ ok: false, reason: 'invalid' })
  })
})

describe('unmarkPickupBar', () => {
  it('takes the flag and the entry away; the numbers come back', () => {
    const marked = ok(markPickupBar(doc(), 7, 2))
    const after = ok(unmarkPickupBar(marked, 7))

    expect(after.timing.shortBars).toBeUndefined()
    expect(barNamesOf(after.timing.shortBars).label(8)).toBe('8')
    const result = unmarkPickupBar(marked, 7)
    expect(result.ok && result.label).toEqual({ kind: 'remove-pickup-bar', bar: 7 })
  })

  it('leaves the other short bars and the top pickup alone', () => {
    const start = doc([{ bar: 0, units: 1 }, { bar: 4, units: 2 }, { bar: 7, units: 2, unnumbered: true }])
    expect(ok(unmarkPickupBar(start, 7)).timing.shortBars).toEqual([{ bar: 0, units: 1 }, { bar: 4, units: 2 }])
  })

  it('refuses a bar that is not an unnumbered pickup, and the top pickup (pickupOff is its way)', () => {
    const start = doc([{ bar: 0, units: 1 }, { bar: 4, units: 2 }])
    expect(unmarkPickupBar(start, 4)).toEqual({ ok: false, reason: 'not-found' })
    expect(unmarkPickupBar(start, 0)).toEqual({ ok: false, reason: 'not-found' })
    expect(unmarkPickupBar(start, 9)).toEqual({ ok: false, reason: 'not-found' })
  })
})

describe('setPickupBarUnits', () => {
  it('changes the length of an unnumbered pickup and keeps its flag', () => {
    const start = ok(markPickupBar(doc(), 7, 1))
    expect(ok(setPickupBarUnits(start, 7, 3)).timing.shortBars).toEqual([{ bar: 7, units: 3, unnumbered: true }])
  })

  it('refuses a length outside 1 to numerator - 1 and a bar that is not a pickup', () => {
    const start = ok(markPickupBar(doc(), 7, 1))
    expect(setPickupBarUnits(start, 7, 4)).toEqual({ ok: false, reason: 'invalid' })
    expect(setPickupBarUnits(start, 7, 0)).toEqual({ ok: false, reason: 'invalid' })
    expect(setPickupBarUnits(start, 9, 2)).toEqual({ ok: false, reason: 'not-found' })
  })
})
