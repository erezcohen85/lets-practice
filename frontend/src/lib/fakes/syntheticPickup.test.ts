import { createFakes } from '@/lib/fakes'
import { expandPlayOrder } from '@/domain/playOrder'
import { buildTimeline, localTempo } from '@/domain/tempo'
import { PICKUP_SPEC, recordingBeats, syntheticPageLayer, syntheticTiming } from '@/lib/fakes/syntheticPiece'

describe('the synthetic piece with a pickup', () => {
  const timing = syntheticTiming(PICKUP_SPEC)

  it('has a pickup of one eighth in its timing, a play order from bar 0 and a locator for bar 0', () => {
    expect(timing.shortBars).toEqual([{ bar: 0, units: 1 }])
    expect(timing.playOrder[0].from).toBe(0)
    expect(timing.locators[0]).toMatchObject({ bar: 0, passIndex: 0, timeSec: 2 })
    expect(timing.locators[1]).toMatchObject({ bar: 1, timeSec: 2.4 })
    expect(timing.locators).toHaveLength(expandPlayOrder(timing.playOrder, timing.barCount).length)
  })

  it('times the pickup as one eighth and the bars after it as six', () => {
    const timeline = buildTimeline(timing)

    expect(localTempo(timeline[0]).beats).toBe(1)
    expect(localTempo(timeline[0]).bpm).toBeCloseTo(150)
    expect(localTempo(timeline[1]).beats).toBe(6)
    expect(timeline[1].endSec - timeline[1].startSec).toBeCloseTo(2.4)
  })

  it('draws a narrow box for bar 0 first on the first line, and bar 1 after it, with no overlap', () => {
    const { bars } = syntheticPageLayer(PICKUP_SPEC, 'violin')

    expect(bars).toHaveLength(25)
    expect(bars.map((box) => box.bar).slice(0, 3)).toEqual([0, 1, 2])
    expect(bars[0].w).toBeLessThan(bars[1].w / 2)
    expect(bars[1].x).toBe(bars[0].x + bars[0].w)
    const line = bars.filter((box) => box.pageIndex === 0 && box.y === bars[0].y)
    expect(line.map((box) => box.bar)).toEqual([0, 1, 2, 3, 4])
    expect(line[line.length - 1].x + line[line.length - 1].w).toBeCloseTo(bars[8].x + bars[8].w, -1)
  })

  it('has no pickup box and no short bars when the spec has no pickup', () => {
    const plain = { ...PICKUP_SPEC, pickupUnits: undefined }

    expect(syntheticPageLayer({ ...plain, playOrder: [{ from: 1, to: 24 }] }, 'violin').bars[0].bar).toBe(1)
    expect(syntheticTiming({ ...plain, playOrder: [{ from: 1, to: 24 }] })).not.toHaveProperty('shortBars')
  })

  it('has a beat for the pickup that is not a downbeat', () => {
    expect(recordingBeats(PICKUP_SPEC)[0].downbeat).toBeLessThan(0.5)
    expect(recordingBeats(PICKUP_SPEC)[1].downbeat).toBeGreaterThan(0.5)
  })
})

describe('the demo-pickup seed', () => {
  it('adds the pickup piece to the five pieces of the Library board, and the plain demo does not have it', async () => {
    const plain = await createFakes({ seed: 'demo' }).data.listPieces()
    const withPickup = await createFakes({ seed: 'demo-pickup' }).data.listPieces()

    expect(plain.map((piece) => piece.title)).not.toContain('Barcarolle in G')
    expect(withPickup).toHaveLength(plain.length + 1)
    const piece = withPickup.find((entry) => entry.title === 'Barcarolle in G')
    expect(piece).toMatchObject({ partCount: 1, durationSec: 82, review: { checked: 0, total: 1 } })
  })

  it('opens with the pickup in its timing and a narrow box for it on the part', async () => {
    const { data } = createFakes({ seed: 'demo-pickup' })

    const map = await data.getPieceMap('piece-barcarolle')

    expect(map?.timing.shortBars).toEqual([{ bar: 0, units: 1 }])
    expect(map?.pages[0].bars[0]).toMatchObject({ bar: 0 })
  })
})
