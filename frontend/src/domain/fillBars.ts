import { done, refuse, withTiming, type EditorDoc, type EditResult, type FilledLocator } from './pieceEdits'
import { expandPlayOrder } from './playOrder'
import { type Locator, type TimingLayer } from './types'

// The fill: after a structure edit leaves play slots without a locator, the processor answers with a time for each of
// them (every locator that was there stays where it is). This module merges that answer into the doc as one step.

const slotKey = (bar: number, passIndex: number) => `${bar}:${passIndex}`

/**
 * The doc with a locator added for every empty slot of `answer`, as one "fill-bars" step. Only the empty slots are
 * taken from the answer; the locators that were there keep their reference, whatever the answer says of them. The new
 * ones are unconfirmed and are listed in `doc.filled`. A refusal ('invalid') when the answer fills nothing, or when a
 * time is not a number or does not lie after the locator before it and before the one after it. The slots in `skip`
 * (a bar the user just emptied on purpose) are left empty.
 */
export function fillEmptyBars(doc: EditorDoc, answer: TimingLayer, skip: readonly FilledLocator[] = []): EditResult {
  const slots = expandPlayOrder(doc.timing.playOrder, doc.timing.barCount)
  const have = new Map<string, Locator>()
  for (const locator of doc.timing.locators) if (!have.has(slotKey(locator.bar, locator.passIndex))) have.set(slotKey(locator.bar, locator.passIndex), locator)
  const offered = new Map<string, Locator>()
  for (const locator of answer.locators) offered.set(slotKey(locator.bar, locator.passIndex), locator)

  const located: Locator[] = []
  const added: FilledLocator[] = []
  for (const slot of slots) {
    const key = slotKey(slot.bar, slot.passIndex)
    const existing = have.get(key)
    if (existing !== undefined) {
      located.push(existing)
      continue
    }
    const offer = offered.get(key)
    if (offer === undefined || skip.some((s) => s.bar === slot.bar && s.passIndex === slot.passIndex)) continue
    located.push({ bar: slot.bar, passIndex: slot.passIndex, timeSec: offer.timeSec, confirmed: false })
    added.push({ bar: slot.bar, passIndex: slot.passIndex })
  }
  if (added.length === 0) return refuse('invalid')
  const increasing = located.every((locator, index) => Number.isFinite(locator.timeSec) && (index === 0 || locator.timeSec > located[index - 1].timeSec))
  if (!increasing) return refuse('invalid')

  // Locators that sit on no slot (none after a prune) stay where they were, after the others.
  const onSlot = new Set(slots.map((slot) => slotKey(slot.bar, slot.passIndex)))
  const rest = doc.timing.locators.filter((locator) => !onSlot.has(slotKey(locator.bar, locator.passIndex)))
  const next = withTiming(doc, { ...doc.timing, locators: [...located, ...rest] })
  return done({ ...next, filled: [...(doc.filled ?? []), ...added] }, { kind: 'fill-bars' })
}

/** The filled locators that are still unconfirmed and unchecked: a hand-moved or "Sounds right" one has been looked at, so it is no longer shown as changed. */
export function filledSlots(doc: EditorDoc): FilledLocator[] {
  return (doc.filled ?? []).filter((entry) => {
    const locator = doc.timing.locators.find((l) => l.bar === entry.bar && l.passIndex === entry.passIndex)
    return locator !== undefined && !locator.confirmed && locator.checked !== true
  })
}
