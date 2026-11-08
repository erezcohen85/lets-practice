import { screen } from '@testing-library/react'
import { DEFAULT_SETTINGS } from '@/lib/dataClient'
import { createFakes } from '@/lib/fakes'
import { renderWithApp } from '@/test/render'

// The Bar numbers setting reaches the Editor's score too (UX fixes part 1, item 7): the bar boxes stay either way.

const CLARK = 'piece-clark-county'
const COLUMN = 1240 + 2 * 16

async function open(barNumbers: boolean) {
  const fakes = createFakes({ seed: 'demo' })
  await fakes.data.saveSettings({ ...DEFAULT_SETTINGS, barNumbers })
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(COLUMN)
  const detail = (await fakes.data.getPiece(CLARK))!
  renderWithApp(`/pieces/${CLARK}/edit?part=${detail.parts[0].id}`, { fakes, playerSec: 271 })
  await screen.findAllByRole('img', { name: /^Page \d of 4$/ }, { timeout: 5000 })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Editor: the bar numbers setting', () => {
  it('draws the numbers over the staff by default', async () => {
    await open(true)

    expect(document.querySelectorAll('[data-slot="bar-number"]').length).toBeGreaterThan(0)
  })

  it('draws none when the setting is off, and keeps the bar boxes', async () => {
    await open(false)

    expect(document.querySelectorAll('[data-slot="bar-number"]')).toHaveLength(0)
    expect(document.querySelectorAll('[data-slot="bar-box"]').length).toBeGreaterThan(0)
  })
})
