import { screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { createFakes } from '@/lib/fakes'
import { strings } from '@/strings'
import { renderWithApp } from '@/test/render'

// Practice on a copy of the sample piece shows the credits its licence asks for; an ordinary piece shows none.

const credits = () => document.querySelector('[data-slot="demo-credits"]')

describe('Practice: the sample piece credit line', () => {
  it('names who made the recording and the licence on a sample piece', async () => {
    const fakes = createFakes({ seed: 'empty', signedIn: true, termsAccepted: true })
    const claim = await fakes.processor.claimSamplePiece()
    if (claim.status !== 'given') throw new Error('expected given')

    renderWithApp(`/pieces/${claim.pieceId}/practice`, { fakes })

    await waitFor(() => expect(credits()).not.toBeNull(), { timeout: 5000 })
    expect(credits()).toHaveTextContent("Let's Practice (synthetic)")
    expect(credits()).toHaveTextContent('CC0')
  })

  it('shows no credit line on an ordinary piece', async () => {
    const fakes = createFakes({ seed: 'demo' })

    renderWithApp('/pieces/piece-clark-county/practice', { fakes, playerSec: 271 })

    await screen.findAllByRole('img', { name: /^Page \d of 4$/ }, { timeout: 5000 })
    expect(credits()).toBeNull()
    expect(screen.queryByText(strings.demo.credits)).not.toBeInTheDocument()
  })
})
