import { splitIsValid, splitProblems, type SplitPart } from '@/domain/splitEdits'

export interface NewPieceForm {
  title: string
  /** The recording is an audio file; a YouTube link is no longer taken (Decision 2026-11-06). */
  recording: { kind: 'file'; fileName: string | null }
  parts: { fileName: string; name: string }[]
}
export type NewPieceError =
  | 'title-missing'
  | 'recording-missing'
  | 'parts-missing'
  | 'part-not-pdf'

/** Errors keyed by field: 'title', 'recording', 'parts', or 'part-<index>'. Empty object = valid. */
export function validateNewPiece(form: NewPieceForm, partsErrors: Record<string, NewPieceError> = validateNewParts(form.parts)): Record<string, NewPieceError> {
  const errors: Record<string, NewPieceError> = {}

  if (form.title.trim() === '') errors.title = 'title-missing'

  if (form.recording.fileName === null || form.recording.fileName === '') errors.recording = 'recording-missing'

  return { ...errors, ...partsErrors }
}

/**
 * The parts half of the form, as the hub's Add part dialog needs it: 'parts', or 'part-<index>'. Empty object = valid.
 * A part's name is optional: left empty, it is read from the PDF's header, else made from the file name.
 */
export function validateNewParts(parts: NewPieceForm['parts']): Record<string, NewPieceError> {
  const errors: Record<string, NewPieceError> = {}
  if (parts.length === 0) errors.parts = 'parts-missing'
  parts.forEach((part, index) => {
    if (!/\.pdf$/i.test(part.fileName)) errors[`part-${index}`] = 'part-not-pdf'
  })
  return errors
}

/** The parts half of the form when the parts come from one PDF: fine once the split is confirmed and holds nothing the processor would refuse. */
export function validateSplitParts(confirmed: boolean, parts: SplitPart[]): Record<string, NewPieceError> {
  return confirmed && splitIsValid(splitProblems(parts)) ? {} : { parts: 'parts-missing' }
}

/** "CCC_clar1_final-v2.pdf" → "CCC clar1 final v2": extension dropped, _ and - become spaces, spaces collapsed. */
export function partNameFromFile(fileName: string): string {
  return fileName
    .replace(/\.[A-Za-z][A-Za-z0-9]{0,4}$/, '')
    .replace(/[_-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
