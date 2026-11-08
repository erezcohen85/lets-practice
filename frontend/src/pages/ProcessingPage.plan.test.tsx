import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { type Fakes } from '@/lib/fakes'
import { latestJobOf } from '@/lib/fakes/store'
import { PlanLimitError } from '@/lib/processorClient'
import { strings } from '@/strings'
import { demoOnTrial } from '@/test/planFixtures'
import { renderWithApp } from '@/test/render'

// The Processing screen when the plan ended or refused the job (Task 5).

const t = strings.processing
const p = strings.plans
const SLOW = 'piece-slow-waltz'

/** The Trial user's piece whose first reading ended with this error. */
function failedWith(error: string): Fakes {
  const fakes = demoOnTrial()
  const stored = latestJobOf(fakes.store, SLOW)!
  stored.job = { ...stored.job, status: 'error', error }
  return fakes
}

describe('Processing: a job the plan refused', () => {
  it('says the plan sentence, not the raw code', async () => {
    renderWithApp(`/pieces/${SLOW}/processing`, { fakes: failedWith('plan_limit:pages_per_part_max') })
    expect(await screen.findByText(/Trial reads PDFs of up to 20 pages\. Choose a shorter PDF\./)).toBeInTheDocument()
    expect(screen.queryByText(/plan_limit:/)).not.toBeInTheDocument()
  })

  it('says the job sentence for an Advanced Reading the plan does not include', async () => {
    renderWithApp(`/pieces/${SLOW}/processing`, { fakes: failedWith('plan_limit:advanced_reading') })
    expect(await screen.findByText(p.jobPrompt.advanced_reading(demoOnTrial().store.plans.get('trial')!))).toBeInTheDocument()
  })

  it('keeps the error text of any other failure as it was', async () => {
    renderWithApp(`/pieces/${SLOW}/processing`, { fakes: failedWith('The score reader failed.') })
    expect(await screen.findByText('The score reader failed.')).toBeInTheDocument()
  })

  it('opens the prompt, and shows no "could not start" line, when Try again is refused by the plan', async () => {
    const fakes = failedWith('The server restarted while this was running. Try again.')
    vi.spyOn(fakes.processor, 'processPiece').mockRejectedValue(new PlanLimitError('new_pieces_per_day'))
    const { user } = renderWithApp(`/pieces/${SLOW}/processing`, { fakes })
    await screen.findByRole('heading', { name: t.failedTitle })

    await user.click(screen.getByRole('button', { name: strings.common.retry }))

    expect(await screen.findByText(p.promptTitle('new_pieces_per_day', 'Trial'))).toBeInTheDocument()
    expect(screen.queryByText(t.retryFailed)).not.toBeInTheDocument()
  })
})
