import { roleOf } from '@/domain/access'
import { type DetectedBeat } from '@/domain/beats'
import { normalizePracticeMemory } from '@/domain/practice'
import { partReview, pieceReview } from '@/domain/reviewQueue'
import { DEFAULT_COUNT_IN_BARS } from '@/domain/tempo'
import { type CountInBars, type Part, type PageLayer, type Piece, type PieceMap, type TimingLayer } from '@/domain/types'
import { readCredits } from '@/lib/demo/demoBundle'
import { type DataClient, type PageImage, type PartSummary, type PieceSummary, type ReviewStatus, type User } from '@/lib/dataClient'
import { fail, isMissingFile, isUuid, selectAll, type SupabasePort } from '@/lib/supabase/port'
import { jobFromRow, pageFromRows, timingFromRows, type BarRow, type JobRow, type LocatorRow, type PartLayerRow, type PlayOrderTableRow } from '@/lib/supabase/rows'

/** Long enough for a practice session (the audio element sends new range requests when seeking); a removed member keeps an address they already hold for this long. */
export const SIGNED_URL_SECONDS = 2 * 60 * 60

const PEAK_MAX = 127
// jobs.error, failed_parts, warnings and cost_usd can be read by a member under RLS, but no member's screen needs them.
const JOB_MEMBER = 'id, piece_id, kind, status, progress, created_at'
const JOB_OWNER = `${JOB_MEMBER}, error, failed_parts`
// sample_credits is a column of the row a reader can already see (migration 0016), so the sample_credits() function is not needed here.
const PIECE_COLUMNS = 'id, owner_id, title, created_at, structure_set_at, sample_of, sample_credits'
const FILE_COLUMNS = 'id, piece_id, name, position, page_count, rests, box_flags'
const AUDIO_COLUMNS = 'id, piece_id, kind, url_or_path, duration, stored_path, name'

interface PieceRow { id: string; owner_id: string; title: string; created_at: string; structure_set_at: string | null; sample_of: string | null; sample_credits: unknown }
interface FileRow extends PartLayerRow { piece_id: string; name: string; position: number; page_count: number }
interface AudioRow { piece_id: string; kind: 'youtube' | 'file'; url_or_path: string; duration: number | null; stored_path: string | null; name: string | null }
interface MemoryRow { practice: unknown; count_in_bars: number | null; last_part_id: string | null }
type Timed = JobRow & { created_at: string }

/**
 * A copy of the sample piece: sample_of is set. When the master is deleted the database clears sample_of (on delete set null) but
 * the copy keeps the credits it was given, and a licence such as CC BY asks for them wherever the files go, so a piece that still
 * holds credits is still a sample.
 */
const isSample = (row: Pick<PieceRow, 'sample_of' | 'sample_credits'>) => row.sample_of !== null || row.sample_credits !== null

const NO_REVIEW: ReviewStatus = { checked: 0, total: 0 }
const fileName = (path: string) => path.slice(path.lastIndexOf('/') + 1)

function recordingLabelOf(audio: AudioRow | undefined): string | null {
  if (audio === undefined) return null
  return audio.name ?? (audio.kind === 'youtube' ? audio.url_or_path : fileName(audio.url_or_path))
}

function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>()
  for (const row of rows) groups.set(key(row), [...(groups.get(key(row)) ?? []), row])
  return groups
}

export function createReads(port: SupabasePort, requireUser: () => Promise<User>) {
  const files = (pieceIds: string[]) => selectAll(() => port.from('score_files').select<FileRow & { id: string }>(FILE_COLUMNS).in('piece_id', pieceIds))
  const recordings = (pieceIds: string[]) => selectAll(() => port.from('audio_sources').select<AudioRow & { id: string }>(AUDIO_COLUMNS).in('piece_id', pieceIds))

  /** The newest job of each piece; the reason and the failed parts only for pieces the user owns. */
  async function latestJobs(pieceIds: string[], owned: Set<string>) {
    const read = async (ids: string[], columns: string) => (ids.length === 0 ? [] : selectAll(() => port.from('jobs').select<Timed>(columns).in('piece_id', ids)))
    const rows = [...(await read(pieceIds.filter((id) => owned.has(id)), JOB_OWNER)), ...(await read(pieceIds.filter((id) => !owned.has(id)), JOB_MEMBER))]
    const newest = new Map<string, Timed>()
    for (const row of rows) {
      const held = newest.get(row.piece_id)
      if (held === undefined || row.created_at > held.created_at) newest.set(row.piece_id, row)
    }
    return newest
  }

  async function ownerNames(pieceIds: string[]) {
    const { data, error } = await port.rpc<Array<{ piece_id: string; display_name: string | null }>>('piece_owner_names', { target_pieces: pieceIds })
    fail(error)
    return new Map((data ?? []).map((row) => [row.piece_id, row.display_name]))
  }

  /** The maps of these pieces, by piece id, each part's layer in part order. */
  async function maps(pieceIds: string[], parts: FileRow[]) {
    const orders = await selectAll(() => port.from('play_order').select<PlayOrderTableRow & { id: string; piece_id: string }>('id, piece_id, bar_count, rows, meters, marks, short_bars').in('piece_id', pieceIds))
    const locators = groupBy(
      await selectAll(() => port.from('locators').select<LocatorRow & { id: string; piece_id: string }>('id, piece_id, bar_number, pass_index, time_sec, confirmed, flags, checked').in('piece_id', pieceIds)),
      (row) => row.piece_id,
    )
    const partIds = parts.map((part) => part.id)
    const bars = groupBy(
      partIds.length === 0 ? [] : await selectAll(() => port.from('bars').select<BarRow & { id: string }>('id, score_file_id, bar_number, page_index, x, y, w, h').in('score_file_id', partIds)),
      (row) => row.score_file_id,
    )
    const result = new Map<string, { timing: TimingLayer; pages: PageLayer[] }>()
    for (const pieceId of pieceIds) {
      const own = parts.filter((part) => part.piece_id === pieceId).sort((a, b) => a.position - b.position)
      result.set(pieceId, {
        timing: timingFromRows(orders.find((row) => row.piece_id === pieceId) ?? null, locators.get(pieceId) ?? []),
        pages: own.map((part) => pageFromRows(part, bars.get(part.id) ?? [])),
      })
    }
    return result
  }

  async function pieceRow(id: string): Promise<PieceRow | null> {
    if (!isUuid(id)) return null
    const { data, error } = await port.from('pieces').select<PieceRow>(PIECE_COLUMNS).eq('id', id).maybeSingle()
    fail(error)
    return data
  }

  async function toPiece(row: PieceRow, parts: FileRow[], audio: AudioRow | undefined, user: User): Promise<Piece> {
    const { data: memory, error } = await port.from('piece_practice').select<MemoryRow>('practice, count_in_bars, last_part_id').eq('user_id', user.id).eq('piece_id', row.id).maybeSingle()
    fail(error)
    const ordered = [...parts].sort((a, b) => a.position - b.position)
    return {
      id: row.id,
      title: row.title,
      createdAt: row.created_at,
      role: roleOf({ ownerId: row.owner_id }, user.id),
      ownerName: (await ownerNames([row.id])).get(row.id) ?? null,
      recording: audio === undefined ? null : { kind: audio.kind, urlOrPath: audio.kind === 'youtube' ? audio.url_or_path : (audio.name ?? fileName(audio.url_or_path)), durationSec: audio.duration },
      parts: ordered.map((part): Part => ({ id: part.id, name: part.name, pageCount: part.page_count })),
      countInBars: (memory?.count_in_bars ?? DEFAULT_COUNT_IN_BARS) as CountInBars,
      practice: normalizePracticeMemory(memory?.practice ?? {}),
      lastPartId: memory?.last_part_id ?? null,
    }
  }

  async function signed(paths: string[]): Promise<string[]> {
    const { data, error } = await port.storage.from('pieces').createSignedUrls(paths, SIGNED_URL_SECONDS)
    fail(error)
    return paths.map((_, index) => {
      const row = data?.[index]
      if (row === undefined || row.error !== null || row.signedUrl === null) throw new Error('no address for a file of this piece')
      return row.signedUrl
    })
  }

  async function stored<T>(id: string, name: string): Promise<T | null> {
    await requireUser()
    const piece = await pieceRow(id)
    if (piece === null) return null
    const { data, error } = await port.storage.from('pieces').download(`${piece.owner_id}/${piece.id}/${name}`)
    if (error !== null) {
      if (isMissingFile(error)) return null
      throw new Error(error.message)
    }
    return data === null ? null : (JSON.parse(await data.text()) as T)
  }

  return {
    async listPieces() {
      const user = await requireUser()
      const { data, error } = await port.from('pieces').select<PieceRow>(PIECE_COLUMNS).order('created_at', { ascending: false })
      fail(error)
      const pieces = data ?? []
      if (pieces.length === 0) return []
      const ids = pieces.map((piece) => piece.id)
      const owned = new Set(pieces.filter((piece) => piece.owner_id === user.id).map((piece) => piece.id))
      const [parts, audio, jobs, names, joined] = await Promise.all([
        files(ids),
        recordings(ids),
        latestJobs(ids, owned),
        ownerNames(ids),
        port.from('piece_members').select<{ piece_id: string; joined_at: string }>('piece_id, joined_at').eq('user_id', user.id),
      ])
      fail(joined.error)
      // A member's card shows no review count, so a member's boxes are not read here.
      const ownedMaps = owned.size === 0 ? new Map<string, { timing: TimingLayer; pages: PageLayer[] }>() : await maps([...owned], parts.filter((part) => owned.has(part.piece_id)))
      return pieces.map((piece): PieceSummary => {
        const map = ownedMaps.get(piece.id)
        const job = jobs.get(piece.id)
        return {
          id: piece.id,
          title: piece.title,
          createdAt: piece.created_at,
          partCount: parts.filter((part) => part.piece_id === piece.id).length,
          pageCount: parts.filter((part) => part.piece_id === piece.id).reduce((sum, part) => sum + part.page_count, 0),
          durationSec: audio.find((row) => row.piece_id === piece.id)?.duration ?? null,
          job: job === undefined ? null : jobFromRow(job),
          review: map === undefined ? NO_REVIEW : pieceReview(map.timing, map.pages),
          role: roleOf({ ownerId: piece.owner_id }, user.id),
          ownerName: names.get(piece.id) ?? null,
          joinedAt: joined.data?.find((row) => row.piece_id === piece.id)?.joined_at ?? null,
          isSample: isSample(piece),
        }
      })
    },

    async getPiece(id) {
      const user = await requireUser()
      const row = await pieceRow(id)
      if (row === null) return null
      const owned = row.owner_id === user.id
      const [parts, audio, jobs] = await Promise.all([files([id]), recordings([id]), latestJobs([id], new Set(owned ? [id] : []))])
      const map = owned ? (await maps([id], parts)).get(id) : undefined
      const ordered = [...parts].sort((a, b) => a.position - b.position)
      const job = jobs.get(id)
      return {
        piece: await toPiece(row, parts, audio[0], user),
        parts: ordered.map((part, index): PartSummary => ({
          id: part.id,
          name: part.name,
          position: part.position,
          pageCount: part.page_count,
          review: map === undefined ? NO_REVIEW : partReview(map.timing, map.pages[index]!),
        })),
        job: job === undefined ? null : jobFromRow(job),
        review: map === undefined ? NO_REVIEW : pieceReview(map.timing, map.pages),
        recordingLabel: recordingLabelOf(audio[0]),
        sampleCredits: isSample(row) ? readCredits(row.sample_credits) : null,
      }
    },

    async getPieceMap(pieceId) {
      const user = await requireUser()
      const row = await pieceRow(pieceId)
      if (row === null) return null
      const [parts, audio] = await Promise.all([files([pieceId]), recordings([pieceId])])
      const map = (await maps([pieceId], parts)).get(pieceId)!
      const result: PieceMap = { piece: await toPiece(row, parts, audio[0], user), timing: map.timing, pages: map.pages, structureSetAt: row.structure_set_at }
      return result
    },

    async getPartPages(pieceId, partId) {
      await requireUser()
      if (!isUuid(pieceId) || !isUuid(partId)) return []
      const pages = await selectAll(() => port.from('score_pages').select<{ id: string; score_file_id: string; page_index: number; image_path: string; width: number; height: number }>('id, score_file_id, page_index, image_path, width, height').eq('score_file_id', partId))
      if (pages.length === 0) return []
      const { data: part, error } = await port.from('score_files').select<{ id: string }>('id').eq('id', partId).eq('piece_id', pieceId).maybeSingle()
      fail(error)
      if (part === null) return []
      const ordered = pages.sort((a, b) => a.page_index - b.page_index)
      const urls = await signed(ordered.map((page) => page.image_path))
      return ordered.map((page, index): PageImage => ({ pageIndex: page.page_index, width: page.width, height: page.height, url: urls[index]! }))
    },

    async getAudioUrl(pieceId) {
      await requireUser()
      if (!isUuid(pieceId)) return null
      const { data, error } = await port.from('audio_sources').select<{ stored_path: string | null }>('stored_path').eq('piece_id', pieceId).limit(1).maybeSingle()
      fail(error)
      if (data?.stored_path === null || data?.stored_path === undefined) return null
      return (await signed([data.stored_path]))[0]!
    },

    async getPeaks(id) {
      const peaks = await stored<{ data: number[] }>(id, 'peaks.json')
      return peaks === null ? null : peaks.data.map((peak) => peak / PEAK_MAX)
    },

    getBeats: (id) => stored<DetectedBeat[]>(id, 'beats.json'),

    async getJob(jobId) {
      const user = await requireUser()
      if (!isUuid(jobId)) return null
      const { data, error } = await port.from('jobs').select<JobRow>(JOB_MEMBER).eq('id', jobId).maybeSingle()
      fail(error)
      if (data === null) return null
      const piece = await pieceRow(data.piece_id)
      if (piece?.owner_id !== user.id) return jobFromRow(data)
      const full = await port.from('jobs').select<JobRow>(JOB_OWNER).eq('id', jobId).maybeSingle()
      fail(full.error)
      return full.data === null ? null : jobFromRow(full.data)
    },
  } satisfies Pick<DataClient, 'listPieces' | 'getPiece' | 'getPieceMap' | 'getPartPages' | 'getAudioUrl' | 'getPeaks' | 'getBeats' | 'getJob'>
}
