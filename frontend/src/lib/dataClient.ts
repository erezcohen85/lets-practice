import { type Role } from '@/domain/access'
import { type DetectedBeat } from '@/domain/beats'
import { type AdminChanges, type AdminData } from '@/domain/adminDraft'
import { COUNT_IN_FADES, DEFAULT_COUNT_IN_FADE, type CountInFade } from '@/domain/countInFade'
import { type PlanState } from '@/domain/planLimits'
import { type SplitRange } from '@/domain/splitEdits'
import { THEMES, type Theme } from '@/domain/theme'
import {
  type ClickMode,
  type CountInBars,
  type Job,
  type Part,
  type PageLayer,
  type Piece,
  type PieceMap,
  type PracticeMemory,
  type TimingLayer,
} from '@/domain/types'
import { type DemoCredit } from '@/lib/demo/demoBundle'

export interface User {
  id: string
  email: string
  name: string
  /** The user's own Google profile picture (an https address), for the top bar; absent when there is none, and always absent on the fakes unless a test sets one. */
  photoUrl?: string
}

/** How the score follows the music in Practice (Decision 2026-10-28); stored in profiles.settings. */
/** The one list of colours Settings offers for the box, the gliding line and the loop (Erez, 2026-11-06). Violet is the loop's own colour and the default of the loop; the box and the line default to teal. */
export type CursorColour = 'violet' | 'teal' | 'amber' | 'pink' | 'blue'
export interface FollowSettings { scroll: 'line' | 'page'; box: boolean; boxColour: CursorColour; line: boolean; lineColour: CursorColour }
/** Settings > Playback (Decision 2026-10-30): the fade of the recording into a count-in, and the count shown on the score. */
export interface PlaybackSettings { countInFade: CountInFade; showCount: boolean }
/** The colour of the practice loop on the score, the overview band and the range field: violet is today's look, and the swatches are the other choices. `show: false` takes away only the tint; the edges and handles stay (UX polish 2026-11-06). */
export type LoopColour = CursorColour
export const LOOP_COLOURS: readonly LoopColour[] = ['violet', 'teal', 'amber', 'pink', 'blue']
export interface LoopSettings { colour: LoopColour; show: boolean }
/** How the Library lists the pieces. */
export type LibraryView = 'cards' | 'list'
/**
 * Settings > Editing > "Continue from my bars": what the app does once the player has checked 3 bars in a row by ear and the
 * bar lines after them are not on the beats. 'ask' offers Continue in a small panel over the waveform; 'button' leaves it to the
 * Continue button in the toolbar; 'auto' places the lines at once (the edit can be undone).
 */
export const CONTINUE_MODES = ['ask', 'button', 'auto'] as const
export type ContinueMode = (typeof CONTINUE_MODES)[number]
export interface UserSettings {
  follow: FollowSettings
  playback: PlaybackSettings
  nightScore: boolean
  /** "Bar numbers over the staff" (Decision 2026-11-01): the bar numbers and rest ranges drawn on the score, in Practice and in the Editor. */
  barNumbers: boolean
  /** The Edit sheet's "Renumber the bars after" switch: how recording times move when Structure inserts or removes a bar. 'ripple' = on (default): with their bars; 'plain' = off: they stay on the numbers. */
  barLineMode: ClickMode
  /** "Continue from my bars" (Settings > Editing): whether the app offers, leaves to the button, or does the bar lines after 3 checked bars. */
  continueMode: ContinueMode
  /** "Fix a wrong beat by itself" (Settings > Editing): when the recording's beat does not match the score, put the bar lines on the beats when the Editor opens. */
  autoRegrid: boolean
  loop: LoopSettings
  libraryView: LibraryView
  /** "Light mode" in Settings: the look of the app for this user. Landing, Terms and the demo stay dark (domain/theme). */
  theme: Theme
}
export const DEFAULT_SETTINGS: UserSettings = {
  follow: { scroll: 'line', box: true, boxColour: 'teal', line: true, lineColour: 'teal' },
  playback: { countInFade: DEFAULT_COUNT_IN_FADE, showCount: true },
  nightScore: false,
  barNumbers: true,
  barLineMode: 'ripple',
  continueMode: 'ask',
  autoRegrid: false,
  loop: { colour: 'violet', show: true },
  libraryView: 'cards',
  theme: 'dark',
}

/**
 * Settings as stored, made whole: a field an older profile does not have, or holds something unknown, gets its default.
 * A data client runs everything it reads from profiles.settings through this, so the pages never see a half profile.
 */
export function normaliseSettings(raw: unknown): UserSettings {
  const stored = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<Record<keyof UserSettings, unknown>>
  const playback = (typeof stored.playback === 'object' && stored.playback !== null ? stored.playback : {}) as Partial<Record<keyof PlaybackSettings, unknown>>
  const loop = (typeof stored.loop === 'object' && stored.loop !== null ? stored.loop : {}) as Partial<Record<keyof LoopSettings, unknown>>
  const { follow, nightScore, barLineMode } = { ...DEFAULT_SETTINGS, ...stored } as UserSettings
  return {
    follow: { ...DEFAULT_SETTINGS.follow, ...follow },
    playback: {
      countInFade: COUNT_IN_FADES.find((choice) => choice === playback.countInFade) ?? DEFAULT_SETTINGS.playback.countInFade,
      showCount: typeof playback.showCount === 'boolean' ? playback.showCount : DEFAULT_SETTINGS.playback.showCount,
    },
    nightScore,
    barNumbers: typeof stored.barNumbers === 'boolean' ? stored.barNumbers : DEFAULT_SETTINGS.barNumbers,
    barLineMode,
    continueMode: CONTINUE_MODES.find((choice) => choice === stored.continueMode) ?? DEFAULT_SETTINGS.continueMode,
    autoRegrid: typeof stored.autoRegrid === 'boolean' ? stored.autoRegrid : DEFAULT_SETTINGS.autoRegrid,
    loop: {
      colour: LOOP_COLOURS.find((choice) => choice === loop.colour) ?? DEFAULT_SETTINGS.loop.colour,
      show: typeof loop.show === 'boolean' ? loop.show : DEFAULT_SETTINGS.loop.show,
    },
    libraryView: stored.libraryView === 'list' || stored.libraryView === 'cards' ? stored.libraryView : DEFAULT_SETTINGS.libraryView,
    theme: THEMES.find((choice) => choice === stored.theme) ?? DEFAULT_SETTINGS.theme,
  }
}
export interface Profile {
  acceptedTermsAt: string | null
  /** The version of the terms accepted; compare with needsTerms, not by hand. */
  acceptedTermsVersion: string | null
  settings: UserSettings
  isAdmin: boolean
  displayName: string | null
  email: string | null
  /** When the account was given its copy of the sample piece, or told there was no room for one (ISO time); null before it was asked, which is when the library asks (migration 0016). */
  sampleGivenAt: string | null
}

/** "x of y checked" in the Review Queue (Decision 2026-10-28). Its real source is decided with the Editor (Phase 6). */
export interface ReviewStatus { checked: number; total: number }
export interface PartSummary { id: string; name: string; position: number; pageCount: number; review: ReviewStatus }
export interface PieceSummary {
  id: string
  title: string
  createdAt: string
  partCount: number
  /** Pages read over all its parts: 0 until the processor has read them, which a piece that was saved and never started keeps. */
  pageCount: number
  durationSec: number | null
  job: Job | null          // the piece's latest job
  review: ReviewStatus     // summed over its parts
  role: Role
  /** The owner's display name; null when the owner has none. */
  ownerName: string | null
  /** When the user joined the piece (ISO time); null for an owner. */
  joinedAt: string | null
  /** A copy of the sample piece (pieces.sample_of is set): the card says "Sample". */
  isSample: boolean
}

/**
 * The share link of a piece: the token in the URL, whether it lets anyone new in, and when the owner confirmed the piece is
 * their own music, public domain or used with permission (ISO time; null until they did, which is how links made before the
 * music rule look). Turning a link on needs that confirmation (Decision 2026-11-06).
 */
export interface ShareLink { token: string; enabled: boolean; rightsConfirmedAt: string | null }
/** `onHold`: the member joined after the piece's limit was reached (it was lowered, or a part deleted) and has no access until there is room. */
export interface PieceMember { userId: string; displayName: string | null; email: string; joinedAt: string; onHold: boolean }
/**
 * 'owner' and 'already_member' still carry the piece id, so the page can open it; 'link_off', 'full' and 'not_found' do not.
 * 'full': the piece has as many members as its limit, so nobody new can join (migration 0014).
 */
export type JoinStatus = 'joined' | 'already_member' | 'owner' | 'link_off' | 'full' | 'not_found'
export interface JoinResult { pieceId: string | null; status: JoinStatus }
/** The member limit of a piece and how many joined, the ones on hold included; `count` over `limit` means some are on hold. */
export interface MemberLimit { limit: number; count: number }
/** A piece the user joined and is on hold for: they cannot open it until its owner makes room. `joinedAt` is an ISO time. */
export interface HeldPiece { id: string; title: string; ownerName: string | null; joinedAt: string }
export interface PieceDetail {
  piece: Piece
  parts: PartSummary[]     // sorted by position
  job: Job | null
  review: ReviewStatus
  /** What the hub's Recording card calls the recording: the user's name for it, else the one it got (the file's name without its extension), else the file name; an old piece made from a YouTube link shows the link. */
  recordingLabel: string | null
  /** The credits of a sample piece's recording and score, which its licence asks to show with the music; null for an ordinary piece, and for credits that could not be read (the piece still opens). */
  sampleCredits: DemoCredit[] | null
}

/** One page image of a part (score_pages): its size in image pixels, which the bar boxes use. */
export interface PageImage { pageIndex: number; width: number; height: number; url: string }

/** The recording is an audio file. A YouTube link is no longer taken (Decision 2026-11-06); old pieces that have one still read. */
export type RecordingInput = { kind: 'file'; file: File }
/** `name` is what the user typed for the part; '' leaves it to the score (the name read from its header, else the file name). */
export interface NewPartInput {
  file: File
  name: string
  /** The Advanced tick: have a vision model check this part's bar boxes (scanned PDFs only; the processor skips others). Off when absent. */
  boxCheck?: boolean
}
/**
 * Parts cut out of one PDF that the processor has already read (ProcessorClient.proposeSplit), in page order: the PDF is not
 * sent again, `splitId` says which one. `fileName` is the PDF's name. A piece or an add made from a split has no part files.
 */
export interface SplitUpload {
  splitId: string
  fileName: string
  parts: SplitRange[]
  /** The box check tick of each part of `parts`, in order; off when absent. */
  boxChecks?: boolean[]
}
export interface NewPieceInput { title: string; recording: RecordingInput; parts: NewPartInput[]; split?: SplitUpload }

/**
 * Everything the pages read and write about the user and their pieces. Phase 4 runs on the in-memory fake in
 * src/lib/fakes; the Supabase client (Phase 9) implements the same interface.
 * Every method except getUser, onUserChange and signInWithGoogle rejects with Error('not signed in') without a
 * signed-in user. A piece the user neither owns nor joined is invisible: getPiece gives null and listPieces leaves it
 * out. A member reads the piece and keeps their own Practice memory; everything else that writes is the owner's.
 */
export interface DataClient {
  getUser(): Promise<User | null>
  /** Called with the new user after sign-in and sign-out; returns an unsubscribe function. */
  onUserChange(listener: (user: User | null) => void): () => void
  /** null: the browser is leaving for Google, and the session arrives by onUserChange after it returns. */
  signInWithGoogle(next?: string | null): Promise<User | null>
  signOut(): Promise<void>
  getProfile(): Promise<Profile>
  acceptTerms(): Promise<Profile>
  saveSettings(settings: UserSettings): Promise<Profile>
  listPieces(): Promise<PieceSummary[]>          // newest first
  getPiece(id: string): Promise<PieceDetail | null>
  /** Creates the piece row, stores the files and the part rows (in the given order), and the recording. */
  createPiece(input: NewPieceInput): Promise<Piece>
  /** Stores the files and part rows of new parts after the piece's own, in the given order, as createPiece does; they stay without pages until the processor's add-parts job has run. With a `split` the parts are ranges of one PDF the processor holds, and `parts` is empty. */
  storeParts(pieceId: string, parts: NewPartInput[], split?: SplitUpload): Promise<Part[]>
  renamePiece(id: string, title: string): Promise<void>
  /** Renames a part (trimmed, 1 to 80 characters). A name set here is the user's: a later processing or add-parts job never replaces it. */
  renamePart(pieceId: string, partId: string, name: string): Promise<void>
  /** Renames the piece's recording (trimmed, 1 to 120 characters). */
  renameRecording(pieceId: string, name: string): Promise<void>
  deletePiece(id: string): Promise<void>
  /**
   * Deletes the signed-in user's account: the login, the profile, their memberships and their memory of shared pieces. Pieces
   * they only joined stay with their owners. Rejects while the user still owns a piece (so no file is left behind) and for the
   * admin. The pieces go first, through deletePiece; lib/accountDeletion.ts runs the whole sequence. The session is not ended
   * here: signOut does that, and still works once the account is gone.
   */
  deleteAccount(): Promise<void>
  /**
   * Removes the PDFs the user staged for a split or a suggested name and never used (the processor sweeps a day-old one only when
   * that user comes back, which never happens after the account is gone). Everything under the user's own staging folder; a file
   * that cannot be removed is warned of as a count, like a piece's files. Rejects only when the folder cannot be listed. Nothing
   * is deleted from the database. lib/accountDeletion.ts runs it before deleteAccount.
   */
  deleteStagedFiles(): Promise<void>
  /**
   * Deletes one part for good (Decision 2026-11-01): its row, page images and bar boxes, and in local mode its files. The
   * piece's last part cannot be deleted (rejects: delete the piece instead). The recording and the shared timing stay.
   */
  deletePart(pieceId: string, partId: string): Promise<void>
  setCountInBars(id: string, bars: CountInBars): Promise<void>
  /** Remembers the part the editor or Practice opened, for the signed-in user (a member has their own); the hub's main buttons open it. */
  setLastPart(pieceId: string, partId: string): Promise<void>
  /** Replaces what the piece remembers of Practice (Piece.practice): metronome, volumes, speed, last loop. */
  savePracticeMemory(pieceId: string, memory: PracticeMemory): Promise<void>
  /** One-sided waveform peaks 0..1 for the recording, or null before processing has made them. */
  getPeaks(id: string): Promise<number[] | null>
  /** The beats the beat tracker found in the recording, in time order; null when it has none (a run made before they were kept, or the recording is not processed yet), and the dock then divides each bar by its meter. */
  getBeats(id: string): Promise<DetectedBeat[] | null>
  getJob(jobId: string): Promise<Job | null>
  /**
   * The piece's timing layer and one page layer per part (in part order), or null for an unknown piece. While the
   * piece is still processing the layers are empty: no bars, no locators, and a page layer without boxes per part.
   */
  getPieceMap(pieceId: string): Promise<PieceMap | null>
  /** The part's page images in page order; [] while the piece is still processing. */
  getPartPages(pieceId: string, partId: string): Promise<PageImage[]>
  /** Replaces the piece's timing layer (play order, meters, marks, locators, bar count). */
  saveTiming(pieceId: string, timing: TimingLayer): Promise<void>
  /** Replaces one part's bar boxes. */
  savePageLayer(pieceId: string, page: PageLayer): Promise<void>
  /** When the piece's structure was confirmed (ISO time), or null to clear it. */
  saveStructureSetAt(pieceId: string, at: string | null): Promise<void>
  /** The piece's share link; the first call makes it, turned off (create_or_get_share). Owner only. */
  getShare(pieceId: string): Promise<ShareLink>
  /**
   * Turns the link on or off. Turning it on needs the rights confirmation: pass `rightsConfirmed` true the first time (it
   * saves the time, once) and it rejects when the piece has none. Turning it off never needs it.
   */
  setShareEnabled(pieceId: string, on: boolean, rightsConfirmed?: boolean): Promise<void>
  /** Gives the piece a new token; the old link then says not_found. */
  resetShareLink(pieceId: string): Promise<ShareLink>
  /** Who joined, newest first, each marked whether they are on hold; [] for anyone but the owner. */
  listMembers(pieceId: string): Promise<PieceMember[]>
  /** The piece's member limit and how many joined (share_member_limit). Owner only. */
  getMemberLimit(pieceId: string): Promise<MemberLimit>
  removeMember(pieceId: string, userId: string): Promise<void>
  /** Joins the piece the token belongs to, for the signed-in user. */
  joinPiece(token: string): Promise<JoinResult>
  /** A member leaves: the piece goes from their library, with their memory of it. Works for a piece they are on hold for too. */
  leavePiece(pieceId: string): Promise<void>
  /** The pieces the signed-in user joined and is on hold for, newest join first. listPieces and getPiece do not have them. */
  listHeldPieces(): Promise<HeldPiece[]>
  /**
   * The signed-in user's plan and what they have used (migration 0015, my_plan). With a piece id of the user's own it also tells
   * that piece's parts, realigns and reads again (`piece`); for any other id `piece` is null. The browser decides with this only
   * to show the "Not in your plan" prompt early: the server refuses the same actions and has the last word.
   */
  myPlan(pieceId?: string): Promise<PlanState>
  /** Admin only. The three plans with their people and today's count, and everyone with a plan (admin_overview). */
  adminOverview(): Promise<AdminData>
  /** Admin only. Applies the whole draft in one call, all or nothing (save_admin_changes); rejects with the first problem and saves nothing. */
  saveAdminChanges(changes: AdminChanges): Promise<void>
  /** A URL the file player can load for the piece's stored recording, or null while the piece is still processing. An old piece made from a YouTube link plays its stored copy the same way. */
  getAudioUrl(pieceId: string): Promise<string | null>
}
