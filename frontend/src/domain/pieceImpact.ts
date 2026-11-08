import { partBarCount, type EditorDoc, type EditResult } from './pieceEdits'
import { barsInPiece } from './shortBars'

// What a bar-count edit does to the piece, for the "This changes the whole piece" confirm, and what to offer a part
// whose bar count differs from the piece (the bar-count guide). Decisions 2026-11-03.

export interface PartOff { partId: string; diff: number } // diff: the part's bars less the piece's
export interface PieceImpact { barsAdded: number; barsRemoved: number; partsOff: PartOff[]; timesDropped: number }

function partsOff(doc: EditorDoc): PartOff[] {
  const piece = barsInPiece(doc.timing)
  return doc.pages.flatMap((page) => {
    const diff = partBarCount(page) - piece
    return diff === 0 ? [] : [{ partId: page.partId, diff }]
  })
}

/** The bars an edit adds to or takes from the piece, the parts it leaves off, and the times it drops. */
export function pieceImpact(before: EditorDoc, result: Extract<EditResult, { ok: true }>): PieceImpact {
  const change = barsInPiece(result.doc.timing) - barsInPiece(before.timing)
  return {
    barsAdded: Math.max(0, change),
    barsRemoved: Math.max(0, -change),
    partsOff: partsOff(result.doc),
    timesDropped: result.droppedLocators.length,
  }
}

export type BarCountAdviceKind = 'part-misread' | 'piece-may-be-wrong' | 'single-part'

export interface BarCountAdvice {
  partBars: number
  pieceBars: number
  diff: number
  agreeWithPiece: number // other parts with the piece's count
  agreeWithPart: number // other parts with this part's count
  others: number
  kind: BarCountAdviceKind
}

/**
 * Null when the part has the piece's count. Otherwise the piece may be wrong only when more than half of the other
 * parts have this part's count; then (and only then) the guide offers "Edit piece structure". Else the part was misread
 * and the guide offers the part's own fixes.
 */
export function barCountAdvice(doc: EditorDoc, partId: string): BarCountAdvice | null {
  const page = doc.pages.find((p) => p.partId === partId)
  if (page === undefined) return null
  const pieceBars = barsInPiece(doc.timing)
  const partBars = partBarCount(page)
  if (partBars === pieceBars) return null
  const others = doc.pages.filter((p) => p.partId !== partId).map(partBarCount)
  const agreeWithPiece = others.filter((n) => n === pieceBars).length
  const agreeWithPart = others.filter((n) => n === partBars).length
  const kind: BarCountAdviceKind =
    others.length === 0 ? 'single-part' : agreeWithPart > others.length / 2 ? 'piece-may-be-wrong' : 'part-misread'
  return { partBars, pieceBars, diff: partBars - pieceBars, agreeWithPiece, agreeWithPart, others: others.length, kind }
}
