import { DEFAULT_SETTINGS, normaliseSettings } from '@/lib/dataClient'

describe('normaliseSettings', () => {
  it('gives the defaults to a profile saved before the playback settings existed', () => {
    const old = { follow: { scroll: 'page', box: false, boxColour: 'amber', line: true, lineColour: 'pink' }, nightScore: true, barLineMode: 'plain' }

    const settings = normaliseSettings(old)

    expect(settings.playback).toEqual({ countInFade: 'pre-roll', showCount: true })
    expect(settings).toMatchObject({ follow: old.follow, nightScore: true, barLineMode: 'plain' })
  })

  it('keeps the playback settings it is given', () => {
    const settings = normaliseSettings({ ...DEFAULT_SETTINGS, playback: { countInFade: 'under-clicks', showCount: false } })

    expect(settings.playback).toEqual({ countInFade: 'under-clicks', showCount: false })
  })

  it('replaces a choice it does not know, and a switch that is not a boolean, with the default', () => {
    const settings = normaliseSettings({ ...DEFAULT_SETTINGS, playback: { countInFade: 'loud', showCount: 'yes' } })

    expect(settings.playback).toEqual(DEFAULT_SETTINGS.playback)
  })

  it('turns the bar numbers on for a profile saved before the setting existed', () => {
    const old: Record<string, unknown> = { ...DEFAULT_SETTINGS }
    delete old.barNumbers

    expect(normaliseSettings(old).barNumbers).toBe(true)
  })

  it('keeps bar numbers off, and replaces a value that is not a boolean with on', () => {
    expect(normaliseSettings({ ...DEFAULT_SETTINGS, barNumbers: false }).barNumbers).toBe(false)
    expect(normaliseSettings({ ...DEFAULT_SETTINGS, barNumbers: 'off' }).barNumbers).toBe(true)
  })

  it('gives a violet, shown loop and the cards view to a profile saved before they existed', () => {
    const old: Record<string, unknown> = { ...DEFAULT_SETTINGS }
    delete old.loop
    delete old.libraryView

    const settings = normaliseSettings(old)

    expect(settings.loop).toEqual({ colour: 'violet', show: true })
    expect(settings.libraryView).toBe('cards')
  })

  it('keeps a loop colour, the loop shown or hidden, and the list view', () => {
    for (const colour of ['violet', 'teal', 'amber', 'pink', 'blue'] as const) {
      expect(normaliseSettings({ ...DEFAULT_SETTINGS, loop: { colour, show: false } }).loop).toEqual({ colour, show: false })
    }
    expect(normaliseSettings({ ...DEFAULT_SETTINGS, libraryView: 'list' }).libraryView).toBe('list')
  })

  it('replaces a loop colour it does not know, a show that is not a boolean, a loop that is not an object and a view it does not know with the defaults', () => {
    expect(normaliseSettings({ ...DEFAULT_SETTINGS, loop: { colour: 'green', show: 'no' } }).loop).toEqual({ colour: 'violet', show: true })
    expect(normaliseSettings({ ...DEFAULT_SETTINGS, loop: 'teal' }).loop).toEqual({ colour: 'violet', show: true })
    expect(normaliseSettings({ ...DEFAULT_SETTINGS, loop: null }).loop).toEqual({ colour: 'violet', show: true })
    expect(normaliseSettings({ ...DEFAULT_SETTINGS, libraryView: 'grid' }).libraryView).toBe('cards')
  })

  it('keeps blue as the box colour', () => {
    expect(normaliseSettings({ ...DEFAULT_SETTINGS, follow: { ...DEFAULT_SETTINGS.follow, boxColour: 'blue' } }).follow.boxColour).toBe('blue')
  })

  it('reads a missing, null or non-object value as the defaults', () => {
    for (const raw of [undefined, null, 'x', 7]) expect(normaliseSettings(raw)).toEqual(DEFAULT_SETTINGS)
  })

  it('returns a copy: changing it leaves the defaults alone', () => {
    const settings = normaliseSettings(undefined)
    settings.playback.showCount = false
    settings.follow.box = false
    settings.loop.show = false

    expect(DEFAULT_SETTINGS.playback.showCount).toBe(true)
    expect(DEFAULT_SETTINGS.follow.box).toBe(true)
    expect(DEFAULT_SETTINGS.loop.show).toBe(true)
  })

  it('gives the dark theme to a profile saved before the theme existed, and keeps light', () => {
    const old: Record<string, unknown> = { ...DEFAULT_SETTINGS }
    delete old.theme

    expect(normaliseSettings(old).theme).toBe('dark')
    expect(normaliseSettings({ ...DEFAULT_SETTINGS, theme: 'light' }).theme).toBe('light')
  })

  it('replaces a theme it does not know with dark', () => {
    expect(normaliseSettings({ ...DEFAULT_SETTINGS, theme: 'sepia' }).theme).toBe('dark')
    expect(normaliseSettings({ ...DEFAULT_SETTINGS, theme: true }).theme).toBe('dark')
  })

  it('goes on asking by default and leaves the automatic beat fix off', () => {
    expect(DEFAULT_SETTINGS.continueMode).toBe('ask')
    expect(DEFAULT_SETTINGS.autoRegrid).toBe(false)
    expect(normaliseSettings(undefined)).toMatchObject({ continueMode: 'ask', autoRegrid: false })
  })

  it('gives both to a profile saved before the Editing settings existed', () => {
    const old: Record<string, unknown> = { ...DEFAULT_SETTINGS, nightScore: true }
    delete old.continueMode
    delete old.autoRegrid

    expect(normaliseSettings(old)).toEqual({ ...DEFAULT_SETTINGS, nightScore: true, continueMode: 'ask', autoRegrid: false })
  })

  it('keeps each way to continue, and the fix switched on', () => {
    for (const continueMode of ['ask', 'button', 'auto'] as const) expect(normaliseSettings({ ...DEFAULT_SETTINGS, continueMode }).continueMode).toBe(continueMode)
    expect(normaliseSettings({ ...DEFAULT_SETTINGS, autoRegrid: true }).autoRegrid).toBe(true)
  })

  it('replaces a way to continue it does not know, and a switch that is not a boolean, with the defaults', () => {
    expect(normaliseSettings({ ...DEFAULT_SETTINGS, continueMode: 'always' }).continueMode).toBe('ask')
    expect(normaliseSettings({ ...DEFAULT_SETTINGS, continueMode: true }).continueMode).toBe('ask')
    expect(normaliseSettings({ ...DEFAULT_SETTINGS, autoRegrid: 'yes' }).autoRegrid).toBe(false)
    expect(normaliseSettings({ ...DEFAULT_SETTINGS, autoRegrid: 1 }).autoRegrid).toBe(false)
  })
})
