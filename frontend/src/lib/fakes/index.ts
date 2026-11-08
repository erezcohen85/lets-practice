import { TERMS_VERSION } from '@/domain/terms'
import { type DataClient } from '@/lib/dataClient'
import { createFakeDataClient } from '@/lib/fakes/fakeDataClient'
import { createFakeProcessorClient } from '@/lib/fakes/fakeProcessorClient'
import { seedDemo, seedShared } from '@/lib/fakes/seed'
import { createStore, DEMO_USER, setPlan, type FakeStage, type FakeStore } from '@/lib/fakes/store'
import { type PlanId } from '@/domain/planLimits'
import { type ProcessorClient } from '@/lib/processorClient'

export type { FakeStage, FakeStore }

export interface CreateFakesOptions {
  /** 'empty' (the default) has no pieces; 'demo' has the five pieces of the Library board, signed in, terms accepted; 'demo-pickup' adds a sixth, a 6/8 piece with a pickup; 'demo-midpickup' adds a sixth, a 4/4 march with a short bar in the middle that takes no number (it reads p7); 'demo-shared' adds three pieces of other users that the demo user has joined. */
  seed?: 'empty' | 'demo' | 'demo-pickup' | 'demo-midpickup' | 'demo-shared'
  /** The stage the first job fails at (see FakeStore.failStage). */
  failStage?: FakeStage
  /** Whether the demo user starts signed in. Default: only with the demo seed. */
  signedIn?: boolean
  /** Whether the demo user has accepted the terms. Default: only with the demo seed. */
  termsAccepted?: boolean
  /** Who starts signed in, when not the demo user (browser checks of the member's views). */
  signedInAs?: string
  /** Plans to give, by email (everyone else is on Trial, the demo user is the admin): browser checks of the Creator and Unlimited views. */
  plans?: Record<string, PlanId>
}

export interface Fakes { data: DataClient; processor: ProcessorClient; store: FakeStore }

const TERMS_ACCEPTED_AT = '2026-10-01T09:00:00.000Z'

/** Both fakes on one in-memory store. Nothing here touches the network or the browser's storage. */
export function createFakes(options: CreateFakesOptions = {}): Fakes {
  const seed = options.seed ?? 'empty'
  const store = createStore()
  if (seed !== 'empty') seedDemo(store, { pickup: seed === 'demo-pickup', midPickup: seed === 'demo-midpickup' })
  if (seed === 'demo-shared') seedShared(store)
  store.failStage = options.failStage
  for (const [email, plan] of Object.entries(options.plans ?? {})) setPlan(store, email, plan)

  if (options.signedInAs !== undefined) store.currentUserId = options.signedInAs
  else if (options.signedIn ?? seed !== 'empty') store.currentUserId = DEMO_USER.id
  const termsAccepted = options.termsAccepted ?? seed !== 'empty'
  // Signed out, it is still the demo user who has accepted, as before: they sign in later with the terms behind them.
  if (termsAccepted) {
    const profile = store.profiles.get(store.currentUserId ?? DEMO_USER.id)
    if (profile !== undefined) {
      profile.acceptedTermsAt = TERMS_ACCEPTED_AT
      profile.acceptedTermsVersion = TERMS_VERSION
    }
  }

  const data = createFakeDataClient(store)
  return { data, processor: createFakeProcessorClient(store, data), store }
}
