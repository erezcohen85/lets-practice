import { refusalText } from '@/components/editor/useRefusalHint'
import { type BeatsPerBar } from '@/domain/beatGrid'
import { type DetectedBeat } from '@/domain/beats'
import { type EditRefusal } from '@/domain/pieceEdits'
import { type ContinuePlan, type RegridOutcome, type RegridStretch } from '@/domain/regridEdits'
import { type Meter } from '@/domain/types'
import { strings } from '@/strings'

const grid = strings.dock.grid

/**
 * Put the bar lines of a stretch on the beats: what the dock sends when Continue, Half-time, Double-time or a number of beats
 * a bar is pressed. `continuedFrom` names (by the labels the screen shows) the first and last bar Continue learned from.
 */
export interface RegridEdit {
  kind: 'regrid'
  stretch: RegridStretch
  beats: readonly DetectedBeat[]
  beatsPerBar: BeatsPerBar
  offsetSec: number
  /** The meter beatsPerBar counts in, when it is not the meter of the bar the stretch starts at (Continue names the one it learned in). */
  referenceMeter?: Meter
  continuedFrom: { first: string; last: string } | null
}

/**
 * The edit Continue sends for what it learned: the toolbar's Continue and the Ask me panel's Continue both build it here, so
 * they put the same lines on the beats and say the same sentence afterwards. `label` turns a bar into the name the screen shows.
 */
export function continueEdit(learned: ContinuePlan, beats: readonly DetectedBeat[], label: (bar: number) => string): RegridEdit {
  return {
    kind: 'regrid',
    stretch: learned.stretch,
    beats,
    beatsPerBar: learned.beatsPerBar,
    offsetSec: learned.offsetSec,
    referenceMeter: learned.referenceMeter,
    continuedFrom: { first: label(learned.firstBar), last: label(learned.lastBar) },
  }
}

/**
 * What a regrid says afterwards, from its outcome (not the plan: the plan can promise more than the ripple does). Every way of
 * putting the lines on the beats says it the same way: the toolbar, the Ask me panel, and the Wrong beat card.
 */
export function regridSentence(outcome: RegridOutcome, continuedFrom: RegridEdit['continuedFrom']): string {
  const prefix = continuedFrom === null ? '' : grid.continued(continuedFrom.first, continuedFrom.last)
  return prefix + grid.done(outcome.placed, outcome.removed, outcome.dropped, outcome.spread)
}

/** Why a regrid was refused, in its own words: the general sentences for these two reasons talk about one line being added or moved. */
export function regridRefusalText(reason: EditRefusal): string {
  if (reason === 'out-of-range') return grid.refusedNothing
  if (reason === 'no-free-slot') return grid.refusedNoRoom
  return refusalText(reason)
}
