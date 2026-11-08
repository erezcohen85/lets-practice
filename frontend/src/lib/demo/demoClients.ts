import { type PlanState } from '@/domain/planLimits'
import { DEFAULT_PRACTICE_MEMORY, type PieceMap } from '@/domain/types'
import { createClickSynth, type ClickSynth } from '@/lib/audio/clickSynth'
import { type Clients } from '@/lib/clients'
import { DEFAULT_SETTINGS, normaliseSettings, type DataClient, type PageImage, type PieceDetail, type Profile, type User } from '@/lib/dataClient'
import { DEMO_BUNDLE_FILE, parseDemoBundle, type DemoBundle, type DemoCredit } from '@/lib/demo/demoBundle'
import { createFilePlayer } from '@/lib/player/filePlayer'
import { type Player } from '@/lib/player/player'
import { type ProcessorClient } from '@/lib/processorClient'

// The clients of the public demo (/demo): the real Practice screen over the fixed files of a bundle, with no account and no
// database. They read the bundle's files and nothing else. A call that would write something (the screen's own saves of the
// settings, the memory of the piece and the last part) answers as if it had; the rest of the writes are refused. Nothing is
// sent, stored or changed by any of them, so a signed-in visitor's real profile, settings and practice memory stay as they were.

export const DEMO_PIECE_ID = 'demo'
/** The bundle /demo shows unless the build names another. */
const DEFAULT_BUNDLE = 'gondola-song'
/** Reading the bundle gives up after this long: a stalled request must end in the screen's failure card, not in a spinner. */
const LOAD_TIMEOUT_MS = 15_000

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>

const DEMO_USER: User = { id: 'demo-visitor', email: '', name: 'Visitor' }
const DEMO_PROFILE: Profile = {
  acceptedTermsAt: null,
  acceptedTermsVersion: null,
  settings: DEFAULT_SETTINGS,
  isAdmin: false,
  displayName: null,
  email: null,
  sampleGivenAt: null,
}

/** The demo visitor's plan: Trial (the seed row of migration 0015) with nothing used. */
const DEMO_PLAN: PlanState = {
  is_admin: false,
  plan: {
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
    suggest_name: true,
    shared_pieces_max: 1,
    members_per_piece: 30,
    members_per_part: 10,
    read_again_per_part_max: 2,
    realign_per_piece_max: 5,
    new_pieces_per_day: 20,
    new_pieces_paused: false,
  },
  usage: { pieces_created: 0, pieces_stored: 0, shared_pieces: 0, advanced_reading_parts_this_month: 0, new_pieces_today_on_plan: 0 },
  piece: null,
}

const refused = () => Promise.reject(new Error('The demo is read only'))

export interface DemoClientsOptions {
  /** The address of the bundle's folder, without a trailing slash (for example /demo/synthetic). */
  baseUrl: string
  fetchFn?: FetchFn
  createPlayer?: () => Player
  createClickSynth?: () => ClickSynth
}

/** The app's clients, and the bundle's credits for the page to show. */
export interface DemoClients extends Clients {
  credits: () => Promise<DemoCredit[]>
}

export function createDemoClients({ baseUrl, fetchFn = (url, init) => fetch(url, init), createPlayer, createClickSynth: makeSynth }: DemoClientsOptions): DemoClients {
  const base = baseUrl.replace(/\/+$/, '')
  const fileUrl = (file: string) => `${base}/${file}`

  // Read once; a failed read is forgotten, so the screen's Try again reads it again.
  let loading: Promise<DemoBundle> | null = null
  const bundle = (): Promise<DemoBundle> => {
    loading ??= (async () => {
      const response = await fetchFn(`${base}/${DEMO_BUNDLE_FILE}`, { method: 'GET', signal: AbortSignal.timeout(LOAD_TIMEOUT_MS) })
      if (!response.ok) throw new Error(`The demo files answered ${response.status}`)
      return parseDemoBundle(await response.json())
    })().catch((error: unknown) => {
      loading = null
      throw error
    })
    return loading
  }
  const ofDemo = async (pieceId: string): Promise<DemoBundle | null> => (pieceId === DEMO_PIECE_ID ? bundle() : null)
  const inOrder = (demo: DemoBundle) => [...demo.parts].sort((a, b) => a.position - b.position)

  const detailOf = (demo: DemoBundle): PieceDetail => ({
    piece: {
      id: DEMO_PIECE_ID,
      title: demo.piece.title,
      createdAt: demo.piece.createdAt,
      // A viewer: the screen then offers no editing.
      role: 'viewer',
      ownerName: null,
      recording: { kind: 'file', urlOrPath: fileUrl(demo.audio), durationSec: demo.piece.durationSec },
      parts: demo.parts.map((part) => ({ id: part.id, name: part.name, pageCount: part.pageCount })),
      countInBars: demo.piece.countInBars,
      practice: DEFAULT_PRACTICE_MEMORY,
      lastPartId: null,
    },
    parts: inOrder(demo).map((part) => ({ ...part, review: { checked: 0, total: 0 } })),
    job: null,
    review: { checked: 0, total: 0 },
    recordingLabel: null,
    sampleCredits: null,
  })

  const data: DataClient = {
    getUser: async () => DEMO_USER,
    onUserChange: () => () => {},
    getProfile: async () => DEMO_PROFILE,
    getPiece: async (id) => {
      const demo = await ofDemo(id)
      return demo === null ? null : detailOf(demo)
    },
    getPieceMap: async (id): Promise<PieceMap | null> => {
      const demo = await ofDemo(id)
      if (demo === null) return null
      return {
        piece: detailOf(demo).piece,
        timing: structuredClone(demo.timing),
        pages: inOrder(demo).map((part) => structuredClone(demo.pages[part.id])),
        structureSetAt: null,
      }
    },
    getPartPages: async (id, partId): Promise<PageImage[]> => {
      const demo = await ofDemo(id)
      return (demo?.pageImages[partId] ?? []).map((image) => ({ pageIndex: image.pageIndex, width: image.width, height: image.height, url: fileUrl(image.file) }))
    },
    getPeaks: async (id) => (await ofDemo(id))?.peaks ?? null,
    getAudioUrl: async (id) => {
      const demo = await ofDemo(id)
      return demo === null ? null : fileUrl(demo.audio)
    },
    getBeats: async () => null,
    getJob: async () => null,

    // What the screen saves as it goes: answered, and dropped. The returned profile carries the new settings, so the screen
    // keeps them for the visit; this client keeps nothing.
    saveSettings: async (settings) => ({ ...DEMO_PROFILE, settings: normaliseSettings(settings) }),
    savePracticeMemory: async () => {},
    setLastPart: async () => {},
    setCountInBars: async () => {},

    signInWithGoogle: refused,
    signOut: refused,
    acceptTerms: refused,
    listPieces: refused,
    createPiece: refused,
    storeParts: refused,
    renamePiece: refused,
    renamePart: refused,
    renameRecording: refused,
    deletePiece: refused,
    deleteAccount: refused,
    deleteStagedFiles: refused,
    deletePart: refused,
    saveTiming: refused,
    savePageLayer: refused,
    saveStructureSetAt: refused,
    getShare: refused,
    setShareEnabled: refused,
    resetShareLink: refused,
    listMembers: refused,
    getMemberLimit: refused,
    removeMember: refused,
    joinPiece: refused,
    leavePiece: refused,
    listHeldPieces: refused,
    // The demo visitor is on Trial with nothing used; the admin's calls are refused.
    myPlan: async () => structuredClone(DEMO_PLAN),
    adminOverview: refused,
    saveAdminChanges: refused,
  }

  const processor: ProcessorClient = {
    processPiece: refused,
    realign: refused,
    fillEmptyBars: refused,
    addParts: refused,
    reprocessPart: refused,
    readPartName: refused,
    proposeSplit: refused,
    suggestPieceName: refused,
    suggestNewPieceName: refused,
    // The visitor has no account to give a copy to; the library never loads here.
    claimSamplePiece: async () => ({ status: 'already' }),
  }

  return {
    data,
    processor,
    createPlayer: createPlayer ?? (() => createFilePlayer()),
    createClickSynth: makeSynth ?? (() => createClickSynth()),
    credits: async () => (await bundle()).credits ?? [],
  }
}

/** Where the bundle's folder is served: public/demo/<name>, the name from VITE_DEMO_BUNDLE (the default one when it is unset or is not a plain folder name). */
export function demoBaseUrl(env: { BASE_URL?: string; VITE_DEMO_BUNDLE?: string } = import.meta.env): string {
  const name = env.VITE_DEMO_BUNDLE !== undefined && /^[a-z0-9][a-z0-9_-]*$/i.test(env.VITE_DEMO_BUNDLE) ? env.VITE_DEMO_BUNDLE : DEFAULT_BUNDLE
  return `${(env.BASE_URL ?? '/').replace(/\/+$/, '')}/demo/${name}`
}
