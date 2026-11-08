import { type Job } from '@/domain/types'

export type PieceState = 'processing' | 'failed' | 'needs-review' | 'ready'

interface ReviewCount { checked: number; total: number }

/**
 * queued/running job → processing; a first read (process-piece) that ended in an error → failed; no job and no page read in
 * any part → failed (the piece was saved and its reading never started: the hub then offers to start it); else needs-review
 * while checked < total; else ready. A realign or add-parts job that ended in an error is not "failed": the piece keeps the
 * map it had and stays practisable and editable, as for a member (Decisions 2026-11-04); the hub says what went wrong.
 * `pageCount` is the pages read over all its parts, so an imported piece with pages and no job stays ready.
 */
export function pieceState(job: Job | null, review: ReviewCount, pageCount: number): PieceState {
  if (job !== null) {
    if (job.status === 'queued' || job.status === 'running') return 'processing'
    if (job.status === 'error' && job.kind === 'process-piece') return 'failed'
  } else if (pageCount === 0) {
    return 'failed'
  }
  return review.checked < review.total ? 'needs-review' : 'ready'
}

/** The pages read over all the parts of a piece's detail. */
export function pagesOf(detail: { parts: ReadonlyArray<{ pageCount: number }> }): number {
  return detail.parts.reduce((sum, part) => sum + part.pageCount, 0)
}

/**
 * Whether a member's piece is still "Being prepared": only the first read (process-piece) that has not finished well.
 * A realign or add-parts job that runs or fails leaves the piece practisable, so the owner's failed realign never locks
 * members out of a good map.
 */
export function memberPreparing(job: Job | null): boolean {
  return job?.kind === 'process-piece' && job.status !== 'done'
}

/** 271 → "4:31", 3600 → "60:00", null → "" (minutes are never wrapped into hours). */
export function formatDuration(sec: number | null): string {
  if (sec === null || !Number.isFinite(sec)) return ''
  const total = Math.max(0, Math.round(sec))
  const seconds = total % 60
  return `${Math.floor(total / 60)}:${String(seconds).padStart(2, '0')}`
}

/** Lower case with the accents taken off, so "Étude" and "etude" compare equal. */
function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

/** Case- and accent-insensitive title match on trimmed words; an empty query matches all. */
export function matchesQuery(title: string, query: string): boolean {
  const words = fold(query).split(/\s+/).filter((word) => word !== '')
  const folded = fold(title)
  return words.every((word) => folded.includes(word))
}

/** The states a library filter can ask for; null shows every piece, including one still processing or failed. */
export type StateFilter = 'needs-review' | 'ready' | null

export function filterPieces<T extends { title: string; job: Job | null; review: ReviewCount; pageCount: number }>(
  pieces: T[],
  options: { query: string; state: StateFilter },
): T[] {
  return pieces.filter(
    (piece) =>
      matchesQuery(piece.title, options.query) &&
      (options.state === null || pieceState(piece.job, piece.review, piece.pageCount) === options.state),
  )
}
