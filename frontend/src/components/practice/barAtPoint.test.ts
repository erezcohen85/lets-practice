import { type BarBox } from '@/domain/types'
import { type PageImage } from '@/lib/dataClient'
import { barAtClientPoint } from './barAtPoint'

const pages: PageImage[] = [
  { pageIndex: 0, width: 1000, height: 1400, url: 'a' },
  { pageIndex: 1, width: 1000, height: 1400, url: 'b' },
]
const bars: BarBox[] = [
  { bar: 1, pageIndex: 0, x: 100, y: 100, w: 200, h: 100 },
  { bar: 2, pageIndex: 1, x: 100, y: 100, w: 200, h: 100 },
]

/** Pages drawn at half size, the second one 800 px below the first. */
function draw() {
  document.body.innerHTML = '<div data-slot="score-page" data-page-index="0"></div><div data-slot="score-page" data-page-index="1"></div>'
  const [first, second] = document.querySelectorAll<HTMLElement>('[data-slot="score-page"]')
  const rect = (top: number) => ({ left: 0, top, width: 500, height: 700, right: 500, bottom: top + 700, x: 0, y: top, toJSON() {} })
  first.getBoundingClientRect = () => rect(0)
  second.getBoundingClientRect = () => rect(800)
}

describe('barAtClientPoint', () => {
  beforeEach(draw)

  it('finds the bar under a point of the first page, in image pixels', () => {
    expect(barAtClientPoint(100, 75, pages, bars)).toBe(1)
  })

  it('finds the bar under a point of the second page', () => {
    expect(barAtClientPoint(100, 875, pages, bars)).toBe(2)
  })

  it('is null between bars on different lines and outside the pages', () => {
    expect(barAtClientPoint(400, 75, pages, bars)).toBeNull()
    expect(barAtClientPoint(100, 760, pages, bars)).toBeNull()
  })

  it('gives the clef area at the start of a line to the first bar of that line', () => {
    expect(barAtClientPoint(30, 75, pages, bars)).toBe(1) // image x 60, left of the box at 100
  })

  it('gives the gap before a bar that starts after a signature to that bar', () => {
    const trimmed: BarBox[] = [
      { bar: 1, pageIndex: 0, x: 100, y: 100, w: 200, h: 100 },
      { bar: 2, pageIndex: 0, x: 340, y: 100, w: 200, h: 100 },
    ]
    expect(barAtClientPoint(160, 75, pages, trimmed)).toBe(2) // image x 320, in the gap
  })
})
