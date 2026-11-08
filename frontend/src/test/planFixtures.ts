import { createFakes, type Fakes } from '@/lib/fakes'
import { DEMO_USER, OTHER_USER } from '@/lib/fakes/store'

const recording = () => ({ kind: 'file', file: new File(['x'], 'take.mp3', { type: 'audio/mpeg' }) }) as const
export const pdf = (name = 'flute.pdf') => new File(['%PDF-1.4'], name, { type: 'application/pdf' })

/** Fakes with a Trial user (OTHER_USER) signed in, who has already made `pieces` pieces of one part each. */
export async function trialFakes(pieces = 0): Promise<Fakes> {
  const fakes = createFakes({ signedInAs: OTHER_USER.id, termsAccepted: true })
  for (let index = 1; index <= pieces; index++) {
    await fakes.data.createPiece({ title: `Etude ${index}`, recording: recording(), parts: [{ file: pdf(`etude-${index}.pdf`), name: 'Flute' }] })
  }
  return fakes
}

/** The demo fakes (five pieces, all the demo user's) with the demo user taken off the admin list: on the Trial plan, like anyone. */
export function demoOnTrial(): Fakes {
  const fakes = createFakes({ seed: 'demo' })
  fakes.store.admins.delete(DEMO_USER.id)
  return fakes
}
