import {
  addBarLineInPiece,
  boxGroup,
  deleteBarLineInPiece,
  setBarsInBox,
  setBarsInBoxInPiece,
} from '@/domain/boxEdits'
import { straightMap } from '@/domain/fixtures'
import { addBarLine, insertPieceBar, removePieceBar, type EditorDoc, type EditResult } from '@/domain/pieceEdits'
import { insertBarInTiming } from '@/domain/renumber'
import { type BarBox, type PageLayer } from '@/domain/types'

// Two parts on an 8-bar piece: the flute has a box per bar; the tuba's reading missed a 3-bar rest at bar 3, so it has
// 6 boxes (its box 3 is the rest, its boxes 4-6 are the piece's bars 6-8), with a rest mark on its box 6.
function doc(): EditorDoc {
  const { timing, page } = straightMap(8)
  const flute: PageLayer = { ...page, partId: 'flute' }
  const tuba: PageLayer = { partId: 'tuba', bars: page.bars.slice(0, 6), rests: [6] }
  return { timing, pages: [flute, tuba] }
}

function ok(result: EditResult): Extract<EditResult, { ok: true }> {
  if (!result.ok) throw new Error(`expected an edit, got a refusal: ${result.reason}`)
  return result
}

function bars(edited: EditorDoc, partId: string): BarBox[] {
  return edited.pages.find((page) => page.partId === partId)?.bars ?? []
}

function rests(edited: EditorDoc, partId: string): number[] {
  return edited.pages.find((page) => page.partId === partId)?.rests ?? []
}

const place = ({ pageIndex, x, y, w, h }: BarBox) => ({ pageIndex, x, y, w, h })

describe('boxGroup', () => {
  it('is the run of bars whose boxes share one place', () => {
    const rest = ok(setBarsInBox(doc(), 'tuba', 3, 3)).doc
    const tuba = rest.pages[1]

    expect(boxGroup(tuba, 4)).toEqual([3, 4, 5])
    expect(boxGroup(tuba, 2)).toEqual([2])
  })
})

describe('setBarsInBox (this part only)', () => {
  it('makes one box hold several bars: copies at its place, later boxes and rests renumbered, all of them rests', () => {
    const before = doc()
    const edited = ok(setBarsInBox(before, 'tuba', 3, 3)).doc
    const tuba = bars(edited, 'tuba')

    expect(tuba.map((b) => b.bar)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect([3, 4, 5].map((n) => place(tuba[n - 1]))).toEqual(Array(3).fill(place(bars(before, 'tuba')[2])))
    expect(place(tuba[5])).toEqual(place(bars(before, 'tuba')[3]))
    expect(rests(edited, 'tuba')).toEqual([3, 4, 5, 8])
  })

  it('never touches the timing or another part', () => {
    const before = doc()
    const edited = ok(setBarsInBox(before, 'tuba', 3, 3)).doc

    expect(edited.timing).toBe(before.timing)
    expect(edited.pages[0]).toBe(before.pages[0])
  })

  it('takes bars off the end of a group: later boxes and rests go down, the dropped rest goes', () => {
    const four = ok(setBarsInBox(doc(), 'tuba', 3, 4)).doc
    const edited = ok(setBarsInBox(four, 'tuba', 5, 3)).doc

    expect(bars(edited, 'tuba')).toHaveLength(8)
    expect(boxGroup(edited.pages[1], 3)).toEqual([3, 4, 5])
    expect(rests(edited, 'tuba')).toEqual([3, 4, 5, 8])
  })

  it('back to one bar, the box keeps its rest mark', () => {
    const three = ok(setBarsInBox(doc(), 'tuba', 3, 3)).doc
    const edited = ok(setBarsInBox(three, 'tuba', 3, 1)).doc

    expect(bars(edited, 'tuba')).toHaveLength(6)
    expect(rests(edited, 'tuba')).toEqual([3, 6])
  })

  it('records one step that names the bar and the count', () => {
    expect(ok(setBarsInBox(doc(), 'tuba', 3, 4)).label).toEqual({ kind: 'set-bars-in-box', bar: 3, count: 4 })
  })

  it('refuses the same count, a count under 1 or over 999, and a bar with no box', () => {
    expect(setBarsInBox(doc(), 'tuba', 3, 1)).toEqual({ ok: false, reason: 'invalid' })
    expect(setBarsInBox(doc(), 'tuba', 3, 0)).toEqual({ ok: false, reason: 'invalid' })
    expect(setBarsInBox(doc(), 'tuba', 3, 1000)).toEqual({ ok: false, reason: 'invalid' })
    expect(setBarsInBox(doc(), 'tuba', 3, 2.5)).toEqual({ ok: false, reason: 'invalid' })
    expect(setBarsInBox(doc(), 'tuba', 7, 2)).toEqual({ ok: false, reason: 'no-box' })
    expect(setBarsInBox(doc(), 'oboe', 1, 2)).toEqual({ ok: false, reason: 'no-box' })
  })
})

describe('the piece variants (Edit piece structure on)', () => {
  const middle = (b: BarBox) => b.x + b.w / 2

  it('add bar line gives the part and the piece the new bar; the other part is left as it was', () => {
    const before = doc()
    const box4 = bars(before, 'flute')[3]
    const result = ok(addBarLineInPiece(before, 'flute', 4, middle(box4), 'ripple'))

    expect(result.doc.timing).toEqual(insertBarInTiming(before.timing, 5, 'ripple').timing)
    expect(bars(result.doc, 'flute')).toHaveLength(9)
    expect(result.doc.pages[1]).toBe(before.pages[1])
    expect(result.label).toEqual({ kind: 'add-piece-bar-line', bar: 4 })
  })

  it('in plain mode the times stay on their numbers', () => {
    const before = doc()
    const result = ok(addBarLineInPiece(before, 'flute', 4, middle(bars(before, 'flute')[3]), 'plain'))
    expect(result.doc.timing).toEqual(insertBarInTiming(before.timing, 5, 'plain').timing)
  })

  it('delete mirrors add: a ripple add and a ripple delete at the same place give the doc back', () => {
    const before = doc()
    const added = ok(addBarLineInPiece(before, 'flute', 4, middle(bars(before, 'flute')[3]), 'ripple')).doc
    const deleted = ok(deleteBarLineInPiece(added, 'flute', 4, 'ripple'))

    expect(deleted.doc.timing.barCount).toBe(8)
    expect(deleted.doc.pages).toEqual(before.pages)
    expect(deleted.doc.timing.playOrder).toEqual(before.timing.playOrder)
    expect(deleted.label).toEqual({ kind: 'delete-piece-bar-line', bar: 4 })
  })

  it('Bars in this box gives the piece the same bars at the end of the group', () => {
    const before = doc()
    const result = ok(setBarsInBoxInPiece(before, 'tuba', 3, 3, 'ripple'))
    const twice = insertBarInTiming(insertBarInTiming(before.timing, 4, 'ripple').timing, 4, 'ripple').timing

    expect(result.doc.timing).toEqual(twice)
    expect(bars(result.doc, 'tuba')).toHaveLength(8)
    expect(result.doc.pages[0]).toBe(before.pages[0])
    expect(result.label).toEqual({ kind: 'set-piece-bars-in-box', bar: 3, count: 3 })
  })

  it('carries the part edit refusals through', () => {
    const before = doc()
    const box4 = bars(before, 'flute')[3]
    expect(addBarLineInPiece(before, 'flute', 4, box4.x + 1, 'ripple')).toEqual(addBarLine(before, 'flute', 4, box4.x + 1))
    expect(deleteBarLineInPiece(before, 'flute', 4, 'ripple')).toEqual({ ok: false, reason: 'line-end' })
  })
})

describe('rests follow only their own boxes', () => {
  it('inserting or removing a bar in the piece only moves no part rests (the Los Banditos case)', () => {
    const before = doc()
    const inserted = ok(insertPieceBar(before, 2, 'ripple')).doc
    const removed = ok(removePieceBar(before, 2, 'ripple')).doc

    expect(rests(inserted, 'tuba')).toEqual([6])
    expect(rests(removed, 'tuba')).toEqual([6])
    expect(inserted.pages).toBe(before.pages)
  })
})

describe('a part edit never leaves a rest after the part\'s last bar (Los Banditos tubas, 2026-11-03)', () => {
  it('a bar line added on a short part with rests up to the piece\'s last bar drops the one pushed past it', () => {
    // The tuba has 7 boxes in a piece of 8 bars and rests on 7-8 (8 has no box of its own).
    const { timing, page } = straightMap(8)
    const before: EditorDoc = { timing, pages: [{ partId: 'tuba', bars: page.bars.slice(0, 7), rests: [7, 8] }] }
    const box1 = page.bars[0]

    const edited = ok(addBarLine(before, 'tuba', 1, box1.x + box1.w / 2)).doc

    expect(edited.pages[0].bars).toHaveLength(8)
    expect(edited.pages[0].rests).toEqual([8]) // 7 moved to 8; 8 moved to 9, after the last bar, and is gone
  })
})
