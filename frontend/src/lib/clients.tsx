import { createContext, useContext, type ReactNode } from 'react'
import { type ClickSynth } from '@/lib/audio/clickSynth'
import { type DataClient } from '@/lib/dataClient'
import { type Player } from '@/lib/player/player'
import { type ProcessorClient } from '@/lib/processorClient'

/**
 * The two interfaces the pages talk to. Phase 4 gives them the in-memory fakes; Phase 9 the real services.
 * `createPlayer` makes a new Player for the recording: a file player in the app, a fake player in tests. It is optional
 * so that code that only needs data and processor (most tests) can leave it out; the editor falls back to a file player.
 * `createClickSynth` does the same for the metronome's clicks: Web Audio in the app, a fake synth in tests; Practice falls
 * back to the Web Audio one.
 */
export interface Clients {
  data: DataClient
  processor: ProcessorClient
  createPlayer?: () => Player
  createClickSynth?: () => ClickSynth
  /** What this deployment cannot do yet, named with `false`; anything not named is on (the fakes and local mode name nothing). Read through useFeatures. */
  features?: Partial<Features>
}

/** What a screen may offer. The real clients turn off what the processor has no route for. */
export interface Features { splitPdf: boolean; boxCheck: boolean; reprocess: boolean; suggestName: boolean; upload: boolean; realign: boolean }

const ClientsContext = createContext<Clients | null>(null)

export function ClientsProvider({ clients, children }: { clients: Clients; children: ReactNode }) {
  return <ClientsContext value={clients}>{children}</ClientsContext>
}

export function useClients(): Clients {
  const clients = useContext(ClientsContext)
  if (clients === null) throw new Error('useClients needs a ClientsProvider above it')
  return clients
}
