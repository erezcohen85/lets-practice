import { type BarBox, type BarNumber, type Locator } from './types'

/** The bar a `?bar=` value names, when it is a whole number and one of the part's bars; anything else is ignored. */
export function barFromParam(value: string | null, bars: readonly BarBox[]): BarNumber | null {
  if (value === null || !/^\d+$/.test(value)) return null
  const bar = Number(value)
  return bars.some((box) => box.bar === bar) ? bar : null
}

/**
 * The locator a click on a bar of the score selects: of the bar's passes, the one nearest the playhead, or the first
 * when the playhead has no time yet. null when the bar has no locator in any pass.
 */
export function locatorNearPlayhead(locators: readonly Locator[], bar: BarNumber, playheadSec: number | null): Locator | null {
  let best: Locator | null = null
  for (const locator of locators) {
    if (locator.bar !== bar) continue
    if (best === null) best = locator
    else if (playheadSec === null) {
      if (locator.passIndex < best.passIndex) best = locator
    } else {
      const distance = Math.abs(locator.timeSec - playheadSec)
      const bestDistance = Math.abs(best.timeSec - playheadSec)
      if (distance < bestDistance || (distance === bestDistance && locator.passIndex < best.passIndex)) best = locator
    }
  }
  return best
}

/** The same choice as a slot (bar and pass), for the page's selection. */
export function locatorOfBar(locators: readonly Locator[], bar: BarNumber, playheadSec: number | null): { bar: BarNumber; passIndex: number } | null {
  const locator = locatorNearPlayhead(locators, bar, playheadSec)
  return locator === null ? null : { bar, passIndex: locator.passIndex }
}

/**
 * A double click on a bar of the score: the locator of the next pass of that bar in playing order (`passIndex` is the one
 * selected now), wrapping from the last pass to the first. A bar played once stays on its one locator; a pass that is not
 * the bar's (or none) starts at the first. null when the bar has no locator.
 */
export function nextPass(locators: readonly Locator[], bar: BarNumber, passIndex: number | null): Locator | null {
  const passes = locators.filter((locator) => locator.bar === bar).sort((a, b) => a.passIndex - b.passIndex)
  if (passes.length === 0) return null
  const at = passes.findIndex((locator) => locator.passIndex === passIndex)
  return passes[(at + 1) % passes.length]
}
