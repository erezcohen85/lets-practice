import { done, refuse, withTiming, type EditorDoc, type EditResult } from './pieceEdits'
import { expandPlayOrder } from './playOrder'
import { slotFractions } from './shortBars'
import { type Locator, type PlaySlot } from './types'

/**
 * Lays the locators of an old play order onto the slots of a new one, for an edit that only changes the play order.
 *
 * A locator is keyed by (bar, pass), and the pass is "the nth time this bar is played", so adding a play of a bar
 * early in the order renames every later pass of it. Keeping a locator by its old key then puts it on the wrong slot,
 * out of time order, and loses it. Here a locator is kept for what it is: the locators, in time order, are matched
 * against the slots, in play order, by bar. The match is the longest one that keeps both orders (a longest common
 * subsequence); where several are equally long each locator takes the earliest slot it can. A matched locator takes
 * its slot's pass and keeps its time, `confirmed`, `checked` and flags; the rest, which have no slot left, are dropped.
 * The matched times rise along the slots, so nothing needs pruning afterwards.
 *
 * `kept` is in play order; `dropped` in the order the locators were given.
 */
export function remapLocators(slots: readonly PlaySlot[], locators: readonly Locator[]): { kept: Locator[]; dropped: Locator[] } {
  const copies = locators.map((locator) => ({ ...locator }))
  // Time order; a locator at the same time as the one before it cannot rise with it, so it is dropped.
  const ordered = [...copies].sort((a, b) => a.timeSec - b.timeSec)
  const dropped = new Set<Locator>()
  const usable: Locator[] = []
  for (const locator of ordered) {
    if (usable.length > 0 && usable[usable.length - 1].timeSec === locator.timeSec) dropped.add(locator)
    else usable.push(locator)
  }

  const m = usable.length
  const n = slots.length
  // longest[i][j]: how many of usable[i..] can be matched to slots[j..].
  const longest = Array.from({ length: m + 1 }, () => new Int32Array(n + 1))
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      longest[i][j] =
        usable[i].bar === slots[j].bar ? longest[i + 1][j + 1] + 1 : Math.max(longest[i + 1][j], longest[i][j + 1])
    }
  }

  const kept: Locator[] = []
  let i = 0
  let j = 0
  while (i < m && j < n) {
    const matchable = usable[i].bar === slots[j].bar && longest[i][j] === longest[i + 1][j + 1] + 1
    if (matchable) {
      kept.push({ ...usable[i], bar: slots[j].bar, passIndex: slots[j].passIndex })
      i++
      j++
    } else if (longest[i][j + 1] === longest[i][j]) {
      j++
    } else {
      dropped.add(usable[i])
      i++
    }
  }
  for (; i < m; i++) dropped.add(usable[i])
  return { kept, dropped: copies.filter((locator) => dropped.has(locator)) }
}

/** What a skipped whole bar costs against a misfit of the time, in log units, so a gap under about 1.7 bars is a slow bar and not a lost one. */
const SKIP_COST = 0.5
/** The cost of `count` whole bars skipped in one step: it grows slowly, because a misfit does too, and a long hole must still take all of its bars. */
const skipCost = (count: number): number => (count <= 0 ? 0 : SKIP_COST * (1 + Math.log(count)))
/** The most slots one step between two locators may pass over. */
const MAX_STEP = 128
/** The neighbouring steps either side of a locator that say how long a bar is around it. */
const LOCAL_STEPS = 8

function medianOf(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length / 2
  return sorted.length % 2 === 1 ? sorted[(sorted.length - 1) / 2] : (sorted[mid - 1] + sorted[mid]) / 2
}

/**
 * The slot each locator time takes, for at most as many times as slots: the cheapest way along the slots in which the time
 * between two locators fits the bars they pass over. A bar's length is the median step around that time, so the tempo may
 * change through the piece and an error never adds up. Slots may stay empty: a pickup at no cost, because a detected downbeat
 * lies on no pickup, a whole bar at skipCost, because the recording has it and the locator was lost. So a gap of two bars
 * leaves a slot for the fill where a one-to-one walk would pull every later label back. A slot in `stretches` (a fermata) may
 * take any longer gap at no cost. The bars before the first locator must fit before it, and the bars after the last cost half.
 */
function placeByTime(times: readonly number[], fractions: readonly number[], stretches: readonly boolean[]): number[] {
  const count = times.length
  const slots = fractions.length
  if (count === 0) return []
  const steps = times.slice(1).map((time, i) => time - times[i])
  const barAt = (a: number): number => {
    const around = steps.slice(Math.max(0, a - LOCAL_STEPS), a + LOCAL_STEPS)
    return around.length === 0 ? 1 : medianOf(around)
  }
  // Running totals over the slots: the bars they hold, and how many are whole.
  const bars = [0]
  const whole = [0]
  fractions.forEach((fraction, i) => {
    bars.push(bars[i] + fraction)
    whole.push(whole[i] + (fraction === 1 ? 1 : 0))
  })
  const free = slots - count
  // cost[a][k]: the best way to have locator a on slot a + k. from[a][k]: the k of the locator before it.
  const cost = Array.from({ length: count }, () => new Float64Array(free + 1).fill(Infinity))
  const from = Array.from({ length: count }, () => new Int32Array(free + 1))
  const firstBar = barAt(0)
  for (let k = 0; k <= free; k++) {
    cost[0][k] = SKIP_COST * whole[k] + Math.max(0, bars[k] - times[0] / firstBar)
  }
  for (let a = 1; a < count; a++) {
    const gap = times[a] - times[a - 1]
    const bar = barAt(a - 1)
    for (let k = 0; k <= free; k++) {
      const slot = a + k
      for (let was = k; was >= 0 && k - was < MAX_STEP; was--) {
        if (cost[a - 1][was] === Infinity) continue
        const before = a - 1 + was
        const expected = (bars[slot] - bars[before]) * bar
        const skipped = whole[slot] - whole[before + 1]
        const misfit = skipped === 0 && stretches[before] && gap > expected ? 0 : Math.abs(Math.log(gap / expected))
        const total = cost[a - 1][was] + misfit + skipCost(skipped)
        if (total < cost[a][k]) {
          cost[a][k] = total
          from[a][k] = was
        }
      }
    }
  }
  let best = 0
  let bestCost = Infinity
  for (let k = 0; k <= free; k++) {
    const slot = count - 1 + k
    // Half the price of a skip anywhere else: with nothing to say otherwise, the bars left over are the last ones.
    const total = cost[count - 1][k] + (SKIP_COST / 2) * (whole[slots] - whole[slot + 1])
    if (total < bestCost) {
      bestCost = total
      best = k
    }
  }
  const placed = new Array<number>(count)
  for (let a = count - 1, k = best; a >= 0; a--) {
    placed[a] = a + k
    k = from[a][k]
  }
  return placed
}

/**
 * Relabels the locators in play order, keeping every time (Task 18). For a map whose times are right and whose labels are
 * not (a repeat played from the recording that the labels skip): the locators in time order take the slots in play order,
 * by the time between them (see placeByTime). A locator whose label changes loses `confirmed` and `checked`, because nobody
 * has checked it under its new label; one whose label stays keeps them. Flags go with the locator. With more locators than
 * slots they go one to one and those past the last slot are dropped (and reported); slots left over stay without a time,
 * for the fill. One step. Refused (`already-in-order`) when no label would change and none would be dropped.
 */
export function relabelInPlayOrder(doc: EditorDoc): EditResult {
  const slots = expandPlayOrder(doc.timing.playOrder, doc.timing.barCount)
  const ordered = doc.timing.locators.map((locator) => ({ ...locator })).sort((a, b) => a.timeSec - b.timeSec)
  const dropped: Locator[] = []
  const usable: Locator[] = []
  for (const locator of ordered) {
    // A locator at the time of the one before it cannot rise with it.
    if (usable.length > 0 && usable[usable.length - 1].timeSec === locator.timeSec) dropped.push(locator)
    else usable.push(locator)
  }
  const fermatas = new Set(doc.timing.marks.filter((mark) => mark.kind === 'fermata').map((mark) => mark.bar))
  const placed =
    usable.length > slots.length
      ? slots.map((_, i) => i)
      : placeByTime(usable.map((locator) => locator.timeSec), slotFractions(slots, doc.timing), slots.map((slot) => fermatas.has(slot.bar)))
  let relabelled = 0
  const kept = placed.map((position, i) => {
    const locator = usable[i]
    const slot = slots[position]
    if (locator.bar === slot.bar && locator.passIndex === slot.passIndex) return locator
    relabelled++
    const moved: Locator = { ...locator, bar: slot.bar, passIndex: slot.passIndex, confirmed: false }
    delete moved.checked
    return moved
  })
  dropped.push(...usable.slice(placed.length))
  if (relabelled === 0 && dropped.length === 0) return refuse('already-in-order')
  return done(withTiming(doc, { ...doc.timing, locators: kept }), { kind: 'relabel-in-order', count: relabelled }, dropped)
}

/**
 * Whether the slots that a play-order edit left without a time look like a sign that the locators' labels are off, not
 * like bars the recording has no locators for (Task 18). A run of empty slots between two kept locators shares the time
 * between those neighbours with the bar of the locator before it: N empty bars need N + 1 bars of time, and an empty pickup
 * needs only what it shares with the half bar before it (`fractions`, each slot's share of a bar; 1 for each when not given).
 * A run cannot fit when that gap is under three quarters of what it needs at the median time between neighbouring
 * locators. With the recording's length known, the run at the very start (against the time of the first locator) and the
 * run at the end (against the time left after the last) count too; without it those two are left out.
 * `before` are the locators the edit started from (the median is theirs), `kept` the ones that found a slot.
 */
export function emptyRunsCannotFit(
  slots: readonly PlaySlot[],
  before: readonly Locator[],
  kept: readonly Locator[],
  recordingSec?: number,
  fractions?: readonly number[],
): boolean {
  const times = before.map((locator) => locator.timeSec).sort((a, b) => a - b)
  const steps = times.slice(1).map((time, i) => time - times[i])
  if (steps.length === 0 || kept.length === 0) return false
  const median = medianOf(steps)
  const timeOf = new Map(kept.map((locator) => [`${locator.bar}:${locator.passIndex}`, locator.timeSec]))
  const shareOf = (position: number) => fractions?.[position] ?? 1
  let run = 0
  let needed = 0 // bars of time the run and the locator before it take
  let from: number | null = null // the time of the locator before the run; null at the start
  const cannotFit = (until: number | null): boolean => {
    if (run === 0) return false
    const start = from ?? (recordingSec === undefined ? null : 0)
    const end = until ?? recordingSec ?? null
    // A run at the start or the end is compared with the recording only when its length is known.
    return start !== null && end !== null && end - start < 0.75 * needed * median
  }
  for (const [position, slot] of slots.entries()) {
    const time = timeOf.get(`${slot.bar}:${slot.passIndex}`)
    if (time === undefined) {
      run++
      needed += shareOf(position)
      continue
    }
    if (cannotFit(time)) return true
    run = 0
    needed = shareOf(position)
    from = time
  }
  return cannotFit(null)
}
