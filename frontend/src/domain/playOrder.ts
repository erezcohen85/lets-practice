import { labelRange, type BarNames } from './barNames'
import { type BarNumber, type PlayOrderRow, type PlaySlot } from './types'

function assertBarCount(barCount: number): void {
  if (!Number.isInteger(barCount) || barCount < 1) {
    throw new RangeError(`barCount must be an integer of at least 1, got ${barCount}`)
  }
}

function assertRow(row: PlayOrderRow, barCount: number): void {
  const { from, to } = row
  if (!Number.isInteger(from) || !Number.isInteger(to)) {
    throw new RangeError(`play-order row ${from}-${to} must use whole bar numbers`)
  }
  // Bar 0 is a pickup; whether the piece has one is for validatePlayOrder, which knows the timing layer.
  if (from < 0 || to > barCount || from > to) {
    throw new RangeError(`play-order row ${from}-${to} must satisfy 0 <= from <= to <= ${barCount}`)
  }
}

/** One row that plays the whole piece once, from bar 1 (bar 0 with a pickup) to barCount. */
export function straightThrough(barCount: number, firstBar: BarNumber = 1): PlayOrderRow[] {
  return [{ from: firstBar, to: barCount }]
}

/** Walks the rows in order and returns one slot per played bar, counting repeat passes. */
export function expandPlayOrder(rows: PlayOrderRow[], barCount: number): PlaySlot[] {
  assertBarCount(barCount)
  const passes = new Map<BarNumber, number>()
  const slots: PlaySlot[] = []
  for (const row of rows) {
    assertRow(row, barCount)
    for (let bar = row.from; bar <= row.to; bar++) {
      const passIndex = passes.get(bar) ?? 0
      passes.set(bar, passIndex + 1)
      slots.push({ position: slots.length, bar, passIndex })
    }
  }
  return slots
}

/** Finds the slot where a bar is played for the given pass, or undefined when it is not played that often. */
export function slotOf(slots: PlaySlot[], bar: BarNumber, passIndex: number): PlaySlot | undefined {
  return slots.find((slot) => slot.bar === bar && slot.passIndex === passIndex)
}

/** Returns every slot of a bar (its chained twins), in play order. */
export function twinsOf(slots: PlaySlot[], bar: BarNumber): PlaySlot[] {
  return slots.filter((slot) => slot.bar === bar)
}

/** Lists the bars that no row plays, in ascending order. */
export function unplayedBars(rows: PlayOrderRow[], barCount: number, firstBar: BarNumber = 1): BarNumber[] {
  const played = new Set(expandPlayOrder(rows, barCount).map((slot) => slot.bar))
  const missing: BarNumber[] = []
  for (let bar = firstBar; bar <= barCount; bar++) {
    if (!played.has(bar)) missing.push(bar)
  }
  return missing
}

/**
 * Reads the text form ("1-8, 1-7, 9-end", or "p1-43, 22-end" with a pickup) into rows of internal bars; the bars are labels,
 * read under `names`. Empty text means straight through; a label that names no bar of the piece is a RangeError.
 */
export function parsePlayOrder(text: string, barCount: number, firstBar: BarNumber, names: BarNames): PlayOrderRow[] {
  assertBarCount(barCount)
  const segments = text
    .split(/[,;\n]/)
    .map((segment) => segment.trim())
    .filter((segment) => segment !== '')
  if (segments.length === 0) return straightThrough(barCount, firstBar)
  return segments.map((segment) => {
    const match = /^(p?\d+)(?:\s*[-–]\s*(p?\d+|end))?$/i.exec(segment)
    if (match === null) {
      throw new RangeError(`cannot read play-order row "${segment}"`)
    }
    const barOf = (label: string): BarNumber => {
      const bar = names.parse(label)
      if (bar === null) throw new RangeError(`play-order row "${segment}" names no bar of the piece`)
      return bar
    }
    const from = barOf(match[1])
    const end = match[2]
    const to = end === undefined ? from : end.toLowerCase() === 'end' ? barCount : barOf(end)
    const row = { from, to }
    assertRow(row, barCount)
    return row
  })
}

/** Writes rows as text, the bars as labels: "a-b" joined by ", ", "a" for one bar, "a-end" when a row runs to the last bar. */
export function formatPlayOrder(rows: PlayOrderRow[], barCount: number, names: BarNames): string {
  return rows
    .map(({ from, to }) => {
      if (from === to) return names.label(from)
      if (to === barCount) return `${names.label(from)}-end`
      return labelRange(names, from, to)
    })
    .join(', ')
}
