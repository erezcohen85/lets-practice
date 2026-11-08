import { type NewPieceError } from '@/domain/newPiece'
import { strings } from '@/strings'

/** The words of an error of the parts half of the form (validateNewParts). */
export function partErrorText(code: NewPieceError): string | undefined {
  switch (code) {
    case 'parts-missing':
      return strings.newPiece.errors.partsMissing
    case 'part-not-pdf':
      return strings.newPiece.errors.partNotPdf
    default:
      return undefined
  }
}
