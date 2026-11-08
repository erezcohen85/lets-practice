import { act, renderHook, screen, waitFor, within } from '@testing-library/react'
import { type ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { useRealign } from '@/components/editor/useRealign'
import { type EditorDoc } from '@/domain/pieceEdits'
import { ClientsProvider } from '@/lib/clients'
import { createFakes, type Fakes } from '@/lib/fakes'
import { DEMO_USER, recordUsage, setPlanLimits } from '@/lib/fakes/store'
import { PlanProvider } from '@/lib/plan'
import { PlanLimitError } from '@/lib/processorClient'
import { SessionProvider } from '@/lib/session'
import { type EditorDocApi } from '@/lib/useEditorDoc'
import { strings } from '@/strings'
import { demoOnTrial } from '@/test/planFixtures'

// Realign on a plan: the plan is asked before the job starts, and the server's refusal opens the same prompt (Task 5).

const MARCH = 'piece-concert-march'
const p = strings.plans

const editor = { saveState: 'saved', doc: {} as EditorDoc, replace: vi.fn() } as unknown as EditorDocApi

function mount(fakes: Fakes) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <ClientsProvider clients={{ data: fakes.data, processor: fakes.processor }}>
      <SessionProvider>
        <PlanProvider>{children}</PlanProvider>
      </SessionProvider>
    </ClientsProvider>
  )
  return renderHook(() => useRealign(MARCH, editor, () => {}), { wrapper })
}

const useRealigns = (fakes: Fakes, times: number) => {
  for (let i = 0; i < times; i++) recordUsage(fakes.store, fakes.store.users.get(DEMO_USER.id)!, 'realign', MARCH)
}

describe('useRealign on a plan', () => {
  it('opens the prompt, and starts no job, when the piece has used its realigns', async () => {
    const fakes = demoOnTrial()
    useRealigns(fakes, 5)
    const realign = vi.spyOn(fakes.processor, 'realign')
    const myPlan = vi.spyOn(fakes.data, 'myPlan')
    const { result } = mount(fakes)
    // The piece's usage is read once the hook is mounted.
    await waitFor(() => expect(myPlan).toHaveBeenCalledWith(MARCH))
    await act(async () => {
      await Promise.resolve()
    })

    act(() => result.current.start())

    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText(p.promptTitle('realign_per_piece_max', 'Trial'))).toBeInTheDocument()
    expect(within(dialog).getByText(/lets you realign each piece 5 times/)).toBeInTheDocument()
    expect(realign).not.toHaveBeenCalled()
    expect(result.current.realigning).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('opens the prompt, with no error of its own, when the server refuses after the page let it through', async () => {
    const fakes = demoOnTrial()
    vi.spyOn(fakes.processor, 'realign').mockRejectedValue(new PlanLimitError('realign_per_piece_max'))
    const myPlan = vi.spyOn(fakes.data, 'myPlan')
    const { result } = mount(fakes)
    // The plan is read once the session is, so the prompt can say the plan's name.
    await waitFor(() => expect(myPlan).toHaveBeenCalledWith())
    await act(async () => {
      await Promise.resolve()
    })

    act(() => result.current.start())

    expect(await screen.findByText(p.promptTitle('realign_per_piece_max', 'Trial'))).toBeInTheDocument()
    await waitFor(() => expect(result.current.realigning).toBe(false))
    expect(result.current.error).toBeNull()
  })

  it('starts the job when the plan allows it', async () => {
    const fakes = demoOnTrial()
    const realign = vi.spyOn(fakes.processor, 'realign')
    const { result } = mount(fakes)
    act(() => result.current.start())
    await waitFor(() => expect(realign).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('does not stop the admin whatever the plan says', async () => {
    const fakes = createFakes({ seed: 'demo' })
    setPlanLimits(fakes.store, 'unlimited', { realign_per_piece_max: 0 })
    useRealigns(fakes, 3)
    const realign = vi.spyOn(fakes.processor, 'realign')
    const { result } = mount(fakes)
    act(() => result.current.start())
    await waitFor(() => expect(realign).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })
})
