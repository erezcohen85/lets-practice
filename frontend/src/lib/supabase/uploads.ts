import { partNameFromFile } from '@/domain/newPiece'
import { recordingNameFromFile } from '@/domain/names'
import { allowed } from '@/domain/planLimits'
import { DEFAULT_COUNT_IN_BARS } from '@/domain/tempo'
import { DEFAULT_PRACTICE_MEMORY, type Part, type Piece } from '@/domain/types'
import { type DataClient, type NewPartInput, type NewPieceInput, type SplitUpload, type User } from '@/lib/dataClient'
import { PlanLimitError, SentenceError } from '@/lib/processorClient'
import { fail, removeFiles, type SupabasePort } from '@/lib/supabase/port'
import { partRefusalOf, readPlan, refusalOf } from '@/lib/supabase/plans'
import { type CutSplit } from '@/lib/supabase/splitting'
import { strings } from '@/strings'

/** What the bucket takes per file (migration 0009). */
const MAX_FILE_BYTES = 50 * 1024 * 1024

/**
 * What a recording's file name may end in, each with the content type it is stored as. Must equal RECORDING_SUFFIXES in
 * backend/processor/app/pipeline/audio_ingest.py (uploads.test.ts holds the two together). The bucket takes `audio/*`, and a
 * browser's own `file.type` can be empty or a video type (Firefox says video/ogg for .ogg), so the type comes from the suffix.
 * It reaches Storage only through `put`: storage-js ignores its `contentType` option for a Blob and sends the Blob's own type.
 */
const RECORDING_TYPES: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
}
export const RECORDING_SUFFIXES = Object.keys(RECORDING_TYPES)

async function sha256(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function requireSize(file: File): void {
  if (file.size === 0) throw new SentenceError(strings.realServices.emptyFile(file.name))
  if (file.size > MAX_FILE_BYTES) throw new SentenceError(strings.realServices.tooLarge(file.name))
}

/** A part must be a PDF, by its type or, when the browser gives none, by its name. */
export function requirePdf(file: File): void {
  if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) throw new SentenceError(strings.newPiece.errors.partNotPdf)
}

function recordingSuffix(file: File): string {
  const suffix = /\.[A-Za-z0-9]+$/.exec(file.name)?.[0]?.toLowerCase()
  if (suffix === undefined || !Object.hasOwn(RECORDING_TYPES, suffix)) throw new SentenceError(strings.realServices.notARecording)
  return suffix
}

/** What one call has made so far, recorded before each step is tried, so a failure can take back even a step whose answer was lost. */
interface Made { paths: string[]; partIds: string[] }

/** The browser stores the files itself (spec 6), under names made from ids: a file's own name is never part of a path. */
export function createUploads(port: SupabasePort, requireUser: () => Promise<User>, cutSplit: CutSplit) {
  const bucket = () => port.storage.from('pieces')

  /**
   * storage-js sends a File as it is: its own type (the browser's guess, maybe empty or video/ogg) and its real name in the
   * multipart form, and ignores `contentType`. A slice with the type set is a nameless Blob with the true type.
   */
  async function put(path: string, file: File, contentType: string): Promise<void> {
    fail((await bucket().upload(path, file.slice(0, file.size, contentType), { contentType })).error)
  }

  /** The part rows and PDFs of new parts from position `first` on. */
  async function storeNew(user: User, pieceId: string, parts: NewPartInput[], first: number, made: Made): Promise<Part[]> {
    const result: Part[] = []
    for (const [index, part] of parts.entries()) {
      const id = crypto.randomUUID()
      const path = `${user.id}/${pieceId}/parts/${id}.pdf`
      // Hashed first: it needs a secure context, and a page without one should fail before any file has moved.
      const sha = await sha256(part.file)
      made.paths.push(path)
      await put(path, part.file, 'application/pdf')
      const typed = part.name.trim()
      const name = typed || partNameFromFile(part.file.name)
      made.partIds.push(id)
      const { error } = await port.from('score_files').insert({
        id,
        piece_id: pieceId,
        storage_path: path,
        sha256: sha,
        name,
        name_source: typed === '' ? 'file' : 'user',
        position: first + index,
        ...(part.boxCheck === true ? { box_check: true } : {}), // the column is migration 0012's; a part without the tick does not need it
      })
      if (error !== null) throw await partRefusalOf(port, error, pieceId, part.boxCheck === true)
      result.push({ id, name, pageCount: 0 })
    }
    return result
  }

  /**
   * The parts of a split PDF the processor staged. The processor writes each kept part's PDF into the piece's folder (it is told
   * the part ids made here, and the piece must be this user's), and the rows are added here with the user's own login, as for a
   * part sent from the browser. The paths are recorded before the call, so a failure takes back even PDFs whose answer was lost.
   */
  async function storeSplit(user: User, pieceId: string, split: SplitUpload, first: number, made: Made): Promise<Part[]> {
    const ids = split.parts.map(() => crypto.randomUUID())
    made.paths.push(...ids.map((id) => `${user.id}/${pieceId}/parts/${id}.pdf`))
    const cut = await cutSplit(pieceId, split.splitId, split.parts.map((range, index) => ({ ...range, id: ids[index]! })))
    const result: Part[] = []
    for (const [index, range] of split.parts.entries()) {
      const id = ids[index]!
      const written = cut.find((item) => item.id === id)
      if (written === undefined) throw new Error('The processor did not write every part.')
      const name = range.name.trim()
      made.partIds.push(id)
      const { error } = await port.from('score_files').insert({
        id,
        piece_id: pieceId,
        storage_path: `${user.id}/${pieceId}/parts/${id}.pdf`,
        sha256: written.sha256,
        name,
        name_source: 'user',
        position: first + index,
        ...(split.boxChecks?.[index] === true ? { box_check: true } : {}),
      })
      if (error !== null) throw await partRefusalOf(port, error, pieceId, split.boxChecks?.[index] === true)
      result.push({ id, name, pageCount: 0 })
    }
    return result
  }

  /** Best effort, and silent: it runs while a failure is being thrown, and must not hide it. */
  async function takeBack(made: Made, pieceId?: string): Promise<void> {
    try {
      if (pieceId !== undefined) await port.from('pieces').delete().eq('id', pieceId) // its parts and recording rows go with it
      else for (const id of made.partIds) await port.from('score_files').delete().eq('id', id)
    } catch {
      // The files are still taken back below.
    }
    await removeFiles(bucket(), made.paths, 'An upload taken back')
  }

  /**
   * Reads the plan once before anything is made and refuses what the policies would refuse later: a piece row that exists when a
   * part is then refused counts as a piece made (migration 0015), so a Trial user would lose one of their pieces for nothing.
   * The policies stay the backstop (refusalOf, partRefusalOf); a plan that cannot be read is left to them.
   */
  async function requirePlanRoom(input: NewPieceInput): Promise<void> {
    let state
    try {
      state = await readPlan(port)
    } catch {
      return
    }
    const parts = input.parts.length + (input.split?.parts.length ?? 0)
    const ticks = input.parts.filter((part) => part.boxCheck === true).length + (input.split?.boxChecks?.filter(Boolean).length ?? 0)
    for (const action of [{ type: 'createPiece' }, { type: 'addPart', partsAfter: parts }, { type: 'advancedReading', parts: ticks }] as const) {
      if (action.type === 'addPart' && parts === 0) continue
      if (action.type === 'advancedReading' && ticks === 0) continue
      const verdict = allowed(state, action)
      if (!verdict.ok) throw new PlanLimitError(verdict.limit)
    }
  }

  return {
    async createPiece(input: NewPieceInput): Promise<Piece> {
      const user = await requireUser()
      // Everything the browser can refuse is refused before the first row or file exists.
      for (const part of input.parts) {
        requirePdf(part.file)
        requireSize(part.file)
      }
      const { recording } = input
      const suffix = recordingSuffix(recording.file)
      requireSize(recording.file)

      await requirePlanRoom(input)

      const id = crypto.randomUUID()
      const createdAt = new Date().toISOString()
      const inserted = (await port.from('pieces').insert({ id, title: input.title, created_at: createdAt })).error
      // The piece trigger of migration 0015 names the limit in its error (a refusal without a key reads the plan again).
      if (inserted !== null) throw await refusalOf(port, inserted, { type: 'createPiece' })
      const made: Made = { paths: [], partIds: [] }
      try {
        const parts = await storeNew(user, id, input.parts, 0, made)
        if (input.split !== undefined) parts.push(...(await storeSplit(user, id, input.split, parts.length, made)))
        const stored = `${user.id}/${id}/upload/recording${suffix}`
        made.paths.push(stored)
        await put(stored, recording.file, RECORDING_TYPES[suffix]!)
        // The recording's name is the file's real name (the reader falls back to an id-based label without it); the object's name above comes only from ids.
        const name = recordingNameFromFile(recording.file.name) || null
        fail((await port.from('audio_sources').insert({ piece_id: id, kind: 'file', url_or_path: stored, name })).error)
        return {
          id,
          title: input.title,
          createdAt,
          role: 'owner',
          ownerName: user.name,
          recording: { kind: 'file', urlOrPath: name ?? recording.file.name, durationSec: null },
          parts,
          countInBars: DEFAULT_COUNT_IN_BARS,
          practice: DEFAULT_PRACTICE_MEMORY,
          lastPartId: null,
        }
      } catch (error) {
        await takeBack(made, id)
        throw error
      }
    },

    async storeParts(pieceId: string, parts: NewPartInput[], split?: SplitUpload): Promise<Part[]> {
      const user = await requireUser()
      for (const part of parts) {
        requirePdf(part.file)
        requireSize(part.file)
      }
      // The piece's owner, before any file moves: RLS would refuse the part row anyway, after up to 50 MB had gone up.
      const owner = await port.from('pieces').select<{ owner_id: string }>('owner_id').eq('id', pieceId).maybeSingle()
      fail(owner.error)
      if (owner.data?.owner_id !== user.id) throw new Error('piece not found')
      const { data, error } = await port.from('score_files').select<{ position: number }>('position').eq('piece_id', pieceId)
      fail(error)
      const first = Math.max(-1, ...(data ?? []).map((row) => row.position)) + 1
      const made: Made = { paths: [], partIds: [] }
      try {
        const stored = await storeNew(user, pieceId, parts, first, made)
        if (split !== undefined) stored.push(...(await storeSplit(user, pieceId, split, first + stored.length, made)))
        return stored
      } catch (failure) {
        // All or none: a part row whose PDF was taken back would be a broken part, so the rows of this call go too. Parts the piece already had are untouched.
        await takeBack(made)
        throw failure
      }
    },
  } satisfies Pick<DataClient, 'createPiece' | 'storeParts'>
}
