import { matchesQuery } from '@/domain/pieceStatus'

interface SharedPiece { title: string; ownerName: string | null; joinedAt: string | null }

/** The owner filter chips of "Shared with me": one name per owner, sorted; none until two or more owners share. "All" is the page's own. */
export function ownerChips(pieces: readonly SharedPiece[]): string[] {
  const names = [...new Set(pieces.flatMap((piece) => (piece.ownerName === null ? [] : [piece.ownerName])))].sort((a, b) => a.localeCompare(b))
  return names.length >= 2 ? names : []
}

/** "Shared with me" newest join first, narrowed by the search and the chosen owner (null: all). */
export function filterShared<T extends SharedPiece>(pieces: readonly T[], options: { query: string; owner: string | null }): T[] {
  return pieces
    .filter((piece) => (options.owner === null || piece.ownerName === options.owner) && matchesQuery(piece.title, options.query))
    .sort((a, b) => (b.joinedAt ?? '').localeCompare(a.joinedAt ?? ''))
}
