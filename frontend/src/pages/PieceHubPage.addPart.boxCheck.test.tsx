import { screen, waitFor, within } from '@testing-library/react'
import { vi } from 'vitest'
import { createFakes } from '@/lib/fakes'
import { strings } from '@/strings'
import { renderWithApp } from '@/test/render'

const hub = strings.hub
const np = strings.newPiece
const pdf = (name: string) => new File(['%PDF-1.4'], name, { type: 'application/pdf' })

describe('Piece hub: Add part, the Advanced Reading tick', () => {
  it('offers the tick in each new part’s row and sends it with the add', async () => {
    const fakes = createFakes({ seed: 'demo' })
    const stored = vi.spyOn(fakes.data, 'storeParts')
    const { user } = renderWithApp('/pieces/piece-concert-march', { fakes })
    await screen.findByRole('heading', { level: 1 })
    await user.click(screen.getByRole('button', { name: hub.addPart }))
    const dialog = await screen.findByRole('dialog', { name: hub.addPartsTitle })
    await user.upload(within(dialog).getByLabelText(np.dropZone), [pdf('oboe.pdf'), pdf('horn.pdf')])
    await within(dialog).findAllByRole('textbox', { name: np.partName })

    const ticks = within(dialog).getAllByRole('checkbox', { name: 'Advanced Reading' })
    expect(ticks).toHaveLength(2)
    expect(ticks[0].closest('label')).toHaveAttribute('title', 'More accurate read for scanned music sheets')
    expect(within(dialog).getByText(np.dropZoneLimits)).toBeInTheDocument()
    await user.click(ticks[0])
    await user.click(within(dialog).getByRole('button', { name: hub.addPartsSubmit }))

    await waitFor(() => expect(stored).toHaveBeenCalled())
    expect(stored.mock.calls[0][1].map((part) => part.boxCheck === true)).toEqual([true, false])
  })
})
