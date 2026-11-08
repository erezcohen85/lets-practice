import { countLabelSpot } from '@/domain/countLabel'
import { straightMap } from '@/domain/fixtures'
import { buildTimeline } from '@/domain/tempo'

const { timing, page } = straightMap(40)
const timeline = buildTimeline(timing)
const boxOf = (bar: number) => page.bars.find((box) => box.bar === bar)!

describe('countLabelSpot', () => {
  it('is at the start of the loop first bar: the x of the gliding line there, on the top edge of the bar box', () => {
    const spot = countLabelSpot(timeline, page, 12) // position 12 plays bar 13

    const box = boxOf(13)
    expect(spot).toEqual({ pageIndex: box.pageIndex, x: box.x, y: box.y })
  })

  it('is the box of the bar being replayed when the loop starts on a second pass', () => {
    const replay = buildTimeline({
      ...timing,
      barCount: 4,
      playOrder: [{ from: 1, to: 4 }, { from: 1, to: 4 }],
      locators: Array.from({ length: 8 }, (_, i) => ({ bar: (i % 4) + 1, passIndex: Math.floor(i / 4), timeSec: 1 + 2 * i, confirmed: false })),
    })

    expect(countLabelSpot(replay, page, 6)).toEqual({ pageIndex: boxOf(3).pageIndex, x: boxOf(3).x, y: boxOf(3).y })
  })

  it('is null for a position outside the timeline', () => {
    expect(countLabelSpot(timeline, page, -1)).toBeNull()
    expect(countLabelSpot(timeline, page, 99)).toBeNull()
  })

  it('is null when this part has no box for the bar', () => {
    expect(countLabelSpot(timeline, { ...page, bars: page.bars.filter((box) => box.bar !== 13) }, 12)).toBeNull()
  })
})
