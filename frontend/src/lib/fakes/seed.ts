import { DEFAULT_COUNT_IN_BARS } from '@/domain/tempo'
import { applyReviewItems, DEMO_REVIEW_ITEMS, spreadReviewItems, type SeedReviewItem } from '@/lib/fakes/reviewSeed'
import { addJob, addSyntheticMap, DEMO_USER, FAKE_PAGE_COUNT, newCreatedAt, nextId, OTHER_USER, recordUsage, THIRD_USER, type FakeStore } from '@/lib/fakes/store'
import { DEMO_SPEC, MID_PICKUP_SPEC, PICKUP_SPEC, recordingBeats, recordingPeaks, recordingSeconds, smallSpec, type SyntheticSpec } from '@/lib/fakes/syntheticPiece'

const SEED_FILE_SIZE = 2_000_000

export interface SeedPiece {
  id: string
  /** The demo user when left out. */
  ownerId?: string
  title: string
  createdAt: string
  recording: { kind: 'file'; name: string }
  durationSec: number | null
  /** missedLineAfter: bars whose following bar line the "OMR" missed in this part (see syntheticPageLayer). rests: the bars this part rests (a part's own). */
  parts: { name: string; missedLineAfter?: number[]; rests?: number[] }[]
  /** The synthetic piece a finished job gives it: 16 bars on one page, as long as the recording, when left out. */
  spec?: SyntheticSpec
  /** The review flags on the piece's locators (a finished job only); none when left out. */
  review?: SeedReviewItem[]
  /** The piece's latest job: finished, or still running after that many stages (1 to 6 for a processing job). */
  job: 'done' | { stagesDone: number }
}

/** Adds a piece with its parts, recording and latest job; a finished job also gives it peaks, a map and page images. */
export function addSeedPiece(store: FakeStore, spec: SeedPiece): void {
  store.pieces.set(spec.id, {
    id: spec.id,
    ownerId: spec.ownerId ?? DEMO_USER.id,
    title: spec.title,
    createdAt: spec.createdAt,
    countInBars: DEFAULT_COUNT_IN_BARS,
    practice: {},
    lastPartId: null,
    durationSec: spec.durationSec,
  })
  // As migration 0015 does for the pieces that exist: one piece_created event, dated by the piece.
  const owner = store.users.get(spec.ownerId ?? DEMO_USER.id)
  if (owner !== undefined) recordUsage(store, owner, 'piece_created', spec.id, null, spec.createdAt)
  store.recordings.set(spec.id, { kind: 'file', name: spec.recording.name, size: SEED_FILE_SIZE })
  spec.parts.forEach((part, position) => {
    const id = nextId(store, 'part')
    store.parts.set(id, {
      id,
      pieceId: spec.id,
      name: part.name,
      position,
      file: { name: `${part.name}.pdf`, size: SEED_FILE_SIZE },
      pageCount: FAKE_PAGE_COUNT,
    })
  })
  addJob(store, spec.id, 'process-piece', spec.job === 'done' ? 'done' : spec.job.stagesDone)
  if (spec.job === 'done') {
    const synthetic = spec.spec ?? smallSpec(spec.durationSec ?? 200)
    store.peaks.set(spec.id, recordingPeaks(synthetic))
    store.beats.set(spec.id, recordingBeats(synthetic))
    addSyntheticMap(
      store,
      spec.id,
      synthetic,
      spec.parts.map((part) => part.missedLineAfter ?? []),
      spec.parts.map((part) => part.rests ?? []),
    )
    const map = store.maps.get(spec.id)
    if (map !== undefined && spec.review !== undefined) map.timing = applyReviewItems(map.timing, spec.review)
  }
}

// The five pieces of the Library board (design/midnight): same titles, part counts, durations and states, newest
// first. The review numbers come from the flags on the locators (reviewSeed.ts): Clark County has the board's twelve
// items, seven of them checked, so its Clarinet and Flute show 7 of 12 and its Trumpet, with a bar line missed, 7 of 13;
// the piece shows 7 of 13. Concert March and Etude No. 4 have all their flags checked (ready), Jazz Combo Chart has
// none checked (needs review, 0 of 9). The Hub's wordings "not reviewed" and "all checked" show on those two pieces.
const DEMO_PIECES: SeedPiece[] = [
  {
    id: 'piece-clark-county',
    title: 'Clark County Celebration',
    createdAt: '2026-10-28T18:00:00.000Z',
    recording: { kind: 'file', name: 'clark-county-celebration.mp3' },
    durationSec: 271,
    parts: [
      // Rests are each part's own: the clarinet rests in bars 5-8, the trumpet in 33-36 and the flute plays all through.
      { name: 'Clarinet in B♭ 1', rests: [5, 6, 7, 8] },
      { name: 'Trumpet in B♭ 2', missedLineAfter: [22], rests: [33, 34, 35, 36] },
      { name: 'Flute 1' },
    ],
    spec: DEMO_SPEC,
    review: DEMO_REVIEW_ITEMS,
    job: 'done',
  },
  {
    id: 'piece-concert-march',
    title: 'Concert March',
    createdAt: '2026-10-27T18:00:00.000Z',
    recording: { kind: 'file', name: 'concert-march.mp3' },
    durationSec: 192,
    parts: [
      { name: 'Clarinet in B♭ 1' },
      { name: 'Alto Sax 1' },
    ],
    review: spreadReviewItems(9, 9),
    job: 'done',
  },
  {
    id: 'piece-slow-waltz',
    title: 'Slow Waltz in G',
    createdAt: '2026-10-26T18:00:00.000Z',
    recording: { kind: 'file', name: 'slow-waltz-in-g.mp3' },
    durationSec: 302,
    parts: [{ name: 'Violin' }],
    // Processing at 0.55, after the audio, pages and omr stages; the reads of the data client then advance it.
    job: { stagesDone: 3 },
  },
  {
    id: 'piece-etude-4',
    title: 'Etude No. 4',
    createdAt: '2026-10-24T18:00:00.000Z',
    recording: { kind: 'file', name: 'etude-no-4.wav' },
    durationSec: 168,
    parts: [{ name: 'Piano' }],
    review: spreadReviewItems(6, 6),
    job: 'done',
  },
  {
    id: 'piece-jazz-combo',
    title: 'Jazz Combo Chart',
    createdAt: '2026-10-21T18:00:00.000Z',
    recording: { kind: 'file', name: 'jazz-combo-chart.mp3' },
    durationSec: 380,
    parts: [
      { name: 'Piano' },
      { name: 'Bass' },
      { name: 'Drums' },
      { name: 'Trumpet in B♭ 1' },
    ],
    review: spreadReviewItems(9, 0),
    job: 'done',
  },
]

/**
 * A 6/8 piece with a pickup of one eighth (bar 0, a narrow box on the first line); its pickup is flagged "Pickup?". Only the
 * 'demo-pickup' seed has it, so the Library board keeps its five pieces.
 */
const PICKUP_PIECE: SeedPiece = {
  id: 'piece-barcarolle',
  title: 'Barcarolle in G',
  createdAt: '2026-10-18T18:00:00.000Z',
  recording: { kind: 'file', name: 'barcarolle-in-g.mp3' },
  durationSec: Math.ceil(recordingSeconds(PICKUP_SPEC)),
  parts: [{ name: 'Violin' }],
  spec: PICKUP_SPEC,
  review: [{ bar: 0, passIndex: 0, kind: 'pickup', severity: 1, expected: 2, found: 1, factor: null, checked: false }],
  job: 'done',
}

/**
 * A 4/4 march whose bar 7 is a short bar with no number of its own (it reads p7; the bars after it read 7, 8 and on). Only the
 * 'demo-midpickup' seed has it.
 */
const MID_PICKUP_PIECE: SeedPiece = {
  id: 'piece-march',
  title: 'March with a pickup',
  createdAt: '2026-10-17T18:00:00.000Z',
  recording: { kind: 'file', name: 'march-with-a-pickup.mp3' },
  durationSec: Math.ceil(recordingSeconds(MID_PICKUP_SPEC)),
  parts: [{ name: 'Trumpet' }, { name: 'Flute' }],
  spec: MID_PICKUP_SPEC,
  review: [
    { bar: 7, passIndex: 0, kind: 'crowded', severity: 1, expected: 4, found: 2, factor: 0.5, checked: false },
    { bar: 12, passIndex: 0, kind: 'crowded', severity: 1, expected: 4, found: 3, factor: 0.75, checked: false },
  ],
  job: 'done',
}

export function seedDemo(store: FakeStore, options: { pickup?: boolean; midPickup?: boolean } = {}): void {
  for (const piece of DEMO_PIECES) addSeedPiece(store, piece)
  if (options.pickup === true) addSeedPiece(store, PICKUP_PIECE)
  if (options.midPickup === true) addSeedPiece(store, MID_PICKUP_PIECE)
}

/** Three ready pieces of other users, each with a share link, that the demo user has joined: the member's Library. */
const SHARED_PIECES: SeedPiece[] = [
  {
    id: 'piece-shared-sonata',
    ownerId: OTHER_USER.id,
    title: 'Sonatina in C',
    createdAt: '2026-10-20T18:00:00.000Z',
    recording: { kind: 'file', name: 'sonatina-in-c.mp3' },
    durationSec: 150,
    parts: [{ name: 'Piano' }],
    review: spreadReviewItems(4, 4),
    job: 'done',
  },
  {
    id: 'piece-shared-hymn',
    ownerId: OTHER_USER.id,
    title: 'Morning Hymn',
    createdAt: '2026-10-19T18:00:00.000Z',
    recording: { kind: 'file', name: 'morning-hymn.mp3' },
    durationSec: 210,
    parts: [{ name: 'Soprano' }, { name: 'Alto' }],
    review: spreadReviewItems(6, 6),
    job: 'done',
  },
  {
    id: 'piece-shared-reel',
    ownerId: THIRD_USER.id,
    title: 'Banks Reel',
    createdAt: '2026-10-17T18:00:00.000Z',
    recording: { kind: 'file', name: 'banks-reel.mp3' },
    durationSec: 120,
    parts: [{ name: 'Fiddle' }],
    review: spreadReviewItems(5, 5),
    job: 'done',
  },
]

/** The demo user is a member of the three pieces of SHARED_PIECES; every one has a share row. */
export function seedShared(store: FakeStore): void {
  for (const piece of SHARED_PIECES) {
    addSeedPiece(store, piece)
    store.shares.set(piece.id, { token: nextId(store, 'share-token'), enabled: true, rightsConfirmedAt: newCreatedAt(store) })
    store.members.set(piece.id, new Map([[DEMO_USER.id, newCreatedAt(store)]]))
  }
}
