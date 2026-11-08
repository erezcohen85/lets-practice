import { type BarNumber, type PageLayer, type TimingLayer } from './types'

// Maps written before rests belonged to a part. Then a multi-rest was a `rest` mark of the shared timing, which counted
// for every part; now it is a number in the page layer of the part that rests (Decision 2026-10-31, built in UX part 6).
// This is the one place that knows the old shape: a map is read through readMap where it comes in, and the next save
// writes the new shape. The processor does the same for map.confirmed.json and local-run.json (run_folder.py).

/** A timing layer as an older version wrote it: its marks may hold rests. */
export type OldTiming = Omit<TimingLayer, 'marks'> & { marks: ReadonlyArray<{ bar: BarNumber; kind: string }> }
/** A page layer as an older version wrote it: it may have no rests. */
export type OldPage = Omit<PageLayer, 'rests'> & { rests?: BarNumber[] }
export interface OldMap { timing: OldTiming | TimingLayer; pages: Record<string, OldPage | PageLayer> }

/**
 * The map in today's shape. The rest marks leave the timing and go to every part's rests (an older map cannot say which
 * part they were read from), joined to any rests the part has; a layer without rests gets none. A map already in
 * today's shape comes back as it is, with the same objects.
 */
export function readMap(map: OldMap): { timing: TimingLayer; pages: Record<string, PageLayer> } {
  const marks = map.timing.marks
  const moved = [...new Set(marks.filter((mark) => mark.kind === 'rest').map((mark) => mark.bar))].sort((a, b) => a - b)
  const timing = moved.length === 0 ? map.timing : { ...map.timing, marks: marks.filter((mark) => mark.kind !== 'rest') }
  const pages = Object.fromEntries(
    Object.entries(map.pages).map(([partId, layer]) => {
      if (layer.rests !== undefined && moved.length === 0) return [partId, layer]
      const rests = [...new Set([...(layer.rests ?? []), ...moved])].sort((a, b) => a - b)
      return [partId, { ...layer, rests }]
    }),
  )
  return { timing: timing as TimingLayer, pages: pages as Record<string, PageLayer> }
}
