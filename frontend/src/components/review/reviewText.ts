import { formatClock } from '@/components/waveform/dockLayout'
import { formatOffset } from '@/domain/barLabel'
import { type BarNames } from '@/domain/barNames'
import { type ReviewItem } from '@/domain/reviewQueue'
import { type ReviewFlag } from '@/domain/types'
import { barWithPass, strings } from '@/strings'

const text = strings.review

/** How a chip is coloured: a flag kind (tokens.flags), the neutral "explained" look, the hand-moved teal, or the warning amber. */
export type ChipTone = 'crowded' | 'beatCount' | 'weakDownbeat' | 'stretched' | 'explained' | 'moved' | 'warning'
export interface Chip { key: string; label: string; tone: ChipTone }

const KIND_TONE: Record<ReviewFlag['kind'], ChipTone> = {
  crowded: 'crowded',
  stretched: 'stretched',
  'beat-count': 'beatCount',
  'weak-downbeat': 'weakDownbeat',
  'other-downbeat': 'weakDownbeat',
  pickup: 'weakDownbeat',
  'skipped-repeat': 'weakDownbeat',
  pulse: 'weakDownbeat',
}

function flagLabel(flag: ReviewFlag): string {
  if (flag.severity === 0) return text.chips.explained
  switch (flag.kind) {
    case 'crowded':
      return text.chips.crowded
    case 'stretched':
      return text.chips.stretched(flag.factor)
    case 'beat-count':
      return text.chips.beatCount
    case 'weak-downbeat':
      return text.chips.weakDownbeat
    case 'other-downbeat':
      return text.chips.otherDownbeat
    case 'pickup':
      return text.chips.pickup
    case 'skipped-repeat':
      return text.chips.skippedRepeat
    case 'pulse':
      return text.chips.pulse
  }
}

/**
 * The chips of a card: one per flag, "Moved" for a hand-moved locator that has no flag, "No time yet" for an unmatched
 * bar, "Bar count" for a part. A moved locator with a flag keeps its flag chip alone (two chips do not fit the header
 * of the 360 px column); the open card says it was moved.
 */
export function chipsOf(item: ReviewItem): Chip[] {
  if (item.kind === 'box') return [{ key: 'box', label: text.chips.box, tone: 'warning' }]
  if (item.kind === 'part') return [{ key: 'part', label: text.chips.part, tone: 'warning' }]
  if (item.kind === 'unmatched') return [{ key: 'unmatched', label: text.chips.unmatched, tone: 'warning' }]
  const chips = item.flags.map((flag): Chip => ({ key: flag.kind, label: flagLabel(flag), tone: flag.severity === 0 ? 'explained' : KIND_TONE[flag.kind] }))
  return item.moved && chips.length === 0 ? [{ key: 'moved', label: text.chips.moved, tone: 'moved' }] : chips
}

const oneDecimal = (value: number) => value.toFixed(1)
const percent = (confidence: number) => Math.round(confidence * 100)

function flagSentences(flag: ReviewFlag, label: string): string[] {
  const sentences: string[] = []
  if (flag.kind === 'stretched') {
    if (flag.explainedBy === null && flag.factor !== null) sentences.push(text.explain.longer(label, oneDecimal(flag.factor)))
  } else if (flag.kind === 'crowded') {
    const ratio = flag.factor !== null && flag.factor > 0 ? 1 / flag.factor : flag.found > 0 ? flag.expected / flag.found : null
    if (ratio !== null) sentences.push(text.explain.shorter(label, oneDecimal(ratio)))
  } else if (flag.kind === 'beat-count') {
    sentences.push(text.explain.beats(flag.found, flag.expected))
  } else if (flag.kind === 'pickup') {
    sentences.push(flag.found >= flag.expected ? text.explain.pickupNoOnset : text.explain.pickupUnsure)
  } else if (flag.kind === 'skipped-repeat') {
    sentences.push(text.explain.skippedRepeat(flag.found, flag.expected))
  } else if (flag.kind === 'pulse') {
    // Whole numbers: the processor stores the beats as heard (1.03) and the score's mean (2.9375).
    sentences.push(text.explain.pulse(Math.round(flag.found), Math.round(flag.expected)))
  } else if (flag.kind === 'other-downbeat') {
    if (flag.uncertainLine !== null) {
      sentences.push(text.explain.otherDownbeat(formatClock(flag.uncertainLine.timeSec), percent(flag.found), percent(flag.expected)))
    }
  } else {
    sentences.push(text.explain.weakDownbeat(flag.uncertainLine === null ? null : percent(flag.uncertainLine.confidence)))
  }
  if (flag.explainedBy !== null) sentences.push(text.explain[flag.explainedBy])
  // The weak-downbeat and other-downbeat sentences already carry their numbers.
  if (flag.uncertainLine !== null && flag.kind !== 'weak-downbeat' && flag.kind !== 'other-downbeat') {
    const time = formatClock(flag.uncertainLine.timeSec)
    const confidence = percent(flag.uncertainLine.confidence)
    sentences.push(flag.explainedBy !== null ? text.explain.uncertainAfterExplained(time, confidence) : text.explain.uncertain(time, confidence))
  }
  return sentences
}

export interface ExplainContext {
  partName: string
  /** The labels the bars go by. */
  names: BarNames
  /** For a hand-moved item: how far it is from where it was (positive is later); null otherwise. */
  movedBySec: number | null
}

/** What an opened card says, one sentence each, from the numbers the processor stored. */
export function explanationOf(item: ReviewItem, context: ExplainContext): string[] {
  if (item.kind === 'box') return [text.explain.box[item.flag.verdict], ...(item.flag.note.trim() === '' ? [] : [item.flag.note.trim()])]
  if (item.kind === 'part') return [strings.editor.status.partBars(context.partName, item.problem.partBars, item.problem.pieceBars)]
  const label = barWithPass(context.names.label(item.bar), item.passIndex)
  if (item.kind === 'unmatched') return [text.explain.unmatched(label)]
  const sentences = item.flags.flatMap((flag) => flagSentences(flag, label))
  if (item.moved && context.movedBySec !== null) sentences.push(text.explain.moved(formatOffset(context.movedBySec)))
  return sentences
}
