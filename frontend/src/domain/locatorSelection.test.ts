import { isSelected, sameSlot, slotsBetween, toggleSlot } from '@/domain/locatorSelection'

const at = (bar: number, timeSec: number, passIndex = 0) => ({ bar, passIndex, timeSec })
const LOCATORS = [at(1, 1), at(2, 4.6), at(3, 8.2), at(4, 11.8), at(5, 15.4)]

describe('toggleSlot', () => {
  it('adds a slot that is not selected, last', () => {
    expect(toggleSlot([{ bar: 2, passIndex: 0 }], { bar: 4, passIndex: 0 })).toEqual([
      { bar: 2, passIndex: 0 },
      { bar: 4, passIndex: 0 },
    ])
  })

  it('removes a slot that is selected and keeps the others in order', () => {
    const selection = [
      { bar: 2, passIndex: 0 },
      { bar: 3, passIndex: 0 },
      { bar: 4, passIndex: 0 },
    ]
    expect(toggleSlot(selection, { bar: 3, passIndex: 0 })).toEqual([
      { bar: 2, passIndex: 0 },
      { bar: 4, passIndex: 0 },
    ])
  })

  it('tells the passes of a bar apart', () => {
    expect(toggleSlot([{ bar: 2, passIndex: 0 }], { bar: 2, passIndex: 1 })).toHaveLength(2)
  })

  it('does not change the selection it was given', () => {
    const selection = Object.freeze([Object.freeze({ bar: 2, passIndex: 0 })])
    expect(() => toggleSlot(selection, { bar: 3, passIndex: 0 })).not.toThrow()
  })
})

describe('slotsBetween', () => {
  it('lists the locators whose time is in the range, in time order, whichever end was dragged first', () => {
    const expected = [
      { bar: 2, passIndex: 0 },
      { bar: 3, passIndex: 0 },
    ]
    expect(slotsBetween(LOCATORS, 4, 9)).toEqual(expected)
    expect(slotsBetween(LOCATORS, 9, 4)).toEqual(expected)
  })

  it('includes a locator exactly on an end of the range', () => {
    expect(slotsBetween(LOCATORS, 4.6, 8.2)).toEqual([
      { bar: 2, passIndex: 0 },
      { bar: 3, passIndex: 0 },
    ])
  })

  it('is empty when no locator is in the range', () => {
    expect(slotsBetween(LOCATORS, 5, 8)).toEqual([])
  })

  it('keeps only the slot, not the time', () => {
    expect(Object.keys(slotsBetween(LOCATORS, 0, 2)[0]).sort()).toEqual(['bar', 'passIndex'])
  })
})

describe('sameSlot and isSelected', () => {
  it('compare the bar and the pass', () => {
    expect(sameSlot({ bar: 2, passIndex: 1 }, { bar: 2, passIndex: 1 })).toBe(true)
    expect(sameSlot({ bar: 2, passIndex: 1 }, { bar: 2, passIndex: 0 })).toBe(false)
    expect(isSelected([{ bar: 2, passIndex: 1 }], { bar: 2, passIndex: 1 })).toBe(true)
    expect(isSelected([], { bar: 2, passIndex: 1 })).toBe(false)
  })
})
