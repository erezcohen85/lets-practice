import { type BarNames } from './barNames'
import { type BarMark, type BarNumber, type ListedMark, type ListedMarkKind, type PageLayer, type TimingLayer } from './types'

/** A run of bars carrying one kind of mark: how the Structure panel shows and writes marks. The stored data stays one mark per bar. */
export interface MarkRange { kind: ListedMarkKind; from: number; to: number }

/**
 * What the Marks list shows for the part open in the editor: the timing's marks (fermata, rit.; shared by every part) in
 * their stored order, then that part's rests, one per bar. A rest is the part's own, so another part lists others.
 */
export function listedMarks(timing: TimingLayer, page: PageLayer | undefined): ListedMark[] {
  return [...timing.marks, ...[...(page?.rests ?? [])].sort((a, b) => a - b).map((bar): ListedMark => ({ bar, kind: 'rest' }))]
}

/** The listed marks back where they are stored: fermata and rit. in the timing, the bars of the rests in the part. */
export function splitListedMarks(marks: ListedMark[]): { marks: BarMark[]; rests: BarNumber[] } {
  return {
    marks: marks.flatMap((mark) => (mark.kind === 'rest' ? [] : [{ bar: mark.bar, kind: mark.kind }])),
    rests: marks.filter((mark) => mark.kind === 'rest').map((mark) => mark.bar).sort((a, b) => a - b),
  }
}

// No piece has this many bars; a span longer than this is not expanded, so a typo like "1-99999999" cannot freeze the page.
const MAX_SPAN = 1000

/** Consecutive bars of one kind, in the stored order, become one range each; a gap, another kind or an out-of-sequence bar starts a new one. */
export function groupMarks(marks: ListedMark[]): MarkRange[] {
  const ranges: MarkRange[] = []
  for (const mark of marks) {
    const last = ranges.at(-1)
    if (last !== undefined && last.kind === mark.kind && last.to + 1 === mark.bar) last.to = mark.bar
    else ranges.push({ kind: mark.kind, from: mark.bar, to: mark.bar })
  }
  return ranges
}

/** "rest 46-48", or "fermata 32" for one bar; the bars as labels. */
export function formatMarkRange({ kind, from, to }: MarkRange, names: BarNames): string {
  return from === to ? `${kind} ${names.label(from)}` : `${kind} ${names.label(from)}-${names.label(to)}`
}

export interface ExpandedRows {
  marks: ListedMark[]
  /** The index of the row each mark came from, so a validation error on a mark can be shown on its row. */
  rowOf: number[]
  /** Rows whose first bar comes after their last: they have no marks. */
  reversed: number[]
}

/**
 * One mark per bar of each row, in order. A row that is not a pair of whole numbers (or spans more than any piece) gives a
 * single mark that validateMarks refuses, so the form shows the usual "pick a bar" error on that row.
 */
export function expandMarkRows(rows: MarkRange[]): ExpandedRows {
  const result: ExpandedRows = { marks: [], rowOf: [], reversed: [] }
  rows.forEach(({ kind, from, to }, row) => {
    const push = (bar: number) => {
      result.marks.push({ bar, kind })
      result.rowOf.push(row)
    }
    if (!Number.isInteger(from) || !Number.isInteger(to)) return push(NaN)
    if (from > to) return void result.reversed.push(row)
    if (to - from > MAX_SPAN) return push(to)
    for (let bar = from; bar <= to; bar++) push(bar)
  })
  return result
}
