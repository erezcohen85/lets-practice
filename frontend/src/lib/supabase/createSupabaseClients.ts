import { createClient } from '@supabase/supabase-js'
import { createClickSynth } from '@/lib/audio/clickSynth'
import { type Clients } from '@/lib/clients'
import { type DataClient } from '@/lib/dataClient'
import { createFilePlayer } from '@/lib/player/filePlayer'
import { createAuthMethods, createRequireUser, type SupabaseLike } from '@/lib/supabase/authClient'
import { createHttpProcessorClient } from '@/lib/supabase/httpProcessor'
import { type SupabasePort } from '@/lib/supabase/port'
import { createPlans } from '@/lib/supabase/plans'
import { createReads } from '@/lib/supabase/reads'
import { createSharing } from '@/lib/supabase/sharing'
import { createProcessorHttp } from '@/lib/supabase/processorHttp'
import { createCutSplit, createStaging } from '@/lib/supabase/splitting'
import { createUploads, requirePdf, requireSize } from '@/lib/supabase/uploads'
import { createWrites } from '@/lib/supabase/writes'

/**
 * The real clients: Supabase for the data, the processor at `processorUrl` for the jobs (called with the signed-in user's token).
 * What the processor has no route for is turned off in `features`.
 */
export function createSupabaseClients(url: string, publishableKey: string, processorUrl: string): Clients {
  // PKCE: the return from Google carries a one-time code, so tokens never sit in the address fragment (M-10).
  const client = createClient(url, publishableKey, { auth: { flowType: 'pkce' } })
  // The library's own types are too deep to compare with the small ports, so these are casts; contract tests run the same code on PGlite, and the live smoke test covers the cast.
  const auth = client as unknown as SupabaseLike
  const port = client as unknown as SupabasePort
  const requireUser = createRequireUser(auth)
  const token = async () => (await client.auth.getSession()).data.session?.access_token ?? null
  const http = createProcessorHttp({ baseUrl: processorUrl, token })
  const { stage } = createStaging(port, requireUser, (file) => {
    requirePdf(file)
    requireSize(file)
  })
  // Every DataClient method is built: the type says so, and a missing one would not compile.
  const data: DataClient = { ...createAuthMethods(auth, window.location.origin), ...createPlans(port, requireUser), ...createReads(port, requireUser), ...createSharing(port, requireUser), ...createWrites(port, requireUser), ...createUploads(port, requireUser, createCutSplit(http)) }
  const processor = createHttpProcessorClient({
    baseUrl: processorUrl,
    data,
    stage,
    token,
  })
  return {
    data,
    processor,
    // Reading a part again has no route online yet (it stays off); one PDF with several parts, Advanced Reading and Suggest a name do.
    features: { splitPdf: true, boxCheck: true, reprocess: false, suggestName: true },
    createPlayer: () => createFilePlayer(),
    createClickSynth: () => createClickSynth(),
  }
}
