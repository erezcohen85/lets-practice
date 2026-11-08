import { type CountInPlan } from './tempo'

// The count-in fade (Decision 2026-10-30): the recording rises from silence to the music volume as a count-in ends.
// Everything here is in recording time, like the loop and the cursor; the speed only enters where clicks (wall time)
// meet the recording.

/** Off; Pre-roll; Pre-roll and loop start; Under the clicks (the user setting, in profiles.settings.playback). */
export const COUNT_IN_FADES = ['off', 'pre-roll', 'pre-roll-and-loop', 'under-clicks'] as const
export type CountInFade = (typeof COUNT_IN_FADES)[number]

export const DEFAULT_COUNT_IN_FADE: CountInFade = 'pre-roll'

/** A stretch of recording time over which the gain rises from 0 to 1. */
export interface FadeSpan { fromSec: number; toSec: number }

export interface FadePlan {
  /** The rise; null = no fade. */
  span: FadeSpan | null
  /** Under the clicks: where the recording starts, and the wall seconds after the first click before it plays. */
  underClicks: { startSec: number; delayWallSec: number } | null
}

const NO_FADE: FadePlan = { span: null, underClicks: null }

/**
 * The gain 0..1 at a progress 0..1 through a fade: a quarter sine, so the power rises evenly (equal power) and the ear
 * hears a steady swell. Exactly 0 at the start and exactly 1 at the end; it never overshoots 1.
 */
export function fadeGain(progress: number): number {
  if (Number.isNaN(progress)) return 1
  if (progress <= 0) return 0
  if (progress >= 1) return 1
  return Math.sin((progress * Math.PI) / 2)
}

/** The gain at a recording time: 0 before the span, 1 from its end on, and 1 with no span. */
export function fadeLevel(span: FadeSpan | null, timeSec: number): number {
  if (span === null) return 1
  return fadeGain((timeSec - span.fromSec) / (span.toSec - span.fromSec))
}

/**
 * What to fade for a loop's count-in, from the setting and the count-in plan.
 * - A pre-roll fades over the recorded bars it replays, in every mode but Off.
 * - A click count-in fades the loop in over its first beat in "Pre-roll and loop start".
 * - In "Under the clicks" it also plays the recording before the loop, started so that it reaches the loop start when the
 *   clicks end (the recording runs at the speed, the clicks at the count-in tempo). A loop at the first bar has nothing
 *   before it and stays clicks only. When the recording is too short for that, it waits (in wall seconds) instead of
 *   starting before 0, so the loop start still lands on the last click.
 */
export function planCountInFade(
  mode: CountInFade,
  plan: CountInPlan,
  loop: { startPosition: number; startSec: number; firstBeatSec: number },
  speed: number,
): FadePlan {
  if (mode === 'off' || plan.type === 'off') return NO_FADE

  if (plan.type === 'pre-roll') {
    return { span: { fromSec: plan.recordingStartSec, toSec: loop.startSec }, underClicks: null }
  }

  if (mode === 'pre-roll-and-loop') {
    return { span: { fromSec: loop.startSec, toSec: loop.startSec + loop.firstBeatSec }, underClicks: null }
  }
  if (mode === 'under-clicks' && loop.startPosition > 0) {
    const clicksWallSec = plan.bars.reduce((total, bar) => total + bar.beats * bar.beatWallSec, 0)
    const wanted = loop.startSec - clicksWallSec * speed
    const startSec = Math.max(0, wanted)
    return {
      span: { fromSec: startSec, toSec: loop.startSec },
      underClicks: { startSec, delayWallSec: (startSec - wanted) / speed },
    }
  }
  return NO_FADE
}
