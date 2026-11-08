import { type BarNumber, type ShortBar } from './types'

// The names a bar goes by on screen. Everywhere in the data a bar keeps its whole internal number, in order (a pickup is
// bar 0, or a short bar with `unnumbered` in the middle of the piece). On screen a pickup has no number of its own: it reads
// "p" plus the number of the next numbered bar ("p7"), and each numbered bar reads its internal number less the unnumbered
// bars before it. The top pickup, stored as bar 0, reads "p1". Convert only at the edge: a label is for people, an internal
// number is for the data, and a function that takes one never takes the other.

export interface BarNames {
  /** The label a bar is shown with: "12" or "p7". */
  label(bar: BarNumber): string
  /** The internal bar a typed label names ("p7", "P7", "7"); null when it is not a label or names a pickup the piece does not have. */
  parse(text: string): BarNumber | null
  /** True for bar 0 and for a short bar flagged unnumbered. */
  isUnnumbered(bar: BarNumber): boolean
  /** How many bars of 1..barCount carry a number: barCount less the unnumbered ones among them. */
  numberedCount(barCount: number): number
}

const LABEL = /^\s*(p?)\s*(\d+)\s*$/i

/** The unnumbered bars of a short-bar list inside the piece (not bar 0), ascending. */
function flaggedBars(shortBars: readonly ShortBar[] | undefined): BarNumber[] {
  return (shortBars ?? [])
    .filter((short) => short.unnumbered === true && short.bar > 0)
    .map((short) => short.bar)
    .sort((a, b) => a - b)
}

export function barNamesOf(shortBars: readonly ShortBar[] | undefined): BarNames {
  const flagged = flaggedBars(shortBars)
  const hasTop = (shortBars ?? []).some((short) => short.bar === 0)
  const before = (bar: BarNumber) => flagged.filter((f) => f < bar).length
  const isUnnumbered = (bar: BarNumber) => bar === 0 || flagged.includes(bar)
  return {
    label(bar) {
      if (bar === 0) return 'p1'
      return `${isUnnumbered(bar) ? 'p' : ''}${bar - before(bar)}`
    },
    parse(text) {
      const match = LABEL.exec(text)
      if (match === null) return null
      const number = Number(match[2])
      if (number < 1) return null
      if (match[1] !== '') {
        if (number === 1 && hasTop) return 0
        return flagged.find((f) => f - before(f) === number) ?? null
      }
      let bar = number
      for (const f of flagged) if (f <= bar) bar++
      return bar
    },
    isUnnumbered,
    numberedCount: (barCount) => barCount - flagged.filter((f) => f <= barCount).length,
  }
}

/** A run of bars as labels: "p1-6", "7" for a single bar. */
export function labelRange(names: BarNames, from: BarNumber, to: BarNumber): string {
  return from === to ? names.label(from) : `${names.label(from)}-${names.label(to)}`
}
