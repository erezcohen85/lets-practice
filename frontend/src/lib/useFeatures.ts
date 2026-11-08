import { useClients, type Features } from '@/lib/clients'

export type { Features }

const ALL_ON: Features = { splitPdf: true, boxCheck: true, reprocess: true, suggestName: true, upload: true, realign: true }

/** What this deployment can do. Everything is on for the fakes and local mode; the real clients turn off what the processor has no route for. */
export function useFeatures(): Features {
  return { ...ALL_ON, ...useClients().features }
}
