import { screen } from '@testing-library/react'
import { DEFAULT_PRACTICE_MEMORY } from '@/domain/types'
import { DEFAULT_SETTINGS, type LoopSettings } from '@/lib/dataClient'
import { createFakes } from '@/lib/fakes'
import { strings } from '@/strings'
import { loopClass } from '@/components/practice/loopColour'
import { renderWithApp } from '@/test/render'

// The loop colour and the "show the loop" setting on the Practice screen (Settings > Loop colour, UX polish task 5).

const CLARK = 'piece-clark-county'
const PAGE_WIDTH = 1240
const COLUMN = PAGE_WIDTH + 2 * 16

async function open(loop: LoopSettings) {
  const fakes = createFakes({ seed: 'demo' })
  await fakes.data.saveSettings({ ...DEFAULT_SETTINGS, loop })
  await fakes.data.savePracticeMemory(CLARK, { ...DEFAULT_PRACTICE_MEMORY, loop: { startPosition: 12, endPosition: 23 }, loopOn: true })
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(COLUMN)
  const view = renderWithApp(`/pieces/${CLARK}/practice`, { fakes, playerSec: 271 })
  await screen.findAllByRole('img', { name: /^Page \d of 4$/ }, { timeout: 5000 })
  return view
}

const tints = () => document.querySelectorAll('[data-slot="range-tint"]')
const handles = () => document.querySelectorAll('[data-slot="range-handle"]')
const range = () => (screen.getByRole('textbox', { name: strings.practice.loopRange }) as HTMLInputElement).value
const band = () => document.querySelector<HTMLElement>('[data-slot="loop-band"]')

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Practice: the loop colour', () => {
  it('is violet by default, through the loop tokens themselves, with the tint, the handles and the band shown', async () => {
    await open({ colour: 'violet', show: true })

    const main = screen.getByRole('main')
    expect(range()).not.toBe('')
    expect(main.style.getPropertyValue('--lp-loop-user')).toBe('var(--lp-loop)')
    expect(main.style.getPropertyValue('--lp-loop-user-soft')).toBe('var(--lp-loop-soft)')
    expect(main.style.getPropertyValue('--lp-loop-user-tint')).toBe('var(--lp-loop-tint)')
    expect(main.style.getPropertyValue('--lp-loop-user-handle')).toBe('var(--lp-loop-handle)')
    expect(tints().length).toBeGreaterThan(0)
    expect(tints()[0]).toHaveClass(loopClass.tint)
    expect(handles()).toHaveLength(2)
    expect(band()).toHaveClass(loopClass.tint, loopClass.handleBorder)
    expect(screen.getByText(strings.practice.loopBand(range()))).toHaveClass(loopClass.soft)
  })

  it('takes another colour from its own token, for the score, the band and the field only', async () => {
    await open({ colour: 'pink', show: true })

    const main = screen.getByRole('main')
    expect(main.style.getPropertyValue('--lp-loop-user')).toBe('var(--lp-cursor-pink)')
    expect(main.style.getPropertyValue('--lp-loop-user-tint')).toContain('var(--lp-cursor-pink)')
    expect(main.style.getPropertyValue('--lp-loop')).toBe('')
  })

  it('removes the tint of the score and the fill of the band when show is off, and keeps the handles and the band edges', async () => {
    await open({ colour: 'blue', show: false })

    expect(tints()).toHaveLength(0)
    expect(handles()).toHaveLength(2)
    expect(band()).not.toBeNull()
    expect(band()).not.toHaveClass(loopClass.tint)
    expect(band()).toHaveClass('border-x', loopClass.handleBorder)
    expect(screen.getByText(strings.practice.loopBand(range()))).toBeInTheDocument()
  })
})
