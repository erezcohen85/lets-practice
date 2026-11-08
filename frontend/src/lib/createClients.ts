import { createClickSynth } from '@/lib/audio/clickSynth'
import { type Clients } from '@/lib/clients'
import { createFakes, type CreateFakesOptions } from '@/lib/fakes'
import { newCreatedAt, OTHER_USER } from '@/lib/fakes/store'
import { createLocalClientsFor } from '@/lib/localRun/localClients'
import { createFilePlayer } from '@/lib/player/filePlayer'
import { createSupabaseClients } from '@/lib/supabase/createSupabaseClients'

/** The variables read are VITE_LOCAL_RUN, VITE_USE_FAKES, VITE_FAKE_SEED, VITE_FAKE_USER, VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY and VITE_PROCESSOR_URL. */
type ClientsEnv = Record<string, string | undefined>

/**
 * The clients the app runs on. VITE_LOCAL_RUN=<URL of the local run server> gives local mode: the library, editor and
 * Practice on the run folders that server serves, with the editor's saves written back to them. VITE_USE_FAKES=1 gives
 * the in-memory fakes (VITE_FAKE_SEED=demo fills the library; demo-shared adds pieces the demo user has joined; VITE_FAKE_USER=other signs in the user who has joined
 * them and may not upload, to see a member's views). VITE_SUPABASE_URL with VITE_SUPABASE_PUBLISHABLE_KEY and VITE_PROCESSOR_URL gives the real clients, from `createSupabaseClients` (local mode and
 * the fakes win when also set, so a developer's .env does not take over a run asked for explicitly); it signs in, reads and writes the library, shares, uploads and starts jobs at the processor.
 * Anything else is null, and main.tsx shows the "not configured" page.
 */
export function createClients(env: ClientsEnv = import.meta.env): Clients | null {
  if (env.VITE_LOCAL_RUN) return createLocalClientsFor(env.VITE_LOCAL_RUN)
  if (env.VITE_USE_FAKES !== '1') {
    if (env.VITE_SUPABASE_URL && env.VITE_SUPABASE_PUBLISHABLE_KEY && env.VITE_PROCESSOR_URL) {
      return createSupabaseClients(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, env.VITE_PROCESSOR_URL)
    }
    return null
  }
  const seeds: ReadonlyArray<CreateFakesOptions['seed']> = ['demo', 'demo-pickup', 'demo-midpickup', 'demo-shared']
  const asOther = env.VITE_FAKE_USER === 'other'
  const seed = seeds.find((name) => name === env.VITE_FAKE_SEED) ?? (asOther ? 'demo-shared' : 'empty')
  const { data, processor, store } = createFakes({ seed, ...(asOther ? { signedInAs: OTHER_USER.id } : {}) })
  // The other user is a member of the demo user's pieces, so a browser check sees the Library of someone who may not upload.
  if (asOther && seed !== 'empty') {
    for (const piece of store.pieces.values()) {
      if (piece.ownerId !== OTHER_USER.id) store.members.set(piece.id, new Map([...(store.members.get(piece.id) ?? []), [OTHER_USER.id, newCreatedAt(store)]]))
    }
  }
  return { data, processor, createPlayer: () => createFilePlayer(), createClickSynth: () => createClickSynth() }
}
