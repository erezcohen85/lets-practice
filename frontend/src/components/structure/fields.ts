import { type BarNames } from '@/domain/barNames'
import { type StructureError } from '@/domain/pieceEdits'
import { strings } from '@/strings'

/** The 44 px controls of the panel: dark fields on the surface card, as the rename dialog's. */
export const fieldClass = 'h-11 bg-background px-3 text-base md:text-base dark:bg-background'

/** What a field holds becomes a number when the player applies; an empty field is not a number (NaN fails validation). */
export function toNumber(text: string): number {
  return text.trim() === '' ? NaN : Number(text)
}

/**
 * A bar typed in a field ("12", "p7", "P7") as the internal bar it names, or NaN (which fails validation) when the field is empty or
 * the label names no bar of the piece, such as p9 where there is no such pickup.
 */
export function toBar(text: string, names: BarNames): number {
  return names.parse(text) ?? NaN
}

/**
 * The sentence for one validation error of the structure. `last` is the label of the last bar the field may hold (the piece's, or a
 * part's for its rests) and `first` the label of the first one.
 */
export function structureErrorText(error: StructureError, last: string, first = '1'): string {
  const text = strings.structure.errors
  switch (error.field) {
    case 'meters':
      return {
        'first-not-bar-1': text.firstMeterNotBar1,
        'out-of-range': text.meterOutOfRange(last),
        'not-increasing': text.meterNotIncreasing,
        'bad-meter': text.badMeter,
      }[error.problem]
    case 'playOrder':
      return {
        empty: text.playOrderEmpty,
        'out-of-range': text.playOrderOutOfRange(last, first),
        'from-after-to': text.playOrderFromAfterTo,
      }[error.problem]
    case 'marks':
      return { 'out-of-range': text.markOutOfRange(last, first), duplicate: text.markDuplicate }[error.problem]
  }
}
