import { screen, waitFor, within } from '@testing-library/react'
import { DEFAULT_SETTINGS, type UserSettings } from '@/lib/dataClient'
import { DEMO_USER, OTHER_USER } from '@/lib/fakes/store'
import { type Fakes } from '@/lib/fakes'
import { strings } from '@/strings'
import { renderWithApp } from '@/test/render'

const pathNow = (router: { state: { location: { pathname: string } } }) => router.state.location.pathname

const renderSettings = () => renderWithApp('/settings', { signedIn: true, termsAccepted: true })

const text = strings.settings
const nightScore = () => screen.getByRole('switch', { name: text.nightScore })
const boxSwitch = () => screen.getByRole('switch', { name: text.box })
const lineSwitch = () => screen.getByRole('switch', { name: text.line })
const barNumbersSwitch = () => screen.getByRole('switch', { name: text.barNumbers })
const continueChoice = (name: string) => screen.getByRole('button', { name })
const autoRegridSwitch = () => screen.getByRole('switch', { name: text.autoRegrid })
const scrollChoice = (name: string) => screen.getByRole('button', { name })
const colourChoice = (group: string, colour: keyof typeof text.colourNames) =>
  within(screen.getByRole('radiogroup', { name: group })).getByRole('radio', { name: text.colourNames[colour] })

const savedSettings = async (fakes: Fakes) => (await fakes.data.getProfile()).settings

/** The next saveSettings call waits for release(), then goes on to the real fake. Later calls are not held. */
function holdNextSave(fakes: Fakes) {
  const original = fakes.data.saveSettings.bind(fakes.data)
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const save = vi.spyOn(fakes.data, 'saveSettings').mockImplementationOnce(async (settings) => {
    await gate
    return original(settings)
  })
  return { save, release }
}

describe('the settings page', () => {
  it('has Settings as its one level-1 heading and a way back to the library', async () => {
    renderSettings()

    const headings = await screen.findAllByRole('heading', { level: 1 })
    expect(headings).toHaveLength(1)
    expect(headings[0]).toHaveTextContent(text.title)
    expect(screen.getByRole('link', { name: strings.common.backToLibrary })).toHaveAttribute('href', '/library')
  })

  it('has the seven sections in order, with no Playback among them (it moved to Practice), each named by its heading', async () => {
    renderSettings()
    await screen.findByRole('heading', { level: 1 })

    const names = screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)
    expect(names).toEqual([text.appearance, text.keyCommands, text.editing, text.following, text.loopSection, text.handsFree, text.account])
    for (const name of names) expect(screen.getByRole('region', { name: name! })).toBeInTheDocument()
  })

  it('has Light mode first in Appearance, then the night score and the bar numbers, all three switches', async () => {
    renderSettings()
    const appearance = within(await screen.findByRole('region', { name: text.appearance }))

    expect(appearance.getAllByRole('switch').map((toggle) => toggle.getAttribute('aria-label') ?? toggle.getAttribute('aria-labelledby'))).toHaveLength(3)
    const [first] = appearance.getAllByRole('switch')
    expect(first).toHaveAccessibleName('Light mode')
    expect(first).toHaveAccessibleDescription('Use a light background across the app.')
    expect(first).not.toBeChecked()
    expect(appearance.getByRole('switch', { name: text.nightScore })).toBeInTheDocument()
    expect(appearance.getByRole('switch', { name: text.barNumbers })).toBeInTheDocument()
    expect(appearance.queryByRole('button')).not.toBeInTheDocument()
  })

  it('shows the night score with its hint', async () => {
    renderSettings()

    expect(await screen.findByText(text.nightScoreHint)).toBeInTheDocument()
  })

  it('shows the defaults of DEFAULT_SETTINGS on a new account', async () => {
    renderSettings()
    await screen.findByRole('heading', { level: 1 })

    expect(DEFAULT_SETTINGS).toEqual({
      follow: { scroll: 'line', box: true, boxColour: 'teal', line: true, lineColour: 'teal' },
      playback: { countInFade: 'pre-roll', showCount: true },
      nightScore: false,
      barNumbers: true,
      barLineMode: 'ripple',
      continueMode: 'ask',
      autoRegrid: false,
      loop: { colour: 'violet', show: true },
      libraryView: 'cards',
      theme: 'dark',
    })
    expect(barNumbersSwitch()).toBeChecked()
    expect(nightScore()).not.toBeChecked()
    expect(scrollChoice(text.scrollByLine)).toHaveAttribute('aria-pressed', 'true')
    expect(scrollChoice(text.scrollByPage)).toHaveAttribute('aria-pressed', 'false')
    expect(boxSwitch()).toBeChecked()
    expect(lineSwitch()).toBeChecked()
    expect(colourChoice(text.boxColours, 'teal')).toBeChecked()
    expect(colourChoice(text.boxColours, 'amber')).not.toBeChecked()
    expect(colourChoice(text.boxColours, 'pink')).not.toBeChecked()
    expect(colourChoice(text.lineColours, 'teal')).toBeChecked()
  })

  it('names the scrolling choice as a group and offers exactly two ways', async () => {
    renderSettings()

    const group = await screen.findByRole('group', { name: text.scrolling })
    expect(within(group).getAllByRole('button').map((button) => button.textContent)).toEqual([
      text.scrollByLine,
      text.scrollByPage,
    ])
  })

  it('offers the same five colours for the box, the line and the loop, in the same order, as three radio groups with names', async () => {
    renderSettings()
    await screen.findByRole('heading', { level: 1 })

    for (const group of [text.boxColours, text.lineColours, text.loopColours]) {
      const radios = within(screen.getByRole('radiogroup', { name: group })).getAllByRole('radio')
      expect(radios.map((radio) => radio.getAttribute('aria-label'))).toEqual(['Violet', 'Teal', 'Amber', 'Pink', 'Blue'])
    }
    expect(screen.getAllByRole('radiogroup')).toHaveLength(3)
  })

  it('offers violet, teal, amber, pink and blue for the loop, with violet chosen', async () => {
    renderSettings()
    await screen.findByRole('heading', { level: 1 })

    const radios = within(screen.getByRole('radiogroup', { name: text.loopColours })).getAllByRole('radio')
    expect(radios.map((radio) => radio.getAttribute('aria-label'))).toEqual(['Violet', 'Teal', 'Amber', 'Pink', 'Blue'])
    expect(colourChoice(text.loopColours, 'violet')).toBeChecked()
    expect(screen.getByRole('switch', { name: 'Show the loop colour' })).toBeChecked()
    expect(screen.getByText(text.loopHint)).toBeInTheDocument()
  })

  it('lists the keys for hands free use, as on the board', async () => {
    renderSettings()
    const section = within(await screen.findByRole('region', { name: text.handsFree }))

    expect(text.keys).toEqual([
      { action: 'Play / pause', keys: 'Space, or pedal' },
      { action: 'Restart loop', keys: 'Left arrow, or pedal' },
      { action: 'Next loop', keys: 'Right arrow, or pedal' },
    ])
    for (const { action, keys } of text.keys) {
      expect(section.getByText(action)).toBeInTheDocument()
      expect(section.getByText(keys)).toBeInTheDocument()
    }
  })

  it('shows who is signed in, the language and the sign out button, and has no Save button', async () => {
    renderSettings()
    const account = within(await screen.findByRole('region', { name: text.account }))

    expect(account.getByText(DEMO_USER.email)).toBeInTheDocument()
    expect(account.getByText(text.language)).toBeInTheDocument()
    expect(account.getByRole('button', { name: text.signOut })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /save/i })).not.toBeInTheDocument()
  })

  it('links the terms of use from the account section, with a touch-sized target', async () => {
    renderSettings()
    const account = within(await screen.findByRole('region', { name: text.account }))

    const link = account.getByRole('link', { name: text.terms })
    expect(link).toHaveAttribute('href', '/terms')
    expect(link.className).toMatch(/\bmin-h-11\b/)
  })

  it('shows the admin a link to the admin hub labelled Admin, and anyone else no such link', async () => {
    renderSettings()
    const account = within(await screen.findByRole('region', { name: text.account }))
    expect(text.admin).toBe('Admin')
    expect(account.getByRole('link', { name: text.admin })).toHaveAttribute('href', '/admin')
    expect(screen.queryByRole('link', { name: 'Creators' })).toBeNull()
  })

  it('shows a person who is not the admin no link to the admin hub', async () => {
    renderWithApp('/settings', { signedInAs: OTHER_USER.id, termsAccepted: true })
    await screen.findByRole('region', { name: text.account })
    expect(screen.queryByRole('link', { name: text.admin })).toBeNull()
  })

  it('has a sign out button of at least 44 px', async () => {
    renderSettings()

    expect((await screen.findByRole('button', { name: text.signOut })).className).toMatch(/\bh-(11|12|13)\b/)
  })
})

describe('the loop colour', () => {
  const loopSwitch = () => screen.getByRole('switch', { name: text.loopShow })

  it('saves a colour for the loop and keeps the switch, and a fresh render shows it', async () => {
    const { user, fakes, unmount } = renderSettings()
    const save = vi.spyOn(fakes.data, 'saveSettings')
    await screen.findByRole('heading', { level: 1 })

    await user.click(colourChoice(text.loopColours, 'blue'))

    expect(save).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS, loop: { colour: 'blue', show: true } })
    await waitFor(() => expect(colourChoice(text.loopColours, 'blue')).toBeChecked())
    expect(colourChoice(text.boxColours, 'teal')).toBeChecked()

    unmount()
    renderWithApp('/settings', { fakes })
    await screen.findByRole('heading', { level: 1 })
    expect(colourChoice(text.loopColours, 'blue')).toBeChecked()
  })

  it('saves turning the loop colour off, and a switched-off loop can still be given a colour', async () => {
    const { user, fakes } = renderSettings()
    const save = vi.spyOn(fakes.data, 'saveSettings')
    await screen.findByRole('heading', { level: 1 })

    await user.click(loopSwitch())
    expect(save).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS, loop: { colour: 'violet', show: false } })
    await waitFor(() => expect(loopSwitch()).not.toBeChecked())

    expect(screen.getByRole('radiogroup', { name: text.loopColours }).className).toMatch(/\bopacity-50\b/)
    await user.click(colourChoice(text.loopColours, 'pink'))
    await waitFor(() => expect(save).toHaveBeenLastCalledWith({ ...DEFAULT_SETTINGS, loop: { colour: 'pink', show: false } }))
  })

  it('puts the loop colour back and says so when the save fails', async () => {
    const { user, fakes } = renderSettings()
    await screen.findByRole('heading', { level: 1 })
    vi.spyOn(fakes.data, 'saveSettings').mockRejectedValueOnce(new Error('offline'))

    await user.click(colourChoice(text.loopColours, 'amber'))

    expect(await screen.findByRole('alert')).toHaveTextContent(text.saveFailed)
    expect(colourChoice(text.loopColours, 'violet')).toBeChecked()
  })
})

describe('the keyboard shortcuts', () => {
  const group = (name: string) => within(screen.getByRole('region', { name }))

  it('has a row in Key commands whose hint counts the Editor-only entries', async () => {
    renderSettings()
    const section = within(await screen.findByRole('region', { name: text.keyCommands }))

    const editorOnly = text.shortcuts.filter((row) => row.group === 'editor').length
    expect(section.getByText(text.keyboardShortcuts)).toBeInTheDocument()
    expect(section.getByText(`Space to play or pause, N for the next problem, and ${editorOnly - 1} more for the Editor.`)).toBeInTheDocument()
    expect(section.getByRole('button', { name: text.shortcutsShow }).className).toMatch(/\bh-11\b/)
  })

  it('opens a read-only list in two groups, with no way to rebind, and closes with Done', async () => {
    const { user } = renderSettings()
    await user.click(await screen.findByRole('button', { name: text.shortcutsShow }))

    const dialog = within(await screen.findByRole('dialog', { name: text.keyboardShortcuts }))
    expect(dialog.queryByText(/click a key|press a key|reset/i)).not.toBeInTheDocument()
    expect(dialog.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)).toEqual([
      'Editor and Practice',
      'Editor only',
    ])
    expect(group('Editor and Practice').getAllByRole('listitem').map((row) => row.textContent)).toEqual(['Play / pauseSpace'])
    expect(group('Editor only').getAllByRole('listitem')).toHaveLength(17)
    for (const [action, keys] of [
      ['Move', 'V'],
      ['Add bar line', 'B'],
      ['Delete bar line', 'X'],
      ['Next problem', 'N'],
      ['Snap to previous / next beat', ', / .'],
      ['Snap to closest beat', '/'],
      ['Select several bar lines', 'Drag, or Shift + click'],
      ['Next time through a repeated bar', 'Double click'],
      ['Previous / next bar, line above / below', '← → ↑ ↓'],
      ['Clear the selection', 'Esc'],
      ['Undo', 'Cmd/Ctrl + Z'],
      ['Redo', 'Shift + Cmd/Ctrl + Z'],
      ['Zoom score', '+ / −'],
      ['Zoom waveform', 'Shift + / −'],
      ['Add locator on / off', 'L'],
      ['Delete the selected locator', 'Delete'],
    ]) {
      expect(dialog.getByText(action).closest('li')).toHaveTextContent(`${action}${keys}`)
    }
    expect(dialog.queryByRole('button', { name: /close/i })).not.toBeInTheDocument()

    await user.click(dialog.getByRole('button', { name: text.shortcutsDone }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('closes with Escape', async () => {
    const { user } = renderSettings()
    await user.click(await screen.findByRole('button', { name: text.shortcutsShow }))
    await screen.findByRole('dialog')

    await user.keyboard('{Escape}')

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})

describe('the bar numbers switch', () => {
  it('is on by default, with its hint', async () => {
    renderSettings()

    expect(await screen.findByRole('switch', { name: text.barNumbers })).toBeChecked()
    expect(screen.getByText(text.barNumbersHint)).toBeInTheDocument()
  })

  it('saves turning the numbers off with the other settings kept, and a fresh render shows it off', async () => {
    const { user, fakes, unmount } = renderSettings()
    const save = vi.spyOn(fakes.data, 'saveSettings')

    await user.click(await screen.findByRole('switch', { name: text.barNumbers }))

    expect(save).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS, barNumbers: false })
    await waitFor(() => expect(barNumbersSwitch()).not.toBeChecked())

    unmount()
    renderWithApp('/settings', { fakes })
    await screen.findByRole('heading', { level: 1 })
    expect(barNumbersSwitch()).not.toBeChecked()
  })

  it('puts the switch back when the save fails and says so in Appearance', async () => {
    const { user, fakes } = renderSettings()
    vi.spyOn(fakes.data, 'saveSettings').mockRejectedValueOnce(new Error('offline'))

    await user.click(await screen.findByRole('switch', { name: text.barNumbers }))

    await waitFor(() => expect(barNumbersSwitch()).toBeChecked())
    expect(within(screen.getByRole('region', { name: text.appearance })).getByText(text.saveFailed)).toBeInTheDocument()
  })
})

describe('the light mode switch', () => {
  it('saves at once with the other settings kept, and a fresh render shows it on', async () => {
    const { user, fakes, unmount } = renderSettings()
    const save = vi.spyOn(fakes.data, 'saveSettings')

    await user.click(await screen.findByRole('switch', { name: text.lightMode }))

    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS, theme: 'light' })
    await waitFor(() => expect(screen.getByRole('switch', { name: text.lightMode })).toBeChecked())

    unmount()
    renderWithApp('/settings', { fakes })
    await screen.findByRole('heading', { level: 1 })
    expect(screen.getByRole('switch', { name: text.lightMode })).toBeChecked()
  })

  it('saves turning it off again', async () => {
    const { user, fakes } = renderSettings()
    const toggle = await screen.findByRole('switch', { name: text.lightMode })

    await user.click(toggle)
    await waitFor(() => expect(toggle).toBeChecked())
    await user.click(toggle)

    await waitFor(async () => expect((await savedSettings(fakes)).theme).toBe('dark'))
    expect(toggle).not.toBeChecked()
  })

  it('puts the switch back and says so in Appearance when the save fails', async () => {
    const { user, fakes } = renderSettings()
    await screen.findByRole('heading', { level: 1 })
    vi.spyOn(fakes.data, 'saveSettings').mockRejectedValueOnce(new Error('offline'))

    await user.click(screen.getByRole('switch', { name: text.lightMode }))

    expect(await screen.findByRole('alert')).toHaveTextContent(text.saveFailed)
    expect(screen.getByRole('switch', { name: text.lightMode })).not.toBeChecked()
    expect(await savedSettings(fakes)).toEqual(DEFAULT_SETTINGS)
  })
})

describe('changing a setting', () => {
  it('saves the night score at once, and a fresh render on the same fakes shows it', async () => {
    const { user, fakes, unmount } = renderSettings()
    const save = vi.spyOn(fakes.data, 'saveSettings')

    await user.click(await screen.findByRole('switch', { name: text.nightScore }))

    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS, nightScore: true })
    await waitFor(() => expect(nightScore()).toBeChecked())

    unmount()
    renderWithApp('/settings', { fakes })
    await screen.findByRole('heading', { level: 1 })
    expect(nightScore()).toBeChecked()
  })

  it('saves page turns for the scrolling', async () => {
    const { user, fakes, unmount } = renderSettings()
    const save = vi.spyOn(fakes.data, 'saveSettings')

    await user.click(await screen.findByRole('button', { name: text.scrollByPage }))

    expect(save).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS, follow: { ...DEFAULT_SETTINGS.follow, scroll: 'page' } })
    await waitFor(() => expect(scrollChoice(text.scrollByPage)).toHaveAttribute('aria-pressed', 'true'))
    expect(scrollChoice(text.scrollByLine)).toHaveAttribute('aria-pressed', 'false')

    unmount()
    renderWithApp('/settings', { fakes })
    await screen.findByRole('heading', { level: 1 })
    expect(scrollChoice(text.scrollByPage)).toHaveAttribute('aria-pressed', 'true')
  })

  it('keeps the choice when the pressed scrolling button is pressed again', async () => {
    const { user, fakes } = renderSettings()
    const save = vi.spyOn(fakes.data, 'saveSettings')

    await user.click(await screen.findByRole('button', { name: text.scrollByLine }))

    expect(scrollChoice(text.scrollByLine)).toHaveAttribute('aria-pressed', 'true')
    expect(save).not.toHaveBeenCalled()
  })

  it('saves turning the box off, and a fresh render shows it off', async () => {
    const { user, fakes, unmount } = renderSettings()
    const save = vi.spyOn(fakes.data, 'saveSettings')

    await user.click(await screen.findByRole('switch', { name: text.box }))

    expect(save).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS, follow: { ...DEFAULT_SETTINGS.follow, box: false } })
    await waitFor(() => expect(boxSwitch()).not.toBeChecked())
    expect(lineSwitch()).toBeChecked()

    unmount()
    renderWithApp('/settings', { fakes })
    await screen.findByRole('heading', { level: 1 })
    expect(boxSwitch()).not.toBeChecked()
  })

  it('saves turning the gliding line off', async () => {
    const { user, fakes } = renderSettings()
    const save = vi.spyOn(fakes.data, 'saveSettings')

    await user.click(await screen.findByRole('switch', { name: text.line }))

    expect(save).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS, follow: { ...DEFAULT_SETTINGS.follow, line: false } })
    await waitFor(() => expect(lineSwitch()).not.toBeChecked())
    expect(boxSwitch()).toBeChecked()
  })

  it('saves amber for the line only, and a fresh render shows it', async () => {
    const { user, fakes, unmount } = renderSettings()
    const save = vi.spyOn(fakes.data, 'saveSettings')
    await screen.findByRole('heading', { level: 1 })

    await user.click(colourChoice(text.lineColours, 'amber'))

    expect(save).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS, follow: { ...DEFAULT_SETTINGS.follow, lineColour: 'amber' } })
    await waitFor(() => expect(colourChoice(text.lineColours, 'amber')).toBeChecked())
    expect(colourChoice(text.lineColours, 'teal')).not.toBeChecked()
    expect(colourChoice(text.boxColours, 'teal')).toBeChecked()

    unmount()
    renderWithApp('/settings', { fakes })
    await screen.findByRole('heading', { level: 1 })
    expect(colourChoice(text.lineColours, 'amber')).toBeChecked()
    expect(colourChoice(text.boxColours, 'teal')).toBeChecked()
  })

  it('saves violet for the line, and a stored violet shows chosen after a fresh render', async () => {
    const { user, fakes } = renderSettings()
    const save = vi.spyOn(fakes.data, 'saveSettings')
    await screen.findByRole('heading', { level: 1 })

    await user.click(colourChoice(text.lineColours, 'violet'))

    expect(save).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS, follow: { ...DEFAULT_SETTINGS.follow, lineColour: 'violet' } })
    await waitFor(() => expect(colourChoice(text.lineColours, 'violet')).toBeChecked())
    expect(colourChoice(text.boxColours, 'teal')).toBeChecked()
  })

  it('saves pink for the box only', async () => {
    const { user, fakes } = renderSettings()
    const save = vi.spyOn(fakes.data, 'saveSettings')
    await screen.findByRole('heading', { level: 1 })

    await user.click(colourChoice(text.boxColours, 'pink'))

    expect(save).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS, follow: { ...DEFAULT_SETTINGS.follow, boxColour: 'pink' } })
    await waitFor(() => expect(colourChoice(text.boxColours, 'pink')).toBeChecked())
    expect(colourChoice(text.lineColours, 'teal')).toBeChecked()
  })

  it('keeps each earlier change in the next one it saves', async () => {
    const { user, fakes, unmount } = renderSettings()
    const save = vi.spyOn(fakes.data, 'saveSettings')
    await screen.findByRole('heading', { level: 1 })

    await user.click(nightScore())
    await waitFor(() => expect(nightScore()).toBeChecked())
    await user.click(scrollChoice(text.scrollByPage))
    await waitFor(() => expect(scrollChoice(text.scrollByPage)).toHaveAttribute('aria-pressed', 'true'))
    await user.click(boxSwitch())
    await waitFor(() => expect(boxSwitch()).not.toBeChecked())
    await user.click(colourChoice(text.lineColours, 'amber'))
    await waitFor(() => expect(colourChoice(text.lineColours, 'amber')).toBeChecked())
    await user.click(barNumbersSwitch())
    await waitFor(() => expect(barNumbersSwitch()).not.toBeChecked())
    await user.click(screen.getByRole('switch', { name: text.lightMode }))
    await waitFor(() => expect(screen.getByRole('switch', { name: text.lightMode })).toBeChecked())

    const expected: UserSettings = {
      nightScore: true,
      follow: { scroll: 'page', box: false, boxColour: 'teal', line: true, lineColour: 'amber' },
      playback: DEFAULT_SETTINGS.playback,
      barNumbers: false,
      barLineMode: 'ripple',
      continueMode: DEFAULT_SETTINGS.continueMode,
      autoRegrid: DEFAULT_SETTINGS.autoRegrid,
      loop: DEFAULT_SETTINGS.loop,
      libraryView: DEFAULT_SETTINGS.libraryView,
      theme: 'light',
    }
    expect(save).toHaveBeenCalledTimes(6)
    expect(save).toHaveBeenLastCalledWith(expected)
    expect(await savedSettings(fakes)).toEqual(expected)

    unmount()
    renderWithApp('/settings', { fakes })
    await screen.findByRole('heading', { level: 1 })
    expect(nightScore()).toBeChecked()
    expect(scrollChoice(text.scrollByPage)).toHaveAttribute('aria-pressed', 'true')
    expect(boxSwitch()).not.toBeChecked()
    expect(colourChoice(text.lineColours, 'amber')).toBeChecked()
  })

  it('lets the colour of a switched-off box be chosen, for when it is turned on again', async () => {
    const { user, fakes } = renderSettings()
    const save = vi.spyOn(fakes.data, 'saveSettings')
    await user.click(await screen.findByRole('switch', { name: text.box }))
    await waitFor(() => expect(boxSwitch()).not.toBeChecked())

    expect(colourChoice(text.boxColours, 'amber')).toBeEnabled()
    await user.click(colourChoice(text.boxColours, 'amber'))

    await waitFor(() =>
      expect(save).toHaveBeenLastCalledWith({
        ...DEFAULT_SETTINGS,
        follow: { ...DEFAULT_SETTINGS.follow, box: false, boxColour: 'amber' },
      }),
    )
  })

  it('shows the change while it is still being saved', async () => {
    const { user, fakes } = renderSettings()
    const { save, release } = holdNextSave(fakes)

    await user.click(await screen.findByRole('switch', { name: text.nightScore }))

    expect(save).toHaveBeenCalledTimes(1)
    expect(nightScore()).toBeChecked()
    expect(await savedSettings(fakes)).toEqual(DEFAULT_SETTINGS)

    release()
    await waitFor(async () => expect((await savedSettings(fakes)).nightScore).toBe(true))
    expect(nightScore()).toBeChecked()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('saves one change at a time, in the order they were made, so the older never overwrites the newer', async () => {
    const { user, fakes } = renderSettings()
    const { save, release } = holdNextSave(fakes)
    await screen.findByRole('heading', { level: 1 })

    await user.click(nightScore())
    await user.click(scrollChoice(text.scrollByPage))

    expect(save).toHaveBeenCalledTimes(1)
    expect(nightScore()).toBeChecked()
    expect(scrollChoice(text.scrollByPage)).toHaveAttribute('aria-pressed', 'true')

    release()
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2))
    const expected: UserSettings = { ...DEFAULT_SETTINGS, nightScore: true, follow: { ...DEFAULT_SETTINGS.follow, scroll: 'page' } }
    expect(save).toHaveBeenNthCalledWith(1, { ...DEFAULT_SETTINGS, nightScore: true })
    expect(save).toHaveBeenNthCalledWith(2, expected)
    await waitFor(async () => expect(await savedSettings(fakes)).toEqual(expected))
    expect(nightScore()).toBeChecked()
    expect(scrollChoice(text.scrollByPage)).toHaveAttribute('aria-pressed', 'true')
  })
})

describe('a change that cannot be saved', () => {
  type Control = [name: string, change: () => HTMLElement, shownUnchanged: () => void]
  const controls: Control[] = [
    ['the night score', nightScore, () => expect(nightScore()).not.toBeChecked()],
    [
      'the scrolling',
      () => scrollChoice(text.scrollByPage),
      () => {
        expect(scrollChoice(text.scrollByPage)).toHaveAttribute('aria-pressed', 'false')
        expect(scrollChoice(text.scrollByLine)).toHaveAttribute('aria-pressed', 'true')
      },
    ],
    ['the box', boxSwitch, () => expect(boxSwitch()).toBeChecked()],
    ['the gliding line', lineSwitch, () => expect(lineSwitch()).toBeChecked()],
    [
      'the colour of the line',
      () => colourChoice(text.lineColours, 'amber'),
      () => {
        expect(colourChoice(text.lineColours, 'teal')).toBeChecked()
        expect(colourChoice(text.lineColours, 'amber')).not.toBeChecked()
      },
    ],
  ]

  it.each(controls)('says so and puts %s back as it was', async (_, change, shownUnchanged) => {
    const { user, fakes } = renderSettings()
    await screen.findByRole('heading', { level: 1 })
    vi.spyOn(fakes.data, 'saveSettings').mockRejectedValueOnce(new Error('offline'))

    await user.click(change())

    expect(await screen.findByRole('alert')).toHaveTextContent(text.saveFailed)
    shownUnchanged()
    expect(await savedSettings(fakes)).toEqual(DEFAULT_SETTINGS)
  })

  it('takes the message away when the next change is saved', async () => {
    const { user, fakes } = renderSettings()
    await screen.findByRole('heading', { level: 1 })
    vi.spyOn(fakes.data, 'saveSettings').mockRejectedValueOnce(new Error('offline'))
    await user.click(nightScore())
    await screen.findByRole('alert')

    await user.click(nightScore())

    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    expect(nightScore()).toBeChecked()
    expect((await savedSettings(fakes)).nightScore).toBe(true)
  })

  it('puts a change back only when it is the newest one that failed, and keeps what was saved after it', async () => {
    const { user, fakes } = renderSettings()
    await screen.findByRole('heading', { level: 1 })
    const original = fakes.data.saveSettings.bind(fakes.data)
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    vi.spyOn(fakes.data, 'saveSettings').mockImplementationOnce(async () => {
      await gate
      throw new Error('offline')
    })
    vi.spyOn(fakes.data, 'saveSettings').mockImplementation(original)

    await user.click(nightScore())
    await user.click(scrollChoice(text.scrollByPage))
    release()

    // The first save failed, the second one carried both changes and went through: nothing to put back.
    await waitFor(async () => expect((await savedSettings(fakes)).follow.scroll).toBe('page'))
    expect((await savedSettings(fakes)).nightScore).toBe(true)
    expect(nightScore()).toBeChecked()
    expect(scrollChoice(text.scrollByPage)).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('signing out', () => {
  it('signs out and lands on the landing page', async () => {
    const { user, router, fakes } = renderSettings()

    await user.click(await screen.findByRole('button', { name: text.signOut }))

    await waitFor(() => expect(pathNow(router)).toBe('/'))
    expect(await screen.findByRole('heading', { level: 1, name: strings.landing.headline.join(' ') })).toBeInTheDocument()
    expect(await fakes.data.getUser()).toBeNull()
  })

  it('says so when signing out fails, and stays on the settings', async () => {
    const { user, router, fakes } = renderSettings()
    fakes.data.signOut = () => Promise.reject(new Error('offline'))

    await user.click(await screen.findByRole('button', { name: text.signOut }))

    expect(await screen.findByRole('alert')).toHaveTextContent(text.signOutFailed)
    expect(pathNow(router)).toBe('/settings')
    expect(screen.getByRole('button', { name: text.signOut })).toBeEnabled()
  })
})

describe('who may open the settings', () => {
  it('sends a visitor to the landing page', async () => {
    const { router } = renderWithApp('/settings')

    await waitFor(() => expect(pathNow(router)).toBe('/'))
  })
})

describe('the Editing section', () => {
  it('holds the way to continue from the checked bars and the automatic beat fix, with the words of the brief', async () => {
    renderSettings()
    const editing = within(await screen.findByRole('region', { name: text.editing }))

    expect(text.editing).toBe('Editing')
    expect(text.continueMode).toBe('Continue from my bars')
    expect(text.continueModeHint).toBe('After you check 3 bars in a row by ear, the app can place the next bar lines on the beats the same way.')
    expect([text.continueAsk, text.continueButton, text.continueAuto]).toEqual(['Ask me', 'Button only', 'Automatically'])
    expect(text.autoRegrid).toBe('Fix a wrong beat by itself')
    expect(text.autoRegridHint).toBe(
      "When the recording's beat does not match the score (one beat a bar in a fast 3/4), put the bar lines on the beats when you open the Editor. You can undo it.",
    )
    expect(editing.getByText(text.continueModeHint)).toBeInTheDocument()
    expect(editing.getByText(text.autoRegridHint)).toBeInTheDocument()
  })

  it('offers Ask me, Button only and Automatically as a named group, Ask me chosen, described by its explanation', async () => {
    renderSettings()

    const group = await screen.findByRole('group', { name: text.continueMode })
    expect(within(group).getAllByRole('button').map((button) => button.textContent)).toEqual([text.continueAsk, text.continueButton, text.continueAuto])
    expect(continueChoice(text.continueAsk)).toHaveAttribute('aria-pressed', 'true')
    expect(continueChoice(text.continueButton)).toHaveAttribute('aria-pressed', 'false')
    expect(continueChoice(text.continueAuto)).toHaveAttribute('aria-pressed', 'false')
    expect(group).toHaveAccessibleDescription(text.continueModeHint)
  })

  it('has the automatic fix off, with its explanation as the switch description', async () => {
    renderSettings()

    expect(await screen.findByRole('switch', { name: text.autoRegrid })).not.toBeChecked()
    expect(autoRegridSwitch()).toHaveAccessibleDescription(text.autoRegridHint)
  })

  it.each([
    [text.continueButton, 'button'],
    [text.continueAuto, 'auto'],
  ] as const)('saves %s with the other settings kept, and a fresh render shows it', async (label, continueMode) => {
    const { user, fakes, unmount } = renderSettings()
    const save = vi.spyOn(fakes.data, 'saveSettings')

    await user.click(await screen.findByRole('button', { name: label }))

    expect(save).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS, continueMode })
    await waitFor(() => expect(continueChoice(label)).toHaveAttribute('aria-pressed', 'true'))
    expect(continueChoice(text.continueAsk)).toHaveAttribute('aria-pressed', 'false')

    unmount()
    renderWithApp('/settings', { fakes })
    await screen.findByRole('heading', { level: 1 })
    expect(continueChoice(label)).toHaveAttribute('aria-pressed', 'true')
    expect((await savedSettings(fakes)).continueMode).toBe(continueMode)
  })

  it('keeps the choice when the pressed one is pressed again', async () => {
    const { user, fakes } = renderSettings()
    const save = vi.spyOn(fakes.data, 'saveSettings')

    await user.click(await screen.findByRole('button', { name: text.continueAsk }))

    expect(continueChoice(text.continueAsk)).toHaveAttribute('aria-pressed', 'true')
    expect(save).not.toHaveBeenCalled()
  })

  it('saves turning the automatic fix on, and a fresh render shows it on', async () => {
    const { user, fakes, unmount } = renderSettings()
    const save = vi.spyOn(fakes.data, 'saveSettings')

    await user.click(await screen.findByRole('switch', { name: text.autoRegrid }))

    expect(save).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS, autoRegrid: true })
    await waitFor(() => expect(autoRegridSwitch()).toBeChecked())

    unmount()
    renderWithApp('/settings', { fakes })
    await screen.findByRole('heading', { level: 1 })
    expect(autoRegridSwitch()).toBeChecked()
  })

  it('puts the choice back and says so in Editing when the save fails', async () => {
    const { user, fakes } = renderSettings()
    vi.spyOn(fakes.data, 'saveSettings').mockRejectedValueOnce(new Error('offline'))

    await user.click(await screen.findByRole('button', { name: text.continueAuto }))

    await waitFor(() => expect(continueChoice(text.continueAsk)).toHaveAttribute('aria-pressed', 'true'))
    expect(within(screen.getByRole('region', { name: text.editing })).getByText(text.saveFailed)).toBeInTheDocument()
  })

  it('puts the switch back and says so in Editing when the save fails', async () => {
    const { user, fakes } = renderSettings()
    vi.spyOn(fakes.data, 'saveSettings').mockRejectedValueOnce(new Error('offline'))

    await user.click(await screen.findByRole('switch', { name: text.autoRegrid }))

    await waitFor(() => expect(autoRegridSwitch()).not.toBeChecked())
    expect(within(screen.getByRole('region', { name: text.editing })).getByText(text.saveFailed)).toBeInTheDocument()
  })
})
