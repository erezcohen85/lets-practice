import { type DetectedBeat } from '@/domain/beats'
import { memberLimit, membersOnHold } from '@/domain/memberLimit'
import { partNameFromFile } from '@/domain/newPiece'
import { allowed, type LimitKey, type PlanAction, type PlanId, type PlanRow, type PlanState } from '@/domain/planLimits'
import { partReview, pieceReview } from '@/domain/reviewQueue'
import { shortUnits } from '@/domain/shortBars'
import { DEFAULT_COUNT_IN_BARS } from '@/domain/tempo'
import { type CountInBars, type Job, type JobKind, type JobPart, type PageLayer, type TimingLayer } from '@/domain/types'
import {
  DEFAULT_SETTINGS,
  normaliseSettings,
  type PageImage,
  type ReviewStatus,
  type User,
  type UserSettings,
} from '@/lib/dataClient'
import { type DemoCredit } from '@/lib/demo/demoBundle'
import { PlanLimitError } from '@/lib/processorClient'
import { fakeFill, fakeRealign } from '@/lib/fakes/fakeRealign'
import { applyReviewItems, DEMO_REVIEW_ITEMS, uncheckedItems } from '@/lib/fakes/reviewSeed'
import { DEMO_SPEC, recordingBeats, recordingPeaks, recordingSeconds, syntheticPageLayer, syntheticPages, syntheticTiming, type SyntheticSpec } from '@/lib/fakes/syntheticPiece'

// One in-memory store behind both fakes, plus the rules they share. Nothing here touches the network, localStorage
// or sessionStorage: Supabase is the only persistence layer, so a page reload starts the fakes over.

/** A stage of the processor's job that the fake can be told to fail at (orchestrator.py). */
export type FakeStage = 'audio' | 'pages' | 'omr' | 'play order' | 'downbeats' | 'align'

export const DEMO_USER: User = { id: 'user-demo', email: 'demo@example.com', name: 'Demo' }
/** A second user, so tests can prove that one user never sees the pieces of another. */
export const OTHER_USER: User = { id: 'user-other', email: 'other@example.com', name: 'Other' }
/** A third, for a piece with a link that is off and a person who is neither its owner nor a member. */
export const THIRD_USER: User = { id: 'user-third', email: 'third@example.com', name: 'Third' }

/** A plan assignment (plan_emails): the plan, and when and by whom it was given. */
export interface StoredPlanEmail { planId: PlanId; addedAt: string; addedBy: string | null }
/** One counted action (usage_events). `voidedAt` is set when a refused first processing gives the slot back. */
export interface UsageEvent {
  id: number
  userId: string
  kind: 'piece_created' | 'advanced_reading_part' | 'read_again' | 'realign'
  planId: PlanId
  pieceId: string | null
  partId: string | null
  at: string
  voidedAt: string | null
  /** The piece_created event of a copy of the sample piece: it counts as created and stored, but not toward the day's new pieces. */
  isSample?: boolean
}
/** What the fake keeps of a profile; isAdmin is worked out on read, like the real function. */
export interface StoredProfile {
  acceptedTermsAt: string | null
  acceptedTermsVersion: string | null
  settings: UserSettings
  /** profiles.sample_given_at: when the sample piece was given or skipped; null until asked. */
  sampleGivenAt: string | null
}
/** What Practice remembers. An owner's lives on StoredPiece (as the migration copies it to the owner's row); a member's in memberMemory. */
export interface StoredMemory { countInBars: CountInBars; practice: unknown; lastPartId: string | null }

/** The fake never reads a file: it keeps the name and the size. */
export interface StoredFile { name: string; size: number }
/** `title` is what the recording is called: the user's name for it, or the one it got (the file name without its extension). */
export type StoredRecording = { kind: 'file'; name: string; size: number; title?: string }
export interface StoredPiece {
  id: string
  ownerId: string
  title: string
  createdAt: string
  countInBars: CountInBars
  /** The stored jsonb as it is: `{}` until saved, and any shape the column could hold; the data client normalises it on read. */
  practice: unknown
  /** The part the editor or Practice opened last; null before one was. */
  lastPartId: string | null
  durationSec: number | null
  /** Set on a copy of the sample piece (pieces.sample_of / sample_credits); the credits are the copy's own. */
  sampleOf?: string
  sampleCredits?: DemoCredit[]
}
export interface StoredPart {
  id: string
  pieceId: string
  name: string
  position: number
  file: StoredFile
  pageCount: number
  /** The Advanced Reading tick the part was uploaded with (score_files.box_check). */
  boxCheck?: boolean
}
export interface StoredMap { timing: TimingLayer; pages: Map<string, PageLayer>; structureSetAt?: string | null }
/** stagesDone is how many stages of the job's ladder have finished. */
export interface StoredJob { job: Job; stagesDone: number }

export interface FakeStore {
  users: Map<string, User>
  /** The signed-in user, or null. */
  currentUserId: string | null
  listeners: Set<(user: User | null) => void>
  profiles: Map<string, StoredProfile>
  admins: Set<string>
  /** The three plans (migration 0015), by id; a null number means no limit. Tests change them with setPlanLimits. */
  plans: Map<PlanId, PlanRow>
  /** Lower case; kept by email so a plan can be given before a first sign-in. Nobody listed is on Trial. */
  planEmails: Map<string, StoredPlanEmail>
  /** Every counted action, oldest first (usage_events). */
  usageEvents: UsageEvent[]
  /** Pieces made by deleted accounts, by lower-case email (the database keeps a hash of it: trial_ledger). */
  ledger: Map<string, number>
  /** When each user last signed in (ISO), by user id. */
  lastSignIn: Map<string, string>
  /** By piece id. */
  shares: Map<string, { token: string; enabled: boolean; rightsConfirmedAt: string | null }>
  /** By piece id, then user id: when they joined. */
  members: Map<string, Map<string, string>>
  /** By `${userId}:${pieceId}`. */
  memberMemory: Map<string, StoredMemory>
  pieces: Map<string, StoredPiece>
  parts: Map<string, StoredPart>
  /** By piece id. */
  recordings: Map<string, StoredRecording>
  /** In the order the jobs were started. */
  jobs: Map<string, StoredJob>
  /** By piece id; there once a processing job has finished. */
  peaks: Map<string, number[]>
  /** By piece id: the beats the beat tracker found; missing for a piece whose run did not keep them. */
  beats: Map<string, DetectedBeat[]>
  /** By piece id: the timing layer and the page layers (by part id); there once a processing job has finished. */
  maps: Map<string, StoredMap>
  /** By part id: the part's page images; there once a processing job has finished. */
  pageImages: Map<string, PageImage[]>
  /**
   * The stage the next job fails at. It is cleared when a job has failed there, so a retry gets through; set it
   * again to make another job fail.
   */
  failStage?: FakeStage
  counters: Map<string, number>
  /** By piece id: the timing the synthetic piece was made with. The fakes' recording is built from it and never changes with the map. */
  recordingTimings: Map<string, TimingLayer>
  /** By piece id: the fakes' recording as a data URL, built on first use from recordingTimings. */
  clickTracks: Map<string, { durationSec: number; url: string }>
  /** By split id: a PDF with several parts that proposeSplit has read and no upload has used yet. */
  splits: Map<string, { pageCount: number; fullScore: boolean; fileName: string }>
  /** Every reprocessPart the processor fake was asked for, in order, with the box check tick it got (tests read it). */
  reprocessed: Array<{ pieceId: string; partId: string; boxCheck: boolean }>
}

export function createStore(): FakeStore {
  const people = [DEMO_USER, OTHER_USER, THIRD_USER]
  return {
    users: new Map(people.map((user): [string, User] => [user.id, { ...user }])),
    currentUserId: null,
    listeners: new Set(),
    profiles: new Map(
      people.map((user): [string, StoredProfile] => [user.id, { acceptedTermsAt: null, acceptedTermsVersion: null, settings: copySettings(DEFAULT_SETTINGS), sampleGivenAt: null }]),
    ),
    admins: new Set([DEMO_USER.id]),
    plans: seedPlans(),
    planEmails: new Map(),
    usageEvents: [],
    ledger: new Map(),
    lastSignIn: seedLastSignIns(people),
    shares: new Map(),
    members: new Map(),
    memberMemory: new Map(),
    pieces: new Map(),
    parts: new Map(),
    recordings: new Map(),
    jobs: new Map(),
    peaks: new Map(),
    beats: new Map(),
    maps: new Map(),
    pageImages: new Map(),
    counters: new Map(),
    recordingTimings: new Map(),
    clickTracks: new Map(),
    splits: new Map(),
    reprocessed: [],
  }
}

export function nextId(store: FakeStore, prefix: string): string {
  const next = (store.counters.get(prefix) ?? 0) + 1
  store.counters.set(prefix, next)
  return `${prefix}-${next}`
}

/** A copy of the settings, made whole the way a real data client does on read. */
export function copySettings(settings: UserSettings): UserSettings {
  return normaliseSettings(settings)
}

// --- who is signed in, and what they can see ---------------------------------

export function requireUser(store: FakeStore): User {
  const user = store.currentUserId === null ? undefined : store.users.get(store.currentUserId)
  if (user === undefined) throw new Error('not signed in')
  return user
}

/** The piece, if it belongs to the user; a piece of another user does not exist for them. */
export function findOwnPiece(store: FakeStore, user: User, pieceId: string): StoredPiece | undefined {
  const piece = store.pieces.get(pieceId)
  return piece !== undefined && piece.ownerId === user.id ? piece : undefined
}

export function requireOwnPiece(store: FakeStore, user: User, pieceId: string): StoredPiece {
  const piece = findOwnPiece(store, user, pieceId)
  if (piece === undefined) throw new Error('piece not found')
  return piece
}

/** Signs the user in, as the real session would after Google returns, and tells the listeners. */
export function signInAs(store: FakeStore, userId: string): void {
  store.currentUserId = userId
  store.lastSignIn.set(userId, new Date().toISOString())
  const user = store.users.get(userId)
  for (const listener of [...store.listeners]) listener(user === undefined ? null : { ...user })
}

// --- plans and usage (migration 0015) --------------------------------------------

/** The three seed rows of the design doc's table. */
function seedPlans(): Map<PlanId, PlanRow> {
  const base = {
    pieces_created_max: null,
    pieces_stored_max: null,
    parts_per_piece_max: null,
    pages_per_part_max: 100,
    recording_minutes_max: 20,
    advanced_reading: true,
    advanced_reading_parts_per_month: null,
    split_pdf: true,
    suggest_name: true,
    shared_pieces_max: null,
    members_per_piece: 30,
    members_per_part: 10,
    read_again_per_part_max: null,
    realign_per_piece_max: null,
    new_pieces_per_day: null,
    new_pieces_paused: false,
  } satisfies Omit<PlanRow, 'id' | 'name' | 'position'>
  const trial: PlanRow = {
    ...base,
    id: 'trial',
    name: 'Trial',
    position: 0,
    pieces_created_max: 3,
    pieces_stored_max: 3,
    parts_per_piece_max: 1,
    pages_per_part_max: 20,
    recording_minutes_max: 10,
    advanced_reading: false,
    advanced_reading_parts_per_month: 0,
    split_pdf: false,
    shared_pieces_max: 1,
    read_again_per_part_max: 2,
    realign_per_piece_max: 5,
    new_pieces_per_day: 20,
  }
  const creator: PlanRow = { ...base, id: 'creator', name: 'Creator', position: 1, pieces_stored_max: 50, advanced_reading_parts_per_month: 30, read_again_per_part_max: 10 }
  const unlimited: PlanRow = { ...base, id: 'unlimited', name: 'Unlimited', position: 2 }
  return new Map([trial, creator, unlimited].map((row): [PlanId, PlanRow] => [row.id, row]))
}

const DAY_MS = 24 * 60 * 60 * 1000

/** The demo user signed in a moment ago, the others some days back, so People has something to sort. */
function seedLastSignIns(people: User[]): Map<string, string> {
  const now = Date.now()
  return new Map(people.map((user, index): [string, string] => [user.id, new Date(now - [0, 2, 12][index]! * DAY_MS).toISOString()]))
}

/** Puts an email on a plan, as the admin's People tab does (no check that it is an email: tests give clean ones). */
export function setPlan(store: FakeStore, email: string, planId: PlanId): void {
  const key = email.toLowerCase()
  store.planEmails.set(key, { planId, addedAt: newCreatedAt(store), addedBy: null })
}

/** Changes numbers of a plan, as the admin's Plans tab does. */
export function setPlanLimits(store: FakeStore, planId: PlanId, values: Partial<Record<LimitKey, number | boolean | null>>): void {
  const row = store.plans.get(planId)
  if (row === undefined) throw new Error(`unknown plan: ${planId}`)
  store.plans.set(planId, { ...row, ...values } as PlanRow)
}

/** The plan row that counts for the user: the admin is Unlimited, else their email's plan, else Trial. */
export function planRowOf(store: FakeStore, user: User): PlanRow {
  const id: PlanId = store.admins.has(user.id) ? 'unlimited' : (store.planEmails.get(user.email.toLowerCase())?.planId ?? 'trial')
  return store.plans.get(id)!
}

/** Counts a counted action for the user, as the trigger and the processor do. */
export function recordUsage(store: FakeStore, user: User, kind: UsageEvent['kind'], pieceId: string | null, partId: string | null = null, at: string = new Date().toISOString()): void {
  store.usageEvents.push({ id: store.usageEvents.length + 1, userId: user.id, kind, planId: planRowOf(store, user).id, pieceId, partId, at, voidedAt: null })
}

/** The start of today and of this month, UTC. */
function windowStarts(): { day: string; month: string } {
  const now = new Date()
  return {
    day: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString(),
    month: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString(),
  }
}

/** What my_plan() returns for the user (and, if it is theirs, for one piece). */
export function planStateOf(store: FakeStore, user: User, pieceId?: string): PlanState {
  const plan = planRowOf(store, user)
  const { day, month } = windowStarts()
  const live = store.usageEvents.filter((event) => event.voidedAt === null)
  const mine = live.filter((event) => event.userId === user.id)
  const owned = [...store.pieces.values()].filter((piece) => piece.ownerId === user.id)
  const piece = pieceId === undefined ? undefined : owned.find((own) => own.id === pieceId)
  const readAgain: Record<string, number> = {}
  for (const event of mine) if (event.kind === 'read_again' && event.pieceId === piece?.id && event.partId !== null) readAgain[event.partId] = (readAgain[event.partId] ?? 0) + 1
  return {
    is_admin: store.admins.has(user.id),
    plan: { ...plan },
    usage: {
      pieces_created: mine.filter((event) => event.kind === 'piece_created').length + (store.ledger.get(user.email.toLowerCase()) ?? 0),
      pieces_stored: owned.length,
      shared_pieces: owned.filter((own) => store.shares.get(own.id)?.enabled === true).length,
      advanced_reading_parts_this_month: mine.filter((event) => event.kind === 'advanced_reading_part' && event.at >= month).length,
      new_pieces_today_on_plan: live.filter((event) => event.kind === 'piece_created' && event.isSample !== true && event.planId === plan.id && event.at >= day).length,
    },
    piece:
      piece === undefined
        ? null
        : {
            id: piece.id,
            parts: partsOf(store, piece.id).length,
            realigns: mine.filter((event) => event.kind === 'realign' && event.pieceId === piece.id).length,
            read_again_by_part: readAgain,
          },
  }
}

/** Throws PlanLimitError for the first limit the action runs into, as the database and the processor do; the admin is never limited. */
export function requireAllowed(store: FakeStore, user: User, action: PlanAction, pieceId?: string): void {
  const verdict = allowed(planStateOf(store, user, pieceId), action)
  if (!verdict.ok) throw new PlanLimitError(verdict.limit)
}

/** Adding parts: the part count and the Advanced Reading tick, as the score_files insert policy asks. `ticks` is how many of them are ticked. */
export function requireRoomForParts(store: FakeStore, user: User, pieceId: string | null, adding: number, ticks: number): void {
  const state = planStateOf(store, user, pieceId ?? undefined)
  if (state.is_admin || adding === 0) return
  const have = state.piece?.parts ?? 0
  const verdict = allowed(state, { type: 'addPart', partsAfter: have + adding })
  if (!verdict.ok) throw new PlanLimitError(verdict.limit)
  if (ticks > 0 && !state.plan.advanced_reading) throw new PlanLimitError('advanced_reading')
}

export function requireAdmin(store: FakeStore, user: User): void {
  if (!store.admins.has(user.id)) throw new Error('admin only')
}

/** The admin's account cannot be deleted: the app has no way to add another admin. */
export function requireNoAdmin(store: FakeStore, user: User): void {
  if (store.admins.has(user.id)) throw new Error('the admin cannot delete their account')
}

/**
 * The piece, if the user owns it or joined it and is not on hold; anything else does not exist for them. The one check of
 * every member read, as can_read_piece is in the database (migration 0014).
 */
export function findReadablePiece(store: FakeStore, user: User, pieceId: string): StoredPiece | undefined {
  const piece = store.pieces.get(pieceId)
  if (piece === undefined) return undefined
  if (piece.ownerId === user.id) return piece
  return store.members.get(pieceId)?.has(user.id) === true && !heldMembers(store, pieceId).has(user.id) ? piece : undefined
}

/** How many members the piece admits: from its owner's plan (members per piece, members per part), and its number of parts. */
export function memberLimitOf(store: FakeStore, pieceId: string): number {
  const owner = store.users.get(store.pieces.get(pieceId)?.ownerId ?? '')
  const plan = owner === undefined ? store.plans.get('trial')! : planRowOf(store, owner)
  return memberLimit(plan.members_per_piece!, plan.members_per_part!, partsOf(store, pieceId).length)
}

/** The ids of the piece's members who are on hold: the newest joiners over its limit. Worked out each time, never stored. */
export function heldMembers(store: FakeStore, pieceId: string): Set<string> {
  const joined = [...(store.members.get(pieceId) ?? new Map<string, string>()).entries()].map(([userId, joinedAt]) => ({ userId, joinedAt }))
  return membersOnHold(joined, memberLimitOf(store, pieceId))
}

/** The memory the user reads and writes for this piece: a member's starts at the defaults. */
export function memoryOf(store: FakeStore, user: User, piece: StoredPiece): StoredMemory {
  if (piece.ownerId === user.id) return piece
  const key = `${user.id}:${piece.id}`
  let memory = store.memberMemory.get(key)
  if (memory === undefined) {
    memory = { countInBars: DEFAULT_COUNT_IN_BARS, practice: {}, lastPartId: null }
    store.memberMemory.set(key, memory)
  }
  return memory
}

/**
 * A time that is later than every piece, join and plan assignment so far, so a new one is always first in a newest-first
 * list, even when two are made within one millisecond.
 */
export function newCreatedAt(store: FakeStore): string {
  let newest = 0
  for (const piece of store.pieces.values()) newest = Math.max(newest, Date.parse(piece.createdAt))
  for (const joins of store.members.values()) for (const joinedAt of joins.values()) newest = Math.max(newest, Date.parse(joinedAt))
  for (const { addedAt } of store.planEmails.values()) newest = Math.max(newest, Date.parse(addedAt))
  return new Date(Math.max(Date.now(), newest + 1)).toISOString()
}

/** Stores the files and rows of new parts after the piece's own, in the given order (what the data client does for createPiece and storeParts). */
export function addStoredParts(store: FakeStore, pieceId: string, parts: Array<{ file: File; name: string; boxCheck?: boolean }>): StoredPart[] {
  const first = partsOf(store, pieceId).length
  return parts.map((part, index) => {
    const id = nextId(store, 'part')
    const stored: StoredPart = {
      id,
      pieceId,
      name: part.name.trim() || partNameFromFile(part.file.name),
      position: first + index,
      file: { name: part.file.name, size: part.file.size },
      pageCount: 0,
      ...(part.boxCheck === true ? { boxCheck: true } : {}),
    }
    store.parts.set(id, stored)
    return stored
  })
}

export function partsOf(store: FakeStore, pieceId: string): StoredPart[] {
  return [...store.parts.values()].filter((part) => part.pieceId === pieceId).sort((a, b) => a.position - b.position)
}

// The review numbers are worked out from the stored map, as the real app does from the locators (Decision 2026-10-29):
// a piece or part without a map has nothing to review yet.

/** "x of y checked" of one part: the piece's shared items plus the part's own problems. */
export function reviewOfPart(store: FakeStore, part: StoredPart): ReviewStatus {
  const map = store.maps.get(part.pieceId)
  if (map === undefined) return { checked: 0, total: 0 }
  return partReview(map.timing, map.pages.get(part.id) ?? { partId: part.id, bars: [], rests: [] })
}

/** "x of y checked" of a piece: the shared items once, plus every part's own problems. */
export function reviewOfPiece(store: FakeStore, pieceId: string): ReviewStatus {
  const map = store.maps.get(pieceId)
  if (map === undefined) return { checked: 0, total: 0 }
  return pieceReview(
    map.timing,
    partsOf(store, pieceId).map((part) => map.pages.get(part.id) ?? { partId: part.id, bars: [], rests: [] }),
  )
}

// --- jobs --------------------------------------------------------------------

interface LadderStep { stage: string; progress: number }

// The stages of a job and the progress each one reaches, as written by backend/processor/app/pipeline/orchestrator.py.
// After the last stage the job is done at 1.0.
const PROCESS_LADDER: LadderStep[] = [
  { stage: 'audio', progress: 0.2 },
  { stage: 'pages', progress: 0.35 },
  { stage: 'omr', progress: 0.55 },
  { stage: 'play order', progress: 0.65 },
  { stage: 'downbeats', progress: 0.8 },
  { stage: 'align', progress: 0.95 },
]
const REALIGN_LADDER: LadderStep[] = [
  { stage: 'load', progress: 0.1 },
  { stage: 'audio', progress: 0.3 },
  { stage: 'downbeats', progress: 0.6 },
  { stage: 'align', progress: 0.9 },
]

// Adding parts reads their PDFs and finds their bars; the piece's timing, recording and map stay as they are.
const ADD_PARTS_LADDER: LadderStep[] = [
  { stage: 'pages', progress: 0.3 },
  { stage: 'omr', progress: 0.8 },
]

function ladderOf(kind: JobKind): LadderStep[] {
  switch (kind) {
    case 'realign':
      return REALIGN_LADDER
    case 'add-parts':
      return ADD_PARTS_LADDER
    case 'process-piece':
      return PROCESS_LADDER
  }
}

// What the fake processing finds is what its synthetic map then has: the demo piece's length and page count.
const FAKE_DURATION_SEC = Math.round(recordingSeconds(DEMO_SPEC))
export const FAKE_PAGE_COUNT = Math.ceil(DEMO_SPEC.barCount / (DEMO_SPEC.barsPerLine * DEMO_SPEC.linesPerPage))

/** Starts a job for a piece: queued, with `state` 0; or running after that many stages; or done. */
export function addJob(store: FakeStore, pieceId: string, kind: JobKind, state: number | 'done' = 0): StoredJob {
  const ladder = ladderOf(kind)
  const stagesDone = state === 'done' ? ladder.length : state
  const status = state === 'done' ? 'done' : stagesDone === 0 ? 'queued' : 'running'
  const progress = state === 'done' ? 1 : stagesDone === 0 ? 0 : ladder[stagesDone - 1].progress
  const job: Job = { id: nextId(store, 'job'), pieceId, kind, status, progress, error: null }
  const names = partsToRead(store, pieceId, kind)
  if (names.length > 1) job.parts = followParts(job, names.map((part) => ({ id: part.id, name: part.name, state: 'waiting' })))
  const stored: StoredJob = { job, stagesDone }
  store.jobs.set(job.id, stored)
  return stored
}

/** The parts a job would read: all of a piece's for processing, the ones without a map layer for an add. */
function partsToRead(store: FakeStore, pieceId: string, kind: JobKind): StoredPart[] {
  if (kind === 'process-piece') return partsOf(store, pieceId)
  return kind === 'add-parts' ? partsWithoutLayer(store, pieceId) : []
}

// The progress between which a job reads its parts (the pdf and bars steps of processingSteps); the parts share it equally.
const READING_RANGE: Partial<Record<JobKind, [number, number]>> = { 'process-piece': [0.2, 0.65], 'add-parts': [0, 0.8] }

/** The parts of a job as its progress says: waiting until the pages are made, then one reading after another, all done at the end; the one being read when the job fails is failed. */
function followParts(job: Job, parts: JobPart[]): JobPart[] {
  const range = READING_RANGE[job.kind]
  if (range === undefined) return parts
  const [start, end] = range
  const reached = job.status === 'done' ? parts.length : job.progress <= start ? -1 : Math.min(parts.length, Math.floor(((job.progress - start) / (end - start)) * parts.length))
  return parts.map((part, index) => {
    // a part the job named as unreadable, with its reason, stays so
    if (part.state === 'failed' && part.error !== undefined) return part
    if (index < reached) return { ...part, state: 'done' }
    if (index === reached) return { ...part, state: job.status === 'error' ? 'failed' : 'reading' }
    return { ...part, state: 'waiting' }
  })
}

export function latestJobOf(store: FakeStore, pieceId: string): StoredJob | undefined {
  let latest: StoredJob | undefined
  for (const stored of store.jobs.values()) if (stored.job.pieceId === pieceId) latest = stored
  return latest
}

/** Moves a queued or running job one stage on; a done or failed job stays as it is. */
export function advanceJob(store: FakeStore, stored: StoredJob): void {
  const { job } = stored
  advanceStage(store, stored)
  if (job.parts !== undefined) job.parts = followParts(job, job.parts)
}

function advanceStage(store: FakeStore, stored: StoredJob): void {
  const { job } = stored
  if (job.status === 'done' || job.status === 'error') return

  const next = ladderOf(job.kind)[stored.stagesDone]
  if (next === undefined) {
    job.status = 'done'
    job.progress = 1
    if (job.kind === 'process-piece') finishProcessing(store, job.pieceId)
    else if (job.kind === 'add-parts') finishAddParts(store, job.pieceId)
    else finishRealign(store, job.pieceId)
    return
  }
  if (next.stage === store.failStage) {
    store.failStage = undefined
    job.status = 'error'
    job.error = `${next.stage} failed: fake failure`
    return
  }
  stored.stagesDone += 1
  job.status = 'running'
  job.progress = next.progress
  if (job.kind === 'process-piece') finishStage(store, job.pieceId, next.stage)
  else if (job.kind === 'add-parts' && next.stage === 'pages') finishPagesOfNewParts(store, job.pieceId)
}

/** What a finished stage leaves behind: the audio stage learns the duration, the pages stage the page counts. */
function finishStage(store: FakeStore, pieceId: string, stage: string): void {
  const piece = store.pieces.get(pieceId)
  if (stage === 'audio' && piece !== undefined) piece.durationSec = FAKE_DURATION_SEC
  if (stage === 'pages') for (const part of partsOf(store, pieceId)) part.pageCount = FAKE_PAGE_COUNT
}

/** A finished processing job gives the piece its peaks and a map: the demo piece for every part, with the board's twelve review flags, none checked yet. */
function finishProcessing(store: FakeStore, pieceId: string): void {
  if (!store.pieces.has(pieceId)) return
  store.peaks.set(pieceId, recordingPeaks(DEMO_SPEC))
  store.beats.set(pieceId, recordingBeats(DEMO_SPEC))
  addSyntheticMap(store, pieceId, DEMO_SPEC)
  const map = store.maps.get(pieceId)
  if (map !== undefined) map.timing = applyReviewItems(map.timing, uncheckedItems(DEMO_REVIEW_ITEMS))
}

/** The synthetic layout of a part: as many bars as the piece's timing has, on the grid of the demo piece. */
function newPartSpec(timing: TimingLayer): SyntheticSpec {
  const pickupUnits = shortUnits(timing, 0)
  return { ...DEMO_SPEC, barCount: timing.barCount, ...(pickupUnits === undefined ? {} : { pickupUnits }) }
}

/** The parts that a processing job has not given pages and bar boxes yet. */
function partsWithoutLayer(store: FakeStore, pieceId: string): StoredPart[] {
  const map = store.maps.get(pieceId)
  return partsOf(store, pieceId).filter((part) => map?.pages.has(part.id) !== true)
}

/** The pages stage of an add-parts job counts the pages of the new parts. */
function finishPagesOfNewParts(store: FakeStore, pieceId: string): void {
  const map = store.maps.get(pieceId)
  if (map === undefined) return
  const spec = newPartSpec(map.timing)
  for (const part of partsWithoutLayer(store, pieceId)) part.pageCount = syntheticPages(spec, syntheticPageLayer(spec, part.id)).length
}

/** A finished add-parts job gives each new part its page images and bar boxes; the timing and the other parts stay as they are. */
function finishAddParts(store: FakeStore, pieceId: string): void {
  const map = store.maps.get(pieceId)
  if (map === undefined || map.timing.barCount < 1) return
  const spec = newPartSpec(map.timing)
  for (const part of partsWithoutLayer(store, pieceId)) {
    const layer = syntheticPageLayer(spec, part.id)
    const images = syntheticPages(spec, layer)
    map.pages.set(part.id, layer)
    store.pageImages.set(part.id, images)
    part.pageCount = images.length
  }
}

/** A finished realign job refits the unconfirmed locators of the stored timing (a piece without a map has nothing to refit). */
function finishRealign(store: FakeStore, pieceId: string): void {
  const piece = store.pieces.get(pieceId)
  const map = store.maps.get(pieceId)
  if (piece === undefined || map === undefined || map.timing.barCount < 1) return
  map.timing = fakeRealign(map.timing, piece.durationSec ?? FAKE_DURATION_SEC)
}

/** The fake's answer to a fill of `timing` for a piece (see fakeFill); nothing is stored. */
export function fillTiming(store: FakeStore, pieceId: string, timing: TimingLayer): TimingLayer | null {
  return fakeFill(timing, store.pieces.get(pieceId)?.durationSec ?? FAKE_DURATION_SEC)
}

/**
 * Gives a piece the synthetic piece of `spec`: its timing layer, and for each part (in part order) a page layer and the
 * page images (each part's page count becomes the number of images). missedLineAfter[i] lists the bars whose following bar line the "OMR" missed in part i;
 * rests[i] the bars part i rests.
 */
export function addSyntheticMap(store: FakeStore, pieceId: string, spec: SyntheticSpec, missedLineAfter: number[][] = [], rests: number[][] = []): void {
  const pages = new Map<string, PageLayer>()
  partsOf(store, pieceId).forEach((part, position) => {
    const layer = syntheticPageLayer(spec, part.id, missedLineAfter[position], rests[position])
    // The printed page has every bar line, also the one the "OMR" missed: the user needs it to click on.
    const images = syntheticPages(spec, syntheticPageLayer(spec, part.id))
    pages.set(part.id, layer)
    store.pageImages.set(part.id, images)
    part.pageCount = images.length
  })
  store.maps.set(pieceId, { timing: syntheticTiming(spec), pages })
  store.recordingTimings.set(pieceId, syntheticTiming(spec))
}
