import { setBarsInBox } from './boxEdits'
import { deleteBarLine, partBarCount, partProblems, type EditorDoc, type EditResult } from './pieceEdits'
import { demoDoc } from './pieceFixtures'
import { pickupOn } from './pickup'
import { insertPartBar, removePartBar, splitPartPickup, shiftPartPickup, PART_NEW_BAR_SHARE } from './partBars'
import { barTally, pieceTally } from './shortBars'
import { type BarBox, type PageLayer } from './types'

function ok(result: EditResult): EditorDoc {
  if (!result.ok) throw new Error(`refused: ${result.reason}`)
  return result.doc
}

const page = (doc: EditorDoc, partId: string): PageLayer => doc.pages.find((p) => p.partId === partId) as PageLayer
const box = (doc: EditorDoc, partId: string, bar: number): BarBox => page(doc, partId).bars.find((b) => b.bar === bar) as BarBox
const bars = (doc: EditorDoc, partId: string) => page(doc, partId).bars.map((b) => b.bar)

/** The demo with a rest and a box flag on the clarinet, to see them follow their boxes. */
function withMarks(): EditorDoc {
  const doc = demoDoc()
  return {
    ...doc,
    pages: doc.pages.map((p) =>
      p.partId === 'clarinet' ? { ...p, rests: [3, 9], boxFlags: [{ bar: 7, verdict: 'ends_late' as const, note: 'x', suggestedX: null }] } : p,
    ),
  }
}

describe('insertPartBar', () => {
  it('After bar n splits its box at 75 %: bar n keeps the wide left side, the new bar n+1 is the narrow right side', () => {
    const before = withMarks()
    const old = box(before, 'clarinet', 5)
    const doc = ok(insertPartBar(before, 'clarinet', 5, 'after'))

    expect(PART_NEW_BAR_SHARE).toBe(0.25)
    expect(box(doc, 'clarinet', 5)).toMatchObject({ x: old.x, w: old.w * 0.75, y: old.y, h: old.h, pageIndex: old.pageIndex })
    expect(box(doc, 'clarinet', 6)).toMatchObject({ x: old.x + old.w * 0.75, w: old.w * 0.25, y: old.y, h: old.h, pageIndex: old.pageIndex })
    expect(partBarCount(page(doc, 'clarinet'))).toBe(65)
  })

  it('Before bar n splits its box at 25 %: the new bar n is the narrow left side and the old bar moves to n+1', () => {
    const before = withMarks()
    const old = box(before, 'clarinet', 5)
    const doc = ok(insertPartBar(before, 'clarinet', 5, 'before'))

    expect(box(doc, 'clarinet', 5)).toMatchObject({ x: old.x, w: old.w * 0.25 })
    expect(box(doc, 'clarinet', 6)).toMatchObject({ x: old.x + old.w * 0.25, w: old.w * 0.75 })
  })

  it('renumbers this part\'s later boxes, rests and flags one up, with no gap, and leaves the timing and the other parts alone', () => {
    const before = withMarks()
    const doc = ok(insertPartBar(before, 'clarinet', 5, 'after'))

    expect(bars(doc, 'clarinet')).toEqual(Array.from({ length: 65 }, (_, i) => i + 1))
    expect(page(doc, 'clarinet').rests).toEqual([3, 10])
    expect(page(doc, 'clarinet').boxFlags?.map((f) => f.bar)).toEqual([8])
    expect(doc.timing).toBe(before.timing)
    expect(page(doc, 'trumpet')).toBe(page(before, 'trumpet'))
    expect(page(doc, 'flute')).toBe(page(before, 'flute'))
  })

  it('makes the part one bar longer than the piece, which partProblems reports', () => {
    const doc = ok(insertPartBar(demoDoc(), 'flute', 5, 'after'))
    expect(partProblems(doc, 'flute')).toEqual([{ kind: 'bar-count', partBars: 65, pieceBars: 64 }])
  })

  it('refuses a box that holds several bars', () => {
    const multi = ok(setBarsInBox(demoDoc(), 'clarinet', 5, 3))
    expect(insertPartBar(multi, 'clarinet', 5, 'after')).toEqual({ ok: false, reason: 'in-multi-rest' })
    expect(insertPartBar(multi, 'clarinet', 7, 'before')).toEqual({ ok: false, reason: 'in-multi-rest' })
  })

  it('refuses a box too narrow for the narrow side to keep its minimum width', () => {
    const doc = demoDoc()
    const narrow = { ...doc, pages: doc.pages.map((p) => ({ ...p, bars: p.bars.map((b) => (b.bar === 5 ? { ...b, w: 40 } : b)) })) }
    expect(insertPartBar(narrow, 'clarinet', 5, 'after')).toEqual({ ok: false, reason: 'too-narrow' })
    expect(insertPartBar(narrow, 'clarinet', 5, 'before')).toEqual({ ok: false, reason: 'too-narrow' })
  })

  it('refuses a bar the part has no box for, and a part the doc does not have', () => {
    expect(insertPartBar(demoDoc(), 'clarinet', 99, 'after')).toEqual({ ok: false, reason: 'no-box' })
    expect(insertPartBar(demoDoc(), 'tuba', 1, 'after')).toEqual({ ok: false, reason: 'no-box' })
  })
})

describe('removePartBar', () => {
  it('merges bar n with the bar after it and renumbers this part\'s later boxes, rests and flags one down', () => {
    const before = withMarks()
    const a = box(before, 'clarinet', 5)
    const b = box(before, 'clarinet', 6)
    const doc = ok(removePartBar(before, 'clarinet', 5))

    expect(box(doc, 'clarinet', 5)).toMatchObject({ x: a.x, w: a.w + b.w })
    expect(bars(doc, 'clarinet')).toEqual(Array.from({ length: 63 }, (_, i) => i + 1))
    expect(page(doc, 'clarinet').rests).toEqual([3, 8])
    expect(page(doc, 'clarinet').boxFlags?.map((f) => f.bar)).toEqual([6])
    expect(doc.timing).toBe(before.timing)
    expect(page(doc, 'flute')).toBe(page(before, 'flute'))
  })

  it('merges with the bar before when the line after it ends the staff line', () => {
    const before = demoDoc()
    // Four boxes to a line: the line after bar 4 ends the first staff line, so bar 4 merges with bar 3.
    const a = box(before, 'clarinet', 3)
    const b = box(before, 'clarinet', 4)
    const doc = ok(removePartBar(before, 'clarinet', 4))

    expect(box(doc, 'clarinet', 3)).toMatchObject({ x: a.x, w: a.w + b.w })
    expect(partBarCount(page(doc, 'clarinet'))).toBe(63)
    expect(bars(doc, 'clarinet')).toEqual(Array.from({ length: 63 }, (_, i) => i + 1))
  })

  it('merges the last bar with the one before it', () => {
    const doc = ok(removePartBar(demoDoc(), 'clarinet', 64))
    expect(partBarCount(page(doc, 'clarinet'))).toBe(63)
  })

  it('refuses when no neighbour is on the same line, with the reason of the line', () => {
    const before = demoDoc()
    const alone = {
      ...before,
      pages: before.pages.map((p) =>
        p.partId === 'clarinet'
          ? { ...p, bars: [{ bar: 1, pageIndex: 0, x: 0, y: 0, w: 100, h: 50 }, { bar: 2, pageIndex: 0, x: 0, y: 100, w: 100, h: 50 }, { bar: 3, pageIndex: 0, x: 0, y: 200, w: 100, h: 50 }] }
          : p,
      ),
    }
    expect(removePartBar(alone, 'clarinet', 2)).toEqual({ ok: false, reason: 'line-end' })
  })

  it('refuses the only box of a part', () => {
    const before = demoDoc()
    const one = { ...before, pages: before.pages.map((p) => (p.partId === 'clarinet' ? { ...p, bars: p.bars.slice(0, 1) } : p)) }
    expect(removePartBar(one, 'clarinet', 1)).toEqual({ ok: false, reason: 'only-bar' })
  })

  it('refuses a box that holds several bars', () => {
    const multi = ok(setBarsInBox(demoDoc(), 'clarinet', 5, 3))
    expect(removePartBar(multi, 'clarinet', 6)).toEqual({ ok: false, reason: 'in-multi-rest' })
  })

  it('refuses a bar the part has no box for', () => {
    expect(removePartBar(demoDoc(), 'clarinet', 99)).toEqual({ ok: false, reason: 'no-box' })
  })

  it('is what deleteBarLine does when the neighbour is the next bar', () => {
    const before = demoDoc()
    expect(ok(removePartBar(before, 'clarinet', 5))).toEqual(ok(deleteBarLine(before, 'clarinet', 5)))
  })
})

/** The demo piece with a pickup (bar 0 + bars 1..63) whose clarinet kept the pickup inside its first box (63 boxes), whose trumpet boxed it as bar 1 (64 boxes 1..64), and whose flute is complete (0..63). */
function pickupPiece(): EditorDoc {
  const demo = demoDoc()
  const piece = ok(pickupOn(demo))
  const merged = ok(deleteBarLine(demo, 'clarinet', 1))
  const trumpet = page(demo, 'flute') // 64 boxes numbered 1..64: the pickup boxed as a full bar
  return {
    ...piece,
    pages: piece.pages.map((p) => {
      if (p.partId === 'clarinet') return { ...page(merged, 'clarinet'), rests: [1, 4], boxFlags: [{ bar: 2, verdict: 'starts_late' as const, note: 'x', suggestedX: null }] }
      if (p.partId === 'trumpet') return { ...trumpet, partId: 'trumpet', rests: [1, 4], boxFlags: [{ bar: 2, verdict: 'starts_late' as const, note: 'x', suggestedX: null }] }
      return p
    }),
  }
}

describe('splitPartPickup (the first box holds the pickup and bar 1)', () => {
  it('starts one bar off the piece', () => {
    expect(partProblems(pickupPiece(), 'clarinet')).toEqual([{ kind: 'bar-count', partBars: 63, pieceBars: 64 }])
  })

  it('cuts the left 25 % of the first box off as box 0 and keeps the other numbers, so the part reads even with the piece', () => {
    const before = pickupPiece()
    const first = box(before, 'clarinet', 1)
    const doc = ok(splitPartPickup(before, 'clarinet'))

    expect(box(doc, 'clarinet', 0)).toMatchObject({ x: first.x, w: first.w * 0.25, y: first.y, h: first.h, pageIndex: first.pageIndex })
    expect(box(doc, 'clarinet', 1)).toMatchObject({ x: first.x + first.w * 0.25, w: first.w * 0.75 })
    expect(bars(doc, 'clarinet')).toEqual(Array.from({ length: 64 }, (_, i) => i))
    expect(box(doc, 'clarinet', 2)).toEqual(box(before, 'clarinet', 2))
    expect(page(doc, 'clarinet').rests).toEqual([1, 4])
    expect(page(doc, 'clarinet').boxFlags?.map((f) => f.bar)).toEqual([2])
    expect(partProblems(doc, 'clarinet')).toEqual([])
  })

  it('leaves the timing and every other part untouched', () => {
    const before = pickupPiece()
    const doc = ok(splitPartPickup(before, 'clarinet'))
    expect(doc.timing).toBe(before.timing)
    expect(page(doc, 'trumpet')).toBe(page(before, 'trumpet'))
    expect(page(doc, 'flute')).toBe(page(before, 'flute'))
  })

  it('refuses when the piece has no pickup', () => {
    expect(splitPartPickup(demoDoc(), 'clarinet')).toEqual({ ok: false, reason: 'no-piece-pickup' })
  })

  it('refuses when the part already has box 0', () => {
    expect(splitPartPickup(pickupPiece(), 'flute')).toEqual({ ok: false, reason: 'part-has-pickup' })
  })

  it('refuses a first box that holds several bars, one too narrow, and a part with no box 1', () => {
    const before = pickupPiece()
    const multi = ok(setBarsInBox(before, 'clarinet', 1, 2))
    expect(splitPartPickup(multi, 'clarinet')).toEqual({ ok: false, reason: 'in-multi-rest' })
    const narrow = { ...before, pages: before.pages.map((p) => (p.partId === 'clarinet' ? { ...p, bars: p.bars.map((b) => (b.bar === 1 ? { ...b, w: 40 } : b)) } : p)) }
    expect(splitPartPickup(narrow, 'clarinet')).toEqual({ ok: false, reason: 'too-narrow' })
    expect(splitPartPickup(before, 'tuba')).toEqual({ ok: false, reason: 'no-box' })
  })
})

describe('shiftPartPickup (the first box is the pickup)', () => {
  it('starts with the right number of boxes but no box 0: the tally differs from the piece\'s', () => {
    const before = pickupPiece()
    expect(partProblems(before, 'trumpet')).toEqual([])
    expect(barTally(page(before, 'trumpet').bars)).toEqual({ printed: 64, pickup: false })
    expect(pieceTally(before.timing)).toEqual({ printed: 63, pickup: true })
  })

  it('moves this part\'s boxes, rests and flags one number down, so boxes 1..64 read 0..63 and tally like the piece', () => {
    const before = pickupPiece()
    const doc = ok(shiftPartPickup(before, 'trumpet'))

    expect(bars(doc, 'trumpet')).toEqual(Array.from({ length: 64 }, (_, i) => i))
    expect(box(doc, 'trumpet', 0)).toMatchObject({ x: box(before, 'trumpet', 1).x, w: box(before, 'trumpet', 1).w })
    expect(page(doc, 'trumpet').rests).toEqual([0, 3])
    expect(page(doc, 'trumpet').boxFlags?.map((f) => f.bar)).toEqual([1])
    expect(barTally(page(doc, 'trumpet').bars)).toEqual(pieceTally(doc.timing))
    expect(partProblems(doc, 'trumpet')).toEqual([])
    expect(doc.timing).toBe(before.timing)
    expect(page(doc, 'clarinet')).toBe(page(before, 'clarinet'))
    expect(page(doc, 'flute')).toBe(page(before, 'flute'))
  })

  it('refuses when the piece has no pickup', () => {
    expect(shiftPartPickup(demoDoc(), 'clarinet')).toEqual({ ok: false, reason: 'no-piece-pickup' })
  })

  it('refuses when the part already has box 0, and a part the doc does not have', () => {
    expect(shiftPartPickup(pickupPiece(), 'flute')).toEqual({ ok: false, reason: 'part-has-pickup' })
    expect(shiftPartPickup(pickupPiece(), 'tuba')).toEqual({ ok: false, reason: 'no-box' })
  })
})
