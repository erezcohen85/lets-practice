import { repeatMap, straightMap } from '@/domain/fixtures'
import {
  canRedo,
  canUndo,
  createHistory,
  HISTORY_LIMIT,
  nextRedo,
  nextUndo,
  record,
  redo,
  undo,
  type StepLabel,
} from '@/domain/history'
import { insertBar, moveLocator } from '@/domain/renumber'
import { type Locator, type PageLayer, type TimingLayer } from '@/domain/types'

const NEW_BOX = { pageIndex: 0, x: 0, y: 0, w: 10, h: 10 }

/** Freezes an object and everything inside it, so any push, splice or assignment on it throws. */
function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value)
    Object.values(value).forEach(deepFreeze)
  }
  return value
}

function locatorOf(timing: TimingLayer, bar: number, passIndex: number): Locator | undefined {
  return timing.locators.find((locator) => locator.bar === bar && locator.passIndex === passIndex)
}

/** The repeat map with two locators confirmed: (1, pass 0) and (2, pass 1), which a plain insert at bar 3 drops. */
function confirmedRepeat(): { timing: TimingLayer; page: PageLayer } {
  const { timing, page } = repeatMap()
  const confirmed = new Set(['1:0', '2:1'])
  return {
    timing: {
      ...timing,
      locators: timing.locators.map((l) => ({ ...l, confirmed: confirmed.has(`${l.bar}:${l.passIndex}`) })),
    },
    page,
  }
}

/** n numbered states, so a test can tell which one it holds by reference or by number. */
function states(n: number): { n: number }[] {
  return Array.from({ length: n }, (_, i) => ({ n: i }))
}

const ADD: StepLabel = { kind: 'add-bar-line', bar: 12 }
const MOVE: StepLabel = { kind: 'move-locator', bar: 3, passIndex: 0 }

describe('createHistory', () => {
  it('starts with the given state as present, no past, no future and the default limit', () => {
    const s = { n: 0 }

    const h = createHistory(s)

    expect(h.present).toBe(s)
    expect(h.past).toEqual([])
    expect(h.future).toEqual([])
    expect(h.limit).toBe(100)
    expect(HISTORY_LIMIT).toBe(100)
    expect(canUndo(h)).toBe(false)
    expect(canRedo(h)).toBe(false)
    expect(nextUndo(h)).toBeNull()
    expect(nextRedo(h)).toBeNull()
  })

  it('takes a custom limit', () => {
    expect(createHistory({ n: 0 }, 5).limit).toBe(5)
    expect(createHistory({ n: 0 }, 1).limit).toBe(1)
  })

  it.each([0, -1, 2.5, Number.NaN, Number.POSITIVE_INFINITY])('throws a RangeError for the limit %s', (limit) => {
    expect(() => createHistory({ n: 0 }, limit)).toThrow(RangeError)
  })
})

describe('record, undo and redo', () => {
  it('undo returns the earlier state by reference and redo the later one', () => {
    const [a, b] = states(2)

    const recorded = record(createHistory(a), ADD, b)
    expect(recorded.present).toBe(b)
    expect(canUndo(recorded)).toBe(true)
    expect(canRedo(recorded)).toBe(false)

    const undone = undo(recorded)
    expect(undone.present).toBe(a)
    expect(canUndo(undone)).toBe(false)
    expect(canRedo(undone)).toBe(true)

    const redone = redo(undone)
    expect(redone.present).toBe(b)
    expect(canUndo(redone)).toBe(true)
    expect(canRedo(redone)).toBe(false)
  })

  it('walks several steps back and forth in order', () => {
    const [s0, s1, s2, s3] = states(4)
    let h = createHistory(s0)
    h = record(h, ADD, s1)
    h = record(h, ADD, s2)
    h = record(h, ADD, s3)

    h = undo(h)
    expect(h.present).toBe(s2)
    h = undo(h)
    expect(h.present).toBe(s1)
    h = redo(h)
    expect(h.present).toBe(s2)
    h = undo(h)
    h = undo(h)
    expect(h.present).toBe(s0)
    h = redo(h)
    h = redo(h)
    h = redo(h)
    expect(h.present).toBe(s3)
  })

  it('keeps the limit through record, undo and redo', () => {
    const [a, b] = states(2)

    const h = redo(undo(record(createHistory(a, 7), ADD, b)))

    expect(h.limit).toBe(7)
  })

  it('stores the label with the states it connects', () => {
    const [a, b] = states(2)

    const h = record(createHistory(a), ADD, b)

    expect(h.past).toEqual([{ label: ADD, before: a, after: b }])
    expect(h.past[0].before).toBe(a)
    expect(h.past[0].after).toBe(b)
  })

  it('records nothing when the next state is the present one', () => {
    const [a, b] = states(2)
    const h = record(createHistory(a), ADD, b)

    expect(record(h, ADD, h.present)).toBe(h)
    expect(record(createHistory(a), ADD, a).past).toEqual([])
  })

  it('records a structurally equal but different object as a step', () => {
    const a = { n: 0 }

    const h = record(createHistory(a), ADD, { n: 0 })

    expect(h.past).toHaveLength(1)
  })

  it('returns the same history object when there is nothing to undo or redo', () => {
    const fresh = createHistory({ n: 0 })
    expect(undo(fresh)).toBe(fresh)
    expect(redo(fresh)).toBe(fresh)

    const [a, b] = states(2)
    const atEnd = record(createHistory(a), ADD, b)
    expect(redo(atEnd)).toBe(atEnd)

    const atStart = undo(atEnd)
    expect(undo(atStart)).toBe(atStart)
  })

  it('clears the redo steps when a new action follows an undo', () => {
    const [s0, s1, s2, s3] = states(4)
    let h = record(record(createHistory(s0), ADD, s1), ADD, s2)
    h = undo(h)
    expect(canRedo(h)).toBe(true)

    h = record(h, MOVE, s3)

    expect(canRedo(h)).toBe(false)
    expect(h.future).toEqual([])
    expect(nextRedo(h)).toBeNull()
    expect(h.past.map((step) => step.after)).toEqual([s1, s3])
    expect(redo(h)).toBe(h)
  })
})

describe('limit', () => {
  it('drops the oldest steps once more than limit are recorded', () => {
    const list = states(6)
    let h = createHistory(list[0], 3)
    for (let i = 1; i <= 5; i++) h = record(h, ADD, list[i])

    expect(h.past).toHaveLength(3)
    expect(h.past.map((step) => step.after)).toEqual([list[3], list[4], list[5]])

    h = undo(h)
    h = undo(h)
    h = undo(h)
    // steps 1 and 2 are gone: the earliest reachable state is the one after step 2
    expect(h.present).toBe(list[2])
    expect(canUndo(h)).toBe(false)
    const again = undo(h)
    expect(again).toBe(h)
  })

  it('keeps all steps while the count stays at the limit', () => {
    const list = states(4)
    let h = createHistory(list[0], 3)
    for (let i = 1; i <= 3; i++) h = record(h, ADD, list[i])

    expect(h.past).toHaveLength(3)
    h = undo(undo(undo(h)))
    expect(h.present).toBe(list[0])
  })

  it('holds at most one step with a limit of 1', () => {
    const [a, b, c] = states(3)

    const h = record(record(createHistory(a, 1), ADD, b), ADD, c)

    expect(h.past).toHaveLength(1)
    expect(undo(h).present).toBe(b)
  })

  it('keeps 100 steps by default and drops the oldest at the 101st', () => {
    const list = states(102)
    let h = createHistory(list[0])
    for (let i = 1; i <= 101; i++) h = record(h, ADD, list[i])

    expect(h.past).toHaveLength(100)
    for (let i = 0; i < 100; i++) h = undo(h)
    expect(h.present).toBe(list[1])
    expect(canUndo(h)).toBe(false)
  })

  it('does not count the redo steps against the limit', () => {
    const list = states(4)
    let h = createHistory(list[0], 3)
    for (let i = 1; i <= 3; i++) h = record(h, ADD, list[i])
    h = undo(undo(h))

    expect(h.future).toHaveLength(2)
    expect(redo(redo(h)).present).toBe(list[3])
  })
})

describe('with real map edits', () => {
  it('restores the exact timing after a plain insert dropped locators, with their confirmed flags', () => {
    const { timing, page } = confirmedRepeat()
    const original = deepFreeze(structuredClone(timing))
    const edit = insertBar(timing, page, 3, NEW_BOX, 'plain')
    // the edit really lost locators: 1:1..4:1, among them the confirmed 2:1
    expect(edit.droppedLocators).toHaveLength(4)
    expect(edit.droppedLocators).toContainEqual({ bar: 2, passIndex: 1, timeSec: 11, confirmed: true })
    expect(edit.timing.locators.length).toBe(timing.locators.length - 4)

    const edited = record(createHistory(timing), { kind: 'add-bar-line', bar: 2 }, edit.timing)
    const undone = undo(edited)

    expect(undone.present).toBe(timing)
    expect(undone.present).toEqual(original)
    expect(undone.present.locators).toHaveLength(12)
    expect(locatorOf(undone.present, 2, 1)).toEqual({ bar: 2, passIndex: 1, timeSec: 11, confirmed: true })
    expect(locatorOf(undone.present, 1, 0)).toEqual({ bar: 1, passIndex: 0, timeSec: 1, confirmed: true })
    expect(locatorOf(undone.present, 3, 1)).toEqual({ bar: 3, passIndex: 1, timeSec: 13, confirmed: false })
    expect(redo(undone).present).toBe(edit.timing)
  })

  it('restores the old time and confirmed: false after moveLocator', () => {
    const { timing } = repeatMap()
    const moved = moveLocator(timing, 3, 0, 5.5)
    expect(moved.ok).toBe(true)
    if (!moved.ok) return
    expect(locatorOf(moved.timing, 3, 0)).toEqual({ bar: 3, passIndex: 0, timeSec: 5.5, confirmed: true })

    const h = record(createHistory(timing), MOVE, moved.timing)
    expect(locatorOf(h.present, 3, 0)?.confirmed).toBe(true)

    const undone = undo(h)

    expect(undone.present).toBe(timing)
    expect(locatorOf(undone.present, 3, 0)).toEqual({ bar: 3, passIndex: 0, timeSec: 5, confirmed: false })
  })

  it('undoes a ripple edit that shifts many locators in one call', () => {
    const { timing, page } = straightMap(8)
    const edit = insertBar(timing, page, 3, NEW_BOX, 'ripple')
    // bars 3..8 now carry numbers 4..9: many rows changed, still one action
    expect(edit.timing.locators.map((l) => l.bar)).toEqual([1, 2, 4, 5, 6, 7, 8, 9])

    const h = record(createHistory(timing), { kind: 'add-bar-line', bar: 2 }, edit.timing)
    expect(h.past).toHaveLength(1)

    const undone = undo(h)

    expect(undone.present).toBe(timing)
    expect(canUndo(undone)).toBe(false)
    expect(undone.present.locators.map((l) => l.bar)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  })

  it('keeps the timing layer, the page layers and the review state in one history', () => {
    interface EditorState { timing: TimingLayer; pages: PageLayer[]; resolved: string[] }
    const { timing, page } = repeatMap()
    const start: EditorState = { timing, pages: [page], resolved: [] }
    const edit = insertBar(timing, page, 3, NEW_BOX, 'plain')

    let h = createHistory(start)
    h = record(h, { kind: 'add-bar-line', bar: 2 }, { ...h.present, timing: edit.timing, pages: [edit.page] })
    h = record(h, { kind: 'resolved', bar: 5, passIndex: 0 }, { ...h.present, resolved: ['5:0'] })
    expect(h.present.resolved).toEqual(['5:0'])
    expect(h.present.pages[0].bars).toHaveLength(9)

    h = undo(h)
    expect(h.present.resolved).toEqual([])
    expect(h.present.timing).toBe(edit.timing)
    expect(h.present.pages[0]).toBe(edit.page)

    h = undo(h)
    expect(h.present).toBe(start)
    expect(h.present.pages[0].bars).toHaveLength(8)
  })

  it('treats a realign as one step and gives the old locators back by reference', () => {
    const { timing } = repeatMap()
    const refitted: Locator[] = timing.locators.map((l) => ({ ...l, timeSec: l.timeSec + 0.25 }))
    const realigned: TimingLayer = { ...timing, locators: refitted }

    const h = record(createHistory(timing), { kind: 'realign' }, realigned)
    expect(h.past).toHaveLength(1)
    expect(nextUndo(h)).toEqual({ kind: 'realign' })

    const undone = undo(h)

    expect(undone.present.locators).toBe(timing.locators)
    expect(redo(undone).present.locators).toBe(refitted)
  })

  it('records "Undo move" as a new step, so the move itself can still be redone after it', () => {
    const { timing } = repeatMap()
    const moved = moveLocator(timing, 3, 0, 5.5)
    expect(moved.ok).toBe(true)
    if (!moved.ok) return

    let h = record(createHistory(timing), MOVE, moved.timing)
    // the review card's "Undo move" puts the before state back, as an action of its own
    h = record(h, { kind: 'undo-move', bar: 3, passIndex: 0 }, h.past[0].before)

    expect(h.past).toHaveLength(2)
    expect(h.present).toBe(timing)
    expect(nextUndo(h)).toEqual({ kind: 'undo-move', bar: 3, passIndex: 0 })

    const undone = undo(h)

    expect(undone.present).toBe(moved.timing)
    expect(nextUndo(undone)).toEqual(MOVE)
  })
})

describe('labels', () => {
  it('names the step undo would revert and the step redo would re-apply through a sequence', () => {
    const [s0, s1, s2] = states(3)
    const first: StepLabel = { kind: 'add-locator', bar: 4, passIndex: 1 }
    const second: StepLabel = { kind: 'delete-bar-line', bar: 9 }
    let h = createHistory(s0)
    expect(nextUndo(h)).toBeNull()
    expect(nextRedo(h)).toBeNull()

    h = record(h, first, s1)
    expect(nextUndo(h)).toEqual(first)
    expect(nextRedo(h)).toBeNull()

    h = record(h, second, s2)
    expect(nextUndo(h)).toEqual(second)

    h = undo(h)
    expect(nextUndo(h)).toEqual(first)
    expect(nextRedo(h)).toEqual(second)

    h = undo(h)
    expect(nextUndo(h)).toBeNull()
    expect(nextRedo(h)).toEqual(first)

    h = redo(h)
    expect(nextUndo(h)).toEqual(first)
    expect(nextRedo(h)).toEqual(second)

    h = redo(h)
    expect(nextUndo(h)).toEqual(second)
    expect(nextRedo(h)).toBeNull()
  })
  it('keeps the piece-bar labels with the new or removed bar number', () => {
    const [s0, s1, s2] = states(3)
    const insert: StepLabel = { kind: 'insert-piece-bar', bar: 23 }
    const remove: StepLabel = { kind: 'remove-piece-bar', bar: 23 }

    const h = record(record(createHistory(s0), insert, s1), remove, s2)

    expect(nextUndo(h)).toEqual(remove)
    expect(nextRedo(undo(h))).toEqual(remove)
    expect(nextUndo(undo(h))).toEqual(insert)
  })
})

describe('purity', () => {
  it('never mutates the history or the states it is given', () => {
    const [s0, s1, s2] = states(3).map(deepFreeze)
    const fresh = deepFreeze(createHistory(s0, 2))

    const one = deepFreeze(record(fresh, ADD, s1))
    const two = deepFreeze(record(one, ADD, s2))
    const three = deepFreeze(record(two, MOVE, { n: 3 }))
    const undone = deepFreeze(undo(three))
    const redone = deepFreeze(redo(undone))
    deepFreeze(record(undone, MOVE, { n: 4 }))

    expect(fresh.past).toEqual([])
    expect(fresh.present).toBe(s0)
    expect(three.past).toHaveLength(2)
    expect(undone.future).toHaveLength(1)
    expect(redone.future).toEqual([])
  })
})
