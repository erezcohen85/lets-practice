import { describe, expect, it } from 'vitest'
import { fillEmptyBars, filledSlots } from '@/domain/fillBars'
import { type EditorDoc } from '@/domain/pieceEdits'
import { setPlayOrder } from '@/domain/pieceEdits'
import { expandPlayOrder } from '@/domain/playOrder'
import { straightMap } from '@/domain/fixtures'
import { unmatchedSlots } from '@/domain/renumber'
import { type Locator, type TimingLayer } from '@/domain/types'

/** 8 bars played 1-8, then 5-8 again: 12 slots, and the second pass of 5-8 has no locator. */
function docWithGap(): EditorDoc {
  const { timing, page } = straightMap(8)
  const playOrder = [{ from: 1, to: 8 }, { from: 5, to: 8 }]
  return { timing: { ...timing, playOrder }, pages: [page] }
}

/** What the processor answers: the timing with a locator for every slot, the empty ones at `time(position)`. */
function answered(doc: EditorDoc, time: (position: number) => number): TimingLayer {
  const have = new Map(doc.timing.locators.map((l) => [`${l.bar}:${l.passIndex}`, l]))
  const locators: Locator[] = expandPlayOrder(doc.timing.playOrder, doc.timing.barCount).map(
    (slot) => have.get(`${slot.bar}:${slot.passIndex}`) ?? { bar: slot.bar, passIndex: slot.passIndex, timeSec: time(slot.position), confirmed: false },
  )
  return { ...doc.timing, locators }
}

describe('fillEmptyBars', () => {
  it('adds a locator for every empty slot, unconfirmed, in play order, and keeps the others by reference', () => {
    const doc = docWithGap()
    const result = fillEmptyBars(doc, answered(doc, (p) => 1 + 2 * p))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.label).toEqual({ kind: 'fill-bars' })
    expect(unmatchedSlots(result.doc.timing)).toEqual([])
    expect(result.doc.timing.locators).toHaveLength(12)
    for (const old of doc.timing.locators) expect(result.doc.timing.locators).toContain(old)
    const added = result.doc.timing.locators.filter((l) => l.passIndex === 1)
    expect(added.map((l) => [l.bar, l.timeSec, l.confirmed])).toEqual([[5, 17, false], [6, 19, false], [7, 21, false], [8, 23, false]])
    expect(result.doc.pages).toBe(doc.pages)
  })

  it('marks the added locators as filled, next to any that were filled before', () => {
    const doc: EditorDoc = { ...docWithGap(), filled: [{ bar: 2, passIndex: 0 }] }
    const result = fillEmptyBars(doc, answered(doc, (p) => 1 + 2 * p))
    if (!result.ok) throw new Error('refused')
    expect(result.doc.filled).toEqual([{ bar: 2, passIndex: 0 }, { bar: 5, passIndex: 1 }, { bar: 6, passIndex: 1 }, { bar: 7, passIndex: 1 }, { bar: 8, passIndex: 1 }])
  })

  it('takes only the empty slots from the answer: a locator the answer changed stays as it was', () => {
    const doc = docWithGap()
    const answer = answered(doc, (p) => 1 + 2 * p)
    answer.locators = answer.locators.map((l) => (l.passIndex === 0 && l.bar === 3 ? { ...l, timeSec: 99 } : l))
    const result = fillEmptyBars(doc, answer)
    if (!result.ok) throw new Error('refused')
    expect(result.doc.timing.locators.find((l) => l.bar === 3 && l.passIndex === 0)?.timeSec).toBe(5)
  })

  it('leaves the slots in `skip` empty, a bar the user just emptied on purpose', () => {
    const doc = docWithGap()
    const result = fillEmptyBars(doc, answered(doc, (p) => 1 + 2 * p), [{ bar: 6, passIndex: 1 }])
    if (!result.ok) throw new Error('refused')
    expect(unmatchedSlots(result.doc.timing).map((s) => [s.bar, s.passIndex])).toEqual([[6, 1]])
    expect(result.doc.filled).toEqual([{ bar: 5, passIndex: 1 }, { bar: 7, passIndex: 1 }, { bar: 8, passIndex: 1 }])
  })

  it('refuses when nothing was added', () => {
    const doc = docWithGap()
    expect(fillEmptyBars(doc, doc.timing)).toEqual({ ok: false, reason: 'invalid' })
  })

  it('refuses an answer that puts a filled bar outside its neighbours, and one with a time that is not a number', () => {
    const doc = docWithGap()
    expect(fillEmptyBars(doc, answered(doc, (p) => 1 + 2 * p - 30)).ok).toBe(false)
    expect(fillEmptyBars(doc, answered(doc, () => Number.NaN)).ok).toBe(false)
  })

  it('fills a gap the play order made when a pass was dropped (the bug of piece 2)', () => {
    const { timing, page } = straightMap(8)
    const start: EditorDoc = { timing, pages: [page] }
    const edited = setPlayOrder(start, [{ from: 1, to: 8 }, { from: 3, to: 8 }])
    if (!edited.ok) throw new Error('refused')
    expect(unmatchedSlots(edited.doc.timing)).toHaveLength(6)
    const result = fillEmptyBars(edited.doc, answered(edited.doc, (p) => 1 + 2 * p))
    expect(result.ok).toBe(true)
  })
})

describe('filledSlots', () => {
  it('lists the filled locators that still exist and have not been confirmed or checked', () => {
    const doc = docWithGap()
    const result = fillEmptyBars(doc, answered(doc, (p) => 1 + 2 * p))
    if (!result.ok) throw new Error('refused')
    expect(filledSlots(result.doc)).toHaveLength(4)
    const locators = result.doc.timing.locators.map((l) => (l.bar === 5 && l.passIndex === 1 ? { ...l, confirmed: true } : l.bar === 6 && l.passIndex === 1 ? { ...l, checked: true } : l))
    const later = { ...result.doc, timing: { ...result.doc.timing, locators: locators.filter((l) => !(l.bar === 8 && l.passIndex === 1)) } }
    expect(filledSlots(later)).toEqual([{ bar: 7, passIndex: 1 }])
  })

  it('is empty for a doc that was never filled', () => {
    expect(filledSlots(docWithGap())).toEqual([])
  })
})
