import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { DEFAULT_SETTINGS } from '@/lib/dataClient'
import { createFakes, type Fakes } from '@/lib/fakes'
import { strings } from '@/strings'
import { renderWithApp } from '@/test/render'

// The Playback panel of the Practice toolbar (UX fixes part 1, items 8 and 9) and the Bar numbers setting (item 7).

const text = strings.practice
const CLARK = 'piece-clark-county'
const PAGE_WIDTH = 1240
const COLUMN = PAGE_WIDTH + 2 * 16

async function open(settings: Partial<typeof DEFAULT_SETTINGS> = {}, fakes: Fakes = createFakes({ seed: 'demo' })) {
  await fakes.data.saveSettings({ ...DEFAULT_SETTINGS, ...settings })
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(COLUMN)
  const view = renderWithApp(`/pieces/${CLARK}/practice`, { fakes, playerSec: 271 })
  await screen.findAllByRole('img', { name: /^Page \d of 4$/ }, { timeout: 5000 })
  return { ...view, fakes }
}

const toolbar = () => screen.getByRole('region', { name: text.toolbar })
const playbackButton = () => within(toolbar()).getByRole('button', { name: text.playback })
const panel = () => screen.getByRole('dialog', { name: text.playbackMenu })
const countInPanel = () => screen.getByRole('dialog', { name: text.countInMenu })
const savedSettings = async (fakes: Fakes) => (await fakes.data.getProfile()).settings

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Practice: the toolbar', () => {
  it('shows no tempo number beside the metronome, and keeps the metronome switch and its tone menu', async () => {
    await open()

    const metronome = toolbar().querySelector<HTMLElement>('[data-slot="metronome"]')!
    expect(metronome.textContent).toBe(text.metronome)
    expect(within(metronome).getByRole('switch', { name: text.metronomeSwitch })).toBeInTheDocument()
    expect(within(toolbar()).getByRole('button', { name: text.tone(text.tones.wood) })).toBeInTheDocument()
  })
})

describe('Practice: the Playback panel', () => {
  it('opens from a Playback button and holds the four fades, as the settings are', async () => {
    await open({ playback: { countInFade: 'under-clicks', showCount: false } })
    expect(screen.queryByRole('dialog', { name: text.playbackMenu })).toBeNull()

    fireEvent.click(playbackButton())

    const group = within(panel()).getByRole('radiogroup', { name: text.countInFade })
    expect(within(group).getAllByRole('radio').map((radio) => radio.textContent)).toEqual(['Off', 'Pre-roll', 'Pre-roll and loop start', 'Under the clicks'])
    expect(within(group).getByRole('radio', { name: text.countInFades['under-clicks'] })).toHaveAttribute('aria-checked', 'true')
    // The panel ends with the last option: the explanation sentence under them is gone.
    expect(panel().textContent).toBe(`${text.countInFade}OffPre-rollPre-roll and loop startUnder the clicks`)
  })

  it('saves a fade at once with the other settings kept, and the panel and a fresh page show it', async () => {
    const { fakes, unmount } = await open({ nightScore: true })
    const save = vi.spyOn(fakes.data, 'saveSettings')
    fireEvent.click(playbackButton())

    fireEvent.click(within(panel()).getByRole('radio', { name: text.countInFades['pre-roll-and-loop'] }))

    await waitFor(() => expect(save).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS, nightScore: true, playback: { ...DEFAULT_SETTINGS.playback, countInFade: 'pre-roll-and-loop' } }))
    await waitFor(() => expect(within(panel()).getByRole('radio', { name: text.countInFades['pre-roll-and-loop'] })).toHaveAttribute('aria-checked', 'true'))
    await waitFor(async () => expect((await savedSettings(fakes)).playback.countInFade).toBe('pre-roll-and-loop'))

    unmount()
    renderWithApp(`/pieces/${CLARK}/practice`, { fakes, playerSec: 271 })
    await screen.findAllByRole('img', { name: /^Page \d of 4$/ }, { timeout: 5000 })
    fireEvent.click(playbackButton())
    expect(within(panel()).getByRole('radio', { name: text.countInFades['pre-roll-and-loop'] })).toHaveAttribute('aria-checked', 'true')
  })

  it('shows the count on the score switch and the loop count-in section in the count-in menu', async () => {
    await open({ playback: { countInFade: 'pre-roll', showCount: false } })
    expect(within(toolbar()).queryByRole('switch', { name: text.showCount })).toBeNull()

    fireEvent.click(within(toolbar()).getByRole('button', { name: text.countInSettings }))

    expect(within(countInPanel()).getByRole('switch', { name: text.showCount })).not.toBeChecked()
    const section = within(countInPanel()).getByRole('group', { name: text.loopCountIn })
    expect(within(section).getByRole('switch', { name: text.countInEveryRepeat })).toBeInTheDocument()
    expect(within(section).getByRole('radiogroup', { name: text.tempoSource })).toBeInTheDocument()
    fireEvent.click(playbackButton())
    expect(within(panel()).queryByRole('switch', { name: text.showCount })).toBeNull()
  })

  it('has a Count-in Metronome switch, on by default, that is independent of the metronome switch', async () => {
    await open()
    fireEvent.click(within(toolbar()).getByRole('button', { name: text.countInSettings }))
    const countIn = within(countInPanel()).getByRole('switch', { name: text.countInMetronome })
    expect(countIn).toBeChecked()

    fireEvent.click(countIn)

    expect(within(countInPanel()).getByRole('switch', { name: text.countInMetronome })).not.toBeChecked()
    expect(within(toolbar().querySelector<HTMLElement>('[data-slot="metronome"]')!).getByRole('switch', { name: text.metronomeSwitch })).not.toBeChecked()
  })

  it('saves the count on the score off from the count-in menu, and the count label goes', async () => {
    const { fakes } = await open()
    const save = vi.spyOn(fakes.data, 'saveSettings')
    fireEvent.click(within(toolbar()).getByRole('button', { name: text.countInSettings }))
    expect(within(countInPanel()).getByRole('switch', { name: text.showCount })).toBeChecked()

    fireEvent.click(within(countInPanel()).getByRole('switch', { name: text.showCount }))

    await waitFor(() => expect(save).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS, playback: { ...DEFAULT_SETTINGS.playback, showCount: false } }))
    await waitFor(() => expect(within(countInPanel()).getByRole('switch', { name: text.showCount })).not.toBeChecked())
    await waitFor(async () => expect((await savedSettings(fakes)).playback.showCount).toBe(false))
  })

  it('puts a change back and says so when it could not be saved', async () => {
    const { fakes } = await open()
    vi.spyOn(fakes.data, 'saveSettings').mockRejectedValueOnce(new Error('offline'))
    fireEvent.click(playbackButton())

    fireEvent.click(within(panel()).getByRole('radio', { name: text.countInFades.off }))

    await waitFor(() => expect(within(panel()).getByText(text.saveFailed)).toBeInTheDocument())
    expect(within(panel()).getByRole('radio', { name: text.countInFades['pre-roll'] })).toHaveAttribute('aria-checked', 'true')
  })

  it('closes on Escape, and the Settings page no longer has a Playback section', async () => {
    const { router } = await open()
    fireEvent.click(playbackButton())

    fireEvent.keyDown(panel(), { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: text.playbackMenu })).toBeNull()

    await act(() => router.navigate('/settings'))
    await screen.findByRole('heading', { level: 1, name: strings.settings.title })
    expect(screen.queryByRole('region', { name: text.playback })).toBeNull()
  })
})

describe('Practice: the bar numbers', () => {
  it('draws the numbers by default and none when the setting is off, keeping the boxes', async () => {
    const on = await open()
    expect(document.querySelectorAll('[data-slot="bar-number"]').length).toBeGreaterThan(0)
    const boxes = document.querySelectorAll('[data-slot="bar-box"]').length
    on.unmount()

    await open({ barNumbers: false })
    expect(document.querySelectorAll('[data-slot="bar-number"]')).toHaveLength(0)
    expect(document.querySelectorAll('[data-slot="bar-box"]')).toHaveLength(boxes)
  })
})
