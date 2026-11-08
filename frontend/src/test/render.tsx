import { type ReactNode } from 'react'
import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { ClientsProvider, type Features } from '@/lib/clients'
import { createFakes, type CreateFakesOptions, type Fakes } from '@/lib/fakes'
import { createFakeClickSynth, type FakeClickSynth } from '@/lib/audio/fakeClickSynth'
import { createFakePlayer, type FakePlayer } from '@/lib/fakes/fakePlayer'
import { PlanProvider } from '@/lib/plan'
import { SessionProvider } from '@/lib/session'
import { routes } from '@/routes'

const ASKED_AT = '2026-11-01T09:00:00.000Z'

export type RenderWithAppOptions = CreateFakesOptions & {
  fakes?: Fakes
  /** How long the fake player's recording is, in seconds (the fake default when left out). */
  playerSec?: number
  /** Called with each fake player and fake click synth the page makes, so a test can drive and read them. */
  onMedia?(media: { player?: FakePlayer; synth?: FakeClickSynth }): void
  /** Features the clients turn off (the real clients do; the fakes leave every one on). */
  features?: Partial<Features>
  /** Leaves every account not yet asked about the sample piece, so the Library asks for it. By default each account is taken as asked, so a test of the Library sees only the pieces it set up. */
  sampleUnasked?: boolean
  /** Puts a wrapper (StrictMode, say) around the whole tree. */
  wrap?(children: ReactNode): ReactNode
}

/**
 * Renders the real route table in a memory router, on the in-memory fakes, inside the same providers as main.tsx.
 * Pass `fakes` to share one store between renders (a fresh render then sees what the first one saved); otherwise the
 * remaining options go to createFakes. With fake timers, start them with `vi.useFakeTimers({ shouldAdvanceTime: true })`
 * so that user-event does not wait for a clock that never moves.
 */
export function renderWithApp(path: string, options: RenderWithAppOptions = {}) {
  const { fakes: given, playerSec, onMedia, features, wrap, sampleUnasked, ...fakeOptions } = options
  const fakes = given ?? createFakes(fakeOptions)
  if (sampleUnasked !== true) for (const profile of fakes.store.profiles.values()) profile.sampleGivenAt ??= ASKED_AT
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  const user = userEvent.setup()
  const tree = (
    <ClientsProvider
      clients={{
        data: fakes.data,
        processor: fakes.processor,
        ...(features === undefined ? {} : { features }),
        createPlayer: () => {
          const player = createFakePlayer(playerSec)
          onMedia?.({ player })
          return player
        },
        createClickSynth: () => {
          const synth = createFakeClickSynth()
          onMedia?.({ synth })
          return synth
        },
      }}
    >
      <SessionProvider>
        <PlanProvider>
          <RouterProvider router={router} />
        </PlanProvider>
      </SessionProvider>
    </ClientsProvider>
  )
  const view = render(wrap === undefined ? tree : wrap(tree))
  return { user, fakes, router, ...view }
}
