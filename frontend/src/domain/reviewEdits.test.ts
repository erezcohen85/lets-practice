import { createHistory, record, undo } from '@/domain/history'
import { type EditorDoc, type EditResult } from '@/domain/pieceEdits'
import { demoDoc } from '@/domain/pieceFixtures'
import { resolveAllOpen, canResolveAll } from '@/domain/reviewEdits'
import { reviewCounts, reviewItems } from '@/domain/reviewQueue'
import { dragLocator } from '@/domain/timingEdits'
import { type BoxFlag, type ReviewFlag } from '@/domain/types'

const FLAG: ReviewFlag = { kind: 'crowded', severity: 1, expected: 3.6, found: 1.8, factor: 0.5, explainedBy: null, uncertainLine: null }
const BOX: BoxFlag = { bar: 5, verdict: 'signature_inside', note: 'a clef', suggestedX: null }

function ok(result: EditResult): Extract<EditResult, { ok: true }> {
  if (!result.ok) throw new Error(`expected an edit, got a refusal: ${result.reason}`)
  return result
}

/** The demo doc with bars 6 and 14 flagged (14 already checked), and a box flag on the clarinet's bar 5. */
function open(): EditorDoc {
  const doc = demoDoc()
  return {
    ...doc,
    timing: {
      ...doc.timing,
      locators: doc.timing.locators.map((l) =>
        l.bar === 6 ? { ...l, flags: [FLAG] } : l.bar === 14 && l.passIndex === 0 ? { ...l, flags: [FLAG], checked: true } : l,
      ),
    },
    pages: doc.pages.map((page) => (page.partId === 'clarinet' ? { ...page, boxFlags: [BOX] } : page)),
  }
}

const locatorOf = (doc: EditorDoc, bar: number) => doc.timing.locators.find((l) => l.bar === bar && l.passIndex === 0)!

describe('resolveAllOpen', () => {
  it('checks an unflagged-as-moved flag item as Sounds right does: confirmed and checked, its time unchanged', () => {
    const doc = open()
    const result = ok(resolveAllOpen(doc, 'clarinet'))

    expect(result.label).toEqual({ kind: 'resolve-all' })
    expect(locatorOf(result.doc, 6)).toEqual({ ...locatorOf(doc, 6), confirmed: true, checked: true })
  })

  it('checks a moved item as Resolved does: checked, off the moved list, no timing change and not confirmed again', () => {
    const base = open()
    const dragged = ok(dragLocator(base, 20, 0, locatorOf(base, 20).timeSec + 0.4)).doc

    const result = ok(resolveAllOpen(dragged, 'clarinet'))

    expect(result.doc.moved).toEqual([])
    expect(locatorOf(result.doc, 20)).toEqual({ ...locatorOf(dragged, 20), checked: true })
  })

  it('dismisses this part\'s box flags and leaves another part\'s alone', () => {
    const doc = open()
    const withOther: EditorDoc = { ...doc, pages: doc.pages.map((page) => (page.partId === 'flute' ? { ...page, boxFlags: [{ ...BOX, bar: 9 }] } : page)) }

    const result = ok(resolveAllOpen(withOther, 'clarinet'))

    expect(result.doc.pages.find((p) => p.partId === 'clarinet')!.boxFlags).toBeUndefined()
    expect(result.doc.pages.find((p) => p.partId === 'flute')!.boxFlags).toEqual([{ ...BOX, bar: 9 }])
  })

  it('leaves the items only fixing removes: bars without a time and part bar-count problems', () => {
    const doc = open()
    const unmatched: EditorDoc = { ...doc, timing: { ...doc.timing, locators: doc.timing.locators.filter((l) => l.bar !== 30) } }
    const before = reviewItems(unmatched, 'trumpet')
    expect(before.some((item) => item.kind === 'part')).toBe(true)

    const after = reviewItems(ok(resolveAllOpen(unmatched, 'trumpet')).doc, 'trumpet')

    const stays = (items: typeof before) => items.filter((item) => item.kind === 'part' || item.kind === 'unmatched')
    expect(stays(after)).toEqual(stays(before))
    expect(after.some((item) => item.kind === 'unmatched' && item.bar === 30)).toBe(true)
  })

  it('leaves every flag item checked and none open but the ones fixing removes', () => {
    const result = ok(resolveAllOpen(open(), 'clarinet'))
    const items = reviewItems(result.doc, 'clarinet')

    expect(items.every((item) => item.kind === 'flag' && item.checked)).toBe(true)
    expect(reviewCounts(items).open).toBe(0)
  })

  it('is refused when nothing is open that it can check, and canResolveAll says so', () => {
    const done = ok(resolveAllOpen(open(), 'clarinet')).doc

    expect(resolveAllOpen(done, 'clarinet')).toEqual({ ok: false, reason: 'not-found' })
    expect(canResolveAll(done, 'clarinet')).toBe(false)
    expect(canResolveAll(open(), 'clarinet')).toBe(true)
    expect(resolveAllOpen(demoDoc(), 'clarinet')).toEqual({ ok: false, reason: 'not-found' })
  })

  it('is one undo step that brings back all of it', () => {
    const doc = open()
    const result = ok(resolveAllOpen(doc, 'clarinet'))
    const history = record(createHistory(doc), result.label, result.doc)

    expect(history.past).toHaveLength(1)
    expect(undo(history).present).toEqual(doc)
  })

  it('does not change the document it was given', () => {
    const doc = open()
    const copy = structuredClone(doc)
    ok(resolveAllOpen(doc, 'clarinet'))
    expect(doc).toEqual(copy)
  })
})
