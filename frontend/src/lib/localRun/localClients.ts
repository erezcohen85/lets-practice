import { MAX_PART_NAME, MAX_PIECE_TITLE, MAX_RECORDING_NAME, recordingNameFromFile, requireName } from '@/domain/names'
import { DEFAULT_COUNT_IN_BARS } from '@/domain/tempo'
import { type Job, type JobKind, type JobPart, type PageLayer } from '@/domain/types'
import { type Clients } from '@/lib/clients'
import { type DataClient, type PageImage, type PieceDetail, type PieceSummary, type SplitUpload } from '@/lib/dataClient'
import { createFakes, type FakeStore } from '@/lib/fakes'
import { addJob, newCreatedAt, nextId, partsOf, type StoredPart } from '@/lib/fakes/store'
import { createClickSynth } from '@/lib/audio/clickSynth'
import { createRunApi, type PendingRun, type RunApi, type RunDocument, type RunMap, type RunSummary, type UploadedPart } from '@/lib/localRun/runApi'
import { createFilePlayer } from '@/lib/player/filePlayer'
import { SentenceError, type ProcessorClient } from '@/lib/processorClient'

// Local mode (VITE_LOCAL_RUN): the fake data client on a store that is filled from the run folders a local server
// serves, so a real sample made by run_piece.py opens in the Library, the editor and Practice on this Mac. Every save
// of the map is written back to the run folder through the server. Nothing is kept in the browser: a reload reads the
// folder again.
//
// New piece and + Add part go to the server too: it saves the files in the piece's folder and runs the real pipeline in
// the background. The piece shows up at once (without pages) and the Processing screen follows the server's job; when
// the job is done the finished run is read from the server into the store. Nothing the pipeline makes is ever faked.

const PEAK_MAX = 127

/** Waits for the store to be filled before any call; a failed load is tried again on the next call. */
function loadOnce(load: () => Promise<void>): () => Promise<void> {
  let ready: Promise<void> | null = null
  return () => {
    ready ??= load().catch((error: unknown) => {
      ready = null
      throw error
    })
    return ready
  }
}

/** The latest job the server started for a piece in this session. `fresh` until the processor client hands it out. */
interface Tracked {
  job: Job
  serverId: string
  fresh: boolean
  /** The parts the job reads again (a reprocess): when it is done they take the server's pages and boxes though they had pages before. */
  replaces: ReadonlySet<string>
  /** The read of the server in flight, so two polls at once ask once (and a finished run is adopted once). */
  refreshing: Promise<void> | null
}

const isOver = (job: Job) => job.status === 'done' || job.status === 'error'

function pageImagesOf(run: RunDocument, partId: string, api: RunApi): PageImage[] {
  return (run.pageImages[partId] ?? []).map((image): PageImage => ({ pageIndex: image.pageIndex, width: image.width, height: image.height, url: api.fileUrl(run.piece.id, image.file) }))
}

function fill(store: FakeStore, run: RunDocument, api: RunApi): void {
  const { piece } = run
  store.pieces.set(piece.id, {
    id: piece.id,
    ownerId: store.currentUserId ?? '',
    title: piece.title,
    createdAt: piece.createdAt,
    countInBars: piece.countInBars,
    practice: {},
    lastPartId: null,
    durationSec: piece.durationSec,
  })
  const title = run.recordingName ?? undefined
  // A run made before the music rule may say 'youtube': its stored audio is a file all the same.
  store.recordings.set(piece.id, { kind: 'file', name: run.recording.kind === 'file' ? run.recording.name : (title ?? 'recording'), size: 0, title })
  for (const part of run.parts) {
    store.parts.set(part.id, { id: part.id, pieceId: piece.id, name: part.name, position: part.position, file: { name: `${part.name}.pdf`, size: 0 }, pageCount: part.pageCount })
    store.pageImages.set(part.id, pageImagesOf(run, part.id, api))
  }
  store.peaks.set(piece.id, run.peaks.map((peak) => peak / PEAK_MAX))
  if (run.beats !== undefined && run.beats.length > 0) store.beats.set(piece.id, run.beats.map((beat) => ({ ...beat })))
  store.maps.set(piece.id, { timing: structuredClone(run.timing), pages: new Map(Object.entries(structuredClone(run.pages))), structureSetAt: run.structureSetAt ?? null })
  addJob(store, piece.id, 'process-piece', 'done')
}

/**
 * Writes the store's map for a piece to the server. One PUT runs at a time; a save that comes while one runs waits for
 * the next, and the calls waiting share it, so the PUT that goes out carries the newest map and the latest edit wins.
 */
function createMapWriter(store: FakeStore, api: RunApi): (pieceId: string) => Promise<void> {
  const chains = new Map<string, { last: Promise<void>; waiting: Promise<void> | null }>()

  function snapshot(pieceId: string): RunMap {
    const map = store.maps.get(pieceId)
    if (map === undefined) throw new Error('piece not found')
    return structuredClone({ timing: map.timing, pages: Object.fromEntries(map.pages) as Record<string, PageLayer>, structureSetAt: map.structureSetAt ?? null })
  }

  return (pieceId) => {
    const chain = chains.get(pieceId) ?? { last: Promise.resolve(), waiting: null }
    chains.set(pieceId, chain)
    if (chain.waiting !== null) return chain.waiting
    const next = chain.last.then(() => {
      chain.waiting = null
      return api.putMap(pieceId, snapshot(pieceId))
    })
    chain.waiting = next
    // A failed save must not stop the next one; its callers still see the failure through `next`.
    chain.last = next.catch(() => {})
    return next
  }
}

function afterReady<T extends object>(client: T, ready: () => Promise<void>, skip: ReadonlyArray<keyof T> = []): T {
  const wrapped = { ...client } as Record<string, unknown>
  for (const key of Object.keys(client) as Array<keyof T & string>) {
    const method = client[key]
    if (typeof method !== 'function' || skip.includes(key)) continue
    wrapped[key] = async (...args: unknown[]) => {
      await ready()
      return (method as (...args: unknown[]) => unknown)(...args)
    }
  }
  return wrapped as T
}

export function createLocalClients(api: RunApi): Clients {
  // The demo user, signed in with the terms accepted: local mode has no sign-in.
  const fakes = createFakes({ signedIn: true, termsAccepted: true })
  const { store } = fakes
  const runs = new Map<string, RunDocument>()

  const ready = loadOnce(async () => {
    const summaries = await api.listRuns()
    // A piece with no finished run has nothing to read yet: it is shown by what the list says of its job.
    const documents = await Promise.all(summaries.filter((summary) => summary.pending === undefined).map((summary) => api.getRun(summary.id)))
    for (const run of documents) {
      runs.set(run.piece.id, run)
      fill(store, run, api)
    }
    for (const summary of summaries) if (summary.pending !== undefined) fillPending(summary, summary.pending)
  })
  const writeMap = createMapWriter(store, api)

  // The jobs the server runs for uploads, by piece and by the id the app knows them by (the server's, prefixed so it
  // never meets an id of the fakes).
  const tracked = new Map<string, Tracked>()
  const trackedById = new Map<string, Tracked>()

  function track(pieceId: string, kind: JobKind, serverId: string, fresh: boolean, replaces: string[] = []): Tracked {
    const job: Job = { id: `local-${serverId}`, pieceId, kind, status: 'queued', progress: 0, error: null }
    const entry: Tracked = { job, serverId, fresh, replaces: new Set(replaces), refreshing: null }
    tracked.set(pieceId, entry)
    trackedById.set(job.id, entry)
    return entry
  }

  /**
   * A piece the server lists with no finished run: the same rows an upload makes (no pages yet), and its job as the list
   * says it is. A job this server runs is followed through `getJob` like one started here, and turns the piece into a
   * normal one when it is done. With no job on this server the piece is failed for good, with the sentence the list
   * gives, and Try again starts a job for it.
   */
  function fillPending(summary: RunSummary, pending: PendingRun): void {
    const id = summary.id
    store.pieces.set(id, { id, ownerId: store.currentUserId ?? '', title: summary.title, createdAt: pending.createdAt, countInBars: DEFAULT_COUNT_IN_BARS, practice: {}, lastPartId: null, durationSec: null })
    const recording = pending.recordingName ?? undefined
    store.recordings.set(id, { kind: 'file', name: recording ?? 'recording', size: 0, title: recording })
    summary.parts.forEach((part, position) => {
      store.parts.set(part.id, { id: part.id, pieceId: id, name: part.name, position, file: { name: `${part.name}.pdf`, size: 0 }, pageCount: 0 })
    })
    const entry = track(id, 'process-piece', pending.jobId ?? `stopped-${id}`, false)
    entry.job = { ...entry.job, status: pending.status, progress: pending.progress, error: pending.error, parts: pending.parts }
  }

  /** The job the last upload for the piece started, once: the processor client hands it out after the data client sent the files. */
  function takeFresh(pieceId: string, kind: JobKind): Tracked | undefined {
    const entry = tracked.get(pieceId)
    if (entry === undefined || !entry.fresh || entry.job.kind !== kind) return undefined
    entry.fresh = false
    return entry
  }

  /** Reads the job's state from the server; a job that has finished brings its run into the store first. */
  function refresh(entry: Tracked): Promise<void> {
    if (isOver(entry.job)) return Promise.resolve()
    entry.refreshing ??= read(entry).finally(() => {
      entry.refreshing = null
    })
    return entry.refreshing
  }

  async function read(entry: Tracked): Promise<void> {
    const server = await api.getJob(entry.serverId).catch((error: unknown) => lost(entry, error))
    if (server === undefined) return
    if (server.status === 'done') await adopt(entry, server.parts)
    else entry.job = { ...entry.job, status: server.status, progress: server.progress, error: server.error, ...(server.parts === undefined ? {} : { parts: server.parts }) }
  }

  /**
   * The server does not know the job (it was restarted since the app listed it): its folder says what became of the piece. A
   * piece with no finished run is failed with the sentence the list gives; a piece that finished is taken in; if the list
   * cannot be read either, the first failure stands and the card keeps what it showed.
   */
  async function lost(entry: Tracked, failure: unknown): Promise<undefined> {
    const summary = (await api.listRuns().catch(() => [])).find((item) => item.id === entry.job.pieceId)
    if (summary === undefined) throw failure
    if (summary.pending === undefined) await adopt(entry)
    else entry.job = { ...entry.job, status: summary.pending.status, progress: summary.pending.progress, error: summary.pending.error, parts: summary.pending.parts }
    return undefined
  }

  /**
   * Puts the finished run in the store. A new piece takes everything the run has; new parts only add themselves. A job
   * that skipped a part it could not read is kept as the piece's job, so the hub can say which part and why.
   */
  async function adopt(entry: Tracked, parts?: JobPart[]): Promise<void> {
    const { pieceId, kind } = entry.job
    const run = await api.getRun(pieceId)
    runs.set(pieceId, run)
    if (kind === 'add-parts') await addNewParts(run, entry.replaces)
    else {
      for (const part of partsOf(store, pieceId)) {
        store.parts.delete(part.id)
        store.pageImages.delete(part.id)
      }
      fill(store, run, api)
    }
    entry.job = { ...entry.job, status: 'done', progress: 1, error: null, ...(parts === undefined ? {} : { parts }) }
    const skipped = (parts ?? []).some((part) => part.state === 'failed')
    if (tracked.get(pieceId) === entry && !skipped) tracked.delete(pieceId)
  }

  /**
   * The parts of the run that the store does not have pages for yet, and the parts the job read again (`replaces`): they take
   * the server's pages and boxes. The timing and the other parts stay as the editor has them.
   */
  async function addNewParts(run: RunDocument, replaces: ReadonlySet<string>): Promise<void> {
    const pieceId = run.piece.id
    const map = store.maps.get(pieceId)
    const known = new Set(run.parts.map((part) => part.id))
    for (const part of partsOf(store, pieceId)) {
      if (known.has(part.id)) continue
      store.parts.delete(part.id)
      store.pageImages.delete(part.id)
    }
    for (const part of run.parts) {
      const had = store.parts.get(part.id)
      if (had !== undefined && had.pageCount > 0 && !replaces.has(part.id)) continue
      store.parts.set(part.id, { id: part.id, pieceId, name: part.name, position: part.position, file: had?.file ?? { name: `${part.name}.pdf`, size: 0 }, pageCount: part.pageCount })
      store.pageImages.set(part.id, pageImagesOf(run, part.id, api))
      if (map !== undefined && (replaces.has(part.id) || !map.pages.has(part.id)) && run.pages[part.id] !== undefined) map.pages.set(part.id, structuredClone(run.pages[part.id]))
    }
    // The server's confirmed map already has the new pages; a save of the editor that was on its way when the job ended
    // would have taken them out again, so the store's whole map is sent once more.
    if (run.confirmedAt !== null) await writeMap(pieceId)
  }

  const base = afterReady(fakes.data, ready, ['onUserChange'])

  /** What the files of an upload are called in the store: the PDFs sent, or the one PDF a split was cut from. */
  const filesOf = (parts: Array<{ file: File }>, split?: SplitUpload) =>
    split === undefined ? parts.map(({ file }) => ({ name: file.name, size: file.size })) : split.parts.map(() => ({ name: split.fileName, size: 0 }))

  /** The piece's row in the store for an upload the server has taken: its parts have no pages until the job is done. `files` says what each part was sent as (a split's parts are all one PDF). */
  function storeUploaded(pieceId: string, uploaded: UploadedPart[], files: Array<{ name: string; size: number }>): StoredPart[] {
    return uploaded.map((part, index) => {
      const stored: StoredPart = { id: part.id, pieceId, name: part.name, position: part.position, file: { ...files[index] }, pageCount: 0 }
      store.parts.set(stored.id, stored)
      return stored
    })
  }

  /** The server's job in place of the store's, for a piece the server is preparing (or failed to). */
  function withServerJob<T extends PieceDetail | PieceSummary>(item: T, pieceId: string): T {
    const entry = tracked.get(pieceId)
    return entry === undefined ? item : { ...item, job: { ...entry.job } }
  }

  const data: DataClient = {
    ...base,
    async createPiece(input) {
      await ready()
      const started = await api.uploadPiece(input)
      const id = started.runId
      store.pieces.set(id, { id, ownerId: store.currentUserId ?? '', title: input.title, createdAt: newCreatedAt(store), countInBars: DEFAULT_COUNT_IN_BARS, practice: {}, lastPartId: null, durationSec: null })
      store.recordings.set(id, { kind: 'file', name: input.recording.file.name, size: input.recording.file.size, title: recordingNameFromFile(input.recording.file.name) })
      storeUploaded(id, started.parts, filesOf(input.parts, input.split))
      track(id, 'process-piece', started.jobId, true)
      const detail = await base.getPiece(id)
      if (detail === null) throw new Error('piece not found')
      return detail.piece
    },
    async storeParts(pieceId, parts, split) {
      await ready()
      if (!store.pieces.has(pieceId)) throw new Error('piece not found')
      const started = await api.uploadParts(pieceId, parts, split)
      const stored = storeUploaded(pieceId, started.parts, filesOf(parts, split))
      track(pieceId, 'add-parts', started.jobId, true)
      return stored.map((part) => ({ id: part.id, name: part.name, pageCount: part.pageCount }))
    },
    async listPieces() {
      await ready()
      // A poll that fails keeps the last state the library knew.
      await Promise.all([...tracked.values()].map((entry) => refresh(entry).catch(() => {})))
      return (await base.listPieces()).map((item) => withServerJob(item, item.id))
    },
    async getPiece(id) {
      await ready()
      const entry = tracked.get(id)
      if (entry !== undefined) await refresh(entry)
      const detail = await base.getPiece(id)
      return detail === null ? null : withServerJob(detail, id)
    },
    async getJob(jobId) {
      await ready()
      const entry = trackedById.get(jobId)
      if (entry === undefined) return base.getJob(jobId)
      await refresh(entry)
      return { ...entry.job }
    },
    // The title of the piece and the piece itself are kept by the server too: without it a reload read the folder again
    // and brought the old title, and the deleted piece, back.
    async renamePiece(id, title) {
      await ready()
      if (!store.pieces.has(id)) throw new Error('piece not found')
      const valid = requireName(title, MAX_PIECE_TITLE)
      await api.putNames(id, { title: valid })
      await base.renamePiece(id, valid)
    },
    // The server moves the piece's folder aside first: a piece it refused (one being prepared) stays in the library.
    async deletePiece(id) {
      await ready()
      if (!store.pieces.has(id)) throw new Error('piece not found')
      await api.deletePiece(id)
      await base.deletePiece(id)
      runs.delete(id)
      const entry = tracked.get(id)
      if (entry !== undefined) trackedById.delete(entry.job.id)
      tracked.delete(id)
    },
    // A rename is saved in the run folder first: a name the server refused, or could not be asked to keep, is not shown.
    async renamePart(pieceId, partId, name) {
      await ready()
      const part = store.parts.get(partId)
      if (part?.pieceId !== pieceId) throw new Error('part not found')
      const valid = requireName(name, MAX_PART_NAME)
      await api.putNames(pieceId, { parts: { [partId]: valid } })
      await base.renamePart(pieceId, partId, valid)
    },
    async renameRecording(pieceId, name) {
      await ready()
      if (!store.recordings.has(pieceId)) throw new Error('recording not found')
      const valid = requireName(name, MAX_RECORDING_NAME)
      await api.putNames(pieceId, { recording: valid })
      await base.renameRecording(pieceId, valid)
    },
    // The server deletes the part's files first: a part it refused (the last one, a piece being prepared) stays in the store.
    async deletePart(pieceId, partId) {
      await ready()
      if (store.parts.get(partId)?.pieceId !== pieceId) throw new Error('part not found')
      await api.deletePart(pieceId, partId)
      await base.deletePart(pieceId, partId)
    },
    async saveTiming(pieceId, timing) {
      await base.saveTiming(pieceId, timing)
      await writeMap(pieceId)
    },
    async savePageLayer(pieceId, page) {
      await base.savePageLayer(pieceId, page)
      await writeMap(pieceId)
    },
    async saveStructureSetAt(pieceId, at) {
      await base.saveStructureSetAt(pieceId, at)
      await writeMap(pieceId)
    },
    async getAudioUrl(pieceId) {
      await ready()
      const run = runs.get(pieceId)
      return run === undefined ? null : api.fileUrl(pieceId, run.audio)
    },
  }

  const fakeProcessor = afterReady(fakes.processor, ready)
  const processor: ProcessorClient = {
    ...fakeProcessor,
    // The server started the job when the files were sent (createPiece); a failed one is started again on its folder.
    // The fakes' processing never runs here: it would give the piece the synthetic map.
    async processPiece(pieceId) {
      await ready()
      const started = takeFresh(pieceId, 'process-piece')
      if (started !== undefined) return { ...started.job }
      const last = tracked.get(pieceId)
      if (last?.job.kind !== 'process-piece' || last.job.status !== 'error') {
        throw new SentenceError('This piece has already been prepared.')
      }
      const again = await api.processAgain(pieceId)
      return { ...track(pieceId, 'process-piece', again.jobId, false).job }
    },
    // The server reads the page headers; its proposal is shown as it is.
    proposeSplit: (pdf) => api.proposeSplit(pdf),
    // The library is the folder's runs: the fakes' sample piece is never put among them.
    claimSamplePiece: async () => ({ status: 'already' }),
    // The server asks the model, with the clues in the run folder; a form is asked from its link, file name and first PDF.
    async suggestPieceName(pieceId) {
      await ready()
      if (!store.pieces.has(pieceId)) throw new Error('piece not found')
      return api.suggestName(pieceId)
    },
    async suggestNewPieceName(clues) {
      await ready()
      return api.suggestNewName(clues)
    },
    // The files go in through storeParts, which starts the job; with none, the job starts again for the parts without pages.
    async addParts(pieceId, parts) {
      await ready()
      if (parts.length > 0) await data.storeParts(pieceId, parts)
      const started = takeFresh(pieceId, 'add-parts')
      if (started !== undefined) return { ...started.job }
      if (!store.pieces.has(pieceId)) throw new Error('piece not found')
      const again = await api.uploadParts(pieceId, [])
      return { ...track(pieceId, 'add-parts', again.jobId, false).job }
    },
    // The server reads the part again; the part keeps its row until the job is done, then takes the new pages and boxes.
    async reprocessPart(pieceId, partId, { boxCheck }) {
      await ready()
      if (store.parts.get(partId)?.pieceId !== pieceId) throw new Error('part not found')
      const started = await api.reprocessPart(pieceId, partId, boxCheck)
      return { ...track(pieceId, 'add-parts', started.jobId, false, [partId]).job }
    },
    // A run with activations is refit by the server (confirmed locators stay) and the result is saved to the folder; without them the fakes' refit runs.
    async realign(pieceId) {
      await ready()
      if (runs.get(pieceId)?.canRealign !== true) return fakeProcessor.realign(pieceId)
      try {
        const map = store.maps.get(pieceId)
        if (map === undefined) throw new Error('piece not found')
        // The store holds the timing the editor shows, also when its last save is still on the way to the folder.
        map.timing = structuredClone(await api.realign(pieceId, structuredClone(map.timing)))
        // As the real realign job writes its result to the database, the folder gets it too: a reload shows it.
        await writeMap(pieceId)
        return { ...addJob(store, pieceId, 'realign', 'done').job }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Re-align failed.'
        const failed: Job = { id: nextId(store, 'job'), pieceId, kind: 'realign', status: 'error', progress: 0, error: message }
        return failed
      }
    },
    // A run with activations fills the empty bars on the server (nothing else moves); without them the fakes' fill answers. A refusal leaves the bars empty.
    async fillEmptyBars(pieceId, timing) {
      await ready()
      if (runs.get(pieceId)?.canRealign !== true) return fakeProcessor.fillEmptyBars(pieceId, timing)
      try {
        return await api.fill(pieceId, structuredClone(timing))
      } catch {
        return null
      }
    },
  }

  return { data, processor, createPlayer: () => createFilePlayer(), createClickSynth: () => createClickSynth() }
}

/** The clients for VITE_LOCAL_RUN=<server URL>. */
export function createLocalClientsFor(serverUrl: string): Clients {
  return createLocalClients(createRunApi(serverUrl))
}
