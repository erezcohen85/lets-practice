/** A beat closer than this share of the local gap to the last kept beat is an extra one and is dropped. */
export const CLEAN_LOW = 0.6
/** A gap longer than this share of the local gap has beats missing in it. */
export const CLEAN_HIGH = 1.6
/** How many of the latest gaps the local gap is the median of. */
export const CLEAN_WINDOW = 8
/** The fewest checked lines (in a row) that say what the bars hold: 4 lines are 3 bars. */
export const LEARN_MIN_LINES = 4
/** A checked line farther than this from a beat (seconds) is not on the pulse, so nothing is learned from it. */
export const LEARN_MAX_OFFSET_SEC = 0.1
/** A step of the grid that ends this close to a whole beat (as a share of a beat) lands on that beat. */
export const SNAP_BEAT_SHARE = 0.25
/** A step whose share is exact (a whole bar of another meter) lands on a whole beat only when it ends this close to it: float slack. */
const EXACT_STEP_SLACK = 1e-6
/** The beats a bar the tracker can be asked to put a bar line on. N counts the beats heard in one bar of the stretch's meter. */
export const BEATS_PER_BAR_CHOICES = [1, 2, 3, 4, 5, 6] as const
export type BeatsPerBar = (typeof BEATS_PER_BAR_CHOICES)[number]
const LAST_CHOICE = BEATS_PER_BAR_CHOICES[BEATS_PER_BAR_CHOICES.length - 1]

/** Slack (seconds) so a line that sits on a beat, give or take rounding, counts as being on it. */
const EDGE_SEC = 1e-9

/** The middle value of the list (the mean of the two middle ones when the count is even). The list is not empty. */
function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = sorted.length >> 1
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

/** The index of the first value that is not less than `value`; times.length when none is. Times are in order. */
function firstNotBefore(times: readonly number[], value: number): number {
  let low = 0
  let high = times.length
  while (low < high) {
    const middle = (low + high) >> 1
    if (times[middle] < value) low = middle + 1
    else high = middle
  }
  return low
}

/** The index of the beat nearest to `timeSec` (the earlier one on a tie). The grid is not empty. */
function nearestIndex(grid: readonly number[], timeSec: number): number {
  const after = firstNotBefore(grid, timeSec)
  if (after === 0) return 0
  if (after === grid.length) return grid.length - 1
  return timeSec - grid[after - 1] <= grid[after] - timeSec ? after - 1 : after
}

/** The gaps the grid goes on at beyond its two ends: the median of the first and of the last CLEAN_WINDOW gaps. */
interface EndGaps {
  first: number
  last: number
}

/** The median of the gaps between the beats `from - 1` .. `to - 1`; 0 when there is no gap. */
function medianGap(grid: readonly number[], from: number, to: number): number {
  const gaps: number[] = []
  for (let index = from; index < to; index++) gaps.push(grid[index] - grid[index - 1])
  return gaps.length > 0 ? median(gaps) : 0
}

/** The time at a place in the grid counted in beats: whole numbers are beats, in between is spread evenly between two
 *  beats, and before the first and past the last beat the grid goes on at the gap of that end. */
function timeAtBeat(grid: readonly number[], ends: EndGaps, position: number): number {
  const last = grid.length - 1
  if (position <= 0) return grid[0] + position * ends.first
  if (position >= last) return grid[last] + (position - last) * ends.last
  const index = Math.floor(position)
  return grid[index] + (position - index) * (grid[index + 1] - grid[index])
}

/** The place in the grid, counted in beats, of a time: the other way round from timeAtBeat. */
function beatAtTime(grid: readonly number[], ends: EndGaps, timeSec: number): number {
  const last = grid.length - 1
  if (timeSec <= grid[0]) return (timeSec - grid[0]) / ends.first
  if (timeSec >= grid[last]) return last + (timeSec - grid[last]) / ends.last
  const after = firstNotBefore(grid, timeSec)
  return after - 1 + (timeSec - grid[after - 1]) / (grid[after] - grid[after - 1])
}

/** Beat times in order, cleaned: a beat closer than CLEAN_LOW x the local gap to the last kept beat is dropped; a gap
 *  longer than CLEAN_HIGH x the local gap gets evenly spaced beats. The local gap is the median of the last
 *  CLEAN_WINDOW kept gaps; until that many are kept, the median of the first CLEAN_WINDOW raw gaps, so one early stray
 *  beat cannot set it. Fewer than 3 beats: returned as they are. */
export function cleanBeats(times: readonly number[]): number[] {
  if (times.length < 3) return [...times]
  const rawGaps: number[] = []
  for (let index = 1; index < times.length && index <= CLEAN_WINDOW; index++) {
    rawGaps.push(times[index] - times[index - 1])
  }
  const firstGap = median(rawGaps)
  const kept = [times[0]]
  const keptGaps: number[] = []
  for (let index = 1; index < times.length; index++) {
    const last = kept[kept.length - 1]
    const gap = keptGaps.length >= CLEAN_WINDOW ? median(keptGaps.slice(-CLEAN_WINDOW)) : firstGap
    const distance = times[index] - last
    if (gap > 0 && distance < CLEAN_LOW * gap) continue
    const pieces = gap > 0 && distance > CLEAN_HIGH * gap ? Math.round(distance / gap) : 1
    for (let piece = 1; piece < pieces; piece++) kept.push(last + (distance * piece) / pieces)
    kept.push(times[index])
    for (let piece = 0; piece < pieces; piece++) keptGaps.push(distance / pieces)
  }
  return kept
}

/** Grid times for bar lines from `startSec` to before `endSec`: the first is startSec itself; then every
 *  `beatsPerBar` cleaned beats, each shifted by `offsetSec` (the user's lines sit that far from the beats). Before the
 *  first beat the grid goes on at the first local gap, past the last beat at the last local gap. `slotUnits` gives, per
 *  slot, starting with the one that begins at `startSec`, its length as a share of a bar of the meter `beatsPerBar` was
 *  counted in (1 for a whole bar of it; less for a pickup or a bar split at a repeat; the beats of its meter against that
 *  meter's for a bar of another meter, see heardBeats), so a bar takes its share of the beats; the list may be longer
 *  than needed. A start within LEARN_MAX_OFFSET_SEC of a beat counts from that beat; a start
 *  farther off keeps its own place between the beats. A step that ends within SNAP_BEAT_SHARE of a whole beat ahead of
 *  where it began lands on that beat, unless `snaps` says that slot's step is exact (false: a whole bar of another meter,
 *  where 0.75 of a beat is not a beat): then it lands on a whole beat only within float slack. An exact step can leave the
 *  lines off the beats (a 3/4 bar at one beat a bar in 4/4 leaves them 0.75 on); the steps after it that may snap snap to the
 *  beats as that shift moved them (2.75, 3.75, 4.75 ...), until an exact step ends on a whole beat again. `snaps` is per
 *  slot like slotUnits; a slot it does not list may snap. */
export function gridTimes(
  grid: readonly number[],
  startSec: number,
  endSec: number,
  beatsPerBar: BeatsPerBar,
  slotUnits: readonly number[],
  offsetSec = 0,
  snaps: readonly boolean[] = [],
): number[] {
  if (startSec >= endSec) return []
  const times = [startSec]
  const lastGap = medianGap(grid, Math.max(1, grid.length - CLEAN_WINDOW), grid.length)
  if (lastGap <= 0) return times
  const ends = { first: medianGap(grid, 1, Math.min(grid.length, CLEAN_WINDOW + 1)) || lastGap, last: lastGap }
  const place = beatAtTime(grid, ends, startSec)
  const nearestBeat = Math.round(place)
  const onBeat = Math.abs(startSec - timeAtBeat(grid, ends, nearestBeat)) <= LEARN_MAX_OFFSET_SEC + EDGE_SEC
  let position = onBeat ? nearestBeat : place
  // how far the beats the lines snap to are from the whole beats: what the exact steps left (0 for a piece in one meter)
  let shift = 0
  for (let index = 0; index < slotUnits.length; index++) {
    const before = position
    position += slotUnits[index] * beatsPerBar
    if (snaps[index] === false) {
      const wholeBeat = Math.round(position)
      if (wholeBeat > before && Math.abs(position - wholeBeat) <= EXACT_STEP_SLACK) position = wholeBeat
      shift = position - Math.round(position)
    } else {
      // never back onto the place the step began, or a short slot would put two lines at one time
      const beat = Math.round(position - shift) + shift
      if (beat > before && Math.abs(position - beat) <= SNAP_BEAT_SHARE) position = beat
    }
    const time = timeAtBeat(grid, ends, position) + offsetSec
    if (time >= endSec) break
    times.push(time)
  }
  return times
}

/** What the user's checked lines say: from `lines` (start times of consecutive checked bars, at least LEARN_MIN_LINES,
 *  in time order) the beats of the cleaned grid inside each bar. All bars must agree on one value in
 *  BEATS_PER_BAR_CHOICES and every line must sit within LEARN_MAX_OFFSET_SEC of a grid beat; else null.
 *  offsetSec = the median of (line - nearest beat). */
export function learnPulse(
  grid: readonly number[],
  lines: readonly number[],
): { beatsPerBar: BeatsPerBar; offsetSec: number } | null {
  if (grid.length === 0 || lines.length < LEARN_MIN_LINES) return null
  const beatIndexes: number[] = []
  const offsets: number[] = []
  for (const line of lines) {
    const index = nearestIndex(grid, line)
    const offset = line - grid[index]
    if (Math.abs(offset) > LEARN_MAX_OFFSET_SEC + EDGE_SEC) return null
    beatIndexes.push(index)
    offsets.push(offset)
  }
  const beatsPerBar = beatIndexes[1] - beatIndexes[0]
  for (let index = 2; index < beatIndexes.length; index++) {
    if (beatIndexes[index] - beatIndexes[index - 1] !== beatsPerBar) return null
  }
  const choice = BEATS_PER_BAR_CHOICES.find((candidate) => candidate === beatsPerBar)
  if (choice === undefined) return null
  return { beatsPerBar: choice, offsetSec: median(offsets) }
}

/** The beats per bar a stretch has now: each line taken at its nearest grid beat, the median of the beats between
 *  consecutive lines, rounded to the nearest choice (half a beat rounds up). Null with fewer than two lines, no beats,
 *  a median under half a beat (the lines are not on this grid), or a median above the last choice and its half (6.5):
 *  seven beats a bar is not one of the choices, and calling it 6 would make Half-time and Double-time work from a wrong number.
 *  A pulse that is not a whole number of beats per bar is not measured reliably: 2.5 gives 2 or 3 depending on where
 *  the lines start. `scales`, one to a gap between lines, multiply the beats counted in that gap, so bars of other meters
 *  are counted in bars of the first one's meter (see measureScales); without them every gap counts as it is. */
export function measuredBeatsPerBar(grid: readonly number[], lines: readonly number[], scales: readonly number[] = []): BeatsPerBar | null {
  if (grid.length === 0 || lines.length < 2) return null
  const counts: number[] = []
  for (let index = 1; index < lines.length; index++) {
    counts.push((nearestIndex(grid, lines[index]) - nearestIndex(grid, lines[index - 1])) * (scales[index - 1] ?? 1))
  }
  const beats = median(counts)
  if (beats < 0.5 || beats > LAST_CHOICE + 0.5) return null
  return BEATS_PER_BAR_CHOICES.reduce((best, choice) =>
    Math.abs(choice - beats) <= Math.abs(best - beats) ? choice : best,
  )
}
