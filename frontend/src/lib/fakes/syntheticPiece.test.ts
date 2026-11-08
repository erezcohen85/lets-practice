import { tokens } from '@/design/tokens'
import { expandPlayOrder } from '@/domain/playOrder'
import { type PageLayer } from '@/domain/types'
import {
  DEMO_SPEC,
  PAGE_HEIGHT,
  PAGE_WIDTH,
  recordingSeconds,
  smallSpec,
  syntheticPageLayer,
  syntheticPages,
  syntheticPageSvg,
  PEAKS_PER_SEC,
  recordingPeaks,
  syntheticPeaks,
  syntheticTiming,
} from '@/lib/fakes/syntheticPiece'

const PART = 'part-x'

function parseSvg(markup: string): Document {
  return new DOMParser().parseFromString(markup, 'image/svg+xml')
}

describe('syntheticTiming of the demo piece', () => {
  const timing = syntheticTiming(DEMO_SPEC)

  it('has 64 bars and the play order 1-16, 9-16, 17-64', () => {
    expect(timing.barCount).toBe(64)
    expect(timing.playOrder).toEqual([
      { from: 1, to: 16 },
      { from: 9, to: 16 },
      { from: 17, to: 64 },
    ])
    expect(timing.meters).toEqual([
      { fromBar: 1, numerator: 4, denominator: 4 },
      { fromBar: 49, numerator: 2, denominator: 4 },
    ])
    expect(timing.marks).toEqual([
      { bar: 15, kind: 'rit' },
      { bar: 16, kind: 'rit' },
      { bar: 28, kind: 'fermata' },
    ])
  })

  it('has one locator per slot of the play order, in slot order, strictly increasing', () => {
    const slots = expandPlayOrder(timing.playOrder, timing.barCount)

    expect(slots).toHaveLength(72)
    expect(timing.locators.map((locator) => [locator.bar, locator.passIndex])).toEqual(
      slots.map((slot) => [slot.bar, slot.passIndex]),
    )
    timing.locators.forEach((locator, i) => {
      if (i > 0) expect(locator.timeSec).toBeGreaterThan(timing.locators[i - 1].timeSec)
    })
    expect(timing.locators[0].timeSec).toBe(DEMO_SPEC.startSec)
  })

  it('confirms exactly the slots in confirmedPositions', () => {
    const confirmed = timing.locators.flatMap((locator, position) => (locator.confirmed ? [position] : []))

    expect(confirmed).toEqual([...DEMO_SPEC.confirmedPositions].sort((a, b) => a - b))
    expect(confirmed.length).toBeGreaterThan(0)
  })

  it('makes a 2/4 bar half as long as a 4/4 bar and a fermata bar 1.6 times as long', () => {
    const slots = expandPlayOrder(timing.playOrder, timing.barCount)
    const length = (bar: number) => {
      const i = slots.findIndex((slot) => slot.bar === bar && slot.passIndex === 0)
      return timing.locators[i + 1].timeSec - timing.locators[i].timeSec
    }

    expect(length(50)).toBeCloseTo(length(30) / 2, 9)
    expect(length(28)).toBeCloseTo(length(30) * 1.6, 9)
    expect(length(30)).toBeCloseTo(4 * DEMO_SPEC.secPerBeat, 9)
  })

  it('returns a new object each time', () => {
    expect(syntheticTiming(DEMO_SPEC)).toEqual(timing)
    expect(syntheticTiming(DEMO_SPEC)).not.toBe(timing)
  })
})

describe('recordingSeconds', () => {
  it('is the last locator plus one bar plus 2 s, and 271 s for the demo piece', () => {
    const timing = syntheticTiming(DEMO_SPEC)
    const last = timing.locators[timing.locators.length - 1]

    expect(recordingSeconds(DEMO_SPEC)).toBeCloseTo(last.timeSec + 2 * DEMO_SPEC.secPerBeat + 2, 9)
    expect(recordingSeconds(DEMO_SPEC)).toBeCloseTo(271, 6)
  })
})

describe('syntheticPageLayer', () => {
  it('has 64 boxes, 16 per page, 4 per line, all inside the page', () => {
    const layer = syntheticPageLayer(DEMO_SPEC, PART)

    expect(layer.partId).toBe(PART)
    expect(layer.bars.map((box) => box.bar)).toEqual(Array.from({ length: 64 }, (_, i) => i + 1))
    for (const page of [0, 1, 2, 3]) expect(layer.bars.filter((box) => box.pageIndex === page)).toHaveLength(16)
    for (const box of layer.bars) {
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.y).toBeGreaterThanOrEqual(0)
      expect(box.x + box.w).toBeLessThanOrEqual(PAGE_WIDTH)
      expect(box.y + box.h).toBeLessThanOrEqual(PAGE_HEIGHT)
    }
  })

  it('puts the boxes of one line on one y and h, touching edge to edge', () => {
    const layer = syntheticPageLayer(DEMO_SPEC, PART)

    for (let line = 0; line < 16; line++) {
      const boxes = layer.bars.slice(line * 4, line * 4 + 4)
      expect(new Set(boxes.map((box) => box.y)).size).toBe(1)
      expect(new Set(boxes.map((box) => box.h)).size).toBe(1)
      for (let i = 1; i < boxes.length; i++) expect(boxes[i].x).toBe(boxes[i - 1].x + boxes[i - 1].w)
    }
    const lineYs = layer.bars.filter((box) => box.pageIndex === 0).map((box) => box.y)
    expect(new Set(lineYs).size).toBe(4)
  })

  it('with a missed bar line after bar 22 has 63 boxes, one wide box 22 and every later bar one lower', () => {
    const full = syntheticPageLayer(DEMO_SPEC, PART)
    const missed = syntheticPageLayer(DEMO_SPEC, PART, [22])

    expect(missed.bars).toHaveLength(63)
    expect(missed.bars.map((box) => box.bar)).toEqual(Array.from({ length: 63 }, (_, i) => i + 1))
    expect(missed.bars[21]).toEqual({ ...full.bars[21], w: full.bars[21].w + full.bars[22].w })
    expect(missed.bars.slice(0, 21)).toEqual(full.bars.slice(0, 21))
    for (let bar = 23; bar <= 63; bar++) expect(missed.bars[bar - 1]).toEqual({ ...full.bars[bar], bar })
  })

  it('gives the same layout for the same input', () => {
    expect(syntheticPageLayer(DEMO_SPEC, PART, [22])).toEqual(syntheticPageLayer(DEMO_SPEC, PART, [22]))
  })
})

describe('syntheticPageSvg', () => {
  const layer = syntheticPageLayer(DEMO_SPEC, PART)

  it('is valid SVG markup of the size of the page', () => {
    const doc = parseSvg(syntheticPageSvg(DEMO_SPEC, layer, 0))

    expect(doc.getElementsByTagName('parsererror')).toHaveLength(0)
    const root = doc.documentElement
    expect(root.tagName).toBe('svg')
    expect(root.getAttribute('width')).toBe(String(PAGE_WIDTH))
    expect(root.getAttribute('height')).toBe(String(PAGE_HEIGHT))
  })

  it('draws one bar line per box edge on the page', () => {
    const doc = parseSvg(syntheticPageSvg(DEMO_SPEC, layer, 1))

    // 4 lines of 4 boxes: 5 edges per line.
    expect(doc.querySelectorAll('line.barline')).toHaveLength(4 * 5)
  })

  it('draws a bar line for the edges of a merged box too', () => {
    const missed = syntheticPageLayer(DEMO_SPEC, PART, [22])
    const doc = parseSvg(syntheticPageSvg(DEMO_SPEC, missed, 1))

    // The line with bars 21 to 24 has three boxes now: 4 edges instead of 5.
    expect(doc.querySelectorAll('line.barline')).toHaveLength(3 * 5 + 4)
  })

  it('draws five staff lines per box', () => {
    const doc = parseSvg(syntheticPageSvg(DEMO_SPEC, layer, 0))

    expect(doc.querySelectorAll('line.staff')).toHaveLength(16 * 5)
  })

  it('makes every box span its staff from the top line to the bottom line plus a small margin, and no more', () => {
    const doc = parseSvg(syntheticPageSvg(DEMO_SPEC, layer, 0))
    // The staff lines of this box: same columns, and near it (the next line of boxes is a whole line pitch away).
    const staffYs = (box: { x: number; y: number; w: number; h: number }) =>
      [...doc.querySelectorAll('line.staff')]
        .filter((line) => Number(line.getAttribute('x1')) === box.x && Number(line.getAttribute('x2')) === box.x + box.w)
        .map((line) => Number(line.getAttribute('y1')))
        .filter((y) => y > box.y - 100 && y < box.y + box.h + 100)

    for (const box of layer.bars.filter((b) => b.pageIndex === 0)) {
      const ys = staffYs(box)
      expect(ys).toHaveLength(5)
      const above = Math.min(...ys) - box.y
      const below = box.y + box.h - Math.max(...ys)
      expect(above).toBeGreaterThanOrEqual(8)
      expect(above).toBeLessThanOrEqual(16)
      expect(below).toBe(above)
    }
  })

  it('prints no bar numbers: the editor numbers the bars itself', () => {
    expect(syntheticPageSvg(DEMO_SPEC, layer, 0)).not.toContain('<text')
  })

  it('is the same markup every time', () => {
    expect(syntheticPageSvg(DEMO_SPEC, layer, 2)).toBe(syntheticPageSvg(DEMO_SPEC, layer, 2))
  })

  it('draws a page with no boxes as blank paper', () => {
    const empty: PageLayer = { partId: PART, bars: [], rests: [] }
    const doc = parseSvg(syntheticPageSvg(DEMO_SPEC, empty, 0))

    expect(doc.getElementsByTagName('parsererror')).toHaveLength(0)
    expect(doc.querySelectorAll('line')).toHaveLength(0)
  })
})

describe('syntheticPages', () => {
  it('gives one image per page with the size of the page and an SVG data URL', () => {
    const pages = syntheticPages(DEMO_SPEC, syntheticPageLayer(DEMO_SPEC, PART))

    expect(pages.map((page) => page.pageIndex)).toEqual([0, 1, 2, 3])
    for (const page of pages) {
      expect(page.width).toBe(1240)
      expect(page.height).toBe(1754)
      expect(page.url.startsWith('data:image/svg+xml;utf8,')).toBe(true)
    }
    const markup = decodeURIComponent(pages[0].url.slice('data:image/svg+xml;utf8,'.length))
    expect(parseSvg(markup).getElementsByTagName('parsererror')).toHaveLength(0)
  })
})

describe('smallSpec', () => {
  it('is 16 bars on one page, straight through, and lasts the given duration', () => {
    const spec = smallSpec(192)
    const timing = syntheticTiming(spec)

    expect(timing.barCount).toBe(16)
    expect(timing.playOrder).toEqual([{ from: 1, to: 16 }])
    expect(syntheticPageLayer(spec, PART).bars.every((box) => box.pageIndex === 0)).toBe(true)
    expect(recordingSeconds(spec)).toBeCloseTo(192, 6)
  })
})

describe('syntheticPeaks', () => {
  it('is deterministic, as long as asked and between 0 and 1', () => {
    const peaks = syntheticPeaks(DEMO_SPEC, 2000)

    expect(peaks).toHaveLength(2000)
    expect(syntheticPeaks(DEMO_SPEC, 2000)).toEqual(peaks)
    expect(peaks.every((value) => value >= 0 && value <= 1)).toBe(true)
  })

  it('makes 40 peaks for every second of the recording', () => {
    expect(PEAKS_PER_SEC).toBe(40)
    expect(recordingPeaks(DEMO_SPEC)).toHaveLength(10840)
    expect(recordingPeaks(smallSpec(192))).toHaveLength(192 * 40)
  })

  describe('as a recording', () => {
    const peaks = recordingPeaks(DEMO_SPEC)
    const timing = syntheticTiming(DEMO_SPEC)
    const at = (sec: number) => peaks[Math.floor(sec * PEAKS_PER_SEC)]
    const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length
    // The 4/4 bars before the fermata: beat 1 on the locator, beats 2 to 4 a beat apart.
    const bars = timing.locators.filter((locator) => locator.bar >= 17 && locator.bar <= 27)
    const beat = DEMO_SPEC.secPerBeat

    it('attacks sharply on every downbeat and decays within about 0.3 s', () => {
      const downbeats = bars.map((locator) => locator.timeSec)

      expect(mean(downbeats.map((t) => at(t + 0.01)))).toBeGreaterThan(mean(downbeats.map((t) => at(t + 0.3))) + 0.15)
    })

    it('attacks less on the other beats than on the downbeat', () => {
      const downbeats = bars.map((locator) => at(locator.timeSec + 0.01))
      const others = bars.flatMap((locator) => [1, 2, 3].map((k) => at(locator.timeSec + k * beat + 0.01)))

      expect(mean(downbeats)).toBeGreaterThan(mean(others) + 0.05)
      expect(mean(others)).toBeGreaterThan(mean(bars.flatMap((locator) => [1, 2, 3].map((k) => at(locator.timeSec + k * beat + 0.3)))))
    })

    it('swells with the phrase: some stretches are louder than others', () => {
      const windowMeans = Array.from({ length: 16 }, (_, i) => mean(peaks.slice(i * 600, (i + 1) * 600)))

      expect(Math.max(...windowMeans) - Math.min(...windowMeans)).toBeGreaterThan(0.12)
    })

    it('spreads over the low, mid and high bands of the waveform colours, most of it in the mid band', () => {
      const share = (test: (value: number) => boolean) => peaks.filter(test).length / peaks.length

      expect(share((value) => value < tokens.wave.midFrom)).toBeGreaterThan(0.05)
      expect(share((value) => value >= tokens.wave.highFrom)).toBeGreaterThan(0.05)
      expect(share((value) => value >= tokens.wave.midFrom && value < tokens.wave.highFrom)).toBeGreaterThan(0.45)
    })

    it('is quieter in the 2/4 bars than in the 4/4 bars', () => {
      const meanBetween = (from: number, to: number) => mean(peaks.slice(Math.floor(from * PEAKS_PER_SEC), Math.floor(to * PEAKS_PER_SEC)))
      const start = (bar: number) => timing.locators.find((locator) => locator.bar === bar && locator.passIndex === 0)?.timeSec ?? 0

      expect(meanBetween(start(17), start(49))).toBeGreaterThan(meanBetween(start(49), start(64)))
    })
  })
})
