import { type SplitProposal, type SplitRange } from '@/domain/splitEdits'
import { type TimingLayer } from '@/domain/types'
import { partNameFromFile } from '@/domain/newPiece'
import { type FetchFn, type PendingRun, type RunDocument, type RunMap, type RunNames, type RunSummary, type ServerJob } from '@/lib/localRun/runApi'

// An in-memory stand-in for the local run server, as a fetch function: tests use it so nothing touches the network.
// It keeps what was saved, so a second client on the same server sees the map a first one saved (a reload).
// Uploads make a job that a test moves on by hand (`jobs`, `finish`): the pipeline itself is not here.

export interface RecordedRequest { method: string; path: string; body: unknown }

/** What an upload sent, read back from its form. */
export interface RecordedUpload {
  path: string
  title: string | null
  recordingName: string | null
  partNames: string[]
  partFiles: string[]
  /** The boxCheck fields, "1" or "0" each; present only when the form had any. */
  partBoxChecks?: string[]
  /** Present only for an upload made from a split. */
  splitId?: string
  split?: SplitRange[]
}

export interface FakeRunServer {
  fetch: FetchFn
  requests: RecordedRequest[]
  /** The most PUTs that were running at the same time. */
  maxPutsInFlight: number
  /** Runs before each PUT answers; make it throw or wait to fail or delay a save. */
  onPut: (map: RunMap) => Promise<void>
  /** What the next POST .../realign answers: a timing, or a refusal with the server's sentence. */
  realignAnswer: TimingLayer | { error: string }
  /** The timing each POST .../realign was sent, in order. */
  realignSent: TimingLayer[]
  /** The mode (`"realign"` when the body has none) each POST .../realign was sent, in order. */
  realignModes: string[]
  /** The map the server holds for a run (the last one saved, else the pipeline's). */
  mapOf(runId: string): RunMap
  /** Every upload (POST /runs, .../parts), in order. */
  uploads: RecordedUpload[]
  /** The jobs the uploads started, by id; change `status`, `progress` and `error` to move one on. */
  jobs: Map<string, ServerJob>
  /** The sentence the next upload is refused with (status 400), or null. */
  refuseUpload: string | null
  /** What POST /split answers (thumbs as paths on the server, as the real one gives them). */
  splitProposal: SplitProposal
  /** The sentence the next POST /split is refused with (status 400), or null. */
  refuseSplit: string | null
  /** The sentence the next rename is refused with (status 400), or null. */
  refuseNames: string | null
  /** The part ids each DELETE .../parts/{id} was sent, in order. */
  deleted: string[]
  /** The sentence the next delete is refused with (status 400), or null. */
  refuseDelete: string | null
  /** The piece ids each DELETE /runs/{id} was sent, in order. */
  deletedPieces: string[]
  /** The sentence the next piece delete is refused with (status 409), or null. */
  refuseDeletePiece: string | null
  /** The reprocess requests (POST .../parts/{id}/reprocess), in order, with the box check each carried. */
  reprocesses: Array<{ runId: string; partId: string; boxCheck: boolean }>
  /** The refusal the next reprocess gets (its status and sentence), or null. */
  refuseReprocess: { status: number; detail: string } | null
  /** What the next suggest-name answers (either route). */
  suggestion: { name: string; source: 'claude' | 'fallback'; note: string | null }
  /** The suggest-name requests, in order: the run id (null for a form) and the fields of the form sent. */
  suggestRequests: Array<{ runId: string | null; fields: Record<string, string> }>
  /** The pieces listed with no finished run (by piece id): what GET /runs gives for a folder still being processed, failed, or stopped by a restart. `finish` takes a piece out of it. */
  pending: Map<string, RunSummary>
  /** Adds a piece with no finished run to the list; its parts are listed as waiting. */
  addPending(id: string, title: string, partNames: string[], state?: Partial<PendingRun>): RunSummary
  /** Ends a job as done and puts `run` in the list, as the pipeline does when it has written the run. */
  finish(jobId: string, run: RunDocument): void
}

function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'part'

export function createFakeRunServer(documents: RunDocument[]): FakeRunServer {
  const runs = new Map(documents.map((document) => [document.piece.id, structuredClone(document)]))
  let inFlight = 0
  let jobCount = 0
  const pieceIds = new Set(runs.keys())

  function startJob(runId: string, kind: ServerJob['kind']): ServerJob {
    jobCount += 1
    const job: ServerJob = { id: `job-${jobCount}`, runId, kind, status: 'queued', progress: 0, stage: 'queued', error: null }
    server.jobs.set(job.id, job)
    return job
  }

  async function upload(path: string, runId: string | null, form: FormData): Promise<Response> {
    const names = form.getAll('names').map(String)
    const files = form.getAll('parts').filter((entry): entry is File => entry instanceof File)
    const recording = form.get('recording')
    const splitId = form.get('splitId')
    const boxChecks = form.getAll('boxCheck').map(String)
    const ranges: SplitRange[] | null = typeof form.get('split') === 'string' ? (JSON.parse(String(form.get('split'))) as SplitRange[]) : null
    server.uploads.push({
      path,
      title: typeof form.get('title') === 'string' ? String(form.get('title')) : null,
      recordingName: recording instanceof File ? recording.name : null,
      partNames: names,
      partFiles: files.map((file) => file.name),
      ...(typeof splitId === 'string' && ranges !== null ? { splitId, split: ranges } : {}),
      ...(boxChecks.length === 0 ? {} : { partBoxChecks: boxChecks }),
    })
    if (server.refuseUpload !== null) {
      const detail = server.refuseUpload
      server.refuseUpload = null
      return reply(400, { detail })
    }
    let id = runId
    if (id === null) {
      const base = slug(String(form.get('title')))
      id = base
      for (let number = 2; pieceIds.has(id); number += 1) id = `${base}-${number}`
      pieceIds.add(id)
    }
    const first = runId === null ? 0 : (runs.get(runId)?.parts.length ?? 0)
    // A part left unnamed is listed under the name made from its file, as the real server does until the score is read.
    const parts = (ranges !== null ? ranges.map((range) => range.name) : names).map((name, index) => {
      const shown = name || partNameFromFile(files[index]?.name ?? 'part.pdf')
      return { id: `${id}-${String(first + index + 1).padStart(2, '0')}-${slug(shown)}`, name: shown, position: first + index }
    })
    const job = startJob(id, runId === null ? 'process-piece' : 'add-parts')
    return reply(200, runId === null ? { runId: id, jobId: job.id, parts } : { jobId: job.id, parts })
  }

  const server: FakeRunServer = {
    requests: [],
    maxPutsInFlight: 0,
    onPut: async () => {},
    realignAnswer: { error: 'This run has no activations to re-align with.' },
    realignSent: [],
    realignModes: [],
    uploads: [],
    jobs: new Map(),
    pending: new Map(),
    addPending(id, title, partNames, state = {}) {
      const parts = partNames.map((name, index) => ({ id: `${id}-${String(index + 1).padStart(2, '0')}-${slug(name)}`, name }))
      const summary: RunSummary = {
        id,
        title,
        folder: id,
        parts,
        pending: { createdAt: '2026-11-06T09:00:00+00:00', recordingName: null, jobId: null, status: 'error', progress: 0, stage: 'starting', error: 'Processing stopped when the local server restarted.', parts: parts.map((part) => ({ ...part, state: 'waiting' as const })), ...state },
      }
      server.pending.set(id, summary)
      return summary
    },
    refuseUpload: null,
    splitProposal: {
      splitId: 'split-1',
      pageCount: 6,
      fullScore: false,
      parts: [{ name: 'Flute', fromPage: 1, toPage: 2 }, { name: 'Oboe', fromPage: 3, toPage: 3 }, { name: 'Clarinet', fromPage: 4, toPage: 6 }],
      pages: Array.from({ length: 6 }, (_, index) => ({ page: index + 1, partName: null, printedPage: index + 1, fullScore: false, thumb: `/split/split-1/pages/${index + 1}.png` })),
      note: null,
    },
    refuseSplit: null,
    refuseNames: null,
    deleted: [],
    refuseDelete: null,
    deletedPieces: [],
    refuseDeletePiece: null,
    reprocesses: [],
    refuseReprocess: null,
    suggestion: { name: 'Suggested name', source: 'claude', note: null },
    suggestRequests: [],
    finish(jobId, run) {
      const job = server.jobs.get(jobId)
      if (job === undefined) throw new Error(`no job ${jobId}`)
      job.status = 'done'
      job.progress = 1
      job.stage = 'done'
      runs.set(run.piece.id, structuredClone(run))
      server.pending.delete(run.piece.id)
      pieceIds.add(run.piece.id)
    },
    mapOf(runId) {
      const run = runs.get(runId)
      if (run === undefined) throw new Error(`no run ${runId}`)
      return structuredClone({ timing: run.timing, pages: run.pages })
    },
    async fetch(input, init) {
      const path = new URL(input).pathname
      const method = init?.method ?? 'GET'
      const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
      server.requests.push({ method, path, body })

      if (method === 'POST' && path === '/split') {
        if (server.refuseSplit !== null) {
          const detail = server.refuseSplit
          server.refuseSplit = null
          return reply(400, { detail })
        }
        return reply(200, server.splitProposal)
      }
      if (method === 'POST' && path === '/runs' && init?.body instanceof FormData) return upload(path, null, init.body)
      const uploadMatch = /^\/runs\/([^/]+)\/parts$/.exec(path)
      if (method === 'POST' && uploadMatch !== null && init?.body instanceof FormData) return upload(path, decodeURIComponent(uploadMatch[1]), init.body)
      const again = /^\/runs\/([^/]+)\/process$/.exec(path)
      if (method === 'POST' && again !== null) {
        const id = decodeURIComponent(again[1])
        const job = startJob(id, 'process-piece')
        const waiting = server.pending.get(id)
        if (waiting?.pending !== undefined) waiting.pending = { ...waiting.pending, jobId: job.id, status: 'queued', progress: 0, stage: 'queued', error: null }
        return reply(200, { jobId: job.id })
      }
      const reprocess = /^\/runs\/([^/]+)\/parts\/([^/]+)\/reprocess$/.exec(path)
      if (method === 'POST' && reprocess !== null) {
        const runId = decodeURIComponent(reprocess[1])
        const partId = decodeURIComponent(reprocess[2])
        const part = runs.get(runId)?.parts.find((candidate) => candidate.id === partId)
        if (part === undefined) return reply(404, { detail: 'That part does not exist.' })
        server.reprocesses.push({ runId, partId, boxCheck: (body as { boxCheck?: boolean } | undefined)?.boxCheck === true })
        if (server.refuseReprocess !== null) {
          const { status, detail } = server.refuseReprocess
          server.refuseReprocess = null
          return reply(status, { detail })
        }
        return reply(200, { jobId: startJob(runId, 'add-parts').id, parts: [{ id: part.id, name: part.name, position: part.position }] })
      }
      const jobMatch = /^\/jobs\/([^/]+)$/.exec(path)
      if (jobMatch !== null) {
        const job = server.jobs.get(decodeURIComponent(jobMatch[1]))
        return job === undefined ? reply(404, { detail: 'That job does not exist.' }) : reply(200, job)
      }

      const removal = /^\/runs\/([^/]+)\/parts\/([^/]+)$/.exec(path)
      if (method === 'DELETE' && removal !== null) {
        const target = runs.get(decodeURIComponent(removal[1]))
        if (target === undefined) return reply(404, { detail: 'That run does not exist.' })
        const partId = decodeURIComponent(removal[2])
        server.deleted.push(partId)
        if (server.refuseDelete !== null) {
          const detail = server.refuseDelete
          server.refuseDelete = null
          return reply(400, { detail })
        }
        target.parts = target.parts.filter((part) => part.id !== partId).map((part, position) => ({ ...part, position }))
        delete target.pageImages[partId]
        delete target.pages[partId]
        return reply(200, { parts: target.parts.map(({ id, position }) => ({ id, position })) })
      }
      const pieceRemoval = /^\/runs\/([^/]+)$/.exec(path)
      if (method === 'DELETE' && pieceRemoval !== null) {
        const id = decodeURIComponent(pieceRemoval[1])
        if (!runs.has(id) && !server.pending.has(id)) return reply(404, { detail: 'That run does not exist.' })
        server.deletedPieces.push(id)
        if (server.refuseDeletePiece !== null) {
          const detail = server.refuseDeletePiece
          server.refuseDeletePiece = null
          return reply(409, { detail })
        }
        runs.delete(id)
        server.pending.delete(id)
        return reply(200, { movedTo: `.deleted/${id}-20261104-093015` })
      }
      const suggestRun = /^\/runs\/([^/]+)\/suggest-name$/.exec(path)
      if (method === 'POST' && suggestRun !== null) {
        server.suggestRequests.push({ runId: decodeURIComponent(suggestRun[1]), fields: {} })
        return reply(200, server.suggestion)
      }
      if (method === 'POST' && path === '/suggest-name' && init?.body instanceof FormData) {
        const fields: Record<string, string> = {}
        for (const [key, value] of init.body.entries()) fields[key] = value instanceof File ? value.name : String(value)
        server.suggestRequests.push({ runId: null, fields })
        return reply(200, server.suggestion)
      }

      if (path === '/runs') {
        const finished: RunSummary[] = [...runs.values()].map((run) => ({ id: run.piece.id, title: run.piece.title, folder: run.piece.id, parts: run.parts.map(({ id, name }) => ({ id, name })) }))
        return reply(200, [...finished, ...server.pending.values()])
      }
      const namesOfPending = /^\/runs\/([^/]+)\/names$/.exec(path)
      const unfinished = namesOfPending === null ? undefined : server.pending.get(decodeURIComponent(namesOfPending[1]))
      if (method === 'PUT' && unfinished !== undefined) {
        const { title } = body as RunNames
        if (title !== undefined) unfinished.title = title
        return reply(200, { parts: {}, recording: null, title: title ?? null })
      }
      const match = /^\/runs\/([^/]+)(\/map|\/realign|\/names)?$/.exec(path)
      const run = match === null ? undefined : runs.get(decodeURIComponent(match[1]))
      if (match === null || run === undefined) return reply(404, { detail: 'That run does not exist.' })

      if (match[2] === undefined) return reply(200, run)
      if (match[2] === '/names') {
        const { parts, recording, title } = body as RunNames
        if (server.refuseNames !== null) {
          const detail = server.refuseNames
          server.refuseNames = null
          return reply(400, { detail })
        }
        for (const [partId, name] of Object.entries(parts ?? {})) {
          const part = run.parts.find((candidate) => candidate.id === partId)
          if (part !== undefined) Object.assign(part, { name, nameSource: 'user' })
        }
        if (recording !== undefined) run.recordingName = recording
        if (title !== undefined) run.piece.title = title
        return reply(200, { parts: parts ?? {}, recording: recording ?? null, title: title ?? null })
      }
      if (match[2] === '/realign') {
        server.realignSent.push((body as { timing: TimingLayer }).timing)
        server.realignModes.push((body as { mode?: string }).mode ?? 'realign')
        const answer = server.realignAnswer
        return 'error' in answer ? reply(400, { detail: answer.error }) : reply(200, answer)
      }
      inFlight += 1
      server.maxPutsInFlight = Math.max(server.maxPutsInFlight, inFlight)
      try {
        await server.onPut(body as RunMap)
      } catch (error) {
        return reply(400, { detail: error instanceof Error ? error.message : 'refused' })
      } finally {
        inFlight -= 1
      }
      const saved = body as RunMap
      run.timing = saved.timing
      run.pages = saved.pages
      run.confirmedAt = '2026-10-30T12:00:00+00:00'
      return reply(200, { savedAt: run.confirmedAt })
    },
  }
  return server
}
