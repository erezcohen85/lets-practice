import { createHistory, record, undo } from '@/domain/history'
import { addBarLine, insertPieceBar, type EditorDoc, type EditResult } from '@/domain/pieceEdits'
import { demoDoc } from '@/domain/pieceFixtures'
import { addLocator, deleteLocator, relabelLocator } from '@/domain/renumber'
import {
  addLocatorAt,
  dragLocator,
  movedOffsets,
  relabel,
  removeLocator,
  resolveMoved,
  soundsRight,
  undoMove,
} from '@/domain/timingEdits'
import { type Locator, type ReviewFlag } from '@/domain/types'

const FLAG: ReviewFlag = { kind: 'crowded', severity: 1, expected: 3.6, found: 1.8, factor: 0.5, explainedBy: null, uncertainLine: null }

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value)
    Object.values(value).forEach(deepFreeze)
  }
  return value
}

/** The demo doc with bar 6 and bar 14 (pass 0) flagged, bar 14 already checked. Frozen, so any mutation throws. */
function flaggedDoc(): EditorDoc {
  const doc = demoDoc()
  return deepFreeze({
    ...doc,
    timing: {
      ...doc.timing,
      locators: doc.timing.locators.map((l) =>
        l.bar === 6 ? { ...l, flags: [FLAG] } : l.bar === 14 && l.passIndex === 0 ? { ...l, flags: [FLAG], checked: true } : l,
      ),
    },
  })
}

function ok(result: EditResult): Extract<EditResult, { ok: true }> {
  if (!result.ok) throw new Error(`expected an edit, got a refusal: ${result.reason}`)
  return result
}

const locatorOf = (doc: EditorDoc, bar: number, pass = 0): Locator => {
  const found = doc.timing.locators.find((l) => l.bar === bar && l.passIndex === pass)
  if (found === undefined) throw new Error(`no locator ${bar}:${pass}`)
  return found
}

describe('dragLocator', () => {
  it('moves the locator, confirms it and remembers the time and state before the drag', () => {
    const doc = flaggedDoc()
    const before = locatorOf(doc, 6)

    const result = ok(dragLocator(doc, 6, 0, before.timeSec + 0.5))

    expect(result.label).toEqual({ kind: 'move-locator', bar: 6, passIndex: 0 })
    expect(locatorOf(result.doc, 6)).toEqual({ ...before, timeSec: before.timeSec + 0.5, confirmed: true })
    expect(result.doc.moved).toEqual([{ bar: 6, passIndex: 0, fromSec: before.timeSec, wasConfirmed: false }])
  })

  it('keeps the first fromSec when the same locator is dragged twice', () => {
    const doc = flaggedDoc()
    const start = locatorOf(doc, 6).timeSec

    const first = ok(dragLocator(doc, 6, 0, start + 0.5))
    const second = ok(dragLocator(first.doc, 6, 0, start + 0.9))

    expect(second.doc.moved).toEqual([{ bar: 6, passIndex: 0, fromSec: start, wasConfirmed: false }])
    expect(locatorOf(second.doc, 6).timeSec).toBe(start + 0.9)
  })

  it('keeps checked and the flags on the dragged locator', () => {
    const doc = flaggedDoc()

    const result = ok(dragLocator(doc, 14, 0, locatorOf(doc, 14).timeSec + 0.2))

    expect(locatorOf(result.doc, 14)).toMatchObject({ checked: true, flags: [FLAG], confirmed: true })
  })

  it('leaves the pages as they were and refuses a drag past a neighbour', () => {
    const doc = flaggedDoc()

    const result = ok(dragLocator(doc, 6, 0, locatorOf(doc, 6).timeSec + 0.5))

    expect(result.doc.pages).toBe(doc.pages)
    expect(dragLocator(doc, 6, 0, locatorOf(doc, 7).timeSec + 1)).toEqual({ ok: false, reason: 'out-of-range' })
    expect(dragLocator(doc, 6, 0, -1)).toEqual({ ok: false, reason: 'out-of-range' })
  })

  it('refuses a locator that does not exist', () => {
    const doc = demoDoc()
    const bare = { ...doc, timing: { ...doc.timing, locators: [] } }

    expect(dragLocator(bare, 6, 0, 5)).toEqual({ ok: false, reason: 'not-found' })
  })

  it('Undo of the drag in the history restores the doc by reference', () => {
    const doc = flaggedDoc()
    const dragged = ok(dragLocator(doc, 6, 0, locatorOf(doc, 6).timeSec + 0.5))

    const history = record(createHistory(doc), dragged.label, dragged.doc)

    expect(undo(history).present).toBe(doc)
  })
})

describe('undoMove', () => {
  it('restores exactly the old time and confirmed state and leaves moved', () => {
    const doc = flaggedDoc()
    const dragged = ok(dragLocator(ok(dragLocator(doc, 6, 0, 22.5)).doc, 6, 0, 22.55))

    const result = ok(undoMove(dragged.doc, 6, 0))

    expect(result.label).toEqual({ kind: 'undo-move', bar: 6, passIndex: 0 })
    expect(locatorOf(result.doc, 6)).toEqual(locatorOf(doc, 6))
    expect(result.doc.moved).toEqual([])
  })

  it('restores a confirmed locator as confirmed', () => {
    const doc = flaggedDoc()
    const original = locatorOf(doc, 14)
    expect(original.confirmed).toBe(true)

    const dragged = ok(dragLocator(doc, 14, 0, original.timeSec + 0.3))
    const result = ok(undoMove(dragged.doc, 14, 0))

    expect(locatorOf(result.doc, 14)).toEqual(original)
  })

  it('refuses a locator that was not moved', () => {
    expect(undoMove(flaggedDoc(), 6, 0)).toEqual({ ok: false, reason: 'not-found' })
  })
})

describe('soundsRight', () => {
  it('confirms and checks an unconfirmed flagged locator', () => {
    const doc = flaggedDoc()
    expect(locatorOf(doc, 6)).toMatchObject({ confirmed: false })

    const result = ok(soundsRight(doc, 6, 0))

    expect(result.label).toEqual({ kind: 'sounds-right', bar: 6, passIndex: 0 })
    expect(locatorOf(result.doc, 6)).toEqual({ ...locatorOf(doc, 6), confirmed: true, checked: true })
    expect(locatorOf(result.doc, 6).timeSec).toBe(locatorOf(doc, 6).timeSec)
    expect(result.doc.pages).toBe(doc.pages)
  })

  it('is refused on a locator that was dragged: the card shows Resolved instead', () => {
    const dragged = ok(dragLocator(flaggedDoc(), 6, 0, 22.5))

    expect(soundsRight(dragged.doc, 6, 0)).toEqual({ ok: false, reason: 'moved' })
  })

  it('refuses a locator that does not exist', () => {
    const doc = demoDoc()

    expect(soundsRight({ ...doc, timing: { ...doc.timing, locators: [] } }, 6, 0)).toEqual({ ok: false, reason: 'not-found' })
  })
})

describe('resolveMoved', () => {
  it('Resolved checks the locator, changes no timing and removes it from moved', () => {
    const dragged = ok(dragLocator(flaggedDoc(), 6, 0, 22.5))

    const result = ok(resolveMoved(dragged.doc, 6, 0))

    expect(result.label).toEqual({ kind: 'resolved', bar: 6, passIndex: 0 })
    expect(locatorOf(result.doc, 6)).toEqual({ ...locatorOf(dragged.doc, 6), checked: true })
    expect(result.doc.moved).toEqual([])
  })

  it('Resolved on a locator that was not moved is refused', () => {
    expect(resolveMoved(flaggedDoc(), 6, 0)).toEqual({ ok: false, reason: 'not-found' })
  })
})

describe('addLocatorAt and removeLocator', () => {
  function withoutLocatorOf(doc: EditorDoc, bar: number): EditorDoc {
    return { ...doc, timing: { ...doc.timing, locators: doc.timing.locators.filter((l) => l.bar !== bar) } }
  }

  it('plain add is exactly addLocator on the timing', () => {
    const doc = withoutLocatorOf(flaggedDoc(), 6)
    const time = locatorOf(doc, 5).timeSec + 1

    const result = ok(addLocatorAt(doc, time, 'plain'))
    const expected = addLocator(doc.timing, time, 'plain')

    expect(expected.ok && result.doc.timing).toEqual(expected.ok && expected.timing)
    expect(result.label).toEqual({ kind: 'add-locator', bar: 6, passIndex: 0 })
    expect(locatorOf(result.doc, 6)).toMatchObject({ confirmed: true, timeSec: time })
    expect(result.doc.pages).toBe(doc.pages)
  })

  it('ripple add is exactly addLocator and carries flags and checked with the shifted locators', () => {
    const doc = flaggedDoc()
    const time = locatorOf(doc, 5).timeSec + 1

    const result = ok(addLocatorAt(doc, time, 'ripple'))
    const expected = addLocator(doc.timing, time, 'ripple')

    expect(expected.ok && result.doc.timing).toEqual(expected.ok && expected.timing)
    expect(result.droppedLocators).toEqual(expected.ok ? expected.droppedLocators : [])
    // the flagged locator of bar 6 moved on to bar 7, its flag with it
    expect(locatorOf(result.doc, 7).flags).toEqual([FLAG])
    expect(locatorOf(result.doc, 6).flags).toBeUndefined()
  })

  it('a ripple add at a bar that has no time moves nothing: it takes that bar, as a plain add does', () => {
    const doc = withoutLocatorOf(flaggedDoc(), 6)
    const time = locatorOf(doc, 5).timeSec + 1

    const rippled = ok(addLocatorAt(doc, time, 'ripple'))
    const plain = ok(addLocatorAt(doc, time, 'plain'))

    expect(rippled.doc.timing).toEqual(plain.doc.timing)
    expect(locatorOf(rippled.doc, 7).timeSec).toBe(locatorOf(doc, 7).timeSec)
  })

  it('refuses an add with no free slot', () => {
    const doc = flaggedDoc()

    expect(addLocatorAt(doc, locatorOf(doc, 5).timeSec + 1, 'plain')).toEqual({ ok: false, reason: 'no-free-slot' })
    expect(addLocatorAt(doc, locatorOf(doc, 5).timeSec, 'plain')).toEqual({ ok: false, reason: 'duplicate-time' })
  })

  it('plain delete is exactly deleteLocator: the bar stays unmatched', () => {
    const doc = flaggedDoc()

    const result = ok(removeLocator(doc, 6, 0, 'plain'))
    const expected = deleteLocator(doc.timing, 6, 0, 'plain')

    expect(expected.ok && result.doc.timing).toEqual(expected.ok && expected.timing)
    expect(result.label).toEqual({ kind: 'delete-locator', bar: 6, passIndex: 0 })
  })

  it('ripple delete is exactly deleteLocator and the flags follow the shifted locators', () => {
    const doc = flaggedDoc()

    const result = ok(removeLocator(doc, 5, 0, 'ripple'))
    const expected = deleteLocator(doc.timing, 5, 0, 'ripple')

    expect(expected.ok && result.doc.timing).toEqual(expected.ok && expected.timing)
    expect(locatorOf(result.doc, 5).flags).toEqual([FLAG])
  })

  it('deleting a moved locator takes it out of moved; a shifted moved locator stays in moved under its new label', () => {
    const doc = flaggedDoc()
    const dragged = ok(dragLocator(doc, 6, 0, locatorOf(doc, 6).timeSec + 0.5))

    const rippled = ok(removeLocator(dragged.doc, 5, 0, 'ripple'))
    const deleted = ok(removeLocator(dragged.doc, 6, 0, 'plain'))

    expect(rippled.doc.moved).toEqual([{ bar: 5, passIndex: 0, fromSec: locatorOf(doc, 6).timeSec, wasConfirmed: false }])
    expect(deleted.doc.moved).toEqual([])
  })

  it('refuses to delete a locator that does not exist', () => {
    const doc = withoutLocatorOf(flaggedDoc(), 6)

    expect(removeLocator(doc, 6, 0, 'plain')).toEqual({ ok: false, reason: 'not-found' })
  })
})

describe('relabel', () => {
  it('is relabelLocator on the timing and reports the dropped locators', () => {
    const doc = flaggedDoc()

    const result = ok(relabel(doc, 12, 0, 13, 0))
    const expected = relabelLocator(doc.timing, 12, 0, 13, 0)

    expect(expected.ok && result.doc.timing).toEqual(expected.ok && expected.timing)
    expect(result.droppedLocators.map((l) => l.bar)).toEqual([64])
    expect(result.label).toEqual({ kind: 'relabel-locator', bar: 12, passIndex: 0 })
    expect(result.doc.pages).toBe(doc.pages)
  })

  it('a relabel to the same label records nothing: the doc is the same', () => {
    const doc = flaggedDoc()

    expect(ok(relabel(doc, 12, 0, 12, 0)).doc).toBe(doc)
  })

  it('refuses what relabelLocator refuses', () => {
    expect(relabel(flaggedDoc(), 12, 0, 13, 2)).toEqual({ ok: false, reason: 'out-of-range' })
    expect(relabel(flaggedDoc(), 12, 3, 13, 0)).toEqual({ ok: false, reason: 'not-found' })
  })
})

describe('the moved locators through other edits', () => {
  it('a bar-line edit keeps them', () => {
    const doc = flaggedDoc()
    const dragged = ok(dragLocator(doc, 6, 0, locatorOf(doc, 6).timeSec + 0.5)).doc

    const edited = ok(addBarLine(dragged, 'clarinet', 3, 750)).doc

    expect(edited.moved).toEqual(dragged.moved)
  })

  it('a ripple Structure edit renumbers them with their locators', () => {
    const doc = flaggedDoc()
    const dragged = ok(dragLocator(doc, 6, 0, locatorOf(doc, 6).timeSec + 0.5)).doc

    const edited = ok(insertPieceBar(dragged, 2, 'ripple')).doc

    expect(edited.moved).toEqual([{ bar: 7, passIndex: 0, fromSec: locatorOf(doc, 6).timeSec, wasConfirmed: false }])
    expect(locatorOf(edited, 7).timeSec).toBe(locatorOf(doc, 6).timeSec + 0.5)
  })

  it('a doc that never had moved locators gets no moved field', () => {
    const doc = flaggedDoc()

    expect('moved' in ok(soundsRight(doc, 6, 0)).doc).toBe(false)
    expect('moved' in ok(addLocatorAt(doc, locatorOf(doc, 5).timeSec + 1, 'ripple')).doc).toBe(false)
  })
})

describe('movedOffsets', () => {
  it('gives how far each moved locator is from where it was, signed', () => {
    const doc = flaggedDoc()
    const six = locatorOf(doc, 6).timeSec
    const eight = locatorOf(doc, 8).timeSec
    const first = ok(dragLocator(doc, 6, 0, six + 0.42))
    const second = ok(dragLocator(first.doc, 8, 0, eight - 0.12))

    const offsets = movedOffsets(second.doc)

    expect(offsets).toHaveLength(2)
    expect(offsets[0]).toMatchObject({ bar: 6, passIndex: 0 })
    expect(offsets[0].deltaSec).toBeCloseTo(0.42, 6)
    expect(offsets[1]).toMatchObject({ bar: 8, passIndex: 0 })
    expect(offsets[1].deltaSec).toBeCloseTo(-0.12, 6)
  })

  it('is empty for a doc without moved locators, and skips an entry whose locator is gone', () => {
    const doc = flaggedDoc()
    expect(movedOffsets(doc)).toEqual([])
    const stale = { ...doc, moved: [{ bar: 6, passIndex: 5, fromSec: 3, wasConfirmed: false }] }
    expect(movedOffsets(stale)).toEqual([])
  })
})
