import { type BarNumber, type PlayOrderRow } from './types'

/** Bars from..to that the rows play `times` times (more than once). */
export interface RepeatedRange { from: BarNumber; to: BarNumber; times: number }

/** How many bars the rows play in all, repeats included. */
export function playedBarCount(rows: PlayOrderRow[]): number {
  return rows.reduce((total, row) => total + row.to - row.from + 1, 0)
}

/** The bars played more than once, joined into runs of equal count, in bar order. Rows need not be valid. */
export function repeatedRanges(rows: PlayOrderRow[]): RepeatedRange[] {
  const plays = new Map<BarNumber, number>()
  for (const row of rows) {
    for (let bar = row.from; bar <= row.to; bar++) plays.set(bar, (plays.get(bar) ?? 0) + 1)
  }
  const ranges: RepeatedRange[] = []
  for (const bar of [...plays.keys()].sort((a, b) => a - b)) {
    const times = plays.get(bar) ?? 0
    if (times < 2) continue
    const last = ranges[ranges.length - 1]
    if (last !== undefined && last.to === bar - 1 && last.times === times) last.to = bar
    else ranges.push({ from: bar, to: bar, times })
  }
  return ranges
}
