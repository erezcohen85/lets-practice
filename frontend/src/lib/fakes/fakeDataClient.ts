import { roleOf } from '@/domain/access'
import { MAX_PART_NAME, MAX_RECORDING_NAME, recordingNameFromFile, requireName } from '@/domain/names'
import { normalizePracticeMemory } from '@/domain/practice'
import { DEFAULT_COUNT_IN_BARS } from '@/domain/tempo'
import { TERMS_VERSION } from '@/domain/terms'
import { type Job, type Piece, type PieceMap, type TimingLayer } from '@/domain/types'
import {
  type DataClient,
  type PageImage,
  type PartSummary,
  type PieceDetail,
  type PieceSummary,
  type Profile,
  type User,
} from '@/lib/dataClient'
import { clickTrackUrl } from '@/lib/fakes/clickTrack'
import { adminOverview, saveAdminChanges } from '@/lib/fakes/fakePlans'
import { addStoredSplitParts, requireSplit } from '@/lib/fakes/fakeSplit'
import {
  addStoredParts,
  advanceJob,
  copySettings,
  DEMO_USER,
  findReadablePiece,
  heldMembers,
  latestJobOf,
  memberLimitOf,
  memoryOf,
  newCreatedAt,
  nextId,
  partsOf,
  requireAdmin,
  planStateOf,
  recordUsage,
  requireAllowed,
  requireNoAdmin,
  requireOwnPiece,
  requireRoomForParts,
  requireUser,
  reviewOfPart,
  reviewOfPiece,
  type FakeStore,
  type StoredMap,
  type StoredPiece,
  type StoredPart,
} from '@/lib/fakes/store'

/** The data client on the in-memory store. Whatever it hands out is a copy: callers cannot change the store. */
export function createFakeDataClient(store: FakeStore): DataClient {
  function notify(user: User | null): void {
    for (const listener of [...store.listeners]) listener(user === null ? null : { ...user })
  }

  /** The piece's latest job after one more stage (reading a job moves it on), as a copy; null before any job. */
  function readLatestJob(pieceId: string): Job | null {
    const stored = latestJobOf(store, pieceId)
    if (stored === undefined) return null
    advanceJob(store, stored)
    return { ...stored.job }
  }

  function toPiece(stored: StoredPiece, parts: StoredPart[], user: User): Piece {
    const recording = store.recordings.get(stored.id)
    const memory = memoryOf(store, user, stored)
    return {
      id: stored.id,
      title: stored.title,
      createdAt: stored.createdAt,
      role: roleOf(stored, user.id),
      ownerName: store.users.get(stored.ownerId)?.name ?? null,
      recording:
        recording === undefined
          ? null
          : {
              kind: recording.kind,
              urlOrPath: recording.name,
              durationSec: stored.durationSec,
            },
      parts: parts.map((part) => ({ id: part.id, name: part.name, pageCount: part.pageCount })),
      countInBars: memory.countInBars,
      practice: normalizePracticeMemory(memory.practice),
      lastPartId: memory.lastPartId,
    }
  }

  function toSummary(stored: StoredPiece, user: User): PieceSummary {
    const job = readLatestJob(stored.id)
    const parts = partsOf(store, stored.id)
    return {
      id: stored.id,
      title: stored.title,
      createdAt: stored.createdAt,
      partCount: parts.length,
      pageCount: parts.reduce((sum, part) => sum + part.pageCount, 0),
      durationSec: stored.durationSec,
      job,
      review: reviewOfPiece(store, stored.id),
      role: roleOf(stored, user.id),
      ownerName: store.users.get(stored.ownerId)?.name ?? null,
      joinedAt: store.members.get(stored.id)?.get(user.id) ?? null,
      isSample: stored.sampleOf !== undefined,
    }
  }

  /** The piece's stored map, started empty if processing has not made one. */
  function mapOf(pieceId: string): StoredMap {
    let map = store.maps.get(pieceId)
    if (map === undefined) {
      map = { timing: structuredClone(EMPTY_TIMING), pages: new Map() }
      store.maps.set(pieceId, map)
    }
    return map
  }

  function copyProfile(userId: string): Profile {
    const profile = store.profiles.get(userId)
    const user = store.users.get(userId)
    if (profile === undefined || user === undefined) throw new Error('profile not found')
    return {
      acceptedTermsAt: profile.acceptedTermsAt,
      acceptedTermsVersion: profile.acceptedTermsVersion,
      settings: copySettings(profile.settings),
      isAdmin: store.admins.has(userId),
      displayName: user.name,
      email: user.email,
      sampleGivenAt: profile.sampleGivenAt,
    }
  }

  return {
    async getUser() {
      const user = store.currentUserId === null ? undefined : store.users.get(store.currentUserId)
      return user === undefined ? null : { ...user }
    },

    onUserChange(listener) {
      store.listeners.add(listener)
      return () => {
        store.listeners.delete(listener)
      }
    },

    // The fake has no Google to leave for: it ignores `next` and signs the demo user in at once.
    async signInWithGoogle() {
      store.currentUserId = DEMO_USER.id
      notify(DEMO_USER)
      return { ...DEMO_USER }
    },

    async signOut() {
      // Signed in is what the session says, not whether the account still exists: signOut works after deleteAccount, as Supabase's does.
      if (store.currentUserId === null) throw new Error('not signed in')
      store.currentUserId = null
      notify(null)
    },

    async getProfile() {
      return copyProfile(requireUser(store).id)
    },

    async acceptTerms() {
      const user = requireUser(store)
      const profile = store.profiles.get(user.id)
      if (profile !== undefined) {
        profile.acceptedTermsAt = new Date().toISOString()
        profile.acceptedTermsVersion = TERMS_VERSION
      }
      return copyProfile(user.id)
    },

    async saveSettings(settings) {
      const user = requireUser(store)
      const profile = store.profiles.get(user.id)
      if (profile !== undefined) profile.settings = copySettings(settings)
      return copyProfile(user.id)
    },

    async listPieces() {
      const user = requireUser(store)
      return [...store.pieces.values()]
        .filter((piece) => findReadablePiece(store, user, piece.id) !== undefined)
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
        .map((piece) => toSummary(piece, user))
    },

    async getPiece(id) {
      const user = requireUser(store)
      const stored = findReadablePiece(store, user, id)
      if (stored === undefined) return null
      const job = readLatestJob(id)
      const parts = partsOf(store, id)
      const detail: PieceDetail = {
        piece: toPiece(stored, parts, user),
        parts: parts.map((part): PartSummary => ({
          id: part.id,
          name: part.name,
          position: part.position,
          pageCount: part.pageCount,
          review: reviewOfPart(store, part),
        })),
        job,
        review: reviewOfPiece(store, id),
        recordingLabel: recordingLabel(store, id),
        sampleCredits: stored.sampleCredits === undefined ? null : structuredClone(stored.sampleCredits),
      }
      return detail
    },

    async createPiece(input) {
      const user = requireUser(store)
      // The pieces insert policy and then the score_files one (migration 0015); the fake refuses before making anything.
      requireAllowed(store, user, { type: 'createPiece' })
      requireRoomForParts(
        store,
        user,
        null,
        input.parts.length + (input.split?.parts.length ?? 0),
        input.parts.filter((part) => part.boxCheck === true).length + (input.split?.boxChecks?.filter(Boolean).length ?? 0),
      )
      // A split the processor refuses makes no piece, as with the real upload.
      if (input.split !== undefined) requireSplit(store, input.split)
      const stored: StoredPiece = {
        id: nextId(store, 'piece'),
        ownerId: user.id,
        title: input.title,
        createdAt: newCreatedAt(store),
        countInBars: DEFAULT_COUNT_IN_BARS,
        practice: {},
        lastPartId: null,
        durationSec: null,
      }
      store.pieces.set(stored.id, stored)
      recordUsage(store, user, 'piece_created', stored.id)
      store.recordings.set(
        stored.id,
        {
          kind: 'file',
          name: input.recording.file.name,
          size: input.recording.file.size,
          title: recordingNameFromFile(input.recording.file.name),
        },
      )
      if (input.split === undefined) addStoredParts(store, stored.id, input.parts)
      else addStoredSplitParts(store, stored.id, input.split)
      return toPiece(stored, partsOf(store, stored.id), user)
    },

    async storeParts(pieceId, parts, split) {
      const user = requireUser(store)
      requireOwnPiece(store, user, pieceId)
      requireRoomForParts(
        store,
        user,
        pieceId,
        parts.length + (split?.parts.length ?? 0),
        parts.filter((part) => part.boxCheck === true).length + (split?.boxChecks?.filter(Boolean).length ?? 0),
      )
      if (split !== undefined) requireSplit(store, split)
      const added = split === undefined ? addStoredParts(store, pieceId, parts) : addStoredSplitParts(store, pieceId, split)
      return added.map((part) => ({ id: part.id, name: part.name, pageCount: part.pageCount }))
    },

    async renamePiece(id, title) {
      requireOwnPiece(store, requireUser(store), id).title = title
    },

    async renamePart(pieceId, partId, name) {
      requireOwnPiece(store, requireUser(store), pieceId)
      const part = partsOf(store, pieceId).find((stored) => stored.id === partId)
      if (part === undefined) throw new Error('part not found')
      part.name = requireName(name, MAX_PART_NAME)
    },

    async renameRecording(pieceId, name) {
      requireOwnPiece(store, requireUser(store), pieceId)
      const recording = store.recordings.get(pieceId)
      if (recording === undefined) throw new Error('recording not found')
      recording.title = requireName(name, MAX_RECORDING_NAME)
    },

    async deletePiece(id) {
      requireOwnPiece(store, requireUser(store), id)
      store.shares.delete(id)
      store.members.delete(id)
      for (const key of [...store.memberMemory.keys()]) if (key.endsWith(`:${id}`)) store.memberMemory.delete(key)
      store.pieces.delete(id)
      store.recordings.delete(id)
      store.peaks.delete(id)
      store.beats.delete(id)
      store.maps.delete(id)
      store.recordingTimings.delete(id)
      store.clickTracks.delete(id)
      for (const part of partsOf(store, id)) {
        store.parts.delete(part.id)
        store.pageImages.delete(part.id)
      }
      for (const [jobId, stored] of store.jobs) if (stored.job.pieceId === id) store.jobs.delete(jobId)
    },

    async deleteStagedFiles() {
      requireUser(store)
      store.splits.clear() // the fake's staged PDFs are the splits it keeps; they belong to the one signed-in user
    },

    async deleteAccount() {
      const user = requireUser(store)
      requireNoAdmin(store, user)
      if ([...store.pieces.values()].some((piece) => piece.ownerId === user.id)) throw new Error('delete your pieces first')
      for (const [pieceId, joined] of store.members) {
        if (joined.delete(user.id)) store.memberMemory.delete(`${user.id}:${pieceId}`)
      }
      for (const key of [...store.memberMemory.keys()]) if (key.startsWith(`${user.id}:`)) store.memberMemory.delete(key)
      // The trial ledger keeps how many pieces the email had made (delete_account, migration 0015); the events go with the account.
      const made = store.usageEvents.filter((event) => event.userId === user.id && event.kind === 'piece_created' && event.voidedAt === null).length
      const key = user.email.toLowerCase()
      store.ledger.set(key, (store.ledger.get(key) ?? 0) + made)
      store.usageEvents = store.usageEvents.filter((event) => event.userId !== user.id)
      store.profiles.delete(user.id)
      store.users.delete(user.id)
    },

    async deletePart(pieceId, partId) {
      const stored = requireOwnPiece(store, requireUser(store), pieceId)
      const parts = partsOf(store, pieceId)
      if (!parts.some((part) => part.id === partId)) throw new Error('part not found')
      if (parts.length === 1) throw new Error('a piece needs at least one part')
      store.parts.delete(partId)
      store.pageImages.delete(partId)
      store.maps.get(pieceId)?.pages.delete(partId)
      // The parts that are left close up their positions, as the local run's file does.
      for (const [position, part] of partsOf(store, pieceId).entries()) part.position = position
      if (stored.lastPartId === partId) stored.lastPartId = null
      for (const [key, memory] of store.memberMemory) if (key.endsWith(`:${pieceId}`) && memory.lastPartId === partId) memory.lastPartId = null
    },

    async setCountInBars(id, bars) {
      const user = requireUser(store)
      const piece = findReadablePiece(store, user, id)
      if (piece === undefined) throw new Error('piece not found')
      memoryOf(store, user, piece).countInBars = bars
    },

    async setLastPart(pieceId, partId) {
      const user = requireUser(store)
      const piece = findReadablePiece(store, user, pieceId)
      if (piece === undefined) throw new Error('piece not found')
      if (!partsOf(store, pieceId).some((part) => part.id === partId)) throw new Error('part not found')
      memoryOf(store, user, piece).lastPartId = partId
    },

    async savePracticeMemory(pieceId, memory) {
      const user = requireUser(store)
      const piece = findReadablePiece(store, user, pieceId)
      if (piece === undefined) throw new Error('piece not found')
      memoryOf(store, user, piece).practice = normalizePracticeMemory(memory)
    },

    async getPeaks(id) {
      if (findReadablePiece(store, requireUser(store), id) === undefined) return null
      const peaks = store.peaks.get(id)
      return peaks === undefined ? null : [...peaks]
    },

    async getBeats(id) {
      if (findReadablePiece(store, requireUser(store), id) === undefined) return null
      const beats = store.beats.get(id)
      return beats === undefined ? null : beats.map((beat) => ({ ...beat }))
    },

    async getJob(jobId) {
      const user = requireUser(store)
      const stored = store.jobs.get(jobId)
      if (stored === undefined || findReadablePiece(store, user, stored.job.pieceId) === undefined) return null
      advanceJob(store, stored)
      return { ...stored.job }
    },

    async getPieceMap(pieceId) {
      const user = requireUser(store)
      const stored = findReadablePiece(store, user, pieceId)
      if (stored === undefined) return null
      const parts = partsOf(store, pieceId)
      const map = store.maps.get(pieceId)
      const detail: PieceMap = {
        piece: toPiece(stored, parts, user),
        timing: structuredClone(map?.timing ?? EMPTY_TIMING),
        pages: parts.map((part) => structuredClone(map?.pages.get(part.id) ?? { partId: part.id, bars: [], rests: [] })),
        structureSetAt: map?.structureSetAt ?? null,
      }
      return detail
    },

    async getPartPages(pieceId, partId) {
      if (findReadablePiece(store, requireUser(store), pieceId) === undefined) return []
      if (!partsOf(store, pieceId).some((part) => part.id === partId)) return []
      return (store.pageImages.get(partId) ?? []).map((image): PageImage => ({ ...image }))
    },

    async saveTiming(pieceId, timing) {
      requireOwnPiece(store, requireUser(store), pieceId)
      mapOf(pieceId).timing = structuredClone(timing)
    },

    async saveStructureSetAt(pieceId, at) {
      requireOwnPiece(store, requireUser(store), pieceId)
      mapOf(pieceId).structureSetAt = at
    },

    async savePageLayer(pieceId, page) {
      requireOwnPiece(store, requireUser(store), pieceId)
      if (!partsOf(store, pieceId).some((part) => part.id === page.partId)) throw new Error('part not found')
      mapOf(pieceId).pages.set(page.partId, structuredClone(page))
    },

    async getAudioUrl(pieceId) {
      const stored = findReadablePiece(store, requireUser(store), pieceId)
      const timing = store.recordingTimings.get(pieceId)
      if (stored === undefined || timing === undefined || stored.durationSec === null) return null
      if (timing.barCount < 1) return null
      // A recording does not change when the map is edited: it is made from the timing the synthetic piece began with.
      const made = store.clickTracks.get(pieceId)
      if (made !== undefined && made.durationSec === stored.durationSec) return made.url
      const url = clickTrackUrl(timing, stored.durationSec)
      store.clickTracks.set(pieceId, { durationSec: stored.durationSec, url })
      return url
    },

    async getShare(pieceId) {
      requireOwnPiece(store, requireUser(store), pieceId)
      let share = store.shares.get(pieceId)
      if (share === undefined) {
        share = { token: nextId(store, 'share-token'), enabled: false, rightsConfirmedAt: null }
        store.shares.set(pieceId, share)
      }
      return { ...share }
    },

    async setShareEnabled(pieceId, on, rightsConfirmed = false) {
      const user = requireUser(store)
      requireOwnPiece(store, user, pieceId)
      const share = store.shares.get(pieceId)
      if (share === undefined) return
      // Turning a link on that is off needs room under the plan's shared pieces (set_share_enabled, migration 0015).
      if (on && !share.enabled) requireAllowed(store, user, { type: 'shareOn' })
      // As the database does (migration 0013): a link that is off turns on only with the confirmation, once; one that is
      // already on, made before the rule, stays as it is until it is turned off.
      if (on && rightsConfirmed) share.rightsConfirmedAt ??= newCreatedAt(store)
      if (on && !share.enabled && share.rightsConfirmedAt === null) throw new Error('confirm the rights before sharing this piece')
      share.enabled = on
    },

    async resetShareLink(pieceId) {
      requireOwnPiece(store, requireUser(store), pieceId)
      const old = store.shares.get(pieceId)
      const share = { token: nextId(store, 'share-token'), enabled: old?.enabled ?? false, rightsConfirmedAt: old?.rightsConfirmedAt ?? null }
      store.shares.set(pieceId, share)
      return { ...share }
    },

    async listMembers(pieceId) {
      const user = requireUser(store)
      if (store.pieces.get(pieceId)?.ownerId !== user.id) return []
      const held = heldMembers(store, pieceId)
      return [...(store.members.get(pieceId) ?? new Map<string, string>()).entries()]
        .sort(([, a], [, b]) => b.localeCompare(a))
        .map(([userId, joinedAt]) => {
          const member = store.users.get(userId)
          return { userId, displayName: member?.name ?? null, email: member?.email ?? '', joinedAt, onHold: held.has(userId) }
        })
    },

    async getMemberLimit(pieceId) {
      requireOwnPiece(store, requireUser(store), pieceId)
      return { limit: memberLimitOf(store, pieceId), count: store.members.get(pieceId)?.size ?? 0 }
    },

    async removeMember(pieceId, userId) {
      requireOwnPiece(store, requireUser(store), pieceId)
      store.members.get(pieceId)?.delete(userId)
    },

    async joinPiece(token) {
      const user = requireUser(store)
      const found = [...store.shares.entries()].find(([, share]) => share.token === token)
      if (found === undefined) return { pieceId: null, status: 'not_found' }
      const [pieceId, share] = found
      if (store.pieces.get(pieceId)?.ownerId === user.id) return { pieceId, status: 'owner' }
      if (store.members.get(pieceId)?.has(user.id) === true) return { pieceId, status: 'already_member' }
      if (!share.enabled) return { pieceId: null, status: 'link_off' }
      const members = store.members.get(pieceId) ?? new Map<string, string>()
      if (members.size >= memberLimitOf(store, pieceId)) return { pieceId: null, status: 'full' }
      members.set(user.id, newCreatedAt(store))
      store.members.set(pieceId, members)
      return { pieceId, status: 'joined' }
    },

    async leavePiece(pieceId) {
      const user = requireUser(store)
      if (store.members.get(pieceId)?.delete(user.id) === true) store.memberMemory.delete(`${user.id}:${pieceId}`)
    },

    async listHeldPieces() {
      const user = requireUser(store)
      return [...store.members.entries()]
        .flatMap(([pieceId, joined]) => {
          const piece = store.pieces.get(pieceId)
          const joinedAt = joined.get(user.id)
          if (piece === undefined || joinedAt === undefined || !heldMembers(store, pieceId).has(user.id)) return []
          return [{ id: pieceId, title: piece.title, ownerName: store.users.get(piece.ownerId)?.name ?? null, joinedAt }]
        })
        .sort((a, b) => b.joinedAt.localeCompare(a.joinedAt))
    },

    async myPlan(pieceId) {
      return structuredClone(planStateOf(store, requireUser(store), pieceId))
    },

    async adminOverview() {
      const user = requireUser(store)
      requireAdmin(store, user)
      return adminOverview(store)
    },

    async saveAdminChanges(changes) {
      const user = requireUser(store)
      requireAdmin(store, user)
      saveAdminChanges(store, user, changes)
    },
  }
}

const EMPTY_TIMING: TimingLayer = { barCount: 0, playOrder: [], meters: [], marks: [], locators: [] }

function recordingLabel(store: FakeStore, pieceId: string): string | null {
  const recording = store.recordings.get(pieceId)
  if (recording === undefined) return null
  return recording.title ?? recording.name
}
