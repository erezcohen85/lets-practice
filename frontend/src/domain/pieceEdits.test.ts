import { deleteBarLineInPiece } from '@/domain/boxEdits'
import { createHistory, record, undo } from '@/domain/history'
import {
  addBarLine,
  deleteBarLine,
  insertPieceBar,
  MIN_BOX_WIDTH,
  moveBarLine,
  moveLineEnd,
  moveLineStart,
  partBarCount,
  partProblems,
  removePieceBar,
  setMarks,
  setMeters,
  setPlayOrder,
  validateMarks,
  validateMeters,
  validatePlayOrder,
  type EditorDoc,
  type EditResult,
} from '@/domain/pieceEdits'
import { DEMO_BAR_COUNT, demoDoc, SHORT_PART_ID } from '@/domain/pieceFixtures'
import { remapLocators } from '@/domain/locatorRemap'
import { expandPlayOrder } from '@/domain/playOrder'
import { deleteBarFromTiming, insertBarInTiming, unmatchedSlots } from '@/domain/renumber'
import { type BarBox, type Locator, type PageLayer, type TimingLayer } from '@/domain/types'

/** Freezes an object and everything inside it, so any mutation by an edit throws. */
function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value)
    Object.values(value).forEach(deepFreeze)
  }
  return value
}

function frozenDemo(): EditorDoc {
  return deepFreeze(demoDoc())
}

function ok(result: EditResult): Extract<EditResult, { ok: true }> {
  if (!result.ok) throw new Error(`expected an edit, got a refusal: ${result.reason}`)
  return result
}

function layer(doc: EditorDoc, partId: string): PageLayer {
  const found = doc.pages.find((page) => page.partId === partId)
  if (found === undefined) throw new Error(`no part ${partId}`)
  return found
}

function box(doc: EditorDoc, partId: string, bar: number): BarBox {
  const found = layer(doc, partId).bars.find((b) => b.bar === bar)
  if (found === undefined) throw new Error(`part ${partId} has no box for bar ${bar}`)
  return found
}

function locator(timing: TimingLayer, bar: number, passIndex: number): Locator | undefined {
  return timing.locators.find((l) => l.bar === bar && l.passIndex === passIndex)
}

function ids(locators: Locator[]): string[] {
  return locators.map((l) => `${l.bar}:${l.passIndex}`).sort()
}

/** A doc whose one part has a single box. */
function onePartDoc(): EditorDoc {
  const doc = demoDoc()
  return deepFreeze({
    timing: { ...doc.timing, barCount: 1, playOrder: [{ from: 1, to: 1 }], meters: [], marks: [], locators: [] },
    pages: [{ partId: 'solo', bars: [{ bar: 1, pageIndex: 0, x: 100, y: 150, w: 260, h: 300 }], rests: [] }],
  })
}

describe('the demo fixture', () => {
  it('has 64 bars, 72 slots with a locator each, three parts in order and a short trumpet', () => {
    const doc = demoDoc()

    expect(doc.timing.barCount).toBe(DEMO_BAR_COUNT)
    expect(doc.timing.locators).toHaveLength(72)
    expect(doc.pages.map((p) => p.partId)).toEqual(['clarinet', 'trumpet', 'flute'])
    expect(doc.pages.map((p) => partBarCount(p))).toEqual([64, 63, 64])
    expect(doc.timing.locators.some((l) => l.confirmed && l.bar > 12 && l.passIndex === 0)).toBe(true)
    expect(doc.timing.locators.some((l) => l.confirmed && l.bar > 12 && l.passIndex === 1)).toBe(true)
  })
})

describe('partBarCount and partProblems', () => {
  it('counts the boxes of a part', () => {
    expect(partBarCount(layer(demoDoc(), 'clarinet'))).toBe(64)
  })

  it('reports no problem for a part whose box count equals the piece bar count', () => {
    expect(partProblems(demoDoc(), 'clarinet')).toEqual([])
    expect(partProblems(demoDoc(), 'flute')).toEqual([])
  })

  it('reports a bar-count problem for the part that misses a bar line', () => {
    expect(partProblems(demoDoc(), SHORT_PART_ID)).toEqual([{ kind: 'bar-count', partBars: 63, pieceBars: 64 }])
  })
})

describe('addBarLine', () => {
  it('splits the box of the short part so it gains a box, renumbers the later boxes and fixes its problem', () => {
    const doc = frozenDemo()
    const old = box(doc, SHORT_PART_ID, 22)
    const x = old.x + 100

    const result = ok(addBarLine(doc, SHORT_PART_ID, 22, x))

    const trumpet = layer(result.doc, SHORT_PART_ID)
    expect(trumpet.bars).toHaveLength(64)
    expect(trumpet.bars.map((b) => b.bar)).toEqual(Array.from({ length: 64 }, (_, i) => i + 1))
    expect(box(result.doc, SHORT_PART_ID, 22)).toEqual({ ...old, w: 100 })
    expect(box(result.doc, SHORT_PART_ID, 23)).toEqual({ ...old, bar: 23, x, w: old.w - 100 })
    expect(box(result.doc, SHORT_PART_ID, 24)).toEqual({ ...box(doc, SHORT_PART_ID, 23), bar: 24 })
    expect(box(result.doc, SHORT_PART_ID, 64)).toEqual({ ...box(doc, SHORT_PART_ID, 63), bar: 64 })
    expect(partProblems(result.doc, SHORT_PART_ID)).toEqual([])
  })

  it('leaves the timing and the other parts untouched, with the same references', () => {
    const doc = frozenDemo()
    const x = box(doc, SHORT_PART_ID, 22).x + 100

    const result = ok(addBarLine(doc, SHORT_PART_ID, 22, x))

    expect(result.doc).not.toBe(doc)
    expect(result.doc.timing).toBe(doc.timing)
    expect(layer(result.doc, 'clarinet')).toBe(layer(doc, 'clarinet'))
    expect(layer(result.doc, 'flute')).toBe(layer(doc, 'flute'))
    expect(result.doc.pages.map((p) => p.partId)).toEqual(['clarinet', 'trumpet', 'flute'])
    expect(result.droppedLocators).toEqual([])
  })

  it('labels the step with the bar the line sits after', () => {
    const doc = frozenDemo()

    const result = ok(addBarLine(doc, 'clarinet', 5, box(doc, 'clarinet', 5).x + 100))

    expect(result.label).toEqual({ kind: 'add-bar-line', bar: 5 })
  })

  it('leaves a complete part one box too long: 65 boxes against 64 bars', () => {
    const doc = frozenDemo()

    const result = ok(addBarLine(doc, 'clarinet', 5, box(doc, 'clarinet', 5).x + 100))

    expect(partBarCount(layer(result.doc, 'clarinet'))).toBe(65)
    expect(partProblems(result.doc, 'clarinet')).toEqual([{ kind: 'bar-count', partBars: 65, pieceBars: 64 }])
  })

  it('refuses a split that would leave a box narrower than the minimum, at either end', () => {
    const doc = frozenDemo()
    const b = box(doc, 'clarinet', 5)

    expect(addBarLine(doc, 'clarinet', 5, b.x + MIN_BOX_WIDTH - 1)).toEqual({ ok: false, reason: 'too-narrow' })
    expect(addBarLine(doc, 'clarinet', 5, b.x + b.w - MIN_BOX_WIDTH + 1)).toEqual({ ok: false, reason: 'too-narrow' })
    expect(addBarLine(doc, 'clarinet', 5, b.x + MIN_BOX_WIDTH).ok).toBe(true)
    expect(addBarLine(doc, 'clarinet', 5, b.x + b.w - MIN_BOX_WIDTH).ok).toBe(true)
  })

  it('refuses an x outside the box as too narrow', () => {
    const doc = frozenDemo()
    const b = box(doc, 'clarinet', 5)

    expect(addBarLine(doc, 'clarinet', 5, b.x - 50)).toEqual({ ok: false, reason: 'too-narrow' })
    expect(addBarLine(doc, 'clarinet', 5, b.x + b.w + 50)).toEqual({ ok: false, reason: 'too-narrow' })
  })

  it('refuses a bar the part has no box for, and an unknown part', () => {
    const doc = frozenDemo()

    expect(addBarLine(doc, SHORT_PART_ID, 64, 500)).toEqual({ ok: false, reason: 'no-box' })
    expect(addBarLine(doc, 'clarinet', 0, 500)).toEqual({ ok: false, reason: 'no-box' })
    expect(addBarLine(doc, 'oboe', 1, 500)).toEqual({ ok: false, reason: 'no-box' })
  })
})

describe('deleteBarLine', () => {
  it('merges the box with the next one into their union and renumbers the later boxes down', () => {
    const doc = frozenDemo()
    const left = box(doc, 'clarinet', 21)
    const right = box(doc, 'clarinet', 22)

    const result = ok(deleteBarLine(doc, 'clarinet', 21))

    const clarinet = layer(result.doc, 'clarinet')
    expect(clarinet.bars).toHaveLength(63)
    expect(clarinet.bars.map((b) => b.bar)).toEqual(Array.from({ length: 63 }, (_, i) => i + 1))
    expect(box(result.doc, 'clarinet', 21)).toEqual({ ...left, w: left.w + right.w })
    expect(box(result.doc, 'clarinet', 22)).toEqual({ ...box(doc, 'clarinet', 23), bar: 22 })
    expect(box(result.doc, 'clarinet', 63)).toEqual({ ...box(doc, 'clarinet', 64), bar: 63 })
  })

  it('does not touch the timing or the other parts, and labels the bar the line sat after', () => {
    const doc = frozenDemo()

    const result = ok(deleteBarLine(doc, 'clarinet', 21))

    expect(result.doc.timing).toBe(doc.timing)
    expect(layer(result.doc, SHORT_PART_ID)).toBe(layer(doc, SHORT_PART_ID))
    expect(layer(result.doc, 'flute')).toBe(layer(doc, 'flute'))
    expect(result.label).toEqual({ kind: 'delete-bar-line', bar: 21 })
    expect(result.droppedLocators).toEqual([])
    expect(partProblems(result.doc, 'clarinet')).toEqual([{ kind: 'bar-count', partBars: 63, pieceBars: 64 }])
  })

  it('refuses a line that ends a staff line, a page or the last bar', () => {
    const doc = frozenDemo()

    expect(deleteBarLine(doc, 'clarinet', 4)).toEqual({ ok: false, reason: 'line-end' })
    expect(deleteBarLine(doc, 'clarinet', 16)).toEqual({ ok: false, reason: 'line-end' })
    expect(deleteBarLine(doc, 'clarinet', 64)).toEqual({ ok: false, reason: 'line-end' })
  })

  it('refuses the line after the last box of the short part but not the one before it', () => {
    const doc = frozenDemo()

    expect(deleteBarLine(doc, SHORT_PART_ID, 63)).toEqual({ ok: false, reason: 'line-end' })
    expect(deleteBarLine(doc, SHORT_PART_ID, 62).ok).toBe(true)
  })

  it('refuses a part with one box as the only bar', () => {
    expect(deleteBarLine(onePartDoc(), 'solo', 1)).toEqual({ ok: false, reason: 'only-bar' })
  })

  it('refuses a bar the part has no box for', () => {
    const doc = frozenDemo()

    expect(deleteBarLine(doc, 'clarinet', 99)).toEqual({ ok: false, reason: 'no-box' })
    expect(deleteBarLine(doc, 'oboe', 1)).toEqual({ ok: false, reason: 'no-box' })
  })
})

describe('moveBarLine', () => {
  it('sets the right edge of the box and the left edge of the next to x, keeping the outer edges', () => {
    const doc = frozenDemo()
    const left = box(doc, 'clarinet', 21)
    const right = box(doc, 'clarinet', 22)
    const x = left.x + 100

    const result = ok(moveBarLine(doc, 'clarinet', 21, x))

    const movedLeft = box(result.doc, 'clarinet', 21)
    const movedRight = box(result.doc, 'clarinet', 22)
    expect(movedLeft).toEqual({ ...left, w: 100 })
    expect(movedRight).toEqual({ ...right, x, w: right.x + right.w - x })
    expect(movedLeft.x + movedLeft.w).toBe(movedRight.x)
  })

  it('never renumbers and never changes timing, and labels the bar the line sits after', () => {
    const doc = frozenDemo()
    const x = box(doc, 'clarinet', 21).x + 100

    const result = ok(moveBarLine(doc, 'clarinet', 21, x))

    expect(result.doc.timing).toBe(doc.timing)
    expect(layer(result.doc, 'flute')).toBe(layer(doc, 'flute'))
    expect(layer(result.doc, 'clarinet').bars.map((b) => b.bar)).toEqual(layer(doc, 'clarinet').bars.map((b) => b.bar))
    expect(partProblems(result.doc, 'clarinet')).toEqual([])
    expect(result.label).toEqual({ kind: 'move-bar-line', bar: 21 })
    expect(result.droppedLocators).toEqual([])
  })

  it('refuses a move that would leave either box narrower than the minimum', () => {
    const doc = frozenDemo()
    const left = box(doc, 'clarinet', 21)
    const right = box(doc, 'clarinet', 22)

    expect(moveBarLine(doc, 'clarinet', 21, left.x + MIN_BOX_WIDTH - 1)).toEqual({ ok: false, reason: 'too-narrow' })
    expect(moveBarLine(doc, 'clarinet', 21, right.x + right.w - MIN_BOX_WIDTH + 1)).toEqual({
      ok: false,
      reason: 'too-narrow',
    })
    expect(moveBarLine(doc, 'clarinet', 21, left.x + MIN_BOX_WIDTH).ok).toBe(true)
    expect(moveBarLine(doc, 'clarinet', 21, right.x + right.w - MIN_BOX_WIDTH).ok).toBe(true)
  })

  it('refuses a line that ends a staff line, a page or the last bar', () => {
    const doc = frozenDemo()

    expect(moveBarLine(doc, 'clarinet', 4, 600)).toEqual({ ok: false, reason: 'line-end' })
    expect(moveBarLine(doc, 'clarinet', 16, 600)).toEqual({ ok: false, reason: 'line-end' })
    expect(moveBarLine(doc, 'clarinet', 64, 600)).toEqual({ ok: false, reason: 'line-end' })
  })

  it('refuses a bar the part has no box for', () => {
    expect(moveBarLine(frozenDemo(), 'clarinet', 99, 600)).toEqual({ ok: false, reason: 'no-box' })
  })
})

describe('bar-line edits on boxes that overlap by 0.6 px (a deskewed page)', () => {
  function overlappingDoc(): EditorDoc {
    const doc = demoDoc()
    const bars = layer(doc, 'clarinet').bars.map((b) => (b.bar === 21 ? { ...b, w: b.w + 0.6 } : b))
    return deepFreeze({ ...doc, pages: doc.pages.map((p) => (p.partId === 'clarinet' ? { ...p, bars } : p)) })
  }

  it('moves the line to give two contiguous boxes with the outer edges kept', () => {
    const doc = overlappingDoc()
    const left = box(doc, 'clarinet', 21)
    const right = box(doc, 'clarinet', 22)
    const x = left.x + 100

    const result = ok(moveBarLine(doc, 'clarinet', 21, x))

    const movedLeft = box(result.doc, 'clarinet', 21)
    const movedRight = box(result.doc, 'clarinet', 22)
    expect(movedLeft.x + movedLeft.w).toBe(movedRight.x)
    expect(movedLeft.x).toBe(left.x)
    expect(movedRight.x + movedRight.w).toBe(right.x + right.w)
    expect(partProblems(result.doc, 'clarinet')).toEqual([])
  })

  it('deletes the line to give one box over the union of the two', () => {
    const doc = overlappingDoc()
    const left = box(doc, 'clarinet', 21)
    const right = box(doc, 'clarinet', 22)

    const result = ok(deleteBarLine(doc, 'clarinet', 21))

    expect(box(result.doc, 'clarinet', 21)).toEqual({ ...left, w: right.x + right.w - left.x })
    expect(layer(result.doc, 'clarinet').bars).toHaveLength(63)
  })
})

describe('insertPieceBar', () => {
  it('gives exactly insertBarInTiming(after + 1) on the timing, in both modes', () => {
    const doc = frozenDemo()

    for (const mode of ['plain', 'ripple'] as const) {
      const result = ok(insertPieceBar(doc, 12, mode))

      expect(result.doc.timing).toEqual(insertBarInTiming(doc.timing, 13, mode).timing)
      expect(result.droppedLocators).toEqual(insertBarInTiming(doc.timing, 13, mode).droppedLocators)
    }
  })

  it('leaves every page layer the same object and labels the new bar number', () => {
    const doc = frozenDemo()

    const result = ok(insertPieceBar(doc, 12, 'ripple'))

    expect(result.doc.pages.map((p, i) => p === doc.pages[i])).toEqual([true, true, true])
    expect(result.label).toEqual({ kind: 'insert-piece-bar', bar: 13 })
  })

  it('treats after = 0 as before bar 1 and after = barCount as after the last bar', () => {
    const doc = frozenDemo()

    expect(ok(insertPieceBar(doc, 0, 'ripple')).label).toEqual({ kind: 'insert-piece-bar', bar: 1 })
    expect(ok(insertPieceBar(doc, 64, 'ripple')).doc.timing.barCount).toBe(65)
  })

  it('changes the problem of every part by one bar', () => {
    const doc = frozenDemo()

    const result = ok(insertPieceBar(doc, 12, 'ripple'))

    expect(partProblems(result.doc, 'clarinet')).toEqual([{ kind: 'bar-count', partBars: 64, pieceBars: 65 }])
    expect(partProblems(result.doc, SHORT_PART_ID)).toEqual([{ kind: 'bar-count', partBars: 63, pieceBars: 65 }])
    expect(partProblems(result.doc, 'flute')).toEqual([{ kind: 'bar-count', partBars: 64, pieceBars: 65 }])
  })

  it('ripple inside the repeat moves both passes after it together and leaves the new bar unmatched in both', () => {
    const doc = frozenDemo()

    const result = ok(insertPieceBar(doc, 12, 'ripple'))

    const { timing } = result.doc
    expect(result.droppedLocators).toEqual([])
    expect(timing.locators).toHaveLength(72)
    for (const pass of [0, 1]) {
      const before = locator(doc.timing, 14, pass)
      const after = locator(timing, 15, pass)
      expect(after).toEqual({ ...before, bar: 15 })
    }
    expect(locator(doc.timing, 14, 1)?.confirmed).toBe(true)
    expect(locator(timing, 15, 1)?.confirmed).toBe(true)
    expect(unmatchedSlots(timing).map((s) => `${s.bar}:${s.passIndex}`)).toEqual(['13:0', '13:1'])
  })

  it('plain inside the repeat keeps locators on their numbers and drops those left out of order', () => {
    const doc = frozenDemo()

    const result = ok(insertPieceBar(doc, 12, 'plain'))

    const dropped = ids(result.droppedLocators)
    expect(dropped.length).toBeGreaterThan(0)
    expect(dropped).toContain('14:1')
    expect(result.droppedLocators.find((l) => l.bar === 14 && l.passIndex === 1)?.confirmed).toBe(true)
    expect(ids(result.doc.timing.locators)).toEqual(
      ids(doc.timing.locators.filter((l) => !dropped.includes(`${l.bar}:${l.passIndex}`))),
    )
    expect(locator(result.doc.timing, 14, 0)).toEqual(locator(doc.timing, 14, 0))
  })

  it('refuses a bar number outside 0..barCount as invalid', () => {
    const doc = frozenDemo()

    expect(insertPieceBar(doc, -1, 'ripple')).toEqual({ ok: false, reason: 'invalid' })
    expect(insertPieceBar(doc, 65, 'ripple')).toEqual({ ok: false, reason: 'invalid' })
    expect(insertPieceBar(doc, 1.5, 'ripple')).toEqual({ ok: false, reason: 'invalid' })
  })
})

describe('removePieceBar', () => {
  it('gives exactly deleteBarFromTiming on the timing, in both modes', () => {
    const doc = frozenDemo()

    for (const mode of ['plain', 'ripple'] as const) {
      const result = ok(removePieceBar(doc, 12, mode))

      expect(result.doc.timing).toEqual(deleteBarFromTiming(doc.timing, 12, mode).timing)
      expect(result.droppedLocators).toEqual(deleteBarFromTiming(doc.timing, 12, mode).droppedLocators)
    }
  })

  it('leaves every page layer the same object, labels the removed bar and shifts every part problem', () => {
    const doc = frozenDemo()

    const result = ok(removePieceBar(doc, 23, 'ripple'))

    expect(result.doc.pages.map((p, i) => p === doc.pages[i])).toEqual([true, true, true])
    expect(result.label).toEqual({ kind: 'remove-piece-bar', bar: 23 })
    expect(partProblems(result.doc, 'clarinet')).toEqual([{ kind: 'bar-count', partBars: 64, pieceBars: 63 }])
    expect(partProblems(result.doc, SHORT_PART_ID)).toEqual([])
  })

  it('ripple reports the locators of the removed bar as dropped, one per pass', () => {
    const doc = frozenDemo()

    const result = ok(removePieceBar(doc, 12, 'ripple'))

    expect(ids(result.droppedLocators)).toEqual(['12:0', '12:1'])
  })

  it('refuses a piece with one bar as the only bar', () => {
    expect(removePieceBar(onePartDoc(), 1, 'ripple')).toEqual({ ok: false, reason: 'only-bar' })
  })

  it('refuses a bar outside the piece as invalid', () => {
    const doc = frozenDemo()

    expect(removePieceBar(doc, 0, 'ripple')).toEqual({ ok: false, reason: 'invalid' })
    expect(removePieceBar(doc, 65, 'ripple')).toEqual({ ok: false, reason: 'invalid' })
  })

  it('records as one history step whose undo restores the doc by reference, with the dropped locator confirmed', () => {
    const doc = frozenDemo()
    const result = ok(removePieceBar(doc, 12, 'plain'))
    expect(result.droppedLocators.some((l) => l.confirmed)).toBe(true)

    const history = record(createHistory(doc), result.label, result.doc)
    const back = undo(history)

    expect(back.present).toBe(doc)
    expect(locator(back.present.timing, 64, 0)).toEqual({ bar: 64, passIndex: 0, timeSec: 1 + 3.6 * 71, confirmed: true })
    expect(history.future).toEqual([])
    expect(back.future[0].label).toEqual({ kind: 'remove-piece-bar', bar: 12 })
  })
})

describe('validateMeters', () => {
  const FOUR_FOUR = { fromBar: 1, numerator: 4, denominator: 4 }

  it('accepts the demo meters', () => {
    expect(validateMeters(demoDoc().timing.meters, 64)).toEqual([])
  })

  it('requires the first change to start at bar 1', () => {
    expect(validateMeters([{ ...FOUR_FOUR, fromBar: 2 }], 64)).toEqual([
      { field: 'meters', index: 0, problem: 'first-not-bar-1' },
    ])
  })

  it('requires every fromBar within 1..barCount', () => {
    expect(validateMeters([FOUR_FOUR, { ...FOUR_FOUR, fromBar: 65 }], 64)).toEqual([
      { field: 'meters', index: 1, problem: 'out-of-range' },
    ])
    expect(validateMeters([{ ...FOUR_FOUR, fromBar: 0 }], 64)).toEqual([
      { field: 'meters', index: 0, problem: 'out-of-range' },
    ])
    expect(validateMeters([FOUR_FOUR, { ...FOUR_FOUR, fromBar: 2.5 }], 64)).toEqual([
      { field: 'meters', index: 1, problem: 'out-of-range' },
    ])
  })

  it('requires strictly increasing fromBars', () => {
    const three = { ...FOUR_FOUR, numerator: 3 }

    expect(validateMeters([FOUR_FOUR, { ...three, fromBar: 9 }, { ...FOUR_FOUR, fromBar: 9 }], 64)).toEqual([
      { field: 'meters', index: 2, problem: 'not-increasing' },
    ])
    expect(validateMeters([FOUR_FOUR, { ...three, fromBar: 9 }, { ...FOUR_FOUR, fromBar: 5 }], 64)).toEqual([
      { field: 'meters', index: 2, problem: 'not-increasing' },
    ])
  })

  it('accepts numerators 1-32 and denominators 1, 2, 4, 8, 16, 32 and refuses the rest', () => {
    for (const numerator of [1, 7, 32]) expect(validateMeters([{ ...FOUR_FOUR, numerator }], 64)).toEqual([])
    for (const denominator of [1, 2, 4, 8, 16, 32]) {
      expect(validateMeters([{ ...FOUR_FOUR, denominator }], 64)).toEqual([])
    }
    for (const numerator of [0, 33, 2.5, -1]) {
      expect(validateMeters([{ ...FOUR_FOUR, numerator }], 64)).toEqual([
        { field: 'meters', index: 0, problem: 'bad-meter' },
      ])
    }
    for (const denominator of [0, 3, 5, 6, 64]) {
      expect(validateMeters([{ ...FOUR_FOUR, denominator }], 64)).toEqual([
        { field: 'meters', index: 0, problem: 'bad-meter' },
      ])
    }
  })
})

describe('validatePlayOrder', () => {
  it('accepts the demo rows', () => {
    expect(validatePlayOrder(demoDoc().timing.playOrder, 64)).toEqual([])
  })

  it('refuses no rows as empty', () => {
    expect(validatePlayOrder([], 64)).toEqual([{ field: 'playOrder', index: 0, problem: 'empty' }])
  })

  it('refuses a row outside 1..barCount as out of range', () => {
    expect(validatePlayOrder([{ from: 1, to: 64 }, { from: 60, to: 65 }], 64)).toEqual([
      { field: 'playOrder', index: 1, problem: 'out-of-range' },
    ])
    expect(validatePlayOrder([{ from: 0, to: 4 }], 64)).toEqual([{ field: 'playOrder', index: 0, problem: 'out-of-range' }])
    expect(validatePlayOrder([{ from: 1.5, to: 4 }], 64)).toEqual([
      { field: 'playOrder', index: 0, problem: 'out-of-range' },
    ])
  })

  it('refuses a row that starts after it ends', () => {
    expect(validatePlayOrder([{ from: 9, to: 5 }], 64)).toEqual([{ field: 'playOrder', index: 0, problem: 'from-after-to' }])
  })
})

describe('validateMarks', () => {
  it('accepts the demo marks and an empty list', () => {
    expect(validateMarks(demoDoc().timing.marks, 64)).toEqual([])
    expect(validateMarks([], 64)).toEqual([])
  })

  it('refuses a bar outside 1..barCount as out of range', () => {
    expect(validateMarks([{ bar: 65, kind: 'fermata' }], 64)).toEqual([{ field: 'marks', index: 0, problem: 'out-of-range' }])
    expect(validateMarks([{ bar: 0, kind: 'rest' }], 64)).toEqual([{ field: 'marks', index: 0, problem: 'out-of-range' }])
  })

  it('refuses the same mark twice on a bar as a duplicate, naming the later one', () => {
    expect(
      validateMarks(
        [
          { bar: 5, kind: 'fermata' },
          { bar: 7, kind: 'rest' },
          { bar: 5, kind: 'fermata' },
        ],
        64,
      ),
    ).toEqual([{ field: 'marks', index: 2, problem: 'duplicate' }])
    expect(
      validateMarks(
        [
          { bar: 5, kind: 'fermata' },
          { bar: 5, kind: 'rest' },
        ],
        64,
      ),
    ).toEqual([])
  })
})

describe('setMeters', () => {
  it('replaces the meters, keeps the rest of the timing and the page layers, and labels the step', () => {
    const doc = frozenDemo()
    const meters = [
      { fromBar: 1, numerator: 3, denominator: 4 },
      { fromBar: 33, numerator: 6, denominator: 8 },
    ]

    const result = ok(setMeters(doc, meters))

    expect(result.doc.timing.meters).toEqual(meters)
    expect(result.doc.timing.locators).toBe(doc.timing.locators)
    expect(result.doc.timing.playOrder).toBe(doc.timing.playOrder)
    expect(result.doc.pages).toBe(doc.pages)
    expect(result.label).toEqual({ kind: 'edit-meters' })
    expect(result.droppedLocators).toEqual([])
  })

  it('refuses meters that fail validation', () => {
    expect(setMeters(frozenDemo(), [{ fromBar: 2, numerator: 4, denominator: 4 }])).toEqual({
      ok: false,
      reason: 'invalid',
    })
  })
})

describe('setMarks', () => {
  it('replaces the marks and labels the step', () => {
    const doc = frozenDemo()
    const marks = [
      { bar: 28, kind: 'fermata' as const },
      { bar: 40, kind: 'rest' as const },
    ]

    const result = ok(setMarks(doc, marks, 'clarinet'))

    expect(result.doc.timing.marks).toEqual([{ bar: 28, kind: 'fermata' }])
    expect(layer(result.doc, 'clarinet').rests).toEqual([40])
    expect(result.doc.timing.meters).toBe(doc.timing.meters)
    expect(result.doc.pages[1]).toBe(doc.pages[1])
    expect(result.doc.pages[2]).toBe(doc.pages[2])
    expect(result.label).toEqual({ kind: 'edit-marks' })
  })

  it('refuses marks that fail validation', () => {
    expect(setMarks(frozenDemo(), [{ bar: 99, kind: 'rest' }], 'clarinet')).toEqual({ ok: false, reason: 'invalid' })
  })
})

describe('setPlayOrder', () => {
  it('keeps every existing locator when a repeat row is added where the recording has room, adds none, and lists the new slots as unmatched', () => {
    // The recording plays the new repeat (8 bars, no locators for it): the later locators sit 8 bars of time later.
    const base = frozenDemo()
    const bar = base.timing.locators[1].timeSec - base.timing.locators[0].timeSec
    const later = base.timing.locators.map((l, i) => (i >= 24 ? { ...l, timeSec: l.timeSec + 8 * bar } : l))
    const doc = deepFreeze({ ...base, timing: { ...base.timing, locators: later } })
    const rows = [
      { from: 1, to: 16 },
      { from: 9, to: 16 },
      { from: 9, to: 16 },
      { from: 17, to: 64 },
    ]

    const result = ok(setPlayOrder(doc, rows))

    expect(result.doc.timing.playOrder).toEqual(rows)
    expect(result.droppedLocators).toEqual([])
    expect(result.doc.timing.locators).toEqual(doc.timing.locators)
    expect(unmatchedSlots(result.doc.timing).map((s) => `${s.bar}:${s.passIndex}`)).toEqual(
      [9, 10, 11, 12, 13, 14, 15, 16].map((bar) => `${bar}:2`),
    )
    expect(result.label).toEqual({ kind: 'edit-play-order' })
  })

  it('drops the locators of slots that vanish and reports them', () => {
    const doc = frozenDemo()

    const result = ok(setPlayOrder(doc, [{ from: 1, to: 64 }]))

    expect(ids(result.droppedLocators)).toEqual([9, 10, 11, 12, 13, 14, 15, 16].map((bar) => `${bar}:1`).sort())
    expect(result.doc.timing.locators).toHaveLength(64)
    expect(result.droppedLocators.find((l) => l.bar === 14)?.confirmed).toBe(true)
  })

  it('leaves the page layers, meters and marks alone', () => {
    const doc = frozenDemo()

    const result = ok(setPlayOrder(doc, [{ from: 1, to: 64 }]))

    expect(result.doc.pages).toBe(doc.pages)
    expect(result.doc.timing.meters).toBe(doc.timing.meters)
    expect(result.doc.timing.marks).toBe(doc.timing.marks)
    expect(result.doc.timing.barCount).toBe(64)
  })

  it('refuses rows that fail validation', () => {
    const doc = frozenDemo()

    expect(setPlayOrder(doc, [])).toEqual({ ok: false, reason: 'invalid' })
    expect(setPlayOrder(doc, [{ from: 1, to: 65 }])).toEqual({ ok: false, reason: 'invalid' })
    expect(setPlayOrder(doc, [{ from: 9, to: 5 }])).toEqual({ ok: false, reason: 'invalid' })
  })
})

/** A part whose bar 1 starts after a clef (x 160) and whose bar 3 starts after a time signature (a gap of 40). */
function trimmedDoc(): EditorDoc {
  const doc = demoDoc()
  const bars: BarBox[] = [
    { bar: 1, pageIndex: 0, x: 160, y: 150, w: 200, h: 300 },
    { bar: 2, pageIndex: 0, x: 360, y: 150, w: 260, h: 300 },
    { bar: 3, pageIndex: 0, x: 660, y: 150, w: 220, h: 300 },
    { bar: 4, pageIndex: 0, x: 880, y: 150, w: 260, h: 300 },
  ]
  return deepFreeze({ ...doc, pages: [{ partId: 'clarinet', bars, rests: [] }] })
}

describe('a gap between two boxes', () => {
  it('moveBarLine moves the right edge of the box before and the left edge of the box after, keeping the gap', () => {
    const edit = ok(moveBarLine(trimmedDoc(), 'clarinet', 2, 700))

    expect(box(edit.doc, 'clarinet', 2)).toMatchObject({ x: 360, w: 340 })
    expect(box(edit.doc, 'clarinet', 3)).toMatchObject({ x: 740, w: 140 })
    expect(edit.label).toEqual({ kind: 'move-bar-line', bar: 2 })
  })

  it('moveBarLine refuses a move that squeezes either box, counting the gap', () => {
    expect(moveBarLine(trimmedDoc(), 'clarinet', 2, 880 - 40 - MIN_BOX_WIDTH + 1)).toEqual({ ok: false, reason: 'too-narrow' })
    expect(ok(moveBarLine(trimmedDoc(), 'clarinet', 2, 880 - 40 - MIN_BOX_WIDTH)).doc.pages[0].bars[2].w).toBe(MIN_BOX_WIDTH)
  })

  it('moveBarLine on touching boxes is what it was', () => {
    const edit = ok(moveBarLine(trimmedDoc(), 'clarinet', 1, 400))
    expect(box(edit.doc, 'clarinet', 1)).toMatchObject({ x: 160, w: 240 })
    expect(box(edit.doc, 'clarinet', 2)).toMatchObject({ x: 400, w: 220 })
  })

  it('deleteBarLine merges the two boxes into one that covers the gap too', () => {
    const edit = ok(deleteBarLine(trimmedDoc(), 'clarinet', 2))

    expect(box(edit.doc, 'clarinet', 2)).toMatchObject({ x: 360, w: 520 })
    expect(box(edit.doc, 'clarinet', 3)).toMatchObject({ x: 880, w: 260 })
  })

  it('addBarLine splits a box as it always did', () => {
    const edit = ok(addBarLine(trimmedDoc(), 'clarinet', 3, 760))
    expect(box(edit.doc, 'clarinet', 3)).toMatchObject({ x: 660, w: 100 })
    expect(box(edit.doc, 'clarinet', 4)).toMatchObject({ x: 760, w: 120 })
  })
})

describe('moveLineStart', () => {
  it('moves the left edge of the first box of a line and keeps its right edge', () => {
    const edit = ok(moveLineStart(trimmedDoc(), 'clarinet', 1, 120))

    expect(box(edit.doc, 'clarinet', 1)).toMatchObject({ x: 120, w: 240 })
    expect(edit.label).toEqual({ kind: 'move-line-start', bar: 1 })
  })

  it('leaves the other boxes, the timing and the other parts with the same references', () => {
    const doc = trimmedDoc()
    const edit = ok(moveLineStart(doc, 'clarinet', 1, 120))

    expect(edit.doc.timing).toBe(doc.timing)
    expect(edit.doc.pages[0].bars[1]).toBe(doc.pages[0].bars[1])
  })

  it('may move the edge right, up to the minimum width, and refuses past it', () => {
    expect(ok(moveLineStart(trimmedDoc(), 'clarinet', 1, 360 - MIN_BOX_WIDTH)).doc.pages[0].bars[0].w).toBe(MIN_BOX_WIDTH)
    expect(moveLineStart(trimmedDoc(), 'clarinet', 1, 360 - MIN_BOX_WIDTH + 1)).toEqual({ ok: false, reason: 'too-narrow' })
  })

  it('refuses an edge left of the page', () => {
    expect(moveLineStart(trimmedDoc(), 'clarinet', 1, -1)).toEqual({ ok: false, reason: 'too-narrow' })
  })

  it('refuses a box that is not the first of its line, also one after a gap', () => {
    expect(moveLineStart(trimmedDoc(), 'clarinet', 2, 400)).toEqual({ ok: false, reason: 'not-line-start' })
    expect(moveLineStart(trimmedDoc(), 'clarinet', 3, 700)).toEqual({ ok: false, reason: 'not-line-start' })
  })

  it('refuses a bar and a part that do not exist', () => {
    expect(moveLineStart(trimmedDoc(), 'clarinet', 9, 100)).toEqual({ ok: false, reason: 'no-box' })
    expect(moveLineStart(trimmedDoc(), 'oboe', 1, 100)).toEqual({ ok: false, reason: 'no-box' })
  })

  it('moves every box of a multi-rest, which share one place', () => {
    const doc = trimmedDoc()
    const rest = deepFreeze({
      ...doc,
      pages: [{ partId: 'clarinet', bars: [1, 2, 3].map((bar) => ({ bar, pageIndex: 0, x: 160, y: 150, w: 200, h: 300 })), rests: [] }],
    })

    const edit = ok(moveLineStart(rest, 'clarinet', 1, 140))

    expect(edit.doc.pages[0].bars.map((b) => [b.x, b.w])).toEqual([[140, 220], [140, 220], [140, 220]])
  })

  it('records as one history step whose undo restores the doc', () => {
    const doc = trimmedDoc()
    const edit = ok(moveLineStart(doc, 'clarinet', 1, 120))
    const history = record(createHistory(doc), edit.label, edit.doc)

    expect(undo(history).present).toBe(doc)
  })
})

describe('moveLineEnd', () => {
  it('moves the right edge of the last box of a line and keeps its left edge', () => {
    const edit = ok(moveLineEnd(trimmedDoc(), 'clarinet', 4, 1180))

    expect(box(edit.doc, 'clarinet', 4)).toMatchObject({ x: 880, w: 300 })
    expect(edit.label).toEqual({ kind: 'move-line-end', bar: 4 })
  })

  it('may move the edge left too, and leaves the boxes before it, the timing and the other parts with the same references', () => {
    const doc = trimmedDoc()
    const edit = ok(moveLineEnd(doc, 'clarinet', 4, 1000))

    expect(box(edit.doc, 'clarinet', 4)).toMatchObject({ x: 880, w: 120 })
    expect(edit.doc.timing).toBe(doc.timing)
    expect(edit.doc.pages[0].bars[2]).toBe(doc.pages[0].bars[2])
  })

  it('moves the end of a box that follows a signature gap without touching the gap', () => {
    const doc = trimmedDoc()
    const bars = doc.pages[0].bars.slice(0, 3) // bar 3 (after a gap of 40) is now the last
    const edit = ok(moveLineEnd({ ...doc, pages: [{ ...doc.pages[0], bars }] }, 'clarinet', 3, 900))

    expect(box(edit.doc, 'clarinet', 3)).toMatchObject({ x: 660, w: 240 })
    expect(box(edit.doc, 'clarinet', 2)).toMatchObject({ x: 360, w: 260 })
  })

  it('holds the box at the minimum width: the edge cannot cross the bar line before it', () => {
    expect(ok(moveLineEnd(trimmedDoc(), 'clarinet', 4, 880 + MIN_BOX_WIDTH)).doc.pages[0].bars[3].w).toBe(MIN_BOX_WIDTH)
    expect(moveLineEnd(trimmedDoc(), 'clarinet', 4, 880 + MIN_BOX_WIDTH - 1)).toEqual({ ok: false, reason: 'too-narrow' })
    expect(moveLineEnd(trimmedDoc(), 'clarinet', 4, 800)).toEqual({ ok: false, reason: 'too-narrow' })
  })

  it('refuses an edge past the page when the page width is given, and takes any edge when it is not', () => {
    expect(ok(moveLineEnd(trimmedDoc(), 'clarinet', 4, 1200, 1200)).doc.pages[0].bars[3].w).toBe(320)
    expect(moveLineEnd(trimmedDoc(), 'clarinet', 4, 1201, 1200)).toEqual({ ok: false, reason: 'too-narrow' })
    expect(ok(moveLineEnd(trimmedDoc(), 'clarinet', 4, 5000)).doc.pages[0].bars[3].w).toBe(4120)
  })

  it('refuses a box that is not the last of its line, also one before a gap', () => {
    expect(moveLineEnd(trimmedDoc(), 'clarinet', 1, 300)).toEqual({ ok: false, reason: 'not-line-end' })
    expect(moveLineEnd(trimmedDoc(), 'clarinet', 2, 600)).toEqual({ ok: false, reason: 'not-line-end' })
  })

  it('refuses a bar and a part that do not exist', () => {
    expect(moveLineEnd(trimmedDoc(), 'clarinet', 9, 100)).toEqual({ ok: false, reason: 'no-box' })
    expect(moveLineEnd(trimmedDoc(), 'oboe', 1, 100)).toEqual({ ok: false, reason: 'no-box' })
  })

  it('moves every box of a multi-rest, which share one place', () => {
    const doc = trimmedDoc()
    const rest = deepFreeze({
      ...doc,
      pages: [{ partId: 'clarinet', bars: [1, 2, 3].map((bar) => ({ bar, pageIndex: 0, x: 160, y: 150, w: 200, h: 300 })), rests: [] }],
    })

    const edit = ok(moveLineEnd(rest, 'clarinet', 1, 400))

    expect(edit.doc.pages[0].bars.map((b) => [b.x, b.w])).toEqual([[160, 240], [160, 240], [160, 240]])
  })

  it('records as one history step whose undo restores the doc', () => {
    const doc = trimmedDoc()
    const edit = ok(moveLineEnd(doc, 'clarinet', 4, 1180))
    const history = record(createHistory(doc), edit.label, edit.doc)

    expect(undo(history).present).toBe(doc)
  })

  it('keeps the part\'s rests and flags, as every box edit does', () => {
    const doc = trimmedDoc()
    const flagged = deepFreeze({
      ...doc,
      pages: [{ ...doc.pages[0], rests: [2], boxFlags: [{ bar: 4, verdict: 'ends_late' as const, note: 'x', suggestedX: null }] }],
    })
    const edit = ok(moveLineEnd(flagged, 'clarinet', 4, 1180))

    expect(edit.doc.pages[0].rests).toEqual([2])
    expect(edit.doc.pages[0].boxFlags?.map((f) => f.bar)).toEqual([4])
  })
})

/** Erez's Trombone part (2026-11-05): a courtesy 3/4 after a single bar line was read as a bar of its own, so every later bar was numbered one too high. */
describe('repairing a courtesy signature the pipeline made a bar by hand', () => {
  /** Lines 1 and 2: bars 1-3 and then a 39 px false bar 4 at the end of line 1; the next line starts at bar 5. */
  function falseBarDoc(): EditorDoc {
    const doc = demoDoc()
    const bars: BarBox[] = [
      { bar: 1, pageIndex: 0, x: 100, y: 100, w: 400, h: 100 },
      { bar: 2, pageIndex: 0, x: 500, y: 100, w: 400, h: 100 },
      { bar: 3, pageIndex: 0, x: 900, y: 100, w: 400, h: 100 },
      { bar: 4, pageIndex: 0, x: 1300, y: 100, w: 39, h: 100 },
      { bar: 5, pageIndex: 0, x: 100, y: 300, w: 600, h: 100 },
      { bar: 6, pageIndex: 0, x: 700, y: 300, w: 600, h: 100 },
    ]
    return deepFreeze({ ...doc, pages: [{ partId: 'clarinet', bars, rests: [] }] })
  }

  it('deleting the bar line before the false bar merges it in, renumbers every later bar down one and keeps the line end', () => {
    const merged = ok(deleteBarLine(falseBarDoc(), 'clarinet', 3))
    const bars = layer(merged.doc, 'clarinet').bars

    expect(bars.map((b) => b.bar)).toEqual([1, 2, 3, 4, 5])
    expect(bars[2]).toMatchObject({ bar: 3, x: 900, w: 439 }) // the end of the false bar is the end of bar 3
    expect(bars[3]).toMatchObject({ bar: 4, x: 100, y: 300 })
  })

  it('then the end of the merged bar is dragged back to where the bar really ends', () => {
    const merged = ok(deleteBarLine(falseBarDoc(), 'clarinet', 3))
    const fixed = ok(moveLineEnd(merged.doc, 'clarinet', 3, 1300))

    expect(layer(fixed.doc, 'clarinet').bars[2]).toMatchObject({ bar: 3, x: 900, w: 400 })
    expect(layer(fixed.doc, 'clarinet').bars.map((b) => b.bar)).toEqual([1, 2, 3, 4, 5])
    expect(fixed.doc.timing).toBe(merged.doc.timing) // the piece keeps its bars: Edit piece structure removes the extra one
  })

  it('with Edit piece structure on, the same delete also takes the bar out of the piece, and the drag leaves the timing alone', () => {
    const doc = falseBarDoc()
    const merged = ok(deleteBarLineInPiece(doc, 'clarinet', 3, 'ripple'))
    const fixed = ok(moveLineEnd(merged.doc, 'clarinet', 3, 1300))

    expect(merged.doc.timing.barCount).toBe(doc.timing.barCount - 1)
    expect(fixed.doc.timing).toBe(merged.doc.timing)
    expect(layer(fixed.doc, 'clarinet').bars.map((b) => [b.bar, b.x, b.w])).toEqual([
      [1, 100, 400],
      [2, 500, 400],
      [3, 900, 400],
      [4, 100, 600],
      [5, 700, 600],
    ])
  })

  it('both steps are undone one by one', () => {
    const doc = falseBarDoc()
    const first = ok(deleteBarLine(doc, 'clarinet', 3))
    const second = ok(moveLineEnd(first.doc, 'clarinet', 3, 1300))
    const history = record(record(createHistory(doc), first.label, first.doc), second.label, second.doc)

    expect(undo(undo(history)).present).toBe(doc)
  })
})

describe('rests belong to a part', () => {
  /** The demo doc with the clarinet resting on 10-12 and the flute on 12-13 and 40. */
  function restingDemo(): EditorDoc {
    const doc = demoDoc()
    const rests: Record<string, number[]> = { clarinet: [10, 11, 12], flute: [12, 13, 40] }
    return deepFreeze({ ...doc, pages: doc.pages.map((page) => ({ ...page, rests: rests[page.partId] ?? [] })) })
  }

  it('setMarks writes the fermata and rit. to the timing and the rests to the part it is given, and no other part', () => {
    const doc = restingDemo()

    const result = ok(
      setMarks(doc, [{ bar: 28, kind: 'fermata' }, { bar: 30, kind: 'rit' }, { bar: 46, kind: 'rest' }, { bar: 47, kind: 'rest' }], 'flute'),
    )

    expect(result.doc.timing.marks).toEqual([{ bar: 28, kind: 'fermata' }, { bar: 30, kind: 'rit' }])
    expect(layer(result.doc, 'flute').rests).toEqual([46, 47])
    expect(layer(result.doc, 'clarinet')).toBe(layer(doc, 'clarinet'))
    expect(layer(result.doc, SHORT_PART_ID)).toBe(layer(doc, SHORT_PART_ID))
    expect(layer(result.doc, 'flute').bars).toBe(layer(doc, 'flute').bars)
  })

  it('setMarks leaves a part whose rests are the same as it was, and refuses a part the doc does not have', () => {
    const doc = restingDemo()
    const same = ok(setMarks(doc, [{ bar: 28, kind: 'fermata' }, { bar: 10, kind: 'rest' }, { bar: 11, kind: 'rest' }, { bar: 12, kind: 'rest' }], 'clarinet'))

    expect(same.doc.pages).toBe(doc.pages)
    expect(setMarks(doc, [], 'oboe')).toEqual({ ok: false, reason: 'invalid' })
  })

  it('setMarks refuses a rest twice, and a rest after the last bar', () => {
    const doc = restingDemo()

    expect(setMarks(doc, [{ bar: 5, kind: 'rest' }, { bar: 5, kind: 'rest' }], 'flute')).toEqual({ ok: false, reason: 'invalid' })
    expect(setMarks(doc, [{ bar: 65, kind: 'rest' }], 'flute')).toEqual({ ok: false, reason: 'invalid' })
  })

  it('an undo step brings the old rests back: the history holds the whole doc', () => {
    const doc = restingDemo()
    const edit = ok(setMarks(doc, [{ bar: 5, kind: 'rest' }], 'flute'))

    const history = record(createHistory(doc), edit.label, edit.doc)
    const back = undo(history).present

    expect(back).toBe(doc)
    expect(layer(back, 'flute').rests).toEqual([12, 13, 40])
    expect(layer(history.present, 'flute').rests).toEqual([5])
  })

  it('inserting a bar in the piece only moves no part\'s rests: they follow their own boxes, which do not move', () => {
    const doc = restingDemo()

    const result = ok(insertPieceBar(doc, 11, 'ripple'))

    expect(layer(result.doc, 'clarinet').rests).toEqual([10, 11, 12])
    expect(layer(result.doc, 'flute').rests).toEqual([12, 13, 40])
    expect(result.doc.pages).toBe(doc.pages)
  })

  it('removing a bar from the piece only moves no part\'s rests either', () => {
    const doc = restingDemo()

    const result = ok(removePieceBar(doc, 12, 'plain'))

    expect(layer(result.doc, 'clarinet').rests).toEqual([10, 11, 12])
    expect(layer(result.doc, 'flute').rests).toEqual([12, 13, 40])
  })

  it('a part whose last bar is a rest can still change its marks after a bar line was added on its score', () => {
    const base = restingDemo()
    const resting = { ...base, pages: base.pages.map((page) => (page.partId === 'flute' ? { ...page, rests: [63, 64] } : page)) }
    const added = ok(addBarLine(resting, 'flute', 10, box(resting, 'flute', 10).x + 100)).doc
    expect(layer(added, 'flute').rests).toEqual([64, 65]) // 65 bars in this part, 64 in the piece

    const same = ok(setMarks(added, [{ bar: 28, kind: 'fermata' }, { bar: 64, kind: 'rest' }, { bar: 65, kind: 'rest' }], 'flute'))
    const changed = ok(setMarks(added, [{ bar: 28, kind: 'fermata' }, { bar: 30, kind: 'rit' }, { bar: 65, kind: 'rest' }], 'flute'))

    expect(layer(same.doc, 'flute').rests).toEqual([64, 65])
    expect(layer(changed.doc, 'flute').rests).toEqual([65])
  })

  it('a rest may not pass the last box of its part, and a fermata or rit. may not pass the last bar of the piece', () => {
    const doc = restingDemo()

    expect(setMarks(doc, [{ bar: 65, kind: 'rest' }], 'flute')).toEqual({ ok: false, reason: 'invalid' })
    expect(setMarks(doc, [{ bar: 65, kind: 'fermata' }], 'flute')).toEqual({ ok: false, reason: 'invalid' })
    const added = ok(addBarLine(doc, 'flute', 10, box(doc, 'flute', 10).x + 100)).doc
    expect(setMarks(added, [{ bar: 65, kind: 'fermata' }], 'flute')).toEqual({ ok: false, reason: 'invalid' })
    expect(setMarks(added, [{ bar: 66, kind: 'rest' }], 'flute')).toEqual({ ok: false, reason: 'invalid' })
  })

  it('validateMarks checks rests against their own limit', () => {
    expect(validateMarks([{ bar: 65, kind: 'rest' }], 64, 1, 65)).toEqual([])
    expect(validateMarks([{ bar: 65, kind: 'rit' }], 64, 1, 65)).toEqual([{ field: 'marks', index: 0, problem: 'out-of-range' }])
  })

  it('adding a bar line on one part\'s score moves only that part\'s rests', () => {
    const doc = restingDemo()
    const x = box(doc, 'flute', 11).x + 100

    const result = ok(addBarLine(doc, 'flute', 11, x))

    expect(layer(result.doc, 'flute').rests).toEqual([13, 14, 41])
    expect(layer(result.doc, 'clarinet')).toBe(layer(doc, 'clarinet'))
    expect(result.doc.timing).toBe(doc.timing)
  })

  it('deleting a bar line on one part\'s score moves only that part\'s rests', () => {
    const doc = restingDemo()

    const result = ok(deleteBarLine(doc, 'flute', 11))

    expect(layer(result.doc, 'flute').rests).toEqual([12, 39]) // bar 12 merged into 11; 13 and 40 move down
    expect(layer(result.doc, 'clarinet')).toBe(layer(doc, 'clarinet'))
  })
})

describe('setPlayOrder: labels that are off', () => {
  const lo = (bar: number, passIndex: number, timeSec: number, confirmed = true): Locator => ({ bar, passIndex, timeSec, confirmed, checked: true })
  const docOf = (playOrder: { from: number; to: number }[], locators: Locator[], recordingSec?: number): EditorDoc => ({
    timing: { barCount: 8, playOrder, meters: [{ fromBar: 1, numerator: 4, denominator: 4 }], marks: [], locators },
    pages: [],
    ...(recordingSec === undefined ? {} : { recordingSec }),
  })
  const straightOrder = [{ from: 1, to: 8 }]
  const withRepeat = [{ from: 1, to: 4 }, { from: 1, to: 4 }, { from: 5, to: 8 }]
  const key = (l: { bar: number; passIndex: number }) => `${l.bar}:${l.passIndex}`
  const eight = Array.from({ length: 8 }, (_, i) => lo(i + 1, 0, i + 1))

  it('relabels in play order when the empty slots cannot fit between their neighbours (the Mozart case), in one step', () => {
    const doc = deepFreeze(docOf(straightOrder, eight))

    const result = ok(setPlayOrder(doc, withRepeat))

    expect(result.doc.timing.locators.map(key)).toEqual(['1:0', '2:0', '3:0', '4:0', '1:1', '2:1', '3:1', '4:1'])
    expect(result.doc.timing.locators.map((l) => l.timeSec)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    // the ones that took a new label are unchecked again; the ones whose label stayed keep their confirmation
    expect(result.doc.timing.locators.map((l) => l.confirmed)).toEqual([true, true, true, true, false, false, false, false])
    expect(result.doc.timing.locators.map((l) => l.checked === true)).toEqual([true, true, true, true, false, false, false, false])
    expect(result.droppedLocators).toEqual([])
    expect(result.label).toEqual({ kind: 'edit-play-order', count: 4 })
    // Undo is the doc before, exactly
    const history = record(createHistory(doc), result.label, result.doc)
    expect(undo(history).present).toBe(doc)
  })

  it('keeps the labels and leaves the slots for the fill when the room is really there', () => {
    // 1-4 at 1-4 s, then a gap of 5 s (the repeat is on the recording without locators), then 5-8 at 9-12 s.
    const room = [1, 2, 3, 4].map((b) => lo(b, 0, b)).concat([5, 6, 7, 8].map((b) => lo(b, 0, b + 4)))
    const doc = deepFreeze(docOf(straightOrder, room))

    const result = ok(setPlayOrder(doc, withRepeat))

    expect(result.doc.timing.locators.map(key)).toEqual(['1:0', '2:0', '3:0', '4:0', '5:0', '6:0', '7:0', '8:0'])
    expect(result.doc.timing.locators.every((l) => l.confirmed && l.checked === true)).toBe(true)
    expect(unmatchedSlots(result.doc.timing).map(key)).toEqual(['1:1', '2:1', '3:1', '4:1'])
    expect(result.label).toEqual({ kind: 'edit-play-order' })
  })

  it('removing a row does not relabel: only that row\'s times go', () => {
    const inStep = Array.from({ length: 12 }, (_, i) => lo(i < 4 ? i + 1 : i < 8 ? i - 3 : i - 3, i < 4 || i >= 8 ? 0 : 1, i + 1))
    const doc = deepFreeze(docOf(withRepeat, inStep))

    const result = ok(setPlayOrder(doc, [{ from: 1, to: 4 }, { from: 5, to: 8 }]))

    expect(result.droppedLocators.map(key)).toEqual(['1:1', '2:1', '3:1', '4:1'])
    expect(result.doc.timing.locators.map((l) => l.timeSec)).toEqual([1, 2, 3, 4, 9, 10, 11, 12])
    expect(result.doc.timing.locators.every((l) => l.confirmed)).toBe(true)
    expect(result.label).toEqual({ kind: 'edit-play-order' })
  })

  it('does not relabel when that would leave surplus locators to drop: the order edit keeps what it kept', () => {
    // Twelve slots, fourteen locators: the last two would have to go, so the two cases cannot be told apart safely.
    const many = Array.from({ length: 14 }, (_, i) => lo((i % 8) + 1, Math.floor(i / 8), i + 1))
    const doc = deepFreeze(docOf(straightOrder, many))
    const expected = remapLocators(expandPlayOrder(withRepeat, 8), many)

    const result = ok(setPlayOrder(doc, withRepeat))

    expect(result.doc.timing.locators.map(key)).toEqual(expected.kept.map(key))
    expect(result.droppedLocators).toHaveLength(expected.dropped.length)
    expect(result.label).toEqual({ kind: 'edit-play-order' })
  })

  it('leaves alone the labels that moved with a bar insert: the Renumber switch keeps the times and moves the labels', () => {
    const doc = deepFreeze(docOf(straightOrder, eight))

    const edit = insertBarInTiming(doc.timing, 3, 'ripple')

    expect(edit.timing.locators.map((l) => l.timeSec)).toEqual(doc.timing.locators.map((l) => l.timeSec))
    expect(edit.timing.locators.map((l) => l.bar)).not.toEqual(doc.timing.locators.map((l) => l.bar))
  })
})
