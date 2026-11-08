import { type DetectedBeat } from '@/domain/beats'
import { readMap, type OldMap } from '@/domain/oldMaps'
import { type SplitProposal } from '@/domain/splitEdits'
import { type JobKind, type JobPart, type JobStatus, type PageLayer, type TimingLayer } from '@/domain/types'
import { type NewPartInput, type NewPieceInput, type SplitUpload } from '@/lib/dataClient'
import { SentenceError, type NameSuggestion, type NewPieceClues } from '@/lib/processorClient'

// The calls to the local run server (backend/processor/spikes/local_server.py), which serves run folders made by
// run_piece.py, writes the editor's saves back to them and, started with the real tools, takes uploads and runs the
// pipeline on them. Local mode only; nothing here is stored in the browser.

export interface RunSummary {
  id: string
  title: string
  folder: string
  parts: Array<{ id: string; name: string }>
  /** Only for a piece with no finished run yet (being processed, failed, or stopped by a restart of the server): where its job is. */
  pending?: PendingRun
}

/** A piece the server lists before its run is finished. `jobId` is null when this server has no job for it (it was restarted, or nothing ever started): then `status` is already 'error' and `error` says why. */
export interface PendingRun {
  createdAt: string
  recordingName: string | null
  jobId: string | null
  status: JobStatus
  progress: number
  stage: string
  error: string | null
  parts: JobPart[]
}

/** The map as the editor keeps it, and as the server saves it in map.confirmed.json. */
/** structureSetAt: kept by the server through every save that does not send it (task 8.18). */
export interface RunMap { timing: TimingLayer; pages: Record<string, PageLayer>; structureSetAt?: string | null }

/** A run as GET /runs/{id} gives it: local-run.json with the confirmed map in place of the pipeline's when there is one. */
export interface RunDocument extends RunMap {
  piece: { id: string; title: string; createdAt: string; countInBars: 0 | 1 | 2 | 3 | 4; durationSec: number }
  /** 'youtube' only in a run made before the music rule (Decision 2026-11-06); it still reads. */
  recording: { kind: 'file'; name: string } | { kind: 'youtube'; url: string }
  /** What the recording is called (the user's name, the uploaded file's name without its extension, the video's title); null or missing before it has one. */
  recordingName?: string | null
  /** The stored recording, relative to the run folder. */
  audio: string
  /** 40 per second, 0..127. */
  peaks: number[]
  /** The beats the beat tracker found, in time order; missing in a run made before they were kept. */
  beats?: DetectedBeat[]
  parts: Array<{ id: string; name: string; nameSource?: 'read' | 'user' | 'file'; position: number; pageCount: number }>
  pageImages: Record<string, Array<{ pageIndex: number; width: number; height: number; file: string }>>
  confirmedAt: string | null
  /** The run has what a re-align needs (alignment and activations). */
  canRealign: boolean
}

/** A part the server has saved for an upload: the id and position it will have in the run. */
export interface UploadedPart { id: string; name: string; position: number }
/** A job as GET /jobs/{id} gives it (progress 0..1, as the orchestrator writes it). */
export interface ServerJob { id: string; runId: string; kind: JobKind; status: JobStatus; progress: number; stage: string; error: string | null; parts?: JobPart[] }

/** The names to save: parts by id, the recording and the piece's title; any may be left out. */
export interface RunNames { parts?: Record<string, string>; recording?: string; title?: string }

export interface RunApi {
  listRuns(): Promise<RunSummary[]>
  getRun(runId: string): Promise<RunDocument>
  /** Saves the whole map; rejects with the server's sentence when it refuses it. */
  putMap(runId: string, map: RunMap): Promise<void>
  /** Saves renames in the run folder (names.json); rejects with the server's sentence when it refuses one. */
  putNames(runId: string, names: RunNames): Promise<void>
  /** Refits the unconfirmed locators of `timing` (the one the editor shows now); the server does not save the result. */
  realign(runId: string, timing: TimingLayer): Promise<TimingLayer>
  /** Gives the bars of `timing` that have no locator a time, leaving every locator that is there as it is; rejects with the server's sentence when they cannot be fitted. Not saved by the server. */
  fill(runId: string, timing: TimingLayer): Promise<TimingLayer>
  /** Deletes a part's files for good (the server refuses the last part, and a piece that is being prepared). */
  deletePart(runId: string, partId: string): Promise<void>
  /** Deletes a piece: the server moves its folder to .deleted/ (it refuses a piece that is being prepared). */
  deletePiece(runId: string): Promise<void>
  /** Asks the server for a title for a piece it has. */
  suggestName(runId: string): Promise<NameSuggestion>
  /** The same for a form that has not been uploaded: the link, the audio file's name and the first PDF are sent. */
  suggestNewName(clues: NewPieceClues): Promise<NameSuggestion>
  /** Has the server read the page headers of one PDF that holds several parts; the thumbs of the answer are full addresses. Rejects with the server's sentence. */
  proposeSplit(pdf: File): Promise<SplitProposal>
  /** Sends a new piece (the recording or the link, and every part's PDF, or the parts cut from a PDF `proposeSplit` read) and starts the pipeline on it. */
  uploadPiece(input: NewPieceInput): Promise<{ runId: string; jobId: string; parts: UploadedPart[] }>
  /** Sends new parts for a piece (files, or a split) and starts the add-parts job; with neither it starts the job again. */
  uploadParts(runId: string, parts: NewPartInput[], split?: SplitUpload): Promise<{ jobId: string; parts: UploadedPart[] }>
  /** Reads one part again from its PDF (the answer has the shape of an add-parts start); `boxCheck` is the Advanced tick. Rejects with the server's sentence (busy, PDF not in the folder). */
  reprocessPart(runId: string, partId: string, boxCheck: boolean): Promise<{ jobId: string; parts: UploadedPart[] }>
  /** Starts the pipeline again on a piece whose first run failed. */
  processAgain(runId: string): Promise<{ jobId: string }>
  getJob(jobId: string): Promise<ServerJob>
  /** The URL of a file of the run (a page image, the audio). */
  fileUrl(runId: string, path: string): string
}

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>

/** The server's one-sentence reason from a failed answer, or the status line when it gave none. */
async function failure(response: Response): Promise<Error> {
  try {
    const body: unknown = await response.json()
    if (typeof body === 'object' && body !== null && 'detail' in body && typeof body.detail === 'string') {
      return new SentenceError(body.detail)
    }
  } catch {
    // not JSON: fall through to the status line
  }
  return new SentenceError(`The local run server answered ${response.status}.`)
}

export function createRunApi(baseUrl: string, fetchFn: FetchFn = (input, init) => fetch(input, init)): RunApi {
  const base = baseUrl.replace(/\/+$/, '')
  const runUrl = (runId: string) => `${base}/runs/${encodeURIComponent(runId)}`

  async function call<T>(url: string, init?: RequestInit): Promise<T> {
    let response: Response
    try {
      response = await fetchFn(url, init)
    } catch {
      throw new SentenceError(`The local run server at ${base} did not answer. Is it running?`)
    }
    if (!response.ok) throw await failure(response)
    return (await response.json()) as T
  }

  const json = (method: string, body?: unknown): RequestInit => ({
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  /** A form with the names and the PDFs of the parts, in the order given; or the staged split and the ranges to keep (never both). */
  /** One boxCheck field per part, "1" or "0", in the order of the parts; none at all when no part is ticked (the server reads that as all off). */
  function appendBoxChecks(form: FormData, ticks: boolean[]) {
    if (ticks.some(Boolean)) for (const tick of ticks) form.append('boxCheck', tick ? '1' : '0')
  }

  function partsForm(parts: NewPartInput[], split?: SplitUpload): FormData {
    const form = new FormData()
    if (split !== undefined) {
      form.append('splitId', split.splitId)
      form.append('split', JSON.stringify(split.parts))
      appendBoxChecks(form, split.parts.map((_, index) => split.boxChecks?.[index] === true))
      return form
    }
    for (const part of parts) {
      form.append('names', part.name)
      form.append('parts', part.file, part.file.name)
    }
    appendBoxChecks(
      form,
      parts.map((part) => part.boxCheck === true),
    )
    return form
  }
  const post = (form: FormData): RequestInit => ({ method: 'POST', body: form })

  return {
    listRuns: () => call<RunSummary[]>(`${base}/runs`),
    async getRun(runId) {
      // A run folder made before rests belonged to a part still has them in its timing: read the map in today's shape.
      const run = await call<RunDocument | (Omit<RunDocument, keyof RunMap> & OldMap)>(runUrl(runId))
      return { ...run, ...readMap(run) }
    },
    async putMap(runId, map) {
      await call(`${runUrl(runId)}/map`, json('PUT', map))
    },
    async putNames(runId, names) {
      await call(`${runUrl(runId)}/names`, json('PUT', names))
    },
    async deletePart(runId, partId) {
      await call(`${runUrl(runId)}/parts/${encodeURIComponent(partId)}`, { method: 'DELETE' })
    },
    async deletePiece(runId) {
      await call(runUrl(runId), { method: 'DELETE' })
    },
    suggestName: (runId) => call<NameSuggestion>(`${runUrl(runId)}/suggest-name`, { method: 'POST' }),
    suggestNewName({ recording, firstPart }) {
      // Only the audio file's name goes, never the recording; the first PDF goes for the top of its page.
      const form = new FormData()
      if (recording !== null) form.append('recordingName', recording.file.name)
      if (firstPart !== null) form.append('part', firstPart, firstPart.name)
      return call<NameSuggestion>(`${base}/suggest-name`, post(form))
    },
    async proposeSplit(pdf) {
      const form = new FormData()
      form.append('pdf', pdf, pdf.name)
      const proposal = await call<SplitProposal>(`${base}/split`, post(form))
      // The server gives a path on itself; the browser needs the whole address.
      return { ...proposal, pages: proposal.pages.map((page) => ({ ...page, thumb: page.thumb.startsWith('/') ? `${base}${page.thumb}` : page.thumb })) }
    },
    realign: (runId, timing) => call<TimingLayer>(`${runUrl(runId)}/realign`, json('POST', { timing })),
    fill: (runId, timing) => call<TimingLayer>(`${runUrl(runId)}/realign`, json('POST', { timing, mode: 'fill' })),
    uploadPiece(input) {
      const form = partsForm(input.parts, input.split)
      form.append('title', input.title)
      form.append('recording', input.recording.file, input.recording.file.name)
      return call(`${base}/runs`, post(form))
    },
    uploadParts: (runId, parts, split) => call(`${runUrl(runId)}/parts`, post(partsForm(parts, split))),
    reprocessPart: (runId, partId, boxCheck) => call(`${runUrl(runId)}/parts/${encodeURIComponent(partId)}/reprocess`, json('POST', { boxCheck })),
    processAgain: (runId) => call(`${runUrl(runId)}/process`, { method: 'POST' }),
    getJob: (jobId) => call<ServerJob>(`${base}/jobs/${encodeURIComponent(jobId)}`),
    fileUrl: (runId, path) => `${runUrl(runId)}/files/${path.split('/').map(encodeURIComponent).join('/')}`,
  }
}
