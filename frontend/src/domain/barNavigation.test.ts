import { neighbourBar } from '@/domain/barNavigation'
import { type BarBox } from '@/domain/types'

const box = (bar: number, pageIndex: number, x: number, y: number, w = 100, h = 80): BarBox => ({ bar, pageIndex, x, y, w, h })

// Page 0: line 1 holds bars 1-3, line 2 holds bars 4-5 (bar 4 is wide). Page 1: one line with bars 6-7.
const bars: BarBox[] = [
  box(1, 0, 300, 100),
  box(2, 0, 400, 100),
  box(3, 0, 500, 100),
  box(4, 0, 100, 300, 300),
  box(5, 0, 400, 300),
  box(6, 1, 100, 100),
  box(7, 1, 200, 100),
]

describe('neighbourBar', () => {
  it('steps to the next and previous bar, across lines and pages', () => {
    expect(neighbourBar(bars, 2, 'right')).toBe(3)
    expect(neighbourBar(bars, 3, 'right')).toBe(4)
    expect(neighbourBar(bars, 5, 'right')).toBe(6)
    expect(neighbourBar(bars, 6, 'left')).toBe(5)
    expect(neighbourBar(bars, 4, 'left')).toBe(3)
  })

  it('stays on the first and last bar', () => {
    expect(neighbourBar(bars, 1, 'left')).toBe(1)
    expect(neighbourBar(bars, 7, 'right')).toBe(7)
  })

  it('goes to the bar of the line below or above that is nearest across', () => {
    expect(neighbourBar(bars, 3, 'down')).toBe(5)
    expect(neighbourBar(bars, 1, 'down')).toBe(4)
    expect(neighbourBar(bars, 5, 'up')).toBe(2)
    expect(neighbourBar(bars, 4, 'up')).toBe(1)
  })

  it('goes from the last line of a page to the first line of the next, and back', () => {
    expect(neighbourBar(bars, 5, 'down')).toBe(7)
    expect(neighbourBar(bars, 6, 'up')).toBe(4)
  })

  it('stays put on the first line going up and the last line going down', () => {
    expect(neighbourBar(bars, 2, 'up')).toBe(2)
    expect(neighbourBar(bars, 7, 'down')).toBe(7)
  })

  it('steps through the bars of a multi-rest that share one box one by one', () => {
    const rest = [box(1, 0, 100, 100), box(2, 0, 200, 100), box(3, 0, 200, 100), box(4, 0, 300, 100)]
    expect(neighbourBar(rest, 1, 'right')).toBe(2)
    expect(neighbourBar(rest, 2, 'right')).toBe(3)
    expect(neighbourBar(rest, 3, 'right')).toBe(4)
  })

  it('starts on the first bar when nothing is selected, or the selected bar has no box', () => {
    expect(neighbourBar(bars, null, 'right')).toBe(1)
    expect(neighbourBar(bars, null, 'down')).toBe(1)
    expect(neighbourBar(bars, 99, 'left')).toBe(1)
  })

  it('has nothing to go to on a part without boxes', () => {
    expect(neighbourBar([], null, 'right')).toBeNull()
  })
})
