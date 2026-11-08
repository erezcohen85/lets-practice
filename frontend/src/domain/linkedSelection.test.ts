import { barFromParam, locatorNearPlayhead, locatorOfBar, nextPass } from './linkedSelection'
import { type BarBox, type Locator } from './types'

const box = (bar: number): BarBox => ({ bar, pageIndex: 0, x: 0, y: 0, w: 10, h: 10 })
const boxes = [box(1), box(2), box(3)]
const at = (bar: number, passIndex: number, timeSec: number): Locator => ({ bar, passIndex, timeSec, confirmed: false })

describe('barFromParam', () => {
  it('reads a bar number of the part', () => {
    expect(barFromParam('2', boxes)).toBe(2)
  })

  it('ignores a missing, unknown, out-of-range or malformed value', () => {
    expect(barFromParam(null, boxes)).toBeNull()
    expect(barFromParam('', boxes)).toBeNull()
    expect(barFromParam('4', boxes)).toBeNull()
    expect(barFromParam('0', boxes)).toBeNull()
    expect(barFromParam('-1', boxes)).toBeNull()
    expect(barFromParam('1.5', boxes)).toBeNull()
    expect(barFromParam('2abc', boxes)).toBeNull()
  })
})

describe('locatorOfBar', () => {
  const locators = [at(1, 0, 0), at(2, 0, 2), at(2, 1, 10), at(2, 2, 20), at(3, 0, 4)]

  it('takes the first pass when there is no playhead time', () => {
    expect(locatorOfBar(locators, 2, null)).toEqual({ bar: 2, passIndex: 0 })
  })

  it('takes the pass whose time is nearest the playhead', () => {
    expect(locatorOfBar(locators, 2, 11)).toEqual({ bar: 2, passIndex: 1 })
    expect(locatorOfBar(locators, 2, 19)).toEqual({ bar: 2, passIndex: 2 })
    expect(locatorOfBar(locators, 2, 0)).toEqual({ bar: 2, passIndex: 0 })
  })

  it('takes the earlier pass when two are equally near', () => {
    expect(locatorOfBar(locators, 2, 6)).toEqual({ bar: 2, passIndex: 0 })
  })

  it('is null for a bar that has no locator in any pass', () => {
    expect(locatorOfBar(locators, 9, 3)).toBeNull()
    expect(locatorOfBar([], 1, null)).toBeNull()
  })
})

describe('locatorNearPlayhead', () => {
  const locators = [at(2, 0, 2), at(2, 1, 10), at(2, 2, 20), at(3, 0, 4)]

  it('gives the whole locator of the pass nearest the playhead, so a click can seek to its time', () => {
    expect(locatorNearPlayhead(locators, 2, 11)).toEqual(at(2, 1, 10))
    expect(locatorNearPlayhead(locators, 2, 19)).toEqual(at(2, 2, 20))
    expect(locatorNearPlayhead(locators, 3, 50)).toEqual(at(3, 0, 4))
  })

  it('takes the first pass with no playhead time, and is null for a bar with no locator', () => {
    expect(locatorNearPlayhead(locators, 2, null)).toEqual(at(2, 0, 2))
    expect(locatorNearPlayhead(locators, 9, 3)).toBeNull()
  })
})

// A double click on a bar of the score steps through its repeats: 1st, 2nd, 1st.
describe('nextPass', () => {
  const locators = [at(2, 0, 2), at(2, 1, 10), at(2, 2, 20), at(3, 0, 4), at(0, 0, 0.5), at(0, 1, 9), at(-7, 0, 30), at(-7, 1, 40)]

  it('gives the locator of the next pass in playing order, and wraps from the last to the first', () => {
    expect(nextPass(locators, 2, 0)).toEqual(at(2, 1, 10))
    expect(nextPass(locators, 2, 1)).toEqual(at(2, 2, 20))
    expect(nextPass(locators, 2, 2)).toEqual(at(2, 0, 2))
  })

  it('steps by playing order, not by the order of the list', () => {
    expect(nextPass([at(2, 2, 20), at(2, 0, 2), at(2, 1, 10)], 2, 0)).toEqual(at(2, 1, 10))
  })

  it('stays on a bar that is played once', () => {
    expect(nextPass(locators, 3, 0)).toEqual(at(3, 0, 4))
  })

  it('works for the pickup and for a pickup in the middle of the piece, whatever number they carry', () => {
    expect(nextPass(locators, 0, 0)).toEqual(at(0, 1, 9))
    expect(nextPass(locators, 0, 1)).toEqual(at(0, 0, 0.5))
    expect(nextPass(locators, -7, 1)).toEqual(at(-7, 0, 30))
  })

  it('starts at the first pass when the given pass is not one of the bar\'s, and is null for a bar with no locator', () => {
    expect(nextPass(locators, 2, 7)).toEqual(at(2, 0, 2))
    expect(nextPass(locators, 2, null)).toEqual(at(2, 0, 2))
    expect(nextPass(locators, 9, 0)).toBeNull()
  })
})
