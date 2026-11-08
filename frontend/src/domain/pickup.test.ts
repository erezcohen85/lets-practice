import { type EditorDoc } from '@/domain/pieceEdits'
import { pickupOff, pickupOn } from '@/domain/pickup'
import { expandPlayOrder } from '@/domain/playOrder'
import { type BarBox, type Locator } from '@/domain/types'

// Erez's piece "2": 6/8, 56 bars of which bar 1 is really a one-eighth pickup, played 1-43, then 22-56.
const BARS = 56
const rows = [{ from: 1, to: 43 }, { from: 22, to: BARS }]

function box(bar: number): BarBox {
  return { bar, pageIndex: Math.floor((bar - 1) / 16), x: 10 * bar, y: 20, w: 9, h: 40 }
}

function pieceTwo(): EditorDoc {
  const locators: Locator[] = expandPlayOrder(rows, BARS).map((slot) => ({
    bar: slot.bar,
    passIndex: slot.passIndex,
    timeSec: 1 + 2.4 * slot.position,
    confirmed: slot.bar % 5 === 0,
    ...(slot.bar === 7 ? { flags: [], checked: true } : {}),
  }))
  return {
    timing: {
      barCount: BARS,
      playOrder: rows,
      meters: [{ fromBar: 1, numerator: 6, denominator: 8 }],
      marks: [{ bar: 1, kind: 'rit' }, { bar: 30, kind: 'fermata' }],
      locators,
    },
    pages: [
      { partId: 'violin', bars: Array.from({ length: BARS }, (_, i) => box(i + 1)), rests: [1, 2, 3] },
      { partId: 'piano', bars: Array.from({ length: BARS }, (_, i) => box(i + 1)), rests: [1, 12] },
    ],
  }
}

function on(doc: EditorDoc, units?: number): EditorDoc {
  const result = pickupOn(doc, units)
  if (!result.ok) throw new Error(`refused: ${result.reason}`)
  return result.doc
}

describe('pickupOn', () => {
  it('makes bar 1 the pickup and moves every later bar one number down: 56 bars become bar 0 and 55', () => {
    const { timing } = on(pieceTwo())

    expect(timing.barCount).toBe(55)
    expect(timing.playOrder).toEqual([{ from: 0, to: 42 }, { from: 21, to: 55 }])
    expect(timing.shortBars).toEqual([{ bar: 0, units: 1 }])
  })

  it('keeps every locator time, moves its label with its bar, and keeps flags and confirmation', () => {
    const before = pieceTwo()
    const { timing } = on(before)

    expect(timing.locators).toHaveLength(before.timing.locators.length)
    before.timing.locators.forEach((old, i) => {
      expect(timing.locators[i]).toMatchObject({ bar: old.bar - 1, passIndex: old.passIndex, timeSec: old.timeSec, confirmed: old.confirmed })
    })
    expect(timing.locators.find((l) => l.bar === 6 && l.passIndex === 0)).toMatchObject({ checked: true, flags: [] })
    expect(expandPlayOrder(timing.playOrder, timing.barCount)[0]).toMatchObject({ bar: 0, passIndex: 0 })
  })

  it('moves marks and every part box, so the first box becomes the pickup box', () => {
    const { timing, pages } = on(pieceTwo())

    expect(timing.marks).toEqual([{ bar: 0, kind: 'rit' }, { bar: 29, kind: 'fermata' }])
    for (const page of pages) {
      expect(page.bars).toHaveLength(BARS)
      expect(page.bars[0]).toMatchObject({ bar: 0, x: 10 })
      expect(page.bars[BARS - 1].bar).toBe(55)
    }
  })

  it('moves the rests of every part with its bars, each part by its own rests', () => {
    const { pages } = on(pieceTwo())

    expect(pages.map((page) => page.rests)).toEqual([[0, 1, 2], [0, 11]])
  })

  it('moves the rests back up when the pickup goes', () => {
    const off = pickupOff(on(pieceTwo()))

    expect(off.ok && off.doc.pages.map((page) => page.rests)).toEqual([[1, 2, 3], [1, 12]])
  })

  it('keeps the first meter at bar 1 and moves a later change down with its bar', () => {
    const doc = pieceTwo()
    doc.timing.meters = [{ fromBar: 1, numerator: 6, denominator: 8 }, { fromBar: 40, numerator: 3, denominator: 4 }]

    expect(on(doc).timing.meters).toEqual([{ fromBar: 1, numerator: 6, denominator: 8 }, { fromBar: 39, numerator: 3, denominator: 4 }])
  })

  it('lets a meter that began on bar 2 take over from the first when bar 2 becomes bar 1', () => {
    const doc = pieceTwo()
    doc.timing.meters = [{ fromBar: 1, numerator: 2, denominator: 8 }, { fromBar: 2, numerator: 6, denominator: 8 }]

    expect(on(doc).timing.meters).toEqual([{ fromBar: 1, numerator: 6, denominator: 8 }])
  })

  it('takes the length asked for, and moves the other short bars down', () => {
    const doc = pieceTwo()
    doc.timing.shortBars = [{ bar: 44, units: 3 }]

    expect(on(doc, 2).timing.shortBars).toEqual([{ bar: 0, units: 2 }, { bar: 43, units: 3 }])
  })

  it('refuses a piece that has a pickup, a length that is not shorter than the meter, and a one-bar piece', () => {
    const withPickup = on(pieceTwo())
    expect(pickupOn(withPickup)).toEqual({ ok: false, reason: 'invalid' })
    expect(pickupOn(pieceTwo(), 6)).toEqual({ ok: false, reason: 'invalid' })
    expect(pickupOn(pieceTwo(), 0)).toEqual({ ok: false, reason: 'invalid' })
    const one = pieceTwo()
    one.timing = { ...one.timing, barCount: 1, playOrder: [{ from: 1, to: 1 }], locators: [], marks: [] }
    expect(pickupOn(one)).toEqual({ ok: false, reason: 'invalid' })
  })

  it('is one step named toggle-pickup', () => {
    const result = pickupOn(pieceTwo())

    expect(result.ok && result.label).toEqual({ kind: 'toggle-pickup' })
  })
})

describe('pickupOff', () => {
  it('is the reverse: bar 0 becomes bar 1 and every other bar moves one number up', () => {
    const before = pieceTwo()
    const back = pickupOff(on(before))

    expect(back.ok).toBe(true)
    if (!back.ok) return
    expect(back.doc.timing).toEqual(before.timing)
    expect(back.doc.pages).toEqual(before.pages)
    expect(back.doc.timing).not.toHaveProperty('shortBars')
  })

  it('keeps the other short bars, moved up', () => {
    const doc = pieceTwo()
    doc.timing.shortBars = [{ bar: 44, units: 3 }]

    const back = pickupOff(on(doc))

    expect(back.ok && back.doc.timing.shortBars).toEqual([{ bar: 44, units: 3 }])
  })

  it('refuses a piece without a pickup', () => {
    expect(pickupOff(pieceTwo())).toEqual({ ok: false, reason: 'invalid' })
  })
})
