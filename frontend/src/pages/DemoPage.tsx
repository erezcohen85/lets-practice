import { useMemo, useState } from 'react'
import { DemoCredits } from '@/components/demo/DemoCredits'
import { ClientsProvider } from '@/lib/clients'
import { createDemoClients, DEMO_PIECE_ID, demoBaseUrl, type DemoClients } from '@/lib/demo/demoClients'
import { SessionProvider } from '@/lib/session'
import { PracticeScreen, type PracticeSetting } from '@/pages/PracticePage'
import { strings } from '@/strings'

// Back to the landing page, on the screen's own path, with no editing.
const SETTING: PracticeSetting = { back: { to: '/', label: strings.demo.back }, basePath: '/demo', editable: false }

/**
 * The public demo at /demo: the real Practice screen on the fixed files of a bundle (public/demo/<name>/), with no account
 * and no database. It runs on clients and a session of its own, below the app's, so whoever is signed in (or not) never
 * reaches their own profile, settings or practice memory from here. `clients` is for tests.
 */
export function DemoPage({ clients }: { clients?: DemoClients }) {
  const [demo] = useState(() => clients ?? createDemoClients({ baseUrl: demoBaseUrl() }))
  const setting = useMemo<PracticeSetting>(() => ({ ...SETTING, footer: <DemoCredits load={demo.credits} /> }), [demo])
  return (
    <ClientsProvider clients={demo}>
      <SessionProvider>
        <PracticeScreen pieceId={DEMO_PIECE_ID} setting={setting} />
      </SessionProvider>
    </ClientsProvider>
  )
}
