import { type StepLabel } from './history'
import { done, refuse, withTiming, type EditorDoc, type EditResult, type MovedLocator } from './pieceEdits'
import { addLocator, deleteLocator, moveLocator, relabelLocator, type LocatorEdit } from './renumber'
import { type BarNumber, type ClickMode, type Locator, type TimingLayer } from './types'

// The locator edits of the timing layer and of the review state kept on it. Each one returns a new doc (the pages keep
// their reference) and a label naming the step; a refusal changes nothing.

function locatorAt(timing: TimingLayer, bar: BarNumber, passIndex: number): Locator | undefined {
  return timing.locators.find((l) => l.bar === bar && l.passIndex === passIndex)
}

function movedEntry(doc: EditorDoc, bar: BarNumber, passIndex: number): MovedLocator | undefined {
  return doc.moved?.find((m) => m.bar === bar && m.passIndex === passIndex)
}

function withoutMoved(doc: EditorDoc, entries: readonly MovedLocator[]): readonly MovedLocator[] {
  return (doc.moved ?? []).filter((m) => !entries.includes(m))
}

function withPatch(timing: TimingLayer, bar: BarNumber, passIndex: number, patch: Partial<Locator>): TimingLayer {
  return {
    ...timing,
    locators: timing.locators.map((l) => (l.bar === bar && l.passIndex === passIndex ? { ...l, ...patch } : l)),
  }
}

function fromLocatorEdit(doc: EditorDoc, edit: LocatorEdit, label: (timing: TimingLayer) => StepLabel): EditResult {
  return edit.ok ? done(withTiming(doc, edit.timing), label(edit.timing), edit.droppedLocators) : refuse(edit.reason)
}

/** Drags a locator to timeSec: it becomes a confirmed anchor, `checked` stays, and the first "was" time of this visit is kept. */
export function dragLocator(doc: EditorDoc, bar: BarNumber, passIndex: number, timeSec: number): EditResult {
  const before = locatorAt(doc.timing, bar, passIndex)
  const edit = moveLocator(doc.timing, bar, passIndex, timeSec)
  if (!edit.ok || before === undefined) return refuse(edit.ok ? 'not-found' : edit.reason)
  const entry = movedEntry(doc, bar, passIndex) ?? { bar, passIndex, fromSec: before.timeSec, wasConfirmed: before.confirmed }
  const moved = [...withoutMoved(doc, [entry]), entry]
  return done({ ...doc, timing: edit.timing, moved }, { kind: 'move-locator', bar, passIndex })
}

/** Adds a confirmed locator at timeSec. A `ripple` add moves the later bars up only when no bar there is free: a bar without a time just takes it. */
export function addLocatorAt(doc: EditorDoc, timeSec: number, mode: ClickMode): EditResult {
  const plain = mode === 'ripple' ? addLocator(doc.timing, timeSec, 'plain') : null
  return fromLocatorEdit(doc, plain?.ok ? plain : addLocator(doc.timing, timeSec, mode), (timing) => {
    const created = timing.locators.find((l) => l.timeSec === timeSec)
    return { kind: 'add-locator', bar: created?.bar, passIndex: created?.passIndex }
  })
}

/** Removes a locator: plain leaves its bar unmatched, ripple moves every later locator one bar back. */
export function removeLocator(doc: EditorDoc, bar: BarNumber, passIndex: number, mode: ClickMode): EditResult {
  return fromLocatorEdit(doc, deleteLocator(doc.timing, bar, passIndex, mode), () => ({ kind: 'delete-locator', bar, passIndex }))
}

/** Gives a locator another label; every later locator shifts with it (spec 5.4). The same label records nothing. */
export function relabel(doc: EditorDoc, bar: BarNumber, passIndex: number, newBar: BarNumber, newPass: number): EditResult {
  const label = { kind: 'relabel-locator', bar, passIndex } as const
  if (bar === newBar && passIndex === newPass && locatorAt(doc.timing, bar, passIndex) !== undefined) return done(doc, label)
  return fromLocatorEdit(doc, relabelLocator(doc.timing, bar, passIndex, newBar, newPass), () => label)
}

/** "Sounds right": the locator is confirmed and checked, its time unchanged. A dragged locator takes Resolved instead. */
export function soundsRight(doc: EditorDoc, bar: BarNumber, passIndex: number): EditResult {
  if (locatorAt(doc.timing, bar, passIndex) === undefined) return refuse('not-found')
  if (movedEntry(doc, bar, passIndex) !== undefined) return refuse('moved')
  const timing = withPatch(doc.timing, bar, passIndex, { confirmed: true, checked: true })
  return done({ ...doc, timing }, { kind: 'sounds-right', bar, passIndex })
}

/** "Resolved": the dragged locator is checked and leaves `moved`; no timing changes. */
export function resolveMoved(doc: EditorDoc, bar: BarNumber, passIndex: number): EditResult {
  const entry = movedEntry(doc, bar, passIndex)
  if (entry === undefined || locatorAt(doc.timing, bar, passIndex) === undefined) return refuse('not-found')
  const timing = withPatch(doc.timing, bar, passIndex, { checked: true })
  return done({ ...doc, timing, moved: withoutMoved(doc, [entry]) }, { kind: 'resolved', bar, passIndex })
}

/** "Undo move": the locator goes back to the time and confirmed state it had before the drag. */
export function undoMove(doc: EditorDoc, bar: BarNumber, passIndex: number): EditResult {
  const entry = movedEntry(doc, bar, passIndex)
  if (entry === undefined) return refuse('not-found')
  // moveLocator checks the neighbours; it confirms, so the old state is put back after.
  const edit = moveLocator(doc.timing, bar, passIndex, entry.fromSec)
  if (!edit.ok) return refuse(edit.reason)
  const timing = withPatch(edit.timing, bar, passIndex, { confirmed: entry.wasConfirmed })
  return done({ ...doc, timing, moved: withoutMoved(doc, [entry]) }, { kind: 'undo-move', bar, passIndex })
}

/** How far each locator moved by hand now sits from where it was, in seconds (positive is later), in the order they were dragged. */
export function movedOffsets(doc: EditorDoc): { bar: BarNumber; passIndex: number; deltaSec: number }[] {
  return (doc.moved ?? []).flatMap((entry) => {
    const now = locatorAt(doc.timing, entry.bar, entry.passIndex)
    return now === undefined ? [] : [{ bar: entry.bar, passIndex: entry.passIndex, deltaSec: now.timeSec - entry.fromSec }]
  })
}
