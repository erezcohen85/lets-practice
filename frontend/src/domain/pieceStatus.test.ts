import { filterPieces, formatDuration, matchesQuery, memberPreparing, pieceState } from '@/domain/pieceStatus'
import { type Job } from '@/domain/types'

function job(status: Job['status'], progress = 0, kind: Job['kind'] = 'process-piece'): Job {
  return {
    id: 'job-1',
    pieceId: 'piece-1',
    kind,
    status,
    progress,
    error: status === 'error' ? 'omr failed: fake failure' : null,
  }
}

const SOME_TO_CHECK = { checked: 3, total: 12 }
const ALL_CHECKED = { checked: 12, total: 12 }
const READ = 8 // pages read over the parts


describe('pieceState', () => {
  it('is processing while the job is queued', () => {
    expect(pieceState(job('queued'), SOME_TO_CHECK, READ)).toBe('processing')
  })

  it('is processing while the job is running', () => {
    expect(pieceState(job('running', 0.55), ALL_CHECKED, READ)).toBe('processing')
  })

  it('is failed when the job ended in an error', () => {
    expect(pieceState(job('error', 0.35), SOME_TO_CHECK, READ)).toBe('failed')
  })

  it.each(['realign', 'add-parts'] as const)('does not call a piece failed because its %s job ended in an error: the map it had is still good', (kind) => {
    expect(pieceState(job('error', 0.35, kind), SOME_TO_CHECK, READ)).toBe('needs-review')
    expect(pieceState(job('error', 0.35, kind), ALL_CHECKED, READ)).toBe('ready')
  })

  it('needs review when the job is done and bars are left to check', () => {
    expect(pieceState(job('done', 1), SOME_TO_CHECK, READ)).toBe('needs-review')
  })

  it('is ready when the job is done and every bar is checked', () => {
    expect(pieceState(job('done', 1), ALL_CHECKED, READ)).toBe('ready')
  })

  it('is ready with no job and nothing to review', () => {
    expect(pieceState(null, { checked: 0, total: 0 }, READ)).toBe('ready')
  })

  it('is failed with no job and no page read: the piece was saved and never started', () => {
    expect(pieceState(null, { checked: 0, total: 0 }, 0)).toBe('failed')
  })

  it('stays ready for an imported piece, which has pages and no job', () => {
    expect(pieceState(null, { checked: 12, total: 12 }, 3)).toBe('ready')
    expect(pieceState(null, { checked: 0, total: 0 }, 3)).toBe('ready')
  })

  it('does not call a piece with a finished job unstarted, whatever its pages', () => {
    expect(pieceState(job('done', 1), ALL_CHECKED, 0)).toBe('ready')
  })

  it('needs review with no job but bars to check', () => {
    expect(pieceState(null, { checked: 0, total: 5 }, READ)).toBe('needs-review')
  })
})

describe('formatDuration', () => {
  it.each([
    [0, '0:00'],
    [59, '0:59'],
    [60, '1:00'],
    [271, '4:31'],
    [3600, '60:00'],
  ])('writes %s seconds as %s', (sec, text) => {
    expect(formatDuration(sec)).toBe(text)
  })

  it('is empty when the duration is not known', () => {
    expect(formatDuration(null)).toBe('')
  })

  it('rounds to the nearest second', () => {
    expect(formatDuration(271.4)).toBe('4:31')
    expect(formatDuration(271.6)).toBe('4:32')
    expect(formatDuration(59.6)).toBe('1:00')
  })
})

describe('matchesQuery', () => {
  it('matches everything on an empty or blank query', () => {
    expect(matchesQuery('Concert March', '')).toBe(true)
    expect(matchesQuery('Concert March', '   ')).toBe(true)
  })

  it('ignores case', () => {
    expect(matchesQuery('Concert March', 'CONCERT')).toBe(true)
    expect(matchesQuery('concert march', 'March')).toBe(true)
  })

  it('ignores accents in both directions', () => {
    expect(matchesQuery('Étude No. 4', 'Etude')).toBe(true)
    expect(matchesQuery('Etude No. 4', 'étude')).toBe(true)
  })

  it('matches part of a word', () => {
    expect(matchesQuery('Clark County Celebration', 'celeb')).toBe(true)
  })

  it('ignores extra spaces around and between the words', () => {
    expect(matchesQuery('Slow Waltz in G', '  slow   waltz  ')).toBe(true)
    expect(matchesQuery('Slow   Waltz in G', 'slow waltz')).toBe(true)
  })

  it('needs every word of the query to be in the title', () => {
    expect(matchesQuery('Slow Waltz in G', 'slow march')).toBe(false)
    expect(matchesQuery('Slow Waltz in G', 'jazz')).toBe(false)
  })
})

describe('filterPieces', () => {
  const pieces = [
    { title: 'Clark County Celebration', job: job('done', 1), review: { checked: 7, total: 12 }, pageCount: 8 },
    { title: 'Concert March', job: job('done', 1), review: { checked: 9, total: 9 }, pageCount: 8 },
    { title: 'Slow Waltz in G', job: job('running', 0.55), review: { checked: 0, total: 0 }, pageCount: 8 },
    { title: 'Étude No. 4', job: job('done', 1), review: { checked: 6, total: 6 }, pageCount: 8 },
    { title: 'Jazz Combo Chart', job: job('done', 1), review: { checked: 0, total: 9 }, pageCount: 8 },
  ]

  it('returns every piece, in order, for an empty query and no filter', () => {
    const result = filterPieces(pieces, { query: '', state: null })

    expect(result.map((piece) => piece.title)).toEqual(pieces.map((piece) => piece.title))
  })

  it('narrows by the query', () => {
    const result = filterPieces(pieces, { query: 'etude', state: null })

    expect(result.map((piece) => piece.title)).toEqual(['Étude No. 4'])
  })

  it('keeps only the pieces that need review', () => {
    const result = filterPieces(pieces, { query: '', state: 'needs-review' })

    expect(result.map((piece) => piece.title)).toEqual(['Clark County Celebration', 'Jazz Combo Chart'])
  })

  it('keeps only the pieces that are ready to practice', () => {
    const result = filterPieces(pieces, { query: '', state: 'ready' })

    expect(result.map((piece) => piece.title)).toEqual(['Concert March', 'Étude No. 4'])
  })

  it('never shows a piece that is still processing under a state filter, and shows it with none', () => {
    expect(filterPieces(pieces, { query: '', state: 'ready' }).map((piece) => piece.title)).not.toContain('Slow Waltz in G')
    expect(filterPieces(pieces, { query: '', state: 'needs-review' }).map((piece) => piece.title)).not.toContain('Slow Waltz in G')
    expect(filterPieces(pieces, { query: '', state: null }).map((piece) => piece.title)).toContain('Slow Waltz in G')
  })

  it('applies the query and the review filter together', () => {
    const result = filterPieces(pieces, { query: 'jazz', state: 'needs-review' })
    const none = filterPieces(pieces, { query: 'march', state: 'needs-review' })

    expect(result.map((piece) => piece.title)).toEqual(['Jazz Combo Chart'])
    expect(none).toEqual([])
  })

  it('does not change the list it is given', () => {
    const copy = [...pieces]

    filterPieces(pieces, { query: 'jazz', state: 'needs-review' })

    expect(pieces).toEqual(copy)
  })
})

describe('memberPreparing', () => {
  const ofKind = (kind: Job['kind'], status: Job['status']): Job => ({ ...job(status), kind })

  it('is true while the first read is queued, running or failed', () => {
    expect(memberPreparing(ofKind('process-piece', 'queued'))).toBe(true)
    expect(memberPreparing(ofKind('process-piece', 'running'))).toBe(true)
    expect(memberPreparing(ofKind('process-piece', 'error'))).toBe(true)
  })

  it('is false once the first read is done, and with no job', () => {
    expect(memberPreparing(ofKind('process-piece', 'done'))).toBe(false)
    expect(memberPreparing(null)).toBe(false)
  })

  it('is false for a realign or add-parts job in any state: the piece stays practisable', () => {
    for (const kind of ['realign', 'add-parts'] as const) {
      for (const status of ['queued', 'running', 'done', 'error'] as const) {
        expect(memberPreparing(ofKind(kind, status))).toBe(false)
      }
    }
  })
})
