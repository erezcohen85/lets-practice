import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readAudioSeconds } from '@/lib/audioDuration'
import { type Fakes } from '@/lib/fakes'
import { OTHER_USER, setPlan, setPlanLimits } from '@/lib/fakes/store'
import { PlanLimitError } from '@/lib/processorClient'
import { strings } from '@/strings'
import { pdf, trialFakes } from '@/test/planFixtures'
import { renderWithApp } from '@/test/render'

// New piece on a plan: each action asks the plan first and opens the prompt when it is refused; the server's refusal does the same.

vi.mock('@/lib/audioDuration', () => ({ readAudioSeconds: vi.fn(async () => null) }))

const t = strings.newPiece
const p = strings.plans
const audio = (name = 'take.mp3') => new File(['x'], name, { type: 'audio/mpeg' })

beforeEach(() => {
  vi.mocked(readAudioSeconds).mockReset()
  vi.mocked(readAudioSeconds).mockResolvedValue(null)
})

async function open(fakes?: Fakes) {
  const view = renderWithApp('/pieces/new', { fakes: fakes ?? (await trialFakes(0)) })
  await screen.findByRole('heading', { level: 1, name: t.title })
  return view
}

/** The prompt that is open, and its OK. */
async function prompt() {
  return screen.findByRole('alertdialog')
}
async function dismiss(user: Awaited<ReturnType<typeof open>>['user']) {
  await user.click(within(await prompt()).getByRole('button', { name: p.ok }))
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
}
const dropZone = () => screen.getByLabelText(t.dropZone)
// hidden: true, so the rows can still be counted while the prompt (a modal) is open over them.
const rowsNow = () => screen.queryAllByRole('textbox', { name: t.partName, hidden: true })

describe('New piece: who gets the form', () => {
  it('gives a Trial user the form, with no message about limited uploads', async () => {
    await open()
    expect(screen.getByRole('button', { name: t.start })).toBeInTheDocument()
    expect(screen.queryByText(strings.limited.text)).not.toBeInTheDocument()
  })

  it('gives the admin the form', async () => {
    renderWithApp('/pieces/new', { seed: 'demo' })
    expect(await screen.findByRole('button', { name: t.start })).toBeInTheDocument()
  })
})

describe('New piece: one PDF with several parts', () => {
  it('opens the prompt on Trial and stays on One PDF per part', async () => {
    const { user } = await open()
    await user.click(screen.getByRole('button', { name: strings.split.modeSplit }))
    const dialog = await prompt()
    expect(within(dialog).getByText(p.promptTitle('split_pdf', 'Trial'))).toBeInTheDocument()
    expect(within(dialog).getByText(/One PDF with several parts is not included|one PDF with several parts is not included/)).toBeInTheDocument()
    await dismiss(user)
    expect(screen.getByRole('button', { name: strings.split.modeEach })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: strings.split.modeSplit })).toHaveAttribute('aria-pressed', 'false')
  })

  it('switches on a plan that has it', async () => {
    const fakes = await trialFakes(0)
    setPlan(fakes.store, OTHER_USER.email, 'creator')
    const { user } = await open(fakes)
    await user.click(screen.getByRole('button', { name: strings.split.modeSplit }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: strings.split.modeSplit })).toHaveAttribute('aria-pressed', 'true')
  })
})

describe('New piece: adding parts', () => {
  it('takes the first PDF and refuses a second on Trial, with the prompt', async () => {
    const { user } = await open()
    await user.upload(dropZone(), [pdf('first.pdf')])
    await waitFor(() => expect(rowsNow()).toHaveLength(1))

    await user.upload(dropZone(), [pdf('second.pdf')])

    const dialog = await prompt()
    expect(within(dialog).getByText(p.promptTitle('parts_per_piece_max', 'Trial'))).toBeInTheDocument()
    expect(within(dialog).getByText(/Trial pieces have one part/)).toBeInTheDocument()
    expect(rowsNow()).toHaveLength(1)
  })

  it('refuses two PDFs chosen together on Trial and adds neither', async () => {
    const { user } = await open()
    await user.upload(dropZone(), [pdf('first.pdf'), pdf('second.pdf')])
    expect(await prompt()).toBeInTheDocument()
    expect(rowsNow()).toHaveLength(0)
  })

  it('takes several on a plan without a limit on parts', async () => {
    const fakes = await trialFakes(0)
    setPlan(fakes.store, OTHER_USER.email, 'creator')
    const { user } = await open(fakes)
    await user.upload(dropZone(), [pdf('first.pdf'), pdf('second.pdf')])
    await waitFor(() => expect(rowsNow()).toHaveLength(2))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('checks nothing for a file that is not a PDF', async () => {
    const { user } = await open()
    await user.upload(dropZone(), [pdf('first.pdf')])
    await waitFor(() => expect(rowsNow()).toHaveLength(1))
    // fireEvent, because the input's accept filter would keep user.upload from handing it the text file.
    fireEvent.change(dropZone(), { target: { files: [new File(['x'], 'notes.txt', { type: 'text/plain' })] } })
    expect(await screen.findByText(t.notPdf('notes.txt'))).toBeInTheDocument()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(rowsNow()).toHaveLength(1)
  })
})

describe('New piece: the Advanced Reading tick', () => {
  it('opens the prompt on Trial and leaves the tick off', async () => {
    const { user } = await open()
    await user.upload(dropZone(), [pdf('flute.pdf')])
    await user.click(await screen.findByRole('checkbox', { name: strings.boxCheck.advancedReading }))
    const dialog = await prompt()
    expect(within(dialog).getByText(p.promptTitle('advanced_reading', 'Trial'))).toBeInTheDocument()
    expect(within(dialog).getByText(/Advanced Reading is not included in Trial/)).toBeInTheDocument()
    await dismiss(user)
    expect(screen.getByRole('checkbox', { name: strings.boxCheck.advancedReading })).not.toBeChecked()
  })

  it('ticks on a plan that has it, and counts the ticked parts against the month', async () => {
    const fakes = await trialFakes(0)
    setPlan(fakes.store, OTHER_USER.email, 'creator')
    setPlanLimits(fakes.store, 'creator', { advanced_reading_parts_per_month: 1 })
    const { user } = await open(fakes)
    await user.upload(dropZone(), [pdf('flute.pdf'), pdf('oboe.pdf')])
    const ticks = await screen.findAllByRole('checkbox', { name: strings.boxCheck.advancedReading })
    expect(ticks).toHaveLength(2)

    await user.click(ticks[0]!)
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(ticks[0]).toBeChecked()

    await user.click(ticks[1]!)
    expect(within(await prompt()).getByText(p.promptTitle('advanced_reading_parts_per_month', 'Creator'))).toBeInTheDocument()
    expect(ticks[1]).not.toBeChecked()
  })

  it('unticking never asks', async () => {
    const fakes = await trialFakes(0)
    setPlan(fakes.store, OTHER_USER.email, 'creator')
    const { user } = await open(fakes)
    await user.upload(dropZone(), [pdf('flute.pdf')])
    const tick = await screen.findByRole('checkbox', { name: strings.boxCheck.advancedReading })
    await user.click(tick)
    setPlanLimits(fakes.store, 'creator', { advanced_reading: false })
    await user.click(tick)
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(tick).not.toBeChecked()
  })
})

describe('New piece: the recording', () => {
  it('reads its length and refuses one past the plan, with the prompt, and does not keep the file', async () => {
    vi.mocked(readAudioSeconds).mockResolvedValue(41 * 60)
    const { user } = await open()
    await user.upload(screen.getByLabelText(t.audioChoose), audio('full-concert.mp3'))
    const dialog = await prompt()
    expect(within(dialog).getByText(p.promptTitle('recording_minutes_max', 'Trial'))).toBeInTheDocument()
    expect(within(dialog).getByText(/up to 10 minutes/)).toBeInTheDocument()
    await dismiss(user)
    expect(screen.queryByText('full-concert.mp3')).not.toBeInTheDocument()
    expect(screen.getByText(t.audioDropZone)).toBeInTheDocument()
  })

  it('keeps the earlier recording when a longer one is refused', async () => {
    vi.mocked(readAudioSeconds).mockResolvedValueOnce(185).mockResolvedValueOnce(41 * 60)
    const { user } = await open()
    await user.upload(screen.getByLabelText(t.audioChoose), audio('etude.mp3'))
    expect(await screen.findByText('etude.mp3')).toBeInTheDocument()
    await user.upload(screen.getByLabelText(t.audioChoose), audio('full-concert.mp3'))
    await prompt()
    expect(screen.getByText('etude.mp3')).toBeInTheDocument()
    expect(screen.queryByText('full-concert.mp3')).not.toBeInTheDocument()
  })

  it('takes a recording within the plan', async () => {
    vi.mocked(readAudioSeconds).mockResolvedValue(185)
    const { user } = await open()
    await user.upload(screen.getByLabelText(t.audioChoose), audio('etude.mp3'))
    expect(await screen.findByText('etude.mp3')).toBeInTheDocument()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('skips the check when the length cannot be read (the processor checks it again)', async () => {
    vi.mocked(readAudioSeconds).mockResolvedValue(null)
    const { user } = await open()
    await user.upload(screen.getByLabelText(t.audioChoose), audio('odd.mp3'))
    expect(await screen.findByText('odd.mp3')).toBeInTheDocument()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })
})

describe('New piece: Suggest a name', () => {
  it('opens the prompt when the plan does not include it, and fills nothing', async () => {
    const fakes = await trialFakes(0)
    setPlanLimits(fakes.store, 'trial', { suggest_name: false })
    const { user } = await open(fakes)
    await user.upload(dropZone(), [pdf('flute.pdf')])
    await user.click(screen.getByRole('button', { name: strings.suggestName.button }))
    expect(within(await prompt()).getByText('Suggest a name is not in your plan.')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: t.titleLabel, hidden: true })).toHaveValue('')
  })

  it('opens the prompt when the server refuses it after the page let it through', async () => {
    const fakes = await trialFakes(0)
    const { user } = await open(fakes)
    await user.upload(dropZone(), [pdf('flute.pdf')])
    setPlanLimits(fakes.store, 'trial', { suggest_name: false })
    await user.click(screen.getByRole('button', { name: strings.suggestName.button }))
    expect(within(await prompt()).getByText('Suggest a name is not in your plan.')).toBeInTheDocument()
    expect(screen.queryByText(strings.suggestName.failed)).not.toBeInTheDocument()
  })

  it('fills the title when the plan includes it', async () => {
    const { user } = await open()
    await user.upload(dropZone(), [pdf('flute.pdf')])
    await user.click(screen.getByRole('button', { name: strings.suggestName.button }))
    await waitFor(() => expect(screen.getByRole('textbox', { name: t.titleLabel })).not.toHaveValue(''))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })
})

describe('New piece: Start', () => {
  async function fillAndStart(fakes: Fakes) {
    vi.mocked(readAudioSeconds).mockResolvedValue(185)
    const view = await open(fakes)
    await view.user.type(screen.getByRole('textbox', { name: t.titleLabel }), 'Etude')
    await view.user.upload(screen.getByLabelText(t.audioChoose), audio())
    await view.user.upload(dropZone(), [pdf('flute.pdf')])
    await waitFor(() => expect(rowsNow()).toHaveLength(1))
    await view.user.click(screen.getByRole('button', { name: t.start }))
    return view
  }

  it('goes to the processing screen when the plan lets it', async () => {
    const { router } = await fillAndStart(await trialFakes(0))
    await waitFor(() => expect(router.state.location.pathname).toMatch(/\/processing$/))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('reads the plan again once the piece is made, so the Library line is current', async () => {
    const fakes = await trialFakes(1)
    const myPlan = vi.spyOn(fakes.data, 'myPlan')
    await fillAndStart(fakes)
    await waitFor(() => expect(myPlan.mock.calls.length).toBeGreaterThan(1))
    expect((await fakes.data.myPlan()).usage.pieces_created).toBe(2)
  })

  it('opens the prompt when the server refuses to make the piece, and says nothing about a failed start', async () => {
    const fakes = await trialFakes(0)
    const { user, router } = await open(fakes)
    vi.mocked(readAudioSeconds).mockResolvedValue(185)
    await user.type(screen.getByRole('textbox', { name: t.titleLabel }), 'Etude')
    await user.upload(screen.getByLabelText(t.audioChoose), audio())
    await user.upload(dropZone(), [pdf('flute.pdf')])
    await waitFor(() => expect(rowsNow()).toHaveLength(1))
    // Another tab used the last piece after this page had read the plan.
    setPlanLimits(fakes.store, 'trial', { pieces_created_max: 0 })

    await user.click(screen.getByRole('button', { name: t.start }))

    const dialog = await prompt()
    expect(within(dialog).getByText(/does not include making pieces/)).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/pieces/new')
    expect(screen.queryByText(t.startFailed)).not.toBeInTheDocument()
    await dismiss(user)
    expect(screen.getByRole('button', { name: t.start })).toBeEnabled()
  })

  it('opens the prompt when the processor refuses the first reading, and takes the piece back so no slot is left behind', async () => {
    const fakes = await trialFakes(0)
    vi.spyOn(fakes.processor, 'processPiece').mockRejectedValue(new PlanLimitError('pages_per_part_max'))
    const { router } = await fillAndStart(fakes)
    const dialog = await prompt()
    expect(within(dialog).getByText(/up to 20 pages/)).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/pieces/new')
    expect(screen.queryByText(t.startFailed)).not.toBeInTheDocument()
    await waitFor(() => expect([...fakes.store.pieces.values()]).toHaveLength(0))
  })
})

describe('New piece: what the plan takes, in words', () => {
  it('says the recording length and the PDF pages of the plan', async () => {
    await open()
    expect(screen.getByText(p.recordingHint('Trial', 10))).toBeInTheDocument()
    expect(p.recordingHint('Trial', 10)).toBe('Up to 10 minutes on Trial.')
    expect(screen.getByText(p.pdfHint('Trial', 20))).toBeInTheDocument()
    expect(p.pdfHint('Trial', 20)).toBe('PDF only. Up to 20 pages on Trial, and 50 MB.')
  })

  it('leaves the admin with the code\'s own limits', async () => {
    renderWithApp('/pieces/new', { seed: 'demo' })
    expect(await screen.findByText(t.dropZoneLimits)).toBeInTheDocument()
    expect(screen.queryByText(/minutes on/)).not.toBeInTheDocument()
  })
})
