import { describe, expect, it } from 'vitest'
import { createHistory, record, undo } from './history'
import { type EditorDoc, type EditResult, setPlayOrder, slotAfterEdit } from './pieceEdits'
import { expandPlayOrder } from './playOrder'
import { type Locator, type PlayOrderRow, type TimingLayer } from './types'

// Task 17 (Erez, 2026-11-06, Mozart): changing the first row of the play order from 0-7 to 0-8 cleared 16 recording
// times. A locator is keyed by (bar, pass); a bar played once more earlier shifts every later pass of it.

const OLD: PlayOrderRow[] = [
  { from: 0, to: 7 },
  { from: 0, to: 25 },
  { from: 8, to: 33 },
]
const NEW: PlayOrderRow[] = [
  { from: 0, to: 8 },
  { from: 0, to: 25 },
  { from: 8, to: 33 },
]

function ok(result: EditResult): Extract<EditResult, { ok: true }> {
  if (!result.ok) throw new Error(`expected an edit, got a refusal: ${result.reason}`)
  return result
}

/**
 * A piece with a pickup (bar 0) and `barCount` bars, a confirmed locator on every slot of `rows`, one second apart from 1 s.
 * `roomAfter`: one more second after that position, the room the recording has for a bar the labels leave out.
 */
function docOf(rows: PlayOrderRow[], barCount = 33, roomAfter = Infinity): EditorDoc {
  const timing: TimingLayer = {
    barCount,
    playOrder: rows,
    meters: [{ fromBar: 1, numerator: 4, denominator: 4 }],
    marks: [],
    shortBars: [{ bar: 0, units: 1 }],
    locators: expandPlayOrder(rows, barCount).map((slot) => ({ bar: slot.bar, passIndex: slot.passIndex, timeSec: 1 + slot.position + (slot.position > roomAfter ? 1 : 0), confirmed: true })),
  }
  return { timing, pages: [] }
}

const key = (l: Pick<Locator, 'bar' | 'passIndex'>) => `${l.bar}:${l.passIndex}`
const timesOf = (doc: EditorDoc) => doc.timing.locators.map((l) => l.timeSec)
const rising = (doc: EditorDoc) => {
  const slots = expandPlayOrder(doc.timing.playOrder, doc.timing.barCount)
  const at = new Map(slots.map((s) => [key(s), s.position]))
  const placed = doc.timing.locators.map((l) => ({ position: at.get(key(l)), timeSec: l.timeSec }))
  expect(placed.every((p) => p.position !== undefined)).toBe(true)
  const inPlay = [...placed].sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
  return inPlay.every((p, i) => i === 0 || p.timeSec > inPlay[i - 1].timeSec)
}

describe('setPlayOrder keeps the recording times of what is still played', () => {
  it('keeps every locator when bar 8 is added to the end of the first row', () => {
    const doc = docOf(OLD, 33, 7)
    const before = doc.timing.locators.length

    const result = ok(setPlayOrder(doc, NEW))

    expect(result.droppedLocators).toEqual([])
    expect(result.doc.timing.locators).toHaveLength(before)
    expect(timesOf(result.doc).sort((a, b) => a - b)).toEqual(timesOf(doc).sort((a, b) => a - b))
    expect(rising(result.doc)).toBe(true)
  })

  it('moves each locator to the pass its slot has in the new order, with its time', () => {
    const doc = docOf(OLD, 33, 7)
    const eightFirstTime = doc.timing.locators.find((l) => l.bar === 8 && l.passIndex === 0)?.timeSec

    const result = ok(setPlayOrder(doc, NEW))

    // The old first play of bar 8 (row 2) is now its second play; the new first play (row 1, after bar 7) has no time yet.
    expect(result.doc.timing.locators.find((l) => l.bar === 8 && l.passIndex === 1)?.timeSec).toBe(eightFirstTime)
    expect(result.doc.timing.locators.some((l) => l.bar === 8 && l.passIndex === 0)).toBe(false)
  })

  it('leaves the new slot empty, not a neighbour dropped', () => {
    const result = ok(setPlayOrder(docOf(OLD, 33, 7), NEW))
    const slots = expandPlayOrder(NEW, 33)
    const have = new Set(result.doc.timing.locators.map(key))
    expect(slots.filter((s) => !have.has(key(s))).map(key)).toEqual(['8:0'])
  })
})

describe('setPlayOrder with no room for the new bar', () => {
  it('relabels by the times, and drops nothing, when the recording has no time for the new slot between its neighbours', () => {
    const doc = docOf(OLD) // every locator one second after the last: bar 8 has no room before the repeat
    const result = ok(setPlayOrder(doc, NEW))
    expect(result.droppedLocators).toEqual([])
    expect(result.label.count ?? 0).toBeGreaterThan(0)
    expect(timesOf(result.doc)).toEqual(timesOf(doc))
    expect(rising(result.doc)).toBe(true)
  })
})

describe('setPlayOrder undo, repeats, flags and the selection', () => {
  it('undo gives back the exact earlier document', () => {
    const doc = docOf(OLD, 33, 7)
    const edit = ok(setPlayOrder(doc, NEW))
    const history = record(createHistory(doc), edit.label, edit.doc)
    expect(undo(history).present).toBe(doc)
    expect(JSON.stringify(undo(history).present)).toBe(JSON.stringify(docOf(OLD, 33, 7)))
  })

  it('does not change the doc it was given', () => {
    const doc = docOf(OLD, 33, 7)
    const frozen = JSON.stringify(doc)
    setPlayOrder(doc, NEW)
    expect(JSON.stringify(doc)).toBe(frozen)
  })

  it('keeps all locators when a rows change plays a bar a third time', () => {
    const doc = docOf([{ from: 1, to: 8 }, { from: 5, to: 8 }, { from: 9, to: 16 }], 16)
    const rows = [{ from: 1, to: 8 }, { from: 5, to: 8 }, { from: 5, to: 8 }, { from: 9, to: 16 }]

    const result = ok(setPlayOrder(doc, rows))

    expect(result.droppedLocators).toEqual([])
    expect(result.doc.timing.locators).toHaveLength(doc.timing.locators.length)
    expect(rising(result.doc)).toBe(true)
  })

  it('keeps the times when a repeat is added in front of an existing repeat', () => {
    const doc = docOf([{ from: 1, to: 8 }, { from: 1, to: 4 }, { from: 9, to: 16 }], 16)
    const rows = [{ from: 1, to: 4 }, { from: 1, to: 8 }, { from: 1, to: 4 }, { from: 9, to: 16 }]

    const result = ok(setPlayOrder(doc, rows))

    expect(result.droppedLocators).toEqual([])
    expect(result.doc.timing.locators).toHaveLength(doc.timing.locators.length)
    expect(rising(result.doc)).toBe(true)
  })

  it('a moved entry, a filled entry and the confirmed, checked and flag fields travel with their locator', () => {
    const base = docOf(OLD, 33, 7)
    const flag = { kind: 'weak-downbeat', severity: 1 } as unknown as NonNullable<Locator['flags']>[number]
    const locators = base.timing.locators.map((l) =>
      l.bar === 8 && l.passIndex === 0 ? { ...l, confirmed: false, checked: true, flags: [flag] } : l,
    )
    const doc: EditorDoc = {
      ...base,
      timing: { ...base.timing, locators },
      moved: [{ bar: 8, passIndex: 0, fromSec: 3, wasConfirmed: false }],
      filled: [{ bar: 9, passIndex: 0 }],
    }
    const eightTime = locators.find((l) => l.bar === 8 && l.passIndex === 0)?.timeSec
    const nineTime = locators.find((l) => l.bar === 9 && l.passIndex === 0)?.timeSec

    const result = ok(setPlayOrder(doc, NEW))

    const eight = result.doc.timing.locators.find((l) => l.timeSec === eightTime)
    expect(eight).toMatchObject({ bar: 8, passIndex: 1, confirmed: false, checked: true, flags: [flag] })
    expect(result.doc.moved).toEqual([{ bar: 8, passIndex: 1, fromSec: 3, wasConfirmed: false }])
    const nine = result.doc.timing.locators.find((l) => l.timeSec === nineTime)
    expect(result.doc.filled).toEqual([{ bar: nine?.bar, passIndex: nine?.passIndex }])
  })

  it('a pass-keyed selection finds its locator again by time, or finds none', () => {
    const doc = docOf(OLD, 33, 7)
    const result = ok(setPlayOrder(doc, NEW))

    expect(slotAfterEdit(doc, result.doc, { bar: 8, passIndex: 0 })).toEqual({ bar: 8, passIndex: 1 })
    expect(slotAfterEdit(doc, result.doc, { bar: 3, passIndex: 1 })).toEqual({ bar: 3, passIndex: 1 })
    expect(slotAfterEdit(doc, result.doc, { bar: 8, passIndex: 5 })).toBeNull()
  })

  it('a pass-keyed selection of a locator the edit dropped is null, not a crash', () => {
    const doc = docOf(OLD, 33, 7)
    const result = ok(setPlayOrder(doc, [{ from: 0, to: 33 }]))
    const goneOne = result.droppedLocators[0]

    expect(slotAfterEdit(doc, result.doc, { bar: goneOne.bar, passIndex: goneOne.passIndex })).toBeNull()
  })
})

describe('setPlayOrder removing a row', () => {
  it('drops the locators of a row whose bars have no place left, and counts them', () => {
    const rows = [{ from: 1, to: 8 }, { from: 9, to: 16 }, { from: 17, to: 24 }]
    const doc = docOf(rows, 24)

    const result = ok(setPlayOrder(doc, [{ from: 1, to: 8 }, { from: 17, to: 24 }]))

    expect(result.droppedLocators.map(key)).toEqual([9, 10, 11, 12, 13, 14, 15, 16].map((bar) => `${bar}:0`))
    expect(result.doc.timing.locators).toHaveLength(16)
    expect(rising(result.doc)).toBe(true)
  })

  it('drops only the extra plays of a repeated row', () => {
    const doc = docOf([{ from: 1, to: 8 }, { from: 1, to: 8 }, { from: 9, to: 16 }], 16)

    const result = ok(setPlayOrder(doc, [{ from: 1, to: 8 }, { from: 9, to: 16 }]))

    expect(result.droppedLocators).toHaveLength(8)
    expect(result.doc.timing.locators).toHaveLength(16)
    expect(rising(result.doc)).toBe(true)
  })
})
