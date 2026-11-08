import { type Role } from './access'
import { type LoopRange } from './practice'

/** App-assigned bar number, 1..barCount in page order (spec 4.3); 0 is a pickup (anacrusis) before bar 1. */
export type BarNumber = number

/** One play-order row: bars from..to inclusive, played in order. */
export interface PlayOrderRow { from: BarNumber; to: BarNumber }

/** One bar in the expanded play order. position is 0-based; passIndex 0 = first time the bar is played. */
export interface PlaySlot { position: number; bar: BarNumber; passIndex: number }

export interface Meter { numerator: number; denominator: number }
/** A meter that applies from fromBar until the next change. The first change has fromBar 1. */
export interface MeterChange extends Meter { fromBar: BarNumber }

/** rit. also stands for rall. and accel.: a tempo change across the bar. Only fermata (and a part's rests) give a count-in clicks. */
export type MarkKind = 'fermata' | 'rit'
/** A mark of the recording's timing, shared by every part (read from the score or set by the user); a rit. passage has one per bar. */
export interface BarMark { bar: BarNumber; kind: MarkKind }

/** What the Marks list shows and "Edit as text" writes: the timing's marks and the open part's rests ('rest' is a part's, never in the timing). */
export type ListedMarkKind = MarkKind | 'rest'
export interface ListedMark { bar: BarNumber; kind: ListedMarkKind }

/**
 * What a review flag is about: a bar that comes out too short, too long, with the wrong beat count, or with a weak
 * downbeat, or a run of bars where the recording has a second downbeat reading nearly as strong a few beats away. 'pickup'
 * is on bar 0: the score readings do not agree it is a pickup (found 1 of 2), or nothing in the recording supports it (found 2).
 * 'skipped-repeat' is on the bar where the score goes back and the recording carries on (expected: bars as written, found: as played).
 * 'pulse' is on the first slot's locator: the recording's beat is not the score's (expected: the mean felt beats per bar of the score, can be
 * fractional; found: the beats per bar the recording was heard at, not rounded; factor: found / expected). Its fix is to put the bar lines on
 * every round(found) beats (domain/pulseRegrid.ts).
 */
export type FlagKind = 'crowded' | 'stretched' | 'beat-count' | 'weak-downbeat' | 'other-downbeat' | 'pickup' | 'skipped-repeat' | 'pulse'

/** A doubt the processor raised about a locator (Decision 2026-10-29: review state lives on the locators). severity 0 = explained, 1 = check, 2 = likely wrong. */
export interface ReviewFlag {
  kind: FlagKind
  severity: 0 | 1 | 2
  /** The bar length (seconds) the tempo around it predicts, and the length found. For 'other-downbeat': how sure the detector is of the chosen bar lines and of the other reading (0..1). */
  expected: number
  found: number
  /** found / expected, or null when there is no ratio to show. */
  factor: number | null
  explainedBy: 'fermata' | 'rit' | null
  /** The bar line the detector was unsure of, with its confidence (0..1), or null. For 'other-downbeat': where the other reading puts this bar. */
  uncertainLine: { timeSec: number; confidence: number } | null
}

/**
 * A downbeat in the recording for one (bar, pass). confirmed = fixed anchor for realign (spec 6).
 * flags: what the processor doubts about it; checked: the user has been through it (Sounds right or Resolved).
 */
export interface Locator {
  bar: BarNumber
  passIndex: number
  timeSec: number
  confirmed: boolean
  flags?: ReviewFlag[]
  checked?: boolean
}

/**
 * A bar shorter than its meter: it holds `units` notes of the meter's denominator (6/8 with a pickup of one eighth:
 * bar 0, 1 unit). The pickup is bar 0 and exists exactly when a short bar has bar 0; any other short bar keeps its number,
 * unless `unnumbered` is set: a pickup in the middle of the piece, which takes no number of its own and reads "p7" on screen
 * (domain/barNames.ts). The data keeps its whole internal number either way; only the label differs.
 */
export interface ShortBar { bar: BarNumber; units: number; unnumbered?: true }

/** Timing layer: one per piece, shared by every part (UX Spec 1.4). */
export interface TimingLayer {
  /** The printed bars, 1..barCount; a pickup (bar 0) is extra. */
  barCount: number
  playOrder: PlayOrderRow[]
  meters: MeterChange[]
  marks: BarMark[]
  locators: Locator[]
  /** Bars shorter than their meter; absent in a map made before short bars existed (none). */
  shortBars?: ShortBar[]
}

/** A bar's box on a page image, in that image's pixels. */
export interface BarBox { bar: BarNumber; pageIndex: number; x: number; y: number; w: number; h: number }

/**
 * Page layer: one per part (one PDF). bars sorted by bar number. rests: the bars this part rests (every bar of a
 * multi-rest), sorted, once each, inside the piece (0 only with a pickup). A rest belongs to a part: a multi-rest in the
 * flute is not one in the oboe. boxFlags: the bar boxes the box check found wrong (Decisions 2026-11-03); absent when there
 * are none, so a map made before the check keeps its shape.
 */
export interface PageLayer { partId: string; bars: BarBox[]; rests: BarNumber[]; boxFlags?: BoxFlag[] }

/**
 * Why a bar box is flagged: what the box check's vision model found wrong with it (the first six), or what Advanced Reading
 * did to it at read time (the last two, 8.22). The processor's FlagVerdict.
 */
export type BoxFlagVerdict =
  | 'signature_inside'
  | 'starts_late'
  | 'ends_early'
  | 'ends_late'
  | 'two_bars'
  | 'not_a_bar'
  | 'read_moved'
  | 'read_count'

/** A box's left edge and width in image pixels: where Advanced Reading found it before it moved it. */
export interface BoxEdges { x: number; w: number }

/**
 * A box flagged by the box check or by Advanced Reading: the bar (the first of a multi-rest's), the verdict, the note
 * and, for a line start, the left edge to suggest (image pixels). previous: the edges the box had before Advanced Reading
 * moved it (Put back line restores them, with the other boxes of the line that carry them); absent in a map made before it, or when the read did not move the box.
 */
export interface BoxFlag { bar: BarNumber; verdict: BoxFlagVerdict; note: string; suggestedX: number | null; previous?: BoxEdges | null }

export interface Part { id: string; name: string; pageCount: number }

/** 'youtube' is only in rows made before the music rule (Decision 2026-11-06); nothing writes it any more. */
export type AudioSourceKind = 'youtube' | 'file'
export interface AudioSource { kind: AudioSourceKind; urlOrPath: string; durationSec: number | null }

export interface Piece {
  id: string
  title: string
  createdAt: string
  /** What the signed-in user is to this piece: its owner, or a viewer who joined by the share link. */
  role: Role
  /** The owner's display name; null when the owner has none. */
  ownerName: string | null
  recording: AudioSource | null
  parts: Part[]
  /** Count-in length for Practice, remembered per piece and per user. */
  countInBars: CountInBars
  /** What Practice remembers of the piece: metronome, volumes, speed, last loop. The default when nothing is stored. */
  practice: PracticeMemory
  /** The part the editor or Practice opened last, by the signed-in user; null before one was opened. */
  lastPartId: string | null
}

/** Everything the editor and practice screens need for one piece. */
/** structureSetAt: when the "Set the piece structure" step was confirmed (ISO time); null or missing: not set yet (Decisions 2026-11-03). */
export interface PieceMap { piece: Piece; timing: TimingLayer; pages: PageLayer[]; structureSetAt?: string | null }

/** 'add-parts' processes the new parts of a piece that already has a map; the shared timing is not touched. */
export type JobKind = 'process-piece' | 'realign' | 'add-parts'
export type JobStatus = 'queued' | 'running' | 'done' | 'error'
/** One PDF part a job reads, in the order it reads them (jobs.parts): waiting, then reading, then done, or failed when the job stopped on it. */
/** One part a job reads; a failed part may say why (a finished job that skipped it, or one that could read no part). */
export interface JobPart { id: string; name: string; state: 'waiting' | 'reading' | 'done' | 'failed'; error?: string }
export interface Job {
  id: string
  pieceId: string
  kind: JobKind
  status: JobStatus
  progress: number
  error: string | null
  /** The parts the job reads, when the service says so (uploads with PDFs); a job without it looks as it always did. */
  parts?: JobPart[]
}

/** Spec 5.4: plain click adds without renumbering, Shift+click (ripple) shifts the following numbers. */
export type ClickMode = 'plain' | 'ripple'

/** Count-in length in bars; 0 = Off (Decisions 2026-10-29). Stored per piece. */
export type CountInBars = 0 | 1 | 2 | 3 | 4

/** The metronome and count-in click sound (Practice). */
export type ClickTone = 'wood' | 'click' | 'beep'
export const CLICK_TONES: readonly ClickTone[] = ['wood', 'click', 'beep']

/** What a piece remembers of Practice (Decisions 2026-10-30, answer 3); stored in pieces.practice. */
export interface PracticeMemory {
  metronome: { on: boolean; volume: number; tone: ClickTone }
  musicVolume: number
  speed: number
  loop: LoopRange | null
  /** The loop was on (its marks showing) when last left; off keeps the range for the Loop button to bring back. */
  loopOn: boolean
  countInEveryRepeat: boolean
  /** The metronome clicks during a count-in, whether or not it is on while the music plays. */
  countInMetronome: boolean
}

export const DEFAULT_PRACTICE_MEMORY: PracticeMemory = {
  metronome: { on: false, volume: 0.8, tone: 'wood' },
  musicVolume: 1,
  speed: 1,
  loop: null,
  loopOn: true,
  countInEveryRepeat: false,
  countInMetronome: true,
}
