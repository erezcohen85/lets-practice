import { SPLIT_EXPIRED, type SplitPage, type SplitProposal } from '@/domain/splitEdits'
import { MAX_PART_NAME } from '@/domain/names'
import { type SplitUpload } from '@/lib/dataClient'
import { nextId, partsOf, type FakeStore, type StoredPart } from '@/lib/fakes/store'
import { SentenceError } from '@/lib/processorClient'

// The fakes' stand-in for the processor's POST /split and for the checks its upload makes on a split (the sentences are
// the processor's own). A staged split lives in the store until an upload has used it.

const FAKE_PAGE_COUNT = 6
const FAKE_PARTS = [
  { name: 'Flute', fromPage: 1, toPage: 2 },
  { name: 'Oboe', fromPage: 3, toPage: 3 },
  { name: 'Clarinet in B♭', fromPage: 4, toPage: 6 },
]
const FULL_SCORE_SENTENCE = 'Full scores (all parts on one page) are not supported yet: upload the parts.'

/**
 * A page picture: a pale sheet with five staff lines and the page number, as a data URL (no network, no files). It is
 * 640 px wide like the processor's pictures, which stay sharp at the 320 px of the hover preview on a retina screen.
 */
function placeholderThumb(page: number): string {
  const lines = [0, 1, 2, 3, 4].map((line) => `<line x1="14" x2="86" y1="${46 + line * 7}" y2="${46 + line * 7}" stroke="gray" stroke-width="1"/>`).join('')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="832" viewBox="0 0 100 130"><rect width="100" height="130" fill="whitesmoke"/>${lines}<text x="50" y="108" font-family="sans-serif" font-size="16" text-anchor="middle" fill="dimgray">${page}</text></svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

/** What the processor would answer for a PDF: three parts over six pages; a file named "fullscore" is a full score, one named "unreadable" has no readable headers. */
export function fakeProposal(store: FakeStore, pdf: File): SplitProposal {
  if (!/\.pdf$/i.test(pdf.name)) throw new SentenceError('This file is not a PDF.')
  const fullScore = pdf.name.toLowerCase().includes('fullscore')
  const unreadable = pdf.name.toLowerCase().includes('unreadable')
  const parts = unreadable ? [{ name: 'Part 1', fromPage: 1, toPage: FAKE_PAGE_COUNT }] : FAKE_PARTS.map((part) => ({ ...part }))
  const pages: SplitPage[] = Array.from({ length: FAKE_PAGE_COUNT }, (_, index) => {
    const page = index + 1
    const owner = parts.find((part) => page >= part.fromPage && page <= part.toPage)
    return { page, partName: unreadable || owner?.fromPage !== page ? null : owner.name, printedPage: page, fullScore, thumb: placeholderThumb(page) }
  })
  const splitId = nextId(store, 'split')
  store.splits.set(splitId, { pageCount: FAKE_PAGE_COUNT, fullScore, fileName: pdf.name })
  return {
    splitId,
    pageCount: FAKE_PAGE_COUNT,
    fullScore,
    parts,
    pages,
    note: unreadable ? 'The page headers could not be read, so the pages are one part: split them by hand.' : null,
  }
}

/** The processor's checks on the ranges of an upload, in its order. A refused split stays staged, so the user can fix it and send again. */
export function requireSplit(store: FakeStore, split: SplitUpload): void {
  const staged = store.splits.get(split.splitId)
  if (staged === undefined) throw new SentenceError(SPLIT_EXPIRED)
  if (staged.fullScore) throw new SentenceError(FULL_SCORE_SENTENCE)
  const ranges = split.parts
  if (ranges.length === 0) throw new SentenceError('Keep at least one part.')
  for (const range of ranges) {
    const name = range.name.trim()
    if (name === '' || name.length > MAX_PART_NAME) throw new SentenceError('Every part needs a name of 1 to 80 characters.')
  }
  for (const range of ranges) {
    if (range.fromPage < 1 || range.toPage > staged.pageCount || range.toPage < range.fromPage) {
      throw new SentenceError(`The pages ${range.fromPage} to ${range.toPage} are not inside this PDF of ${staged.pageCount} pages.`)
    }
  }
  for (const range of ranges) {
    const skipped = new Set(range.skipPages)
    if ([...skipped].some((page) => !Number.isInteger(page) || page < range.fromPage || page > range.toPage)) {
      throw new SentenceError(`The skipped pages must be inside the part's pages (${range.fromPage} to ${range.toPage}).`)
    }
    if (skipped.size >= range.toPage - range.fromPage + 1) throw new SentenceError('A part needs at least one page that is not skipped.')
  }
  ranges.forEach((range, index) => {
    if (index > 0 && range.fromPage <= ranges[index - 1].toPage) throw new SentenceError('The parts must be in page order and must not overlap.')
  })
}

/** An upload that went through has used its staged split up. */
function consumeSplit(store: FakeStore, split: SplitUpload): void {
  store.splits.delete(split.splitId)
}

/** Stores a part row per kept range after the piece's own (what the data client does with a split); all point to the one PDF. */
export function addStoredSplitParts(store: FakeStore, pieceId: string, split: SplitUpload): StoredPart[] {
  const first = partsOf(store, pieceId).length
  const stored = split.parts.map((range, index): StoredPart => {
    const id = nextId(store, 'part')
    const part: StoredPart = { id, pieceId, name: range.name.trim(), position: first + index, file: { name: split.fileName, size: 0 }, pageCount: 0, ...(split.boxChecks?.[index] === true ? { boxCheck: true } : {}) }
    store.parts.set(id, part)
    return part
  })
  consumeSplit(store, split)
  return stored
}
