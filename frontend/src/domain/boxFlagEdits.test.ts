import { dismissBoxFlag, applySuggestedEdge, putBackBox } from '@/domain/boxFlagEdits'
import { MIN_BOX_WIDTH, type EditorDoc, type EditResult } from '@/domain/pieceEdits'
import { demoDoc } from '@/domain/pieceFixtures'
import { partReview, pieceReview, reviewItems } from '@/domain/reviewQueue'
import { type BarBox, type BoxFlag } from '@/domain/types'

// The demo piece's clarinet has four boxes per line, 260 px wide from x = 100: bars 1, 5, 9 ... start a line.
const flag = (bar: number, extra: Partial<BoxFlag> = {}): BoxFlag => ({ bar, verdict: 'signature_inside', note: 'a clef', suggestedX: null, ...extra })

function flagged(...flags: BoxFlag[]): EditorDoc {
  const doc = demoDoc()
  return { ...doc, pages: doc.pages.map((page) => (page.partId === 'clarinet' ? { ...page, boxFlags: flags } : page)) }
}

function ok(result: EditResult): EditorDoc {
  if (!result.ok) throw new Error(`expected an edit, got a refusal: ${result.reason}`)
  return result.doc
}

const clarinet = (doc: EditorDoc) => doc.pages.find((page) => page.partId === 'clarinet')!

describe('the box items of the queue', () => {
  it('are one per flag of the open part, after the part problem and before the timing items', () => {
    const doc = flagged(flag(9), flag(5, { verdict: 'two_bars' }))
    const items = reviewItems(doc, 'trumpet') // the part that misses a bar line has a part problem
    expect(items.map((item) => item.kind)[0]).toBe('part')

    const own = reviewItems(doc, 'clarinet')
    const kinds = own.map((item) => item.kind)
    expect(kinds.slice(0, 2)).toEqual(['box', 'box'])
    expect(own.slice(0, 2).map((item) => (item.kind === 'box' ? item.bar : -1))).toEqual([5, 9])
  })

  it('count in the part and the piece status until they are resolved', () => {
    const doc = flagged(flag(5), flag(9))
    const without = flagged()

    expect(partReview(doc.timing, clarinet(doc)).total).toBe(partReview(without.timing, clarinet(without)).total + 2)
    expect(pieceReview(doc.timing, doc.pages).total).toBe(pieceReview(without.timing, without.pages).total + 2)
  })

  it('do not show for another part', () => {
    expect(reviewItems(flagged(flag(5)), 'flute').some((item) => item.kind === 'box')).toBe(false)
  })
})

describe('applySuggestedEdge', () => {
  it('moves the line start to the suggested edge and removes the flag, as one resolve-box-flag step', () => {
    const doc = flagged(flag(5, { suggestedX: 140 }), flag(9))
    const result = applySuggestedEdge(doc, 'clarinet', 5)

    expect(result.ok && result.label).toEqual({ kind: 'resolve-box-flag', bar: 5 })
    const after = clarinet(ok(result))
    expect(after.bars.find((box) => box.bar === 5)!.x).toBe(140)
    expect(after.boxFlags?.map((f) => f.bar)).toEqual([9])
  })

  it('leaves the key out when it was the last flag', () => {
    const after = clarinet(ok(applySuggestedEdge(flagged(flag(5, { suggestedX: 140 })), 'clarinet', 5)))
    expect('boxFlags' in after).toBe(false)
  })

  it('is refused without a suggested edge, and for an edge the box cannot take', () => {
    const none = applySuggestedEdge(flagged(flag(5)), 'clarinet', 5)
    expect(none.ok).toBe(false)
    const tooFar = applySuggestedEdge(flagged(flag(5, { suggestedX: 99999 })), 'clarinet', 5)
    expect(tooFar).toEqual({ ok: false, reason: 'too-narrow' })
  })

  it('is refused for a bar with no flag', () => {
    expect(applySuggestedEdge(flagged(), 'clarinet', 5)).toEqual({ ok: false, reason: 'not-found' })
  })
})

describe('dismissBoxFlag', () => {
  it('removes the flag and nothing else, as one resolve-box-flag step', () => {
    const doc = flagged(flag(5), flag(9))
    const result = dismissBoxFlag(doc, 'clarinet', 5)

    expect(result.ok && result.label).toEqual({ kind: 'resolve-box-flag', bar: 5 })
    const after = ok(result)
    expect(clarinet(after).boxFlags?.map((f) => f.bar)).toEqual([9])
    expect(clarinet(after).bars).toBe(clarinet(doc).bars)
    expect(after.timing).toBe(doc.timing)
  })

  it('is refused for a bar with no flag', () => {
    expect(dismissBoxFlag(flagged(), 'clarinet', 5)).toEqual({ ok: false, reason: 'not-found' })
  })
})

// Advanced Reading (8.22) moves a box at read time and flags it read_moved with the edges it had before. Bars 5 to 8 of
// the demo clarinet are one line, 260 px wide, touching, from x = 100: 5 is 100-360, 6 is 360-620, 7 is 620-880, 8 is 880-1140.
const moved = (bar: number, previous: { x: number; w: number } | null | undefined, extra: Partial<BoxFlag> = {}): BoxFlag => ({
  bar,
  verdict: 'read_moved',
  note: 'Advanced Reading moved this bar.',
  suggestedX: null,
  ...(previous === undefined ? {} : { previous }),
  ...extra,
})

/** The doc with some bars of the clarinet put where `patch` says (the map as Advanced Reading, and then the user, left it). */
function withBoxes(doc: EditorDoc, patch: Record<number, Partial<BarBox>>): EditorDoc {
  return {
    ...doc,
    pages: doc.pages.map((page) =>
      page.partId === 'clarinet' ? { ...page, bars: page.bars.map((box) => (patch[box.bar] === undefined ? box : { ...box, ...patch[box.bar] })) } : page,
    ),
  }
}

const boxOf = (doc: EditorDoc, bar: number) => clarinet(doc).bars.find((box) => box.bar === bar)!
const edgesOf = (doc: EditorDoc, bar: number) => {
  const { x, w } = boxOf(doc, bar)
  return { x, w }
}
/** Every bar of the clarinet that differs from `before`. */
const changedBars = (before: EditorDoc, after: EditorDoc) =>
  clarinet(after)
    .bars.filter((box) => JSON.stringify(box) !== JSON.stringify(boxOf(before, box.bar)))
    .map((box) => box.bar)

describe('putBackBox', () => {
  it('restores the old edges, removes the flag and is one resolve-box-flag step; the timing never changes', () => {
    // Advanced Reading pulled bar 6's left edge in to 380; bar 5 grew to meet it.
    const doc = withBoxes(flagged(moved(6, { x: 360, w: 260 }), flag(9)), { 6: { x: 380, w: 240 }, 5: { w: 280 } })
    const result = putBackBox(doc, 'clarinet', 6)

    expect(result.ok && result.label).toEqual({ kind: 'resolve-box-flag', bar: 6 })
    const after = ok(result)
    expect(edgesOf(after, 6)).toEqual({ x: 360, w: 260 })
    expect(clarinet(after).boxFlags?.map((f) => f.bar)).toEqual([9])
    expect(after.timing).toBe(doc.timing)
    expect(after.pages.find((page) => page.partId === 'flute')).toBe(doc.pages.find((page) => page.partId === 'flute'))
  })

  it('leaves the boxFlags key out when it was the last flag', () => {
    const doc = withBoxes(flagged(moved(6, { x: 360, w: 260 })), { 6: { x: 380, w: 240 }, 5: { w: 280 } })
    expect('boxFlags' in clarinet(ok(putBackBox(doc, 'clarinet', 6)))).toBe(false)
  })

  it('moves the neighbour whose edge touched the box on its left, so the line stays gap-free', () => {
    const doc = withBoxes(flagged(moved(6, { x: 360, w: 260 })), { 6: { x: 380, w: 240 }, 5: { w: 280 } })
    const after = ok(putBackBox(doc, 'clarinet', 6))

    expect(edgesOf(after, 5)).toEqual({ x: 100, w: 260 })
    expect(changedBars(doc, after)).toEqual([5, 6])
  })

  it('moves the neighbour whose edge touched the box on its right', () => {
    // Bar 6 was widened to 660; bar 7 starts there.
    const doc = withBoxes(flagged(moved(6, { x: 360, w: 260 })), { 6: { w: 300 }, 7: { x: 660, w: 220 } })
    const after = ok(putBackBox(doc, 'clarinet', 6))

    expect(edgesOf(after, 6)).toEqual({ x: 360, w: 260 })
    expect(edgesOf(after, 7)).toEqual({ x: 620, w: 260 })
    expect(changedBars(doc, after)).toEqual([6, 7])
  })

  it('moves both neighbours when both edges moved', () => {
    const doc = withBoxes(flagged(moved(6, { x: 360, w: 260 })), { 6: { x: 390, w: 200 }, 5: { w: 290 }, 7: { x: 590, w: 290 } })
    const after = ok(putBackBox(doc, 'clarinet', 6))

    expect([5, 6, 7].map((bar) => edgesOf(after, bar))).toEqual([
      { x: 100, w: 260 },
      { x: 360, w: 260 },
      { x: 620, w: 260 },
    ])
  })

  it('counts an edge within a pixel as touching', () => {
    const doc = withBoxes(flagged(moved(6, { x: 360, w: 260 })), { 6: { x: 380, w: 240 }, 5: { w: 280.8 } })
    expect(edgesOf(ok(putBackBox(doc, 'clarinet', 6)), 5)).toEqual({ x: 100, w: 260 })
  })

  it('leaves a neighbour alone when a gap lay between it and the box, such as the room of a signature', () => {
    // Bar 7 starts 40 px after bar 6 ends (a key signature); putting bar 6's right edge back does not drag it.
    const doc = withBoxes(flagged(moved(6, { x: 360, w: 260 })), { 6: { w: 240 }, 7: { x: 640, w: 240 } })
    const after = ok(putBackBox(doc, 'clarinet', 6))

    expect(edgesOf(after, 6)).toEqual({ x: 360, w: 260 })
    expect(boxOf(after, 7)).toBe(boxOf(doc, 7))
  })

  it('takes the neighbours as the map has them now: a neighbour the user edited since keeps its other edge', () => {
    // The user pulled bar 5's left edge in to 120 after the read; only its touching right edge goes back.
    const doc = withBoxes(flagged(moved(6, { x: 360, w: 260 })), { 6: { x: 380, w: 240 }, 5: { x: 120, w: 260 } })
    const after = ok(putBackBox(doc, 'clarinet', 6))

    expect(edgesOf(after, 5)).toEqual({ x: 120, w: 240 })
  })

  it('does not drag a box the user has moved away from the flagged one', () => {
    // The user pulled bar 5's right edge back to 340 after the read, so it no longer touches bar 6 (380).
    const doc = withBoxes(flagged(moved(6, { x: 360, w: 260 })), { 6: { x: 380, w: 240 }, 5: { w: 240 } })
    const after = ok(putBackBox(doc, 'clarinet', 6))

    expect(boxOf(after, 5)).toBe(boxOf(doc, 5))
    expect(edgesOf(after, 6)).toEqual({ x: 360, w: 260 })
  })

  it('touches no box on another line, even one whose edge sits at the same x', () => {
    // Bar 6's left edge goes back from 380 to 360 and bar 5 follows; bar 4, the line above, happens to end at 360 as well.
    const doc = withBoxes(flagged(moved(6, { x: 360, w: 260 })), { 6: { x: 380, w: 240 }, 5: { w: 280 }, 4: { x: 100, w: 260 } })
    const after = ok(putBackBox(doc, 'clarinet', 6))

    expect(changedBars(doc, after)).toEqual([5, 6])
    expect(boxOf(after, 4)).toBe(boxOf(doc, 4))
  })

  it('restores every bar of a multi-rest and gives the flag one place', () => {
    // Bars 6 and 7 are one printed rest, 360-880; Advanced Reading moved its left edge to 380 and bar 5 grew to meet it.
    const rest = { y: boxOf(flagged(), 6).y, h: 300, pageIndex: 0 }
    const doc = withBoxes(flagged(moved(6, { x: 360, w: 520 })), { 6: { ...rest, x: 380, w: 500 }, 7: { ...rest, x: 380, w: 500 }, 5: { w: 280 } })
    const after = ok(putBackBox(doc, 'clarinet', 6))

    expect(edgesOf(after, 6)).toEqual({ x: 360, w: 520 })
    expect(edgesOf(after, 7)).toEqual({ x: 360, w: 520 })
    expect(edgesOf(after, 5)).toEqual({ x: 100, w: 260 })
    expect(edgesOf(after, 8)).toEqual({ x: 880, w: 260 })
    expect(clarinet(after).boxFlags).toBeUndefined()
  })

  it('moves every bar of a multi-rest that is the neighbour', () => {
    // Bars 7 and 8 are one printed rest; bar 6 was widened to 640 and the rest starts there.
    const rest = { y: boxOf(flagged(), 7).y, h: 300, pageIndex: 0 }
    const doc = withBoxes(flagged(moved(6, { x: 360, w: 260 })), { 6: { w: 280 }, 7: { ...rest, x: 640, w: 500 }, 8: { ...rest, x: 640, w: 500 } })
    const after = ok(putBackBox(doc, 'clarinet', 6))

    expect(edgesOf(after, 7)).toEqual({ x: 620, w: 520 })
    expect(edgesOf(after, 8)).toEqual({ x: 620, w: 520 })
  })

  it('keeps the other flags, with their old edges', () => {
    const other = moved(9, { x: 90, w: 270 })
    const doc = withBoxes(flagged(moved(6, { x: 360, w: 260 }), other), { 6: { x: 380, w: 240 }, 5: { w: 280 } })
    expect(clarinet(ok(putBackBox(doc, 'clarinet', 6))).boxFlags).toEqual([other])
  })

  it('works on a flag that has a check verdict as well, which the read merged its note into', () => {
    const merged = moved(5, { x: 80, w: 280 }, { verdict: 'starts_late', suggestedX: 120 })
    const doc = withBoxes(flagged(merged), { 5: { x: 100, w: 260 } })
    const after = ok(putBackBox(doc, 'clarinet', 5))

    expect(edgesOf(after, 5)).toEqual({ x: 80, w: 280 })
  })

  it('is refused for a bar with no flag', () => {
    expect(putBackBox(flagged(), 'clarinet', 6)).toEqual({ ok: false, reason: 'not-found' })
    expect(putBackBox(flagged(moved(6, { x: 360, w: 260 })), 'clarinet', 7)).toEqual({ ok: false, reason: 'not-found' })
  })

  it('is refused for a flag with no old edges, whether the key is missing or null', () => {
    expect(putBackBox(flagged(moved(6, undefined)), 'clarinet', 6)).toEqual({ ok: false, reason: 'invalid' })
    expect(putBackBox(flagged(moved(6, null)), 'clarinet', 6)).toEqual({ ok: false, reason: 'invalid' })
    expect(putBackBox(flagged(moved(5, undefined, { verdict: 'read_count' })), 'clarinet', 5)).toEqual({ ok: false, reason: 'invalid' })
  })

  it('is refused for old edges that leave the box with no width, off the page or not a number', () => {
    const doc = (previous: { x: number; w: number }) => withBoxes(flagged(moved(6, previous)), { 6: { x: 380, w: 240 }, 5: { w: 280 } })
    for (const previous of [
      { x: 360, w: 0 },
      { x: 360, w: -5 },
      { x: 360, w: MIN_BOX_WIDTH - 1 },
      { x: -10, w: 260 },
      { x: Number.NaN, w: 260 },
      { x: 360, w: Number.POSITIVE_INFINITY },
    ]) {
      expect(putBackBox(doc(previous), 'clarinet', 6)).toEqual({ ok: false, reason: 'invalid' })
    }
  })

  it('is refused when a touching neighbour would be left too narrow, and changes nothing', () => {
    // Bar 5 was edited down to 300-380; the old left edge of bar 6 (305) would leave it 5 px wide.
    const doc = withBoxes(flagged(moved(6, { x: 305, w: 315 })), { 6: { x: 380, w: 240 }, 5: { x: 300, w: 80 } })
    expect(putBackBox(doc, 'clarinet', 6)).toEqual({ ok: false, reason: 'invalid' })
    expect(doc.pages.find((page) => page.partId === 'clarinet')!.boxFlags?.map((f) => f.bar)).toEqual([6])
  })

  it('is refused when the flag sits on a bar that has no box', () => {
    const doc = flagged(moved(99, { x: 360, w: 260 }))
    expect(putBackBox(doc, 'clarinet', 99)).toEqual({ ok: false, reason: 'no-box' })
  })
})

// Sousa Flutes, line 18 (8.22). Advanced Reading judges a line's moves as one proposal, so it adds a missed bar line and
// moves three boxes at once, each with its own read_moved flag. Before: 120 was 470.67-876.67, 121 876.67-970, 122 970-1116.
// Now: 120 is 470.67-722.5, 121 722.5-876.67, 122 876.67-1116. Bar 119 ends where 120 starts and is untouched; 123 and 124
// are the next line down.
const BEFORE = { 120: { x: 470.67, w: 406 }, 121: { x: 876.67, w: 93.33 }, 122: { x: 970, w: 146 } }

function sousaDoc(...flags: BoxFlag[]): EditorDoc {
  const on = (bar: number, x: number, w: number, y = 214) => ({ bar, pageIndex: 0, x, y, w, h: 140 })
  const bars = [on(119, 100, 370.67), on(120, 470.67, 251.83), on(121, 722.5, 154.17), on(122, 876.67, 239.33), on(123, 100, 260, 582), on(124, 360, 260, 582)]
  const doc = flagged(...flags)
  return { ...doc, pages: doc.pages.map((page) => (page.partId === 'clarinet' ? { ...page, bars } : page)) }
}

const lineFlags = () => [moved(120, BEFORE[120]), moved(121, BEFORE[121]), moved(122, BEFORE[122])]

/** The boxes of the line of bars 119-122 side by side: each starts where the one before ends. */
function expectGapFree(doc: EditorDoc) {
  const line = clarinet(doc).bars.filter((box) => box.bar >= 119 && box.bar <= 122)
  line.slice(1).forEach((box, i) => expect(box.x).toBeCloseTo(line[i].x + line[i].w, 6))
}

describe('putBackBox on a line Advanced Reading changed as a whole', () => {
  it('restores every box of the line that has old edges, exactly, from any of its flags', () => {
    for (const bar of [120, 121, 122]) {
      const doc = sousaDoc(...lineFlags())
      const result = putBackBox(doc, 'clarinet', bar)

      expect(result.ok && result.label).toEqual({ kind: 'resolve-box-flag', bar })
      const after = ok(result)
      expect([120, 121, 122].map((n) => edgesOf(after, n))).toEqual([BEFORE[120], BEFORE[121], BEFORE[122]])
      expectGapFree(after)
      expect(clarinet(after).boxFlags).toBeUndefined()
      expect(changedBars(doc, after)).toEqual([120, 121, 122])
      expect(after.timing).toBe(doc.timing)
    }
  })

  it('leaves the flags of other lines, and their boxes, alone', () => {
    const elsewhere = moved(123, { x: 90, w: 270 })
    const doc = sousaDoc(...lineFlags(), elsewhere)
    const after = ok(putBackBox(doc, 'clarinet', 120))

    expect(clarinet(after).boxFlags).toEqual([elsewhere])
    expect(boxOf(after, 123)).toBe(boxOf(doc, 123))
  })

  it('keeps the flags of the line that have no old edges, a read_count or a check flag', () => {
    const count = moved(119, undefined, { verdict: 'read_count', note: 'Advanced Reading read 4 bars on this line; the first read had 3.' })
    const check = flag(122, { verdict: 'ends_late' })
    const doc = sousaDoc(count, moved(120, BEFORE[120]), moved(121, BEFORE[121]), check)
    const after = ok(putBackBox(doc, 'clarinet', 120))

    expect(clarinet(after).boxFlags).toEqual([count, check])
    expect(edgesOf(after, 120)).toEqual(BEFORE[120])
    expect(edgesOf(after, 121)).toEqual(BEFORE[121])
  })

  it('goes by the old edges, not the verdict: a flag the box check also found wrong goes back too', () => {
    const merged = moved(121, BEFORE[121], { verdict: 'starts_late', suggestedX: 740, note: 'Advanced Reading moved this bar. The box starts late.' })
    const doc = sousaDoc(moved(120, BEFORE[120]), merged, moved(122, BEFORE[122]))
    const after = ok(putBackBox(doc, 'clarinet', 120))

    expect(edgesOf(after, 121)).toEqual(BEFORE[121])
    expect(clarinet(after).boxFlags).toBeUndefined()
  })

  it('moves a box whose flag was dismissed as a touching neighbour, so the line stays gap-free', () => {
    // The middle flag was dismissed: bar 121 stays where the read put it until its neighbours go back, then it follows both.
    const doc = sousaDoc(moved(120, BEFORE[120]), moved(122, BEFORE[122]))
    const after = ok(putBackBox(doc, 'clarinet', 120))

    expect(edgesOf(after, 120)).toEqual(BEFORE[120])
    expect(edgesOf(after, 122)).toEqual(BEFORE[122])
    expect(boxOf(after, 121).x).toBeCloseTo(BEFORE[121].x, 6)
    expect(boxOf(after, 121).w).toBeCloseTo(BEFORE[121].w, 6)
    expectGapFree(after)
  })

  it('does the same when the first or the last flag was the dismissed one', () => {
    const first = ok(putBackBox(sousaDoc(moved(121, BEFORE[121]), moved(122, BEFORE[122])), 'clarinet', 121))
    expect(edgesOf(first, 121)).toEqual(BEFORE[121])
    expect(edgesOf(first, 122)).toEqual(BEFORE[122])
    expect(boxOf(first, 120).x).toBeCloseTo(BEFORE[120].x, 6)
    expect(boxOf(first, 120).w).toBeCloseTo(BEFORE[120].w, 6)
    expectGapFree(first)

    const last = ok(putBackBox(sousaDoc(moved(120, BEFORE[120]), moved(121, BEFORE[121])), 'clarinet', 120))
    expect(edgesOf(last, 120)).toEqual(BEFORE[120])
    expect(edgesOf(last, 121)).toEqual(BEFORE[121])
    expect(boxOf(last, 122).x).toBeCloseTo(BEFORE[122].x, 6)
    expect(boxOf(last, 122).w).toBeCloseTo(BEFORE[122].w, 6)
    expectGapFree(last)
  })

  it('is refused when a box between the restored ones would really be left too narrow, and changes nothing', () => {
    // Bar 121 was dismissed; the old edges of 122 now start 3 px after the old end of 120, which leaves 121 3.33 px wide.
    const doc = sousaDoc(moved(120, BEFORE[120]), moved(122, { x: 880, w: 236 }))
    expect(putBackBox(doc, 'clarinet', 120)).toEqual({ ok: false, reason: 'invalid' })
  })

  it('is refused when another flag of the line has old edges that cannot be restored', () => {
    const doc = sousaDoc(moved(120, BEFORE[120]), moved(121, { x: 876.67, w: 0 }), moved(122, BEFORE[122]))
    expect(putBackBox(doc, 'clarinet', 120)).toEqual({ ok: false, reason: 'invalid' })
  })

  it('is still refused from a flag with no old edges, even when its line has flags that have them', () => {
    const doc = sousaDoc(moved(119, undefined, { verdict: 'read_count' }), moved(120, BEFORE[120]))
    expect(putBackBox(doc, 'clarinet', 119)).toEqual({ ok: false, reason: 'invalid' })
  })
})
