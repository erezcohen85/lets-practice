import { type SplitProposal } from '@/domain/splitEdits'
import { type Job, type JobKind, type TimingLayer } from '@/domain/types'
import { type DataClient } from '@/lib/dataClient'
import { SentenceError, type NameSuggestion, type ProcessorClient, type SampleClaim } from '@/lib/processorClient'
import { createProcessorHttp } from '@/lib/supabase/processorHttp'
import { strings } from '@/strings'

interface Options {
  baseUrl: string
  /** The signed-in user's access token, or null. */
  token: () => Promise<string | null>
  data: Pick<DataClient, 'storeParts'>
  /** Puts a PDF in the user's staging folder in Storage and gives its id: what a split and a suggested name read it from. */
  stage: (file: File) => Promise<string>
  fetchFn?: typeof fetch
}

/**
 * The processor on Railway. The job routes answer at once with the new job's id; its progress is read from Postgres
 * (DataClient.getJob). The token goes in the Authorization header only: it is never part of an address, a body or a message.
 * A PDF is never sent to the processor: the browser stages it in Storage under its own folder (`stage`), and the processor
 * is told only the staged id.
 */
export function createHttpProcessorClient({ baseUrl, token, data, stage, fetchFn }: Options): ProcessorClient {
  const { post, refusal, splitRefusal } = createProcessorHttp({ baseUrl, token, ...(fetchFn === undefined ? {} : { fetchFn }) })

  async function startJob(pieceId: string, kind: JobKind): Promise<Job> {
    const response = await post(`/jobs/${kind}`, { piece_id: pieceId })
    if (!response.ok) throw await refusal(response)
    const body = (await response.json()) as { job_id: string; status: Job['status'] }
    return { id: body.job_id, pieceId, kind, status: body.status, progress: 0, error: null }
  }

  async function suggestion(response: Response): Promise<NameSuggestion> {
    if (!response.ok) throw await splitRefusal(response)
    return (await response.json()) as NameSuggestion
  }

  async function claim(response: Response): Promise<SampleClaim> {
    if (!response.ok) throw await refusal(response)
    const body = (await response.json().catch(() => null)) as { status?: unknown; piece_id?: unknown } | null
    if (body?.status === 'given' && typeof body.piece_id === 'string' && body.piece_id !== '') return { status: 'given', pieceId: body.piece_id }
    if (body?.status === 'skipped' || body?.status === 'already') return { status: body.status }
    throw new Error('The processor answered with a sample claim it could not read.')
  }

  return {
    processPiece: (pieceId) => startJob(pieceId, 'process-piece'),
    realign: (pieceId) => startJob(pieceId, 'realign'),
    async addParts(pieceId, parts) {
      if (parts.length > 0) await data.storeParts(pieceId, parts)
      return startJob(pieceId, 'add-parts')
    },
    async fillEmptyBars(pieceId, timing) {
      try {
        const response = await post(`/pieces/${pieceId}/fill`, { timing })
        return response.ok ? ((await response.json()) as TimingLayer) : null
      } catch {
        return null
      }
    },
    // No route yet: the file name stands until the job reads the real name.
    readPartName: async () => null,
    async proposeSplit(pdf) {
      const splitId = await stage(pdf)
      const response = await post(`/splits/${splitId}/propose`)
      if (!response.ok) throw await splitRefusal(response)
      return (await response.json()) as SplitProposal
    },
    reprocessPart: () => Promise.reject(new SentenceError(strings.realServices.reprocessOff)),
    async claimSamplePiece() {
      return claim(await post('/sample-piece'))
    },
    async suggestPieceName(pieceId) {
      return suggestion(await post(`/pieces/${pieceId}/suggest-name`))
    },
    async suggestNewPieceName({ recording, firstPart }) {
      // The first PDF is a clue only: one that cannot be staged (too large, not a PDF) leaves the file name to go on.
      const staged = firstPart === null ? null : await stage(firstPart).catch(() => null)
      const recordingName = recording?.kind === 'file' ? recording.file.name : null
      return suggestion(await post('/suggest-name', { recording_name: recordingName, staged_id: staged }))
    },
  }
}
