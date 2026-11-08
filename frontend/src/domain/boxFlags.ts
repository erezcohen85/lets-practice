import { type BarBox, type BarNumber, type BoxFlag, type PageLayer } from './types'

// The box check's flags (PageLayer.boxFlags) follow their boxes through the part's edits the way rests do: a flag whose bar
// disappears is dropped, and a layer with no flags has no boxFlags key (a map made before the check keeps its shape).

/** The layer with `flags` as its boxFlags, or without the key when there are none. */
export function pageWithFlags(page: Omit<PageLayer, 'boxFlags'>, flags: readonly BoxFlag[] | undefined): PageLayer {
  return flags === undefined || flags.length === 0 ? { ...page } : { ...page, boxFlags: [...flags] }
}

/** The flags that still sit on a box of `bars`. */
export function flagsOnBoxes(flags: readonly BoxFlag[] | undefined, bars: readonly BarBox[]): BoxFlag[] {
  const known = new Set(bars.map((box) => box.bar))
  return (flags ?? []).filter((flag) => known.has(flag.bar))
}

/** Every flag moved by `by` bars (a pickup toggled). */
export function shiftFlags(flags: readonly BoxFlag[] | undefined, by: number): BoxFlag[] {
  return (flags ?? []).map((flag) => ({ ...flag, bar: flag.bar + by }))
}

/** The flags after a bar is inserted at n: those on or after n follow their bars up. */
export function flagsAfterInsert(flags: readonly BoxFlag[] | undefined, n: BarNumber): BoxFlag[] {
  return (flags ?? []).map((flag) => (flag.bar >= n ? { ...flag, bar: flag.bar + 1 } : flag))
}

/** The flags after bar n is deleted: its own flag goes, later ones follow their bars down. */
export function flagsAfterDelete(flags: readonly BoxFlag[] | undefined, n: BarNumber): BoxFlag[] {
  return (flags ?? []).filter((flag) => flag.bar !== n).map((flag) => (flag.bar > n ? { ...flag, bar: flag.bar - 1 } : flag))
}

/** The layer without the flag on `bar` (and without the key when it was the last). */
export function dropBoxFlag(page: PageLayer, bar: BarNumber): PageLayer {
  const { boxFlags, ...rest } = page
  return pageWithFlags(rest, (boxFlags ?? []).filter((flag) => flag.bar !== bar))
}
