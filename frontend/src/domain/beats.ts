/** One beat the beat tracker found in the recording: when it falls, and how likely it is the first beat of a bar (0..1). */
export interface DetectedBeat { t: number; downbeat: number }

export type SnapDirection = 'previous' | 'next' | 'closest'

/** A beat this close to a time (seconds) is "here": Snap skips it to the next one, the way a click on a bar line does not move it. */
export const HERE_SEC = 0.02
/** Snap to closest leaves a line farther than this from any beat (seconds): the tracker missed that bar, and the beat it would take belongs to another place. */
export const CLOSEST_SNAP_SEC = 0.15
/** A line this close to a beat (seconds) is on it: Snap to closest has nothing to do. */
export const ON_BEAT_SEC = 0.001
/** A dragged line takes a beat this close to the pointer, unless Shift is held. */
export const DRAG_SNAP_SEC = 0.03

/** A beat more likely than not the first of a bar is drawn stronger. */
export function isDownbeat(beat: DetectedBeat): boolean {
  return beat.downbeat >= 0.5
}

/** The index of the first beat (in time order) after `timeSec`; beats.length when none is. */
function firstAfter(beats: readonly DetectedBeat[], timeSec: number): number {
  let low = 0
  let high = beats.length
  while (low < high) {
    const middle = (low + high) >> 1
    if (beats[middle].t > timeSec) high = middle
    else low = middle + 1
  }
  return low
}

/**
 * The time of the beat before or after `timeSec`, or null when there is none that way. A beat within HERE_SEC of the
 * time counts as the place the time is already at and is skipped. `closest` is the nearer beat on either side, within
 * CLOSEST_SNAP_SEC, or null when there is none or the time is already on it. Beats are in time order.
 */
export function snapToBeat(timeSec: number, beats: readonly DetectedBeat[], direction: SnapDirection): number | null {
  if (direction === 'closest') {
    const beat = nearestBeat(timeSec, beats, CLOSEST_SNAP_SEC)
    return beat !== null && Math.abs(beat - timeSec) >= ON_BEAT_SEC ? beat : null
  }
  if (direction === 'next') {
    const index = firstAfter(beats, timeSec + HERE_SEC)
    return index < beats.length ? beats[index].t : null
  }
  const index = firstAfter(beats, timeSec - HERE_SEC - Number.EPSILON) - 1
  return index >= 0 ? beats[index].t : null
}

/** The time of the beat closest to `timeSec` if it is within `withinSec`, else null. Beats are in time order. */
export function nearestBeat(timeSec: number, beats: readonly DetectedBeat[], withinSec: number): number | null {
  const after = firstAfter(beats, timeSec)
  let best: number | null = null
  let bestDistance = withinSec + 1e-9
  for (const index of [after - 1, after]) {
    if (index < 0 || index >= beats.length) continue
    const distance = Math.abs(beats[index].t - timeSec)
    if (distance < bestDistance) {
      best = beats[index].t
      bestDistance = distance
    }
  }
  return best
}
