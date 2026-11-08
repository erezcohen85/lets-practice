import { type BeatsPerBar } from './beatGrid'
import { meterRatio } from './feltBeats'
import { meterAt } from './renumber'
import { type MeterChange } from './types'

// Which lines the "bar lines on the beats" buttons (Half-time, Double-time, Bar = N) act on, worked out from the selection.
// Pure: the dock gives it the lines it draws and the selected slots.

/** A bar line as the dock knows it. */
export interface StretchLine {
  bar: number
  passIndex: number
  timeSec: number
  confirmed: boolean
}

type SlotOf = { bar: number; passIndex: number }

/**
 * fromSec and toSec: the stretch. whole: nothing was selected, so it is the whole piece (the screen asks before changing
 * that). lineTimes: the times of the lines from fromSec to toSec, both ends included, to measure the beats a bar by.
 * lastSlot: the selected line the stretch starts or ends at last in time (Continue goes on from it); null for the whole piece.
 */
export type StretchPick =
  | { ok: true; fromSec: number; toSec: number; whole: boolean; lineTimes: number[]; lastSlot: SlotOf | null }
  | { ok: false; reason: 'no-lines' | 'selection-without-line' | 'no-room' }

/**
 * Two or more selected lines: from the first to the last selected. One selected: from it to the next checked line, or to
 * the end of the recording when no checked line follows. None selected: the whole piece, from the first line to the end
 * of the recording. A selection none of whose slots has a line is not read as "nothing selected": it is refused.
 */
export function pickStretch(lines: readonly StretchLine[], selection: readonly SlotOf[], durationSec: number): StretchPick {
  if (lines.length === 0) return { ok: false, reason: 'no-lines' }
  const chosen = lines.filter((line) => selection.some((slot) => slot.bar === line.bar && slot.passIndex === line.passIndex))
  if (selection.length > 0 && chosen.length === 0) return { ok: false, reason: 'selection-without-line' }
  const times = chosen.map((line) => line.timeSec)
  const last = chosen.reduce<StretchLine | null>((latest, line) => (latest === null || line.timeSec > latest.timeSec ? line : latest), null)

  let fromSec: number
  let toSec: number
  if (chosen.length >= 2) {
    fromSec = Math.min(...times)
    toSec = Math.max(...times)
  } else if (chosen.length === 1) {
    fromSec = times[0]
    const next = lines.filter((line) => line.confirmed && line.timeSec > fromSec).reduce<number | null>((nearest, line) => (nearest === null || line.timeSec < nearest ? line.timeSec : nearest), null)
    toSec = next ?? durationSec
  } else {
    fromSec = Math.min(...lines.map((line) => line.timeSec))
    toSec = durationSec
  }
  if (!(toSec > fromSec)) return { ok: false, reason: 'no-room' }

  return {
    ok: true,
    fromSec,
    toSec,
    whole: chosen.length === 0,
    lineTimes: lines.map((line) => line.timeSec).filter((time) => time >= fromSec && time <= toSec).sort((a, b) => a - b),
    lastSlot: last === null ? null : { bar: last.bar, passIndex: last.passIndex },
  }
}

/**
 * For each gap between two lines of the stretch (the lines from fromSec to toSec, in time order, both ends included), the number
 * that turns the beats counted in it into beats of the first bar's meter: 1 in a bar of that meter, 1.5 for a 2/4 bar against
 * 3/4. The first bar's meter is the stretch's reference, the one its N counts in. `meters` are the piece's meter changes.
 * It picks the lines the way pickStretch picks lineTimes (the same bounds, in time order), so for the same fromSec and toSec
 * it gives one scale to each gap of lineTimes, which measuredBeatsPerBar needs.
 */
export function measureScales(lines: readonly StretchLine[], fromSec: number, toSec: number, meters: MeterChange[]): number[] {
  const inStretch = lines.filter((line) => line.timeSec >= fromSec && line.timeSec <= toSec).sort((a, b) => a.timeSec - b.timeSec)
  if (inStretch.length < 2) return []
  const reference = meterAt(meters, inStretch[0].bar)
  return inStretch.slice(0, -1).map((line) => 1 / meterRatio(meterAt(meters, line.bar), reference))
}

const HALF_TIME: Record<BeatsPerBar, BeatsPerBar | null> = { 1: 2, 2: 4, 3: 6, 4: null, 5: null, 6: null }
const DOUBLE_TIME: Record<BeatsPerBar, BeatsPerBar | null> = { 1: null, 2: 1, 3: 1, 4: 2, 5: null, 6: 3 }

/** Half-time: the beats a bar doubled; null when that is more than 6. */
export function halfTimeBeats(beatsPerBar: BeatsPerBar): BeatsPerBar | null {
  return HALF_TIME[beatsPerBar]
}

/** Double-time: the beats a bar halved when that is a whole number, a triple going to 1; null for 1 and 5. */
export function doubleTimeBeats(beatsPerBar: BeatsPerBar): BeatsPerBar | null {
  return DOUBLE_TIME[beatsPerBar]
}
