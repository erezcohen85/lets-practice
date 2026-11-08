import { selectedLocators } from '@/test/dockSelection'
import { render, screen, waitFor, within } from '@testing-library/react'
import { StrictMode } from 'react'
import userEvent from '@testing-library/user-event'
import { EditorDock } from '@/components/waveform/EditorDock'
import { type DetectedBeat } from '@/domain/beats'
import { type EditorDoc, type EditResult } from '@/domain/pieceEdits'
import { demoDoc } from '@/domain/pieceFixtures'
import { ClientsProvider } from '@/lib/clients'
import { type ContinueMode, type DataClient } from '@/lib/dataClient'
import { createFakes } from '@/lib/fakes'
import { createFakePlayer, type FakePlayer } from '@/lib/fakes/fakePlayer'
import { strings } from '@/strings'

const text = strings.dock
const CLARK = 'piece-clark-county'

function renderDock(options: { data?: Partial<DataClient>; doc?: EditorDoc; players?: FakePlayer[] } = {}) {
  const fakes = createFakes({ seed: 'demo' })
  const players = options.players ?? []
  const data = { ...fakes.data, ...options.data } as DataClient
  const onSelect = vi.fn()
  const doc = options.doc ?? demoDoc()
  const view = render(
    <ClientsProvider
      clients={{
        data,
        processor: fakes.processor,
        createPlayer: () => {
          const player = createFakePlayer(260)
          players.push(player)
          return player
        },
      }}
    >
      <EditorDock pieceId={CLARK} partId="clarinet" doc={doc} recordingSec={271} selected={null} onSelect={onSelect} barLineMode="ripple" onApply={() => null} />
    </ClientsProvider>,
  )
  return { ...view, onSelect, players }
}

describe('EditorDock', () => {
  it('loads the peaks and the recording and then plays', async () => {
    const user = userEvent.setup()
    const { players } = renderDock()

    const play = await screen.findByRole('button', { name: text.play })
    await waitFor(() => expect(play).toBeEnabled())
    expect(players).toHaveLength(1)
    expect(document.querySelectorAll('[data-slot="dock-wave-bar"]').length).toBeGreaterThan(0)

    await user.click(play)
    expect(await screen.findByRole('button', { name: text.pause })).toBeInTheDocument()
    expect(players[0].isPlaying()).toBe(true)
  })

  it("draws the piece's detected beats as the beat lines, and divides the bars when it has none", async () => {
    const user = userEvent.setup()
    const { unmount } = renderDock({ data: { getBeats: async () => [{ t: 2, downbeat: 0.9 }, { t: 3, downbeat: 0.1 }] } })
    await user.click(await screen.findByRole('checkbox', { name: text.beatLines }))
    await waitFor(() => expect(document.querySelectorAll('[data-slot="dock-beat"]')).toHaveLength(2))
    unmount()

    renderDock({ data: { getBeats: async () => null } })
    await user.click(await screen.findByRole('checkbox', { name: text.beatLines }))
    expect(document.querySelectorAll('[data-slot="dock-beat"]').length).toBeGreaterThan(2)
  })

  it('shows the dock with Play off and a note for a piece without a playable recording', async () => {
    renderDock({ data: { getAudioUrl: async () => null } })

    expect(await screen.findByText(text.noRecording)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: text.play })).toBeDisabled()
  })

  it('says so when the waveform is not ready', async () => {
    renderDock({ data: { getPeaks: async () => null } })

    expect(await screen.findByText(text.noWaveform)).toBeInTheDocument()
  })

  it('says so when the waveform could not be loaded', async () => {
    renderDock({
      data: {
        getPeaks: async () => {
          throw new Error('offline')
        },
      },
    })

    expect(await screen.findByText(text.loadFailed)).toBeInTheDocument()
  })

  it('lets go of the player when the Editor closes', async () => {
    const { unmount, players } = renderDock()
    await screen.findByRole('button', { name: text.play })
    const destroy = vi.spyOn(players[0], 'destroy')

    unmount()

    expect(destroy).toHaveBeenCalledTimes(1)
  })

  it('still plays when React runs the effects twice (StrictMode)', async () => {
    const user = userEvent.setup()
    const fakes = createFakes({ seed: 'demo' })
    const made: FakePlayer[] = []
    render(
      <StrictMode>
        <ClientsProvider
          clients={{
            data: fakes.data,
            processor: fakes.processor,
            createPlayer: () => {
              const player = createFakePlayer(260)
              made.push(player)
              return player
            },
          }}
        >
          <EditorDock pieceId={CLARK} partId="clarinet" doc={demoDoc()} recordingSec={271} selected={null} onSelect={() => {}} barLineMode="ripple" onApply={() => null} />
        </ClientsProvider>
      </StrictMode>,
    )

    const play = await screen.findByRole('button', { name: text.play })
    await waitFor(() => expect(play).toBeEnabled())
    await user.click(play)

    expect(await screen.findByRole('button', { name: text.pause })).toBeInTheDocument()
    expect(made.some((player) => player.isPlaying())).toBe(true)
  })

  it('says what to do with the selected bar in its hint', async () => {
    const fakes = createFakes({ seed: 'demo' })
    render(
      <ClientsProvider clients={{ data: fakes.data, processor: fakes.processor, createPlayer: () => createFakePlayer(260) }}>
        <EditorDock pieceId={CLARK} partId="clarinet" doc={demoDoc()} recordingSec={271} selected={{ bar: 9, passIndex: 1 }} onSelect={() => {}} barLineMode="ripple" onApply={() => null} />
      </ClientsProvider>,
    )

    await waitFor(() => expect(selectedLocators()).toEqual(['9:1']))
  })
  it('moves the playhead when the page asks, once per request, and ignores a request it mounted with', async () => {
    const fakes = createFakes({ seed: 'demo' })
    const players: FakePlayer[] = []
    const dock = (seekTo: { timeSec: number } | null) => (
      <ClientsProvider
        clients={{
          data: fakes.data,
          processor: fakes.processor,
          createPlayer: () => {
            const player = createFakePlayer(260)
            players.push(player)
            return player
          },
        }}
      >
        <EditorDock pieceId={CLARK} partId="clarinet" doc={demoDoc()} recordingSec={271} selected={null} onSelect={() => {}} seekTo={seekTo} barLineMode="ripple" onApply={() => null} />
      </ClientsProvider>
    )
    const first = { timeSec: 100 }
    const { rerender } = render(dock(first))
    const play = await screen.findByRole('button', { name: text.play })
    await waitFor(() => expect(play).toBeEnabled())
    expect(players[0].getTime()).toBe(0)

    rerender(dock({ timeSec: 42.5 }))

    await waitFor(() => expect(players[0].getTime()).toBe(42.5))
    expect(screen.getByRole('timer', { name: text.timeLabel })).toHaveTextContent('0:42.5')
  })
})


describe('EditorDock: Continue from my bars', () => {
  const g = text.grid
  // A beat every half second from 1 s; bars 1 to `checked` are checked 2 s apart (4 beats a bar), the bars after them are guesses off the beats.
  const BEATS: DetectedBeat[] = Array.from({ length: 100 }, (_, i) => ({ t: 1 + 0.5 * i, downbeat: i % 4 === 0 ? 0.9 : 0.1 }))
  const docOf = (checked: number): EditorDoc => {
    const locators = [
      ...Array.from({ length: checked }, (_, i) => ({ bar: i + 1, passIndex: 0, timeSec: 1 + 2 * i, confirmed: true })),
      ...Array.from({ length: 6 }, (_, i) => ({ bar: checked + 1 + i, passIndex: 0, timeSec: 1 + 2 * (checked - 1) + 0.3 + 1.1 * (i + 1), confirmed: false })),
    ]
    return { ...demoDoc(), timing: { barCount: 20, playOrder: [{ from: 1, to: 20 }], meters: [{ fromBar: 1, numerator: 4, denominator: 4 }], marks: [], locators } }
  }

  function dock(doc: EditorDoc, onApply: (result: EditResult) => null, continueMode?: ContinueMode) {
    const fakes = createFakes({ seed: 'demo' })
    return (
      <ClientsProvider clients={{ data: { ...fakes.data, getBeats: async () => BEATS } as DataClient, processor: fakes.processor, createPlayer: () => createFakePlayer(260) }}>
        <EditorDock pieceId={CLARK} partId="clarinet" doc={doc} recordingSec={271} selected={null} onSelect={() => {}} barLineMode="ripple" continueMode={continueMode} onApply={onApply} />
      </ClientsProvider>
    )
  }
  const panel = () => screen.findByRole('status', { name: g.promptRegion })

  it('offers Continue once the beats are in, and Continue applies the edit and says what it did, like the toolbar', async () => {
    const onApply = vi.fn<(result: EditResult) => null>(() => null)
    const user = userEvent.setup()
    render(dock(docOf(4), onApply, 'ask'))

    const region = await panel()
    expect(region).toHaveTextContent('Your bars 1 to 4 hold 4 beats each. Continue that pattern to bar 20?')
    await user.click(within(region).getByRole('button', { name: g.promptContinue }))

    expect(onApply).toHaveBeenCalledTimes(1)
    const result = onApply.mock.calls[0][0]
    expect(result).toMatchObject({ ok: true, label: { kind: 'regrid' } })
    expect(await screen.findByText(new RegExp(`^${g.continued('1', '4')}`))).toBeInTheDocument()
    expect(screen.queryByRole('status', { name: g.promptRegion })).not.toBeInTheDocument()
  })

  it('does not offer it in Button only, or when the dock was not told a way', async () => {
    const onApply = vi.fn<(result: EditResult) => null>(() => null)
    const { unmount } = render(dock(docOf(4), onApply, 'button'))
    await waitFor(() => expect(within(screen.getByRole('group', { name: g.group })).getByRole('button', { name: g.continue })).not.toHaveAttribute('aria-disabled'))
    expect(screen.queryByRole('status', { name: g.promptRegion })).not.toBeInTheDocument()
    unmount()

    render(dock(docOf(4), onApply))
    await waitFor(() => expect(within(screen.getByRole('group', { name: g.group })).getByRole('button', { name: g.continue })).not.toHaveAttribute('aria-disabled'))
    expect(screen.queryByRole('status', { name: g.promptRegion })).not.toBeInTheDocument()
    expect(onApply).not.toHaveBeenCalled()
  })

  it('in Automatically, applies the edit and says what it did when the fourth bar is checked, and not before', async () => {
    const onApply = vi.fn<(result: EditResult) => null>(() => null)
    const { rerender } = render(dock(docOf(3), onApply, 'auto'))
    await waitFor(() => expect(within(screen.getByRole('group', { name: g.group })).getByRole('button', { name: g.continue })).toBeInTheDocument())
    await screen.findByRole('button', { name: text.play })
    expect(onApply).not.toHaveBeenCalled()

    rerender(dock(docOf(4), onApply, 'auto'))

    await waitFor(() => expect(onApply).toHaveBeenCalledTimes(1))
    expect(onApply.mock.calls[0][0]).toMatchObject({ ok: true, label: { kind: 'regrid' } })
    expect(await screen.findByText(new RegExp(`^${g.continued('1', '4')}`))).toBeInTheDocument()
    expect(screen.queryByRole('status', { name: g.promptRegion })).not.toBeInTheDocument()
  })

  it('in Automatically, does nothing when the Editor opens on a doc with the plan already there', async () => {
    const onApply = vi.fn<(result: EditResult) => null>(() => null)
    render(dock(docOf(4), onApply, 'auto'))
    await screen.findByRole('button', { name: text.play })
    await waitFor(() => expect(within(screen.getByRole('group', { name: g.group })).getByRole('button', { name: g.continue })).not.toHaveAttribute('aria-disabled'))

    expect(onApply).not.toHaveBeenCalled()
  })
})
