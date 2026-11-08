import { demoDoc } from '@/domain/pieceFixtures'
import { lineModeFor, shiftedBars } from '@/domain/locatorModes'
import { addLocator, deleteLocator } from '@/domain/renumber'

describe('lineModeFor', () => {
  it('follows the switch: on renumbers (ripple), off does not (plain)', () => {
    expect(lineModeFor('ripple', false)).toBe('ripple')
    expect(lineModeFor('plain', false)).toBe('plain')
  })

  it('Shift does the other one, for that one action', () => {
    expect(lineModeFor('ripple', true)).toBe('plain')
    expect(lineModeFor('plain', true)).toBe('ripple')
  })
})

describe('shiftedBars', () => {
  const timing = demoDoc().timing

  it('names the first and last bar a ripple delete moved back, by their old numbers', () => {
    const after = deleteLocator(timing, 30, 0, 'ripple')
    if (!after.ok) throw new Error('delete refused')

    expect(shiftedBars(timing, after.timing)).toEqual({
      first: { bar: 31, passIndex: 0 },
      last: { bar: 64, passIndex: 0 },
      count: 34,
      direction: 'back',
    })
  })

  it('names the bars a ripple add moved forward', () => {
    const at = timing.locators.find((l) => l.bar === 10)!.timeSec + 1
    const after = addLocator(timing, at, 'ripple')
    if (!after.ok) throw new Error('add refused')

    const moved = shiftedBars(timing, after.timing)

    expect(moved).toMatchObject({ first: { bar: 11, passIndex: 0 }, direction: 'forward' })
    expect(moved?.count).toBeGreaterThan(1)
  })

  it('counts a single moved locator once', () => {
    const after = deleteLocator(timing, 63, 0, 'ripple')
    if (!after.ok) throw new Error('delete refused')

    expect(shiftedBars(timing, after.timing)).toEqual({ first: { bar: 64, passIndex: 0 }, last: { bar: 64, passIndex: 0 }, count: 1, direction: 'back' })
  })

  it('is null when nothing changed its bar: a plain delete, or the last bar deleted by ripple', () => {
    const plain = deleteLocator(timing, 30, 0, 'plain')
    const last = deleteLocator(timing, 64, 0, 'ripple')
    if (!plain.ok || !last.ok) throw new Error('delete refused')

    expect(shiftedBars(timing, plain.timing)).toBeNull()
    expect(shiftedBars(timing, last.timing)).toBeNull()
  })
})
