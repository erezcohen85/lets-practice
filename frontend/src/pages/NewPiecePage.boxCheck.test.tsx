import { screen, waitFor, within } from '@testing-library/react'
import { vi } from 'vitest'
import { strings } from '@/strings'
import { renderWithApp } from '@/test/render'

const t = strings.newPiece
const b = strings.boxCheck
const pdf = (name: string) => new File(['%PDF-1.4'], name, { type: 'application/pdf' })
const audio = (name: string) => new File(['ID3'], name, { type: 'audio/mpeg' })

async function openWithParts(...names: string[]) {
  const view = renderWithApp('/pieces/new', { signedIn: true, termsAccepted: true })
  await screen.findByRole('heading', { level: 1, name: t.title })
  await view.user.upload(screen.getByLabelText(t.dropZone), names.map(pdf))
  await screen.findAllByRole('textbox', { name: t.partName })
  return view
}

describe('New piece: the Advanced Reading tick in every part row', () => {
  it('is not offered until there is a part', async () => {
    renderWithApp('/pieces/new', { signedIn: true, termsAccepted: true })
    await screen.findByRole('heading', { level: 1, name: t.title })
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  })

  it('is one tick in each row, off, labelled Advanced Reading, with Erez’s words as its hover text', async () => {
    await openWithParts('flute.pdf', 'oboe.pdf')

    const ticks = screen.getAllByRole('checkbox', { name: 'Advanced Reading' })
    expect(ticks).toHaveLength(2)
    for (const tick of ticks) expect(tick).not.toBeChecked()
    expect(screen.queryByRole('button', { name: b.advanced })).not.toBeInTheDocument()
    const label = ticks[0].closest('label')!
    expect(label).toHaveAttribute('title', 'More accurate read for scanned music sheets')
    // Each tick sits in the row of its part, which also holds the name and the remove button.
    const row = ticks[0].closest('li')!
    expect(within(row).getByRole('textbox', { name: t.partName })).toBeInTheDocument()
    expect(within(row).getByRole('button', { name: t.removePart })).toBeInTheDocument()
  })

  it('sends boxCheck for the ticked part only', async () => {
    const view = await openWithParts('flute.pdf', 'oboe.pdf')
    const create = vi.spyOn(view.fakes.data, 'createPiece')
    await view.user.type(screen.getByRole('textbox', { name: t.titleLabel }), 'Etude')
    await view.user.upload(screen.getByLabelText(t.audioChoose), audio('take.mp3'))
    await view.user.click(screen.getAllByRole('checkbox', { name: 'Advanced Reading' })[1])

    await view.user.click(screen.getByRole('button', { name: t.start }))

    await waitFor(() => expect(create).toHaveBeenCalled())
    expect(create.mock.calls[0][0].parts.map((part) => part.boxCheck === true)).toEqual([false, true])
  })

  it('a removed part takes its tick with it', async () => {
    const { user } = await openWithParts('flute.pdf', 'oboe.pdf')
    await user.click(screen.getAllByRole('checkbox', { name: 'Advanced Reading' })[0])

    await user.click(screen.getAllByRole('button', { name: t.removePart })[0])

    expect(screen.getAllByRole('checkbox')).toHaveLength(1)
    expect(screen.getByRole('checkbox')).not.toBeChecked()
  })
})
