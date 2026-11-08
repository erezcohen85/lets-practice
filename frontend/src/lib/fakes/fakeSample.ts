import { addSeedPiece } from '@/lib/fakes/seed'
import { newCreatedAt, nextId, planRowOf, planStateOf, type FakeStore } from '@/lib/fakes/store'
import { type DemoCredit } from '@/lib/demo/demoBundle'
import { type User } from '@/lib/dataClient'
import { type SampleClaim } from '@/lib/processorClient'

/** The fakes' stand-in for the admin's master piece: the id the copies name as theirs, and what they are called. */
export const FAKE_SAMPLE_MASTER_ID = 'piece-sample-master'
export const FAKE_SAMPLE_TITLE = 'Sample: Synthetic Waltz'
const FAKE_SAMPLE_SECONDS = 90
/** One line, as the real sample's credit lines are: made up, since the fakes' piece is drawn, not recorded. */
export const FAKE_SAMPLE_CREDITS: DemoCredit[] = [
  { what: 'Recording and score', who: 'Let\'s Practice (synthetic)', title: 'Synthetic Waltz', licence: 'CC0', source: 'https://example.com/synthetic-waltz' },
]

/**
 * What POST /sample-piece does, on the store: once per account, copies the synthetic sample into the user's library as an
 * ordinary piece of theirs (it counts as one created and one stored, not toward the day), or skips when the plan has no room.
 * The answer is kept either way, so the next call says 'already'.
 */
export function claimFakeSample(store: FakeStore, user: User): SampleClaim {
  const profile = store.profiles.get(user.id)
  if (profile === undefined) throw new Error('profile not found')
  if (profile.sampleGivenAt !== null) return { status: 'already' }
  const now = new Date().toISOString()
  const state = planStateOf(store, user)
  const plan = planRowOf(store, user)
  const room = (used: number, max: number | null) => max === null || used < max
  if (!room(state.usage.pieces_created, plan.pieces_created_max) || !room(state.usage.pieces_stored, plan.pieces_stored_max)) {
    profile.sampleGivenAt = now
    return { status: 'skipped' }
  }
  const id = nextId(store, 'piece')
  addSeedPiece(store, {
    id,
    ownerId: user.id,
    title: FAKE_SAMPLE_TITLE,
    createdAt: newCreatedAt(store),
    recording: { kind: 'file', name: 'synthetic-waltz.mp3' },
    durationSec: FAKE_SAMPLE_SECONDS,
    parts: [{ name: 'Piano' }],
    job: 'done',
  })
  const piece = store.pieces.get(id)!
  piece.sampleOf = FAKE_SAMPLE_MASTER_ID
  piece.sampleCredits = structuredClone(FAKE_SAMPLE_CREDITS)
  for (const event of store.usageEvents) if (event.kind === 'piece_created' && event.pieceId === id) event.isSample = true
  profile.sampleGivenAt = now
  return { status: 'given', pieceId: id }
}
