import { type NewPartInput, type RecordingInput } from '@/lib/dataClient'
import { type LimitKey } from '@/domain/planLimits'
import { type SplitProposal } from '@/domain/splitEdits'
import { type Job, type TimingLayer } from '@/domain/types'

/**
 * A suggested piece title ("Title (Composer)", or the title alone). `source` says whether the AI made it or the fallback
 * did (the tidied file name), and `note` is the sentence that says why when it was the fallback. An
 * empty `name` means there was nothing to suggest from.
 */
export interface NameSuggestion { name: string; source: 'claude' | 'fallback'; note: string | null }

/** What a piece that has not been uploaded yet can tell: its recording as chosen in the form, and its first PDF. */
export interface NewPieceClues { recording: RecordingInput | null; firstPart: File | null }

/**
 * The calls to the processor service (Railway; the in-memory fake in src/lib/fakes in tests).
 * Every method rejects with Error('not signed in') without a signed-in user.
 */
export interface ProcessorClient {
  processPiece(pieceId: string): Promise<Job>
  realign(pieceId: string): Promise<Job>
  /**
   * Times for the play slots of `timing` that have no locator (a structure edit left them empty), answered as `timing` with a
   * locator added for each; the locators that are there come back as they are. Aligns only those slots, held between the
   * locators beside them. Resolves with null when they cannot be fitted (the bars stay empty). Saves nothing.
   */
  fillEmptyBars(pieceId: string, timing: TimingLayer): Promise<TimingLayer | null>
  /**
   * Adds parts to a piece that has a map: stores their files (through the DataClient, as createPiece does) and starts an
   * 'add-parts' job that gives each part without pages its page images and bar boxes, for the piece's existing bar count;
   * the shared timing is not touched. With no new files it starts the job again for the parts still without pages
   * (what Try again does after a failed job).
   */
  addParts(pieceId: string, parts: NewPartInput[]): Promise<Job>
  /**
   * Reads one part again from its PDF, for a part that came out wrong: its pages, bar boxes and edits are replaced; the
   * other parts, the recording and the shared timing are not touched, and the part keeps its id, name and place. Starts an
   * 'add-parts' job for it (so the Processing screen follows it as it follows an add). `boxCheck` is the Advanced tick.
   * Rejects with a SentenceError when the processor refuses (busy, PDF missing).
   */
  reprocessPart(pieceId: string, partId: string, options: { boxCheck: boolean }): Promise<Job>
  /** The part name the vision read finds in the PDF's header (UX Spec 1.4), or null if it cannot read one. */
  readPartName(pdf: File): Promise<string | null>
  /**
   * Has the processor read the page headers of one PDF that holds several parts (one after another) and propose where each
   * starts, with a small picture of every page. The PDF stays with the processor under `splitId`: the upload then names the
   * parts to keep (NewPieceInput.split, storeParts) instead of sending part files. Rejects with a SentenceError for a PDF it
   * cannot read.
   */
  proposeSplit(pdf: File): Promise<SplitProposal>
  /** Asks for a title for a piece that exists (Decision 2026-11-01, "Suggest a name"): one AI call, a fallback without it. */
  suggestPieceName(pieceId: string): Promise<NameSuggestion>
  /** The same for the New piece form, before anything is uploaded. */
  suggestNewPieceName(clues: NewPieceClues): Promise<NameSuggestion>
  /**
   * Asks for the account's copy of the sample piece (migration 0016, POST /sample-piece). It is made once per account: 'given'
   * carries the new piece's id, 'skipped' means there was no room in the plan (or no master piece) and none is made, and
   * 'already' means the account has had its answer before, so the library asks once and never again. Rejects with a
   * SampleFailedError when the copy failed and the next load may try again.
   */
  claimSamplePiece(): Promise<SampleClaim>
}

export type SampleClaim = { status: 'given'; pieceId: string } | { status: 'skipped' } | { status: 'already' }

/**
 * Starts a failed job again, as the same kind: adding parts runs the add-parts job again for the parts still without pages,
 * and a realign refits the unconfirmed bars again. Only a failed first read starts the whole piece over; reading it again
 * after a realign would replace the boxes and structure the user has checked.
 */
export function retryJob(processor: ProcessorClient, job: Job): Promise<Job> {
  if (job.kind === 'add-parts') return processor.addParts(job.pieceId, [])
  if (job.kind === 'realign') return processor.realign(job.pieceId)
  return processor.processPiece(job.pieceId)
}

/**
 * An error whose message is one plain sentence a user can read (a refusal of the local server, such as "The recording is
 * longer than 20 minutes."). Pages that show a generic failure text show this sentence instead.
 */
export class SentenceError extends Error {}

/** The sentence of a SentenceError, or null for any other error. */
export function sentenceOf(error: unknown): string | null {
  return error instanceof SentenceError ? error.message : null
}

/**
 * A refusal by the user's plan (migration 0015 and the processor): `limit` is the key of the limit that was hit. The prompt
 * "Not in your plan" (lib/plan.tsx) turns it into a sentence; a message is kept for logs only.
 */
export class PlanLimitError extends Error {
  readonly limit: LimitKey
  constructor(limit: LimitKey) {
    super(`plan_limit:${limit}`)
    this.name = 'PlanLimitError'
    this.limit = limit
  }
}

/** The processor could not copy the sample piece's files (503, code sample_failed). The account stays without an answer, so the next library load tries again; the library shows without it. */
export class SampleFailedError extends Error {
  constructor() {
    super('sample_failed')
    this.name = 'SampleFailedError'
  }
}
