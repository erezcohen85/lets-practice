import { deltaLimits, moveLocators, planSnap, snapLocators, MIN_GAP_SEC } from '@/domain/groupMove'
import { type DetectedBeat } from '@/domain/beats'
import { type EditResult, type EditorDoc } from '@/domain/pieceEdits'
import { demoDoc } from '@/domain/pieceFixtures'

// The demo doc has one locator per slot, bar n at 1 + 3.6 * (n - 1) s: 1, 4.6, 8.2, 11.8, 15.4, ...
const slot = (bar: number, passIndex = 0) => ({ bar, passIndex })
const timeOf = (doc: EditorDoc, bar: number, pass = 0) => doc.timing.locators.find((l) => l.bar === bar && l.passIndex === pass)!.timeSec
const confirmedOf = (doc: EditorDoc, bar: number) => doc.timing.locators.find((l) => l.bar === bar && l.passIndex === 0)!.confirmed
const placed = (doc: EditorDoc) => doc.timing.locators.map(({ bar, passIndex, timeSec }) => ({ bar, passIndex, timeSec }))

function ok(result: EditResult): Extract<EditResult, { ok: true }> {
  if (!result.ok) throw new Error(`expected an edit, got a refusal: ${result.reason}`)
  return result
}

describe('deltaLimits', () => {
  it('stops short of the neighbours that are not selected', () => {
    // Bars 3 and 4 selected: bar 2 at 4.6 and bar 5 at 15.4 are the neighbours.
    const { min, max } = deltaLimits(placed(demoDoc()), [slot(3), slot(4)], 260)
    expect(min).toBeCloseTo(4.6 + MIN_GAP_SEC - 8.2)
    expect(max).toBeCloseTo(15.4 - MIN_GAP_SEC - 11.8)
  })

  it('lets a selection of neighbours move together past the room between its own members', () => {
    const limits = deltaLimits(placed(demoDoc()), [slot(2), slot(3), slot(4)], 260)
    expect(limits.max).toBeCloseTo(15.4 - MIN_GAP_SEC - 11.8)
  })

  it('is bounded by the start of the recording and its end', () => {
    const doc = demoDoc()
    expect(deltaLimits(placed(doc), [slot(1)], 260).min).toBeCloseTo(-1)
    const last = doc.timing.locators.at(-1)!
    expect(deltaLimits(placed(doc), [slot(last.bar, last.passIndex)], 260).max).toBeCloseTo(260 - last.timeSec)
  })

  it('does not let the first selected locator pass a non-selected one that is not directly beside it', () => {
    // Bars 2 and 4 selected, bar 3 is between them and stays: bar 2 can move up to bar 3, bar 4 down to it.
    const { min, max } = deltaLimits(placed(demoDoc()), [slot(2), slot(4)], 260)
    expect(max).toBeCloseTo(8.2 - MIN_GAP_SEC - 4.6)
    expect(min).toBeCloseTo(8.2 + MIN_GAP_SEC - 11.8)
  })
})

describe('moveLocators', () => {
  it('moves every selected locator by the same offset', () => {
    const result = ok(moveLocators(demoDoc(), [slot(2), slot(3), slot(4)], 0.5))
    expect(timeOf(result.doc, 2)).toBeCloseTo(5.1)
    expect(timeOf(result.doc, 3)).toBeCloseTo(8.7)
    expect(timeOf(result.doc, 4)).toBeCloseTo(12.3)
  })

  it('leaves the locators that are not selected where they are', () => {
    const result = ok(moveLocators(demoDoc(), [slot(2), slot(3)], 0.5))
    expect(timeOf(result.doc, 1)).toBe(1)
    expect(timeOf(result.doc, 4)).toBeCloseTo(11.8)
  })

  it('stops the whole group at the first non-selected neighbour instead of passing it', () => {
    const doc = demoDoc()
    const result = ok(moveLocators(doc, [slot(2), slot(3)], 50))
    // Bar 4 at 11.8 is the limit for bar 3: it ends 0.01 s before it, and bar 2 keeps its distance to bar 3.
    expect(timeOf(result.doc, 3)).toBeCloseTo(11.8 - MIN_GAP_SEC)
    expect(timeOf(result.doc, 2)).toBeCloseTo(11.8 - MIN_GAP_SEC - 3.6)
  })

  it('stops a move to the left at the previous neighbour the same way', () => {
    const result = ok(moveLocators(demoDoc(), [slot(3), slot(4)], -50))
    expect(timeOf(result.doc, 3)).toBeCloseTo(4.6 + MIN_GAP_SEC)
    expect(timeOf(result.doc, 4)).toBeCloseTo(4.6 + MIN_GAP_SEC + 3.6)
  })

  it('keeps the order of all the locators', () => {
    const result = ok(moveLocators(demoDoc(), [slot(2), slot(5)], 50))
    const times = result.doc.timing.locators.map((l) => l.timeSec)
    expect(times).toEqual([...times].sort((a, b) => a - b))
  })

  it('makes every moved locator a fixed point and records it as moved, with where it was', () => {
    const doc = demoDoc()
    const result = ok(moveLocators(doc, [slot(2), slot(3)], 0.4))
    expect(confirmedOf(result.doc, 2)).toBe(true)
    expect(confirmedOf(result.doc, 3)).toBe(true)
    expect(result.doc.moved).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ bar: 2, passIndex: 0, fromSec: 4.6, wasConfirmed: doc.timing.locators[1].confirmed }),
        expect.objectContaining({ bar: 3, passIndex: 0, fromSec: 8.2, wasConfirmed: doc.timing.locators[2].confirmed }),
      ]),
    )
    expect(result.doc.moved).toHaveLength(2)
  })

  it('keeps the first place a locator was moved from when it moves again', () => {
    const first = ok(moveLocators(demoDoc(), [slot(2), slot(3)], 0.4))
    const second = ok(moveLocators(first.doc, [slot(2), slot(3)], 0.3))
    expect(second.doc.moved?.find((m) => m.bar === 2)?.fromSec).toBe(4.6)
    expect(second.doc.moved).toHaveLength(2)
  })

  it('is one step, labelled with the number of locators', () => {
    expect(ok(moveLocators(demoDoc(), [slot(2), slot(3)], 0.4)).label).toEqual({ kind: 'move-locators', count: 2 })
  })

  it('does not change the doc it was given', () => {
    const doc = demoDoc()
    const before = JSON.stringify(doc)
    moveLocators(doc, [slot(2), slot(3)], 0.4)
    expect(JSON.stringify(doc)).toBe(before)
  })

  it('refuses a move that has no room at all', () => {
    // Bar 2 already sits against bar 3 after the first move, so a second push the same way has no room.
    const doc = demoDoc()
    const first = ok(moveLocators(doc, [slot(2)], 50)).doc
    const again = moveLocators(first, [slot(2)], 5)
    expect(again.ok).toBe(false)
  })

  it('refuses a selection with no locator', () => {
    expect(moveLocators(demoDoc(), [slot(99)], 1)).toEqual({ ok: false, reason: 'not-found' })
    expect(moveLocators(demoDoc(), [], 1)).toEqual({ ok: false, reason: 'not-found' })
  })

  it('moves the passes of a repeated bar separately', () => {
    // Bars 9 to 16 are played twice; pass 1 of bar 9 is a different locator from pass 0.
    const doc = demoDoc()
    const result = ok(moveLocators(doc, [slot(9, 1)], 0.2))
    expect(timeOf(result.doc, 9, 1)).toBeCloseTo(timeOf(doc, 9, 1) + 0.2)
    expect(timeOf(result.doc, 9, 0)).toBe(timeOf(doc, 9, 0))
  })
})

// Beats every 0.9 s from 1: 1, 1.9, 2.8, 3.7, 4.6, 5.5, ... so each bar (3.6 s apart) is on a beat.
const BEATS: DetectedBeat[] = Array.from({ length: 60 }, (_, i) => ({ t: 1 + 0.9 * i, downbeat: i % 4 === 0 ? 0.9 : 0.05 }))
// Shift them 0.3 s later so bars are 0.3 s before a beat and 0.6 s after the one before it.
const LATE: DetectedBeat[] = BEATS.map((b) => ({ ...b, t: b.t + 0.3 }))

describe('planSnap and snapLocators, closest', () => {
  const beatsAt = (...times: number[]): DetectedBeat[] => times.map((t) => ({ t, downbeat: 0.1 }))
  const line = (bar: number, timeSec: number) => ({ bar, passIndex: 0, timeSec })

  it('moves each locator to its own closest beat, whichever side it is on', () => {
    const plan = planSnap(placed(demoDoc()), [slot(2), slot(3), slot(4)], beatsAt(4.5, 8.3, 11.75), 'closest', 260)
    expect(plan.skipped).toBe(0)
    expect(plan.moves).toEqual([line(2, 4.5), line(3, 8.3), line(4, 11.75)])
  })

  it('counts a line with no beat close by as skipped, and a line already on its beat as neither', () => {
    const plan = planSnap(placed(demoDoc()), [slot(2), slot(3), slot(4)], beatsAt(4.6, 11.9), 'closest', 260)
    expect(plan.moves).toEqual([line(4, 11.9)])
    expect(plan.skipped).toBe(1)
  })

  it('does not take a beat past a neighbour that is not selected', () => {
    const plan = planSnap([line(1, 1), line(2, 1.1)], [slot(1)], beatsAt(1.12), 'closest', 260)
    expect(plan.moves).toEqual([])
    expect(plan.skipped).toBe(1)
  })

  it('never puts two lines on one beat', () => {
    const plan = planSnap([line(1, 1), line(2, 1.2)], [slot(1), slot(2)], beatsAt(1.1), 'closest', 260)
    expect(plan.moves).toEqual([line(2, 1.1)])
    expect(plan.skipped).toBe(1)
  })

  it('stays inside the recording', () => {
    const plan = planSnap([line(1, 9.95)], [slot(1)], beatsAt(10.05), 'closest', 10)
    expect(plan.moves).toEqual([])
    expect(plan.skipped).toBe(1)
  })

  it('applies moves in both directions as one step, each a fixed point', () => {
    const outcome = snapLocators(demoDoc(), [slot(2), slot(3)], beatsAt(4.5, 8.3), 'closest', 260)
    const result = ok(outcome.result)
    expect(outcome.moved).toBe(2)
    expect(timeOf(result.doc, 2)).toBe(4.5)
    expect(timeOf(result.doc, 3)).toBe(8.3)
    expect(confirmedOf(result.doc, 2)).toBe(true)
    expect(result.label).toEqual({ kind: 'move-locators', count: 2 })
  })
})

describe('planSnap and snapLocators', () => {
  it('moves each locator to its own next beat', () => {
    const plan = planSnap(placed(demoDoc()), [slot(2), slot(3), slot(4)], LATE, 'next', 260)
    expect(plan.skipped).toBe(0)
    expect(plan.moves.map((m) => m.timeSec)).toEqual([4.9, 8.5, 12.1].map((t) => expect.closeTo(t, 6)))
    expect(plan.moves.map((m) => m.bar)).toEqual([2, 3, 4])
  })

  it('moves each locator to its own previous beat', () => {
    const plan = planSnap(placed(demoDoc()), [slot(2), slot(3)], LATE, 'previous', 260)
    expect(plan.moves.map((m) => m.timeSec)).toEqual([4.0, 7.6].map((t) => expect.closeTo(t, 6)))
  })

  it('does not move a locator that is already on a beat the way a single snap skips it', () => {
    // On BEATS bar 2 is on a beat (4.6), so "next" goes to 5.5, not to 4.6.
    const plan = planSnap(placed(demoDoc()), [slot(2)], BEATS, 'next', 260)
    expect(plan.moves[0].timeSec).toBeCloseTo(5.5)
  })

  it('skips a locator with no beat that way and counts it', () => {
    const plan = planSnap(placed(demoDoc()), [slot(2), slot(3)], [{ t: 6, downbeat: 0.1 }], 'next', 260)
    // Bar 2 (4.6) goes to 6; bar 3 (8.2) has no later beat. 6 is before bar 3, so no crossing.
    expect(plan.moves).toEqual([{ bar: 2, passIndex: 0, timeSec: 6 }])
    expect(plan.skipped).toBe(1)
  })

  it('skips a locator whose beat is past a neighbour that is not selected', () => {
    // Bar 2 snaps next to 12 s: that is past bar 3 (8.2), which is not selected.
    const plan = planSnap(placed(demoDoc()), [slot(2)], [{ t: 12, downbeat: 0.1 }], 'next', 260)
    expect(plan.moves).toEqual([])
    expect(plan.skipped).toBe(1)
  })

  it('skips the one of two that would land on the same beat as the other', () => {
    // Bars 3 and 4 would both take the beat at 12 s: only the later one can, since they must keep their order.
    const plan = planSnap(placed(demoDoc()), [slot(3), slot(4)], [{ t: 12, downbeat: 0.1 }], 'next', 260)
    expect(plan.moves).toEqual([{ bar: 4, passIndex: 0, timeSec: 12 }])
    expect(plan.skipped).toBe(1)
  })

  it('applies the plan as one step, every moved locator a fixed point', () => {
    const outcome = snapLocators(demoDoc(), [slot(2), slot(3), slot(4)], LATE, 'next', 260)
    const result = ok(outcome.result)
    expect(outcome.moved).toBe(3)
    expect(outcome.skipped).toBe(0)
    expect(timeOf(result.doc, 2)).toBeCloseTo(4.9)
    expect(confirmedOf(result.doc, 3)).toBe(true)
    expect(result.doc.moved).toHaveLength(3)
    expect(result.label).toEqual({ kind: 'move-locators', count: 3 })
  })

  it('refuses, changing nothing, when no locator can snap', () => {
    const outcome = snapLocators(demoDoc(), [slot(2)], [{ t: 12, downbeat: 0.1 }], 'next', 260)
    expect(outcome.result.ok).toBe(false)
    expect(outcome.moved).toBe(0)
    expect(outcome.skipped).toBe(1)
  })
})
