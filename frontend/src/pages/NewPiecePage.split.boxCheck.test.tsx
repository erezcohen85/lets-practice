import { screen, waitFor, within } from '@testing-library/react'
import { vi } from 'vitest'
import { strings } from '@/strings'
import { renderWithApp } from '@/test/render'

const t = strings.newPiece
const s = strings.split
const pdf = (name: string) => new File(['%PDF-1.4'], name, { type: 'application/pdf' })
const audio = (name: string) => new File(['ID3'], name, { type: 'audio/mpeg' })

describe('New piece, one PDF with several parts: the Advanced Reading tick', () => {
  it('is in each kept part’s row once the parts are confirmed, and goes with the split', async () => {
    const view = renderWithApp('/pieces/new', { signedIn: true, termsAccepted: true })
    await screen.findByRole('heading', { level: 1, name: t.title })
    const { user } = view
    await user.click(screen.getByRole('button', { name: s.modeSplit }))
    await user.upload(screen.getByLabelText(s.dropZone), pdf('band.pdf'))
    await screen.findByRole('list', { name: s.partsList })
    // While the split is being checked the parts are the split screen's, with no tick.
    expect(screen.queryByRole('checkbox', { name: 'Advanced Reading' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: s.confirm }))

    const ticks = screen.getAllByRole('checkbox', { name: 'Advanced Reading' })
    expect(ticks.length).toBeGreaterThan(1)
    expect(ticks[0].closest('label')).toHaveAttribute('title', 'More accurate read for scanned music sheets')
    expect(within(ticks[0].closest('li')!).getByRole('button', { name: s.removePart })).toBeInTheDocument()
    await user.click(ticks[1])

    const create = vi.spyOn(view.fakes.data, 'createPiece')
    await user.type(screen.getByRole('textbox', { name: t.titleLabel }), 'Band piece')
    await user.upload(screen.getByLabelText(t.audioChoose), audio('take.mp3'))
    await user.click(screen.getByRole('button', { name: t.start }))

    await waitFor(() => expect(create).toHaveBeenCalled())
    const boxChecks = create.mock.calls[0][0].split?.boxChecks
    expect(boxChecks?.map(Boolean)).toEqual(ticks.map((_, index) => index === 1))
  })
})
