import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState, type ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { type LimitKey, type PlanAction } from '@/domain/planLimits'
import { ClientsProvider } from '@/lib/clients'
import { createFakes, type Fakes } from '@/lib/fakes'
import { OTHER_USER, setPlan, setPlanLimits } from '@/lib/fakes/store'
import { jobErrorSentence, limitSentence, PlanProvider, usePlan, usePlanGate } from '@/lib/plan'
import { PlanLimitError } from '@/lib/processorClient'
import { SessionProvider } from '@/lib/session'
import { strings } from '@/strings'

type Outcome = { result?: unknown; error?: unknown }

/** Buttons that drive the gate, and the plan as text. `work` is what `run` does. */
function Probe({ action, work, limit }: { action: PlanAction | null; work: () => Promise<unknown>; limit?: LimitKey }) {
  const gate = usePlanGate()
  const { state, refresh } = usePlan()
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  return (
    <div>
      <p data-testid="plan">{state === null ? 'none' : `${state.plan.id}:${state.usage.pieces_created}`}</p>
      <p data-testid="outcome">{outcome === null ? 'idle' : 'error' in outcome ? `threw ${String(outcome.error)}` : `result ${String(outcome.result)}`}</p>
      <button onClick={() => setOutcome({ result: gate.check(action ?? { type: 'createPiece' }) })}>check</button>
      <button onClick={() => void gate.run(action, work).then((result) => setOutcome({ result }), (error: unknown) => setOutcome({ error }))}>run</button>
      <button onClick={() => gate.show(limit ?? 'pieces_created_max')}>show</button>
      <button onClick={() => void refresh()}>refresh</button>
    </div>
  )
}

function mount(fakes: Fakes, child: ReactNode) {
  const user = userEvent.setup()
  const view = render(
    <ClientsProvider clients={{ data: fakes.data, processor: fakes.processor }}>
      <SessionProvider>
        <PlanProvider>{child}</PlanProvider>
      </SessionProvider>
    </ClientsProvider>,
  )
  return { user, ...view }
}

const trialUser = () => createFakes({ signedInAs: OTHER_USER.id, termsAccepted: true })
const fullTrial = (fakes: Fakes) => {
  for (let made = 0; made < 3; made += 1) fakes.store.usageEvents.push({ id: made + 1, userId: OTHER_USER.id, kind: 'piece_created', planId: 'trial', pieceId: `p${made}`, partId: null, at: new Date().toISOString(), voidedAt: null })
}
const noWork = async () => 'done'

describe('the plan context', () => {
  it('reads the plan after sign-in and again on refresh', async () => {
    const fakes = trialUser()
    const read = vi.spyOn(fakes.data, 'myPlan')
    const { user } = mount(fakes, <Probe action={null} work={noWork} />)
    await waitFor(() => expect(screen.getByTestId('plan')).toHaveTextContent('trial:0'))
    expect(read).toHaveBeenCalledTimes(1)

    fullTrial(fakes)
    await user.click(screen.getByRole('button', { name: 'refresh' }))
    await waitFor(() => expect(screen.getByTestId('plan')).toHaveTextContent('trial:3'))
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('has no plan for a visitor who is signed out, and keeps working when the plan cannot be read', async () => {
    const signedOut = createFakes()
    mount(signedOut, <Probe action={null} work={noWork} />)
    await screen.findByTestId('plan')
    expect(screen.getByTestId('plan')).toHaveTextContent('none')

    const offline = trialUser()
    vi.spyOn(offline.data, 'myPlan').mockRejectedValue(new Error('offline'))
    const { user } = mount(offline, <Probe action={{ type: 'createPiece' }} work={noWork} />)
    await user.click((await screen.findAllByRole('button', { name: 'check' }))[1]!)
    expect(screen.getAllByTestId('outcome')[1]).toHaveTextContent('result true') // nothing is refused early without a plan
  })
})

describe('the prompt', () => {
  it('opens on a refused check with the title and the sentence of the limit, and closes on OK', async () => {
    const fakes = trialUser()
    fullTrial(fakes)
    const { user } = mount(fakes, <Probe action={{ type: 'createPiece' }} work={noWork} />)
    await waitFor(() => expect(screen.getByTestId('plan')).toHaveTextContent('trial:3'))

    await user.click(screen.getByRole('button', { name: 'check' }))

    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent('Not in your Trial plan')
    expect(dialog).toHaveTextContent(strings.plans.prompt.pieces_created_max((await fakes.data.myPlan()).plan))
    expect(dialog).toHaveTextContent('Trial includes 3 pieces, and you have made all 3. Deleting a piece does not give one back.')
    expect(screen.getByTestId('outcome')).toHaveTextContent('result false')
    await user.click(screen.getByRole('button', { name: strings.plans.ok }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  })

  it('stays shut when the plan allows the action', async () => {
    const fakes = trialUser()
    const { user } = mount(fakes, <Probe action={{ type: 'createPiece' }} work={noWork} />)
    await waitFor(() => expect(screen.getByTestId('plan')).toHaveTextContent('trial:0'))
    await user.click(screen.getByRole('button', { name: 'check' }))
    expect(screen.getByTestId('outcome')).toHaveTextContent('result true')
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('says the plan\'s own name and numbers, and a paused plan has its own title', async () => {
    const fakes = createFakes({ signedInAs: OTHER_USER.id, termsAccepted: true, plans: { [OTHER_USER.email]: 'creator' } })
    setPlanLimits(fakes.store, 'creator', { realign_per_piece_max: 7, new_pieces_paused: true })
    const { user } = mount(fakes, <Probe action={null} work={noWork} limit="realign_per_piece_max" />)
    await waitFor(() => expect(screen.getByTestId('plan')).toHaveTextContent('creator'))
    await user.click(screen.getByRole('button', { name: 'show' }))
    expect(await screen.findByRole('alertdialog')).toHaveTextContent('Not in your Creator plan')
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Creator lets you realign each piece 7 times, and this piece has used all 7.')
    await user.click(screen.getByRole('button', { name: strings.plans.ok }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  })

  it('a paused plan is titled New pieces are paused', async () => {
    const fakes = trialUser()
    const { user } = mount(fakes, <Probe action={null} work={noWork} limit="new_pieces_paused" />)
    await waitFor(() => expect(screen.getByTestId('plan')).toHaveTextContent('trial'))
    await user.click(screen.getByRole('button', { name: 'show' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent('New pieces are paused')
    expect(dialog).toHaveTextContent('New pieces are paused for Trial for now. Try again later.')
  })

  it('without a plan it still opens, with the plain sentence', async () => {
    const fakes = trialUser()
    vi.spyOn(fakes.data, 'myPlan').mockRejectedValue(new Error('offline'))
    const { user } = mount(fakes, <Probe action={null} work={noWork} limit="split_pdf" />)
    await user.click(await screen.findByRole('button', { name: 'show' }))
    expect(await screen.findByRole('alertdialog')).toHaveTextContent(strings.plans.promptGeneric)
  })
})

describe('run', () => {
  it('does the work when the plan allows it, and with no action', async () => {
    const work = vi.fn(async () => 'made')
    const { user } = mount(trialUser(), <Probe action={{ type: 'createPiece' }} work={work} />)
    await waitFor(() => expect(screen.getByTestId('plan')).toHaveTextContent('trial:0'))
    await user.click(screen.getByRole('button', { name: 'run' }))
    await waitFor(() => expect(screen.getByTestId('outcome')).toHaveTextContent('result made'))
  })

  it('does not do the work when the check refuses, and opens the prompt', async () => {
    const fakes = trialUser()
    fullTrial(fakes)
    const work = vi.fn(async () => 'made')
    const { user } = mount(fakes, <Probe action={{ type: 'createPiece' }} work={work} />)
    await waitFor(() => expect(screen.getByTestId('plan')).toHaveTextContent('trial:3'))
    await user.click(screen.getByRole('button', { name: 'run' }))
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument()
    expect(work).not.toHaveBeenCalled()
    expect(screen.getByTestId('outcome')).toHaveTextContent('result undefined')
  })

  it('turns the server\'s PlanLimitError into the prompt, resolves undefined, and reads the plan again', async () => {
    const fakes = trialUser()
    const read = vi.spyOn(fakes.data, 'myPlan')
    const work = vi.fn(async () => {
      throw new PlanLimitError('pages_per_part_max')
    })
    const { user } = mount(fakes, <Probe action={null} work={work} />)
    await waitFor(() => expect(screen.getByTestId('plan')).toHaveTextContent('trial:0'))

    await user.click(screen.getByRole('button', { name: 'run' }))

    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent('Trial reads PDFs of up to 20 pages. Choose a shorter PDF.')
    expect(screen.getByTestId('outcome')).toHaveTextContent('result undefined')
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2))
  })

  it('the prompt shows the numbers the fresh read has, not the stale ones', async () => {
    const fakes = trialUser()
    const work = vi.fn(async () => {
      setPlanLimits(fakes.store, 'trial', { pages_per_part_max: 12 })
      throw new PlanLimitError('pages_per_part_max')
    })
    const { user } = mount(fakes, <Probe action={null} work={work} />)
    await waitFor(() => expect(screen.getByTestId('plan')).toHaveTextContent('trial:0'))
    await user.click(screen.getByRole('button', { name: 'run' }))
    await waitFor(() => expect(screen.getByRole('alertdialog')).toHaveTextContent('up to 12 pages'))
  })

  it('rethrows any other error and opens no prompt', async () => {
    const { user } = mount(trialUser(), <Probe action={null} work={async () => Promise.reject(new Error('offline'))} />)
    await waitFor(() => expect(screen.getByTestId('plan')).toHaveTextContent('trial:0'))
    await user.click(screen.getByRole('button', { name: 'run' }))
    await waitFor(() => expect(screen.getByTestId('outcome')).toHaveTextContent('threw Error: offline'))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })
})

describe('outside a PlanProvider', () => {
  it('nothing is refused early and the server\'s refusal reaches the caller', async () => {
    const user = userEvent.setup()
    render(<Probe action={{ type: 'createPiece' }} work={async () => Promise.reject(new PlanLimitError('split_pdf'))} />)
    await user.click(screen.getByRole('button', { name: 'check' }))
    expect(screen.getByTestId('outcome')).toHaveTextContent('result true')
    await user.click(screen.getByRole('button', { name: 'run' }))
    await waitFor(() => expect(screen.getByTestId('outcome')).toHaveTextContent('threw PlanLimitError'))
  })
})

describe('limitSentence and jobErrorSentence', () => {
  it('limitSentence is the sentence of the limit with the plan\'s numbers', async () => {
    const fakes = trialUser()
    const state = await fakes.data.myPlan()
    expect(limitSentence('recording_minutes_max', state)).toBe('Trial takes recordings of up to 10 minutes. Choose a shorter recording.')
    setPlan(fakes.store, OTHER_USER.email, 'creator')
    expect(limitSentence('recording_minutes_max', await fakes.data.myPlan())).toBe('Creator takes recordings of up to 20 minutes. Choose a shorter recording.')
  })

  it('a job that ended with plan_limit:<key> gets the sentence; anything else gets null', async () => {
    const state = await trialUser().data.myPlan()
    expect(jobErrorSentence('plan_limit:advanced_reading', state)).toBe('Advanced Reading is not included in Trial, so this part was not read. Turn it off and try again.')
    expect(jobErrorSentence('plan_limit:advanced_reading', state)).not.toContain('standard way')
    expect(jobErrorSentence('plan_limit:pages_per_part_max', state)).toBe('Trial reads PDFs of up to 20 pages. Choose a shorter PDF.')
    expect(jobErrorSentence('plan_limit:advanced_reading')).toBe(strings.plans.promptGeneric)
    expect(jobErrorSentence('align failed: fake failure', state)).toBeNull()
    expect(jobErrorSentence('plan_limit:no_such_key', state)).toBeNull()
    expect(jobErrorSentence(null, state)).toBeNull()
    expect(jobErrorSentence(null)).toBeNull()
  })
})
