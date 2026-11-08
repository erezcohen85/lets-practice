import { screen } from '@testing-library/react'
import { type Features } from '@/lib/clients'
import { strings } from '@/strings'
import { renderWithApp } from '@/test/render'

// New piece where the real processor has no route for a feature: the screen leaves it out.

const t = strings.newPiece
const pdf = (name: string) => new File(['%PDF-1.4'], name, { type: 'application/pdf' })

async function open(features?: Partial<Features>) {
  const view = renderWithApp('/pieces/new', { signedIn: true, termsAccepted: true, ...(features === undefined ? {} : { features }) })
  await screen.findByRole('heading', { level: 1, name: t.title })
  return view
}

describe('New piece with features off', () => {
  it('control: everything is offered when the clients name nothing', async () => {
    const { user } = await open()
    expect(screen.getByRole('button', { name: strings.suggestName.button })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: strings.split.modeSplit })).toBeInTheDocument()
    await user.upload(screen.getByLabelText(t.dropZone), [pdf('flute.pdf')])
    await screen.findAllByRole('textbox', { name: t.partName })
    expect(screen.getByRole('checkbox', { name: strings.boxCheck.advancedReading })).toBeInTheDocument()
  })

  it('has no Suggest a name button with suggestName off', async () => {
    await open({ suggestName: false })
    expect(screen.queryByRole('button', { name: strings.suggestName.button })).not.toBeInTheDocument()
  })

  it('has no switch to one PDF with several parts with splitPdf off', async () => {
    await open({ splitPdf: false })
    expect(screen.queryByRole('button', { name: strings.split.modeSplit })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: strings.split.modeEach })).not.toBeInTheDocument()
    expect(screen.getByLabelText(t.dropZone)).toBeInTheDocument()
  })

  it('has no Advanced Reading tick with boxCheck off', async () => {
    const { user } = await open({ boxCheck: false })
    await user.upload(screen.getByLabelText(t.dropZone), [pdf('flute.pdf')])
    await screen.findAllByRole('textbox', { name: t.partName })
    expect(screen.queryByRole('checkbox', { name: strings.boxCheck.advancedReading })).not.toBeInTheDocument()
  })

  it('shows the limited-access message to a creator with upload off', async () => {
    renderWithApp('/pieces/new', { seed: 'demo', features: { upload: false } })
    expect(await screen.findByText(strings.limited.text)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: t.start })).not.toBeInTheDocument()
  })
})
