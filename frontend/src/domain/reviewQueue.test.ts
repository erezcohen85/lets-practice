import { type EditorDoc } from '@/domain/pieceEdits'
import { SHORT_PART_ID, demoDoc } from '@/domain/pieceFixtures'
import { nextProblem, partReview, pieceReview, reviewCounts, reviewItems, type ReviewItem } from '@/domain/reviewQueue'
import { resolveAllOpen } from '@/domain/reviewEdits'
import { dragLocator, resolveMoved, soundsRight, undoMove } from '@/domain/timingEdits'
import { type ReviewFlag } from '@/domain/types'

const FLAG: ReviewFlag = { kind: 'crowded', severity: 1, expected: 3.6, found: 1.8, factor: 0.5, explainedBy: null, uncertainLine: null }

/** The demo doc with flags on these (bar:pass) locators; the ones in `checked` are checked. */
function flagged(labels: string[], checked: string[] = []): EditorDoc {
  const doc = demoDoc()
  return {
    ...doc,
    timing: {
      ...doc.timing,
      locators: doc.timing.locators.map((l) => {
        const label = `${l.bar}:${l.passIndex}`
        if (!labels.includes(label)) return l
        return { ...l, flags: [FLAG], ...(checked.includes(label) ? { checked: true } : {}) }
      }),
    },
  }
}

function withoutLocators(doc: EditorDoc, labels: string[]): EditorDoc {
  return {
    ...doc,
    timing: { ...doc.timing, locators: doc.timing.locators.filter((l) => !labels.includes(`${l.bar}:${l.passIndex}`)) },
  }
}

function ok<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
  if (!result.ok) throw new Error('expected an ok result')
  return result as Extract<T, { ok: true }>
}

describe('reviewItems', () => {
  it('lists a locator with flags as a flag item, with its time, flags, checked and moved', () => {
    const doc = flagged(['6:0', '14:0'], ['14:0'])

    const items = reviewItems(doc, 'clarinet')

    expect(items).toEqual([
      { kind: 'flag', bar: 6, passIndex: 0, timeSec: 19, flags: [FLAG], checked: false, moved: false },
      { kind: 'flag', bar: 14, passIndex: 0, timeSec: 1 + 3.6 * 13, flags: [FLAG], checked: true, moved: false },
    ])
  })

  it('ignores locators without flags and with an empty flag list', () => {
    const doc = demoDoc()
    const empty = { ...doc, timing: { ...doc.timing, locators: doc.timing.locators.map((l) => ({ ...l, flags: [] })) } }

    expect(reviewItems(doc, 'clarinet')).toEqual([])
    expect(reviewItems(empty, 'clarinet')).toEqual([])
  })

  it('lists an unmatched slot as an unmatched item, in play order with the flag items', () => {
    const doc = withoutLocators(flagged(['6:0', '14:1']), ['9:1', '3:0'])

    const items = reviewItems(doc, 'clarinet')

    expect(items.map((item) => item.kind === 'part' || item.kind === 'box' ? item.kind : `${item.kind} ${item.bar}:${item.passIndex}`)).toEqual([
      'unmatched 3:0',
      'flag 6:0',
      'unmatched 9:1',
      'flag 14:1',
    ])
  })

  it('puts the part problems first: the trumpet part has one bar fewer than the piece', () => {
    const doc = flagged(['6:0'])

    const items = reviewItems(doc, SHORT_PART_ID)

    expect(items).toEqual([
      { kind: 'part', problem: { kind: 'bar-count', partBars: 63, pieceBars: 64 } },
      expect.objectContaining({ kind: 'flag', bar: 6 }),
    ])
    expect(reviewItems(doc, 'clarinet')).toHaveLength(1)
  })

  it('marks a dragged locator as moved', () => {
    const dragged = ok(dragLocator(flagged(['6:0']), 6, 0, 19.5)).doc

    expect(reviewItems(dragged, 'clarinet')).toEqual([expect.objectContaining({ kind: 'flag', bar: 6, moved: true, checked: false })])
  })

  describe('a locator dragged by hand', () => {
    it('is an open, moved item even without a flag', () => {
      const dragged = ok(dragLocator(demoDoc(), 20, 0, 1 + 3.6 * 27 + 0.5)).doc

      const items = reviewItems(dragged, 'clarinet')

      expect(items).toEqual([
        { kind: 'flag', bar: 20, passIndex: 0, timeSec: 1 + 3.6 * 27 + 0.5, flags: [], checked: false, moved: true },
      ])
      expect(reviewCounts(items)).toEqual({ checked: 0, total: 1, moved: 1, open: 1 })
    })

    it('leaves the queue when it is Resolved', () => {
      const dragged = ok(dragLocator(demoDoc(), 20, 0, 1 + 3.6 * 27 + 0.5)).doc

      const resolved = ok(resolveMoved(dragged, 20, 0)).doc

      expect(reviewItems(resolved, 'clarinet')).toEqual([])
    })

    it('leaves the queue when its move is undone', () => {
      const dragged = ok(dragLocator(demoDoc(), 20, 0, 1 + 3.6 * 27 + 0.5)).doc

      const undone = ok(undoMove(dragged, 20, 0)).doc

      expect(reviewItems(undone, 'clarinet')).toEqual([])
    })

    it('leaves the queue with Resolve all', () => {
      const first = ok(dragLocator(demoDoc(), 20, 0, 1 + 3.6 * 27 + 0.5)).doc
      const second = ok(dragLocator(first, 21, 0, 1 + 3.6 * 28 + 0.5)).doc
      expect(reviewCounts(reviewItems(second, 'clarinet'))).toMatchObject({ total: 2, moved: 2 })

      const resolved = ok(resolveAllOpen(second, 'clarinet')).doc

      expect(reviewItems(resolved, 'clarinet')).toEqual([])
    })

    it('stays in the queue as a checked item after Resolved when it has a flag, and after Undo move keeps its flag state', () => {
      const doc = flagged(['6:0'])
      const dragged = ok(dragLocator(doc, 6, 0, 19.5)).doc

      const resolved = ok(resolveMoved(dragged, 6, 0)).doc
      const undone = ok(undoMove(dragged, 6, 0)).doc

      expect(reviewItems(resolved, 'clarinet')).toEqual([
        expect.objectContaining({ kind: 'flag', bar: 6, flags: [FLAG], checked: true, moved: false }),
      ])
      expect(reviewItems(undone, 'clarinet')).toEqual([
        expect.objectContaining({ kind: 'flag', bar: 6, checked: false, moved: false }),
      ])
    })

    it('does not count in the status of the Library and the hub, which are built without `moved`', () => {
      const dragged = ok(dragLocator(demoDoc(), 20, 0, 1 + 3.6 * 27 + 0.5)).doc

      expect(partReview(dragged.timing, dragged.pages[0])).toEqual({ checked: 0, total: 0 })
      expect(pieceReview(dragged.timing, dragged.pages)).toEqual({ checked: 0, total: 1 })
    })
  })

  it('has no items for a piece without bars', () => {
    const empty: EditorDoc = { timing: { barCount: 0, playOrder: [], meters: [], marks: [], locators: [] }, pages: [] }

    expect(reviewItems(empty, 'clarinet')).toEqual([])
  })
})

describe('reviewCounts', () => {
  it('counts every item in total, the checked flag items, the moved unchecked ones and the open ones', () => {
    const base = withoutLocators(flagged(['6:0', '14:0', '22:0', '31:0'], ['14:0']), ['9:1'])
    const dragged = ok(dragLocator(base, 22, 0, 1 + 3.6 * 29 + 0.5)).doc
    const items = reviewItems(dragged, SHORT_PART_ID)

    expect(reviewCounts(items)).toEqual({ checked: 1, total: 6, moved: 1, open: 5 })
  })

  it('a moved locator that is resolved is checked, not moved', () => {
    const dragged = ok(dragLocator(flagged(['6:0']), 6, 0, 19.5)).doc
    const resolved = ok(resolveMoved(dragged, 6, 0)).doc

    expect(reviewCounts(reviewItems(resolved, 'clarinet'))).toEqual({ checked: 1, total: 1, moved: 0, open: 0 })
  })

  it('Sounds right moves an item from open to checked', () => {
    const doc = flagged(['6:0', '14:0'])

    const checked = ok(soundsRight(doc, 6, 0)).doc

    expect(reviewCounts(reviewItems(doc, 'clarinet'))).toMatchObject({ checked: 0, total: 2, open: 2 })
    expect(reviewCounts(reviewItems(checked, 'clarinet'))).toMatchObject({ checked: 1, total: 2, open: 1 })
  })

  it('an empty queue is all zero', () => {
    expect(reviewCounts([])).toEqual({ checked: 0, total: 0, moved: 0, open: 0 })
  })
})

describe('nextProblem', () => {
  const item = (bar: number, checked: boolean): ReviewItem => ({
    kind: 'flag',
    bar,
    passIndex: 0,
    timeSec: bar,
    flags: [FLAG],
    checked,
    moved: false,
  })
  const part: ReviewItem = { kind: 'part', problem: { kind: 'bar-count', partBars: 63, pieceBars: 64 } }

  it('is the next item that is not checked', () => {
    const items = [item(1, false), item(2, true), item(3, false), item(4, false)]

    expect(nextProblem(items, 0)).toBe(2)
    expect(nextProblem(items, 2)).toBe(3)
  })

  it('starts at the first open item when nothing is selected', () => {
    expect(nextProblem([item(1, true), item(2, false)], null)).toBe(1)
    expect(nextProblem([item(1, false), item(2, false)], null)).toBe(0)
  })

  it('wraps round to the start', () => {
    const items = [item(1, false), item(2, true), item(3, true)]

    expect(nextProblem(items, 2)).toBe(0)
    expect(nextProblem(items, 1)).toBe(0)
  })

  it('stays on the only open item', () => {
    expect(nextProblem([item(1, true), item(2, false)], 1)).toBe(1)
  })

  it('part and unmatched items are never checked', () => {
    const items = [part, item(1, true), { kind: 'unmatched', bar: 3, passIndex: 0 } as const]

    expect(nextProblem(items, 0)).toBe(2)
    expect(nextProblem(items, 2)).toBe(0)
  })

  it('is null when every item is checked, or there are none', () => {
    expect(nextProblem([item(1, true), item(2, true)], 0)).toBeNull()
    expect(nextProblem([], null)).toBeNull()
  })
})

describe('partReview and pieceReview', () => {
  const doc = flagged(['6:0', '14:0', '22:0', '28:0'], ['14:0', '28:0'])
  const [clarinet, trumpet, flute] = doc.pages

  it('counts the shared timing items for a part with no problem of its own', () => {
    expect(partReview(doc.timing, clarinet)).toEqual({ checked: 2, total: 4 })
    expect(partReview(doc.timing, flute)).toEqual({ checked: 2, total: 4 })
  })

  it('adds the bar-count problem to the part that has one, so parts differ only by their own problems', () => {
    expect(partReview(doc.timing, trumpet)).toEqual({ checked: 2, total: 5 })
  })

  it('counts unmatched slots among the shared items', () => {
    const missing = withoutLocators(doc, ['40:0']).timing

    expect(partReview(missing, clarinet)).toEqual({ checked: 2, total: 5 })
  })

  it('the piece counts the shared items once plus every part problem', () => {
    expect(pieceReview(doc.timing, doc.pages)).toEqual({ checked: 2, total: 5 })
  })

  it('a piece with nothing to review is 0 of 0; one with no bars too', () => {
    const clean = demoDoc()
    const empty = { barCount: 0, playOrder: [], meters: [], marks: [], locators: [] }

    expect(pieceReview(clean.timing, [clean.pages[0], clean.pages[2]])).toEqual({ checked: 0, total: 0 })
    expect(pieceReview(empty, [{ partId: 'a', bars: [], rests: [] }])).toEqual({ checked: 0, total: 0 })
    expect(partReview(empty, { partId: 'a', bars: [], rests: [] })).toEqual({ checked: 0, total: 0 })
  })

  it('agrees with the counts of the Review Queue of the part', () => {
    const queue = reviewCounts(reviewItems(doc, SHORT_PART_ID))

    expect(partReview(doc.timing, trumpet)).toEqual({ checked: queue.checked, total: queue.total })
  })
})
