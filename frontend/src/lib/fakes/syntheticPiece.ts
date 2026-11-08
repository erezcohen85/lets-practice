import { type DetectedBeat } from '@/domain/beats'
import { expandPlayOrder } from '@/domain/playOrder'
import { meterAt } from '@/domain/renumber'
import {
  type BarBox,
  type BarMark,
  type BarNumber,
  type Locator,
  type MeterChange,
  type PageLayer,
  type PlayOrderRow,
  type TimingLayer,
} from '@/domain/types'
import { tokens } from '@/design/tokens'
import { type PageImage } from '@/lib/dataClient'

// A piece made up on the spot: the pages are SVG drawings, the boxes sit on a regular grid, the recording is a steady
// tempo. The fakes use it so the editor has something to show; nothing here reads a file or draws at random.

export interface SyntheticSpec {
  barCount: number
  barsPerLine: number
  linesPerPage: number
  meters: MeterChange[]
  playOrder: PlayOrderRow[]
  marks: BarMark[]
  /** Seconds per beat as recorded; a fermata bar lasts 1.6 times its length. */
  secPerBeat: number
  /** Time of the first downbeat. */
  startSec: number
  /** Slot positions (expanded play order) whose locators start confirmed. */
  confirmedPositions: number[]
  /** A pickup (bar 0) of this many beats: the play order starts at 0 and the first line holds a narrow box for it. */
  pickupUnits?: number
  /** Pickups in the middle of the piece, each a short bar with no number of its own: its internal bar and its beats. The bars keep their whole numbers; the app labels such a bar p7. */
  midPickups?: { bar: BarNumber; units: number }[]
}

export const PAGE_WIDTH = 1240 // A4 at 150 dpi
export const PAGE_HEIGHT = 1754

const FERMATA_FACTOR = 1.6
const TAIL_SEC = 2
const MARGIN_X = 100
const MARGIN_Y = 140
const PICKUP_BOX_FRACTION = 0.3

/** The demo piece of the canvas: 64 bars, 4 pages of 4 lines of 4 bars, 4/4 then 2/4 from bar 49, bars 9-16 repeated, a rit. over bars 15-16, a fermata on bar 28. */
export const DEMO_SPEC: SyntheticSpec = {
  barCount: 64,
  barsPerLine: 4,
  linesPerPage: 4,
  meters: [
    { fromBar: 1, numerator: 4, denominator: 4 },
    { fromBar: 49, numerator: 2, denominator: 4 },
  ],
  playOrder: [
    { from: 1, to: 16 },
    { from: 9, to: 16 },
    { from: 17, to: 64 },
  ],
  marks: [
    { bar: 15, kind: 'rit' },
    { bar: 16, kind: 'rit' },
    { bar: 28, kind: 'fermata' },
  ],
  // The rit. is a mark only: the recording stays even, so the demo's times do not change. 258.4 beats (56 bars of 4, 16 of 2, 2.4 for the fermata) from 4 s on, then the last bar and the 2 s tail: 271 s.
  secPerBeat: 265 / 258.4,
  startSec: 4,
  confirmedPositions: [0, 24, 48, 71],
}

/** A barcarolle in 6/8 with a pickup of one eighth: bar 0, then 24 bars, a repeat of bars 9-16, an eighth lasts 0.4 s. */
export const PICKUP_SPEC: SyntheticSpec = {
  barCount: 24,
  barsPerLine: 4,
  linesPerPage: 4,
  meters: [{ fromBar: 1, numerator: 6, denominator: 8 }],
  playOrder: [
    { from: 0, to: 16 },
    { from: 9, to: 24 },
  ],
  marks: [],
  secPerBeat: 0.4,
  startSec: 2,
  confirmedPositions: [0],
  pickupUnits: 1,
}

/**
 * A march in 4/4, 24 bars, played straight through, with a short bar of two beats at internal bar 7 that takes no number of its own:
 * the bars read 1 to 6, p7, 7 and on. Its first locator is confirmed.
 */
export const MID_PICKUP_SPEC: SyntheticSpec = {
  barCount: 24,
  barsPerLine: 4,
  linesPerPage: 4,
  meters: [{ fromBar: 1, numerator: 4, denominator: 4 }],
  playOrder: [{ from: 1, to: 24 }],
  marks: [],
  secPerBeat: 0.5,
  startSec: 2,
  confirmedPositions: [0],
  midPickups: [{ bar: 7, units: 2 }],
}

/** 16 bars on one page, straight through, 4/4, with the first downbeat confirmed; lasts `durationSec`. */
export function smallSpec(durationSec: number): SyntheticSpec {
  const startSec = 2
  return {
    barCount: 16,
    barsPerLine: 4,
    linesPerPage: 4,
    meters: [{ fromBar: 1, numerator: 4, denominator: 4 }],
    playOrder: [{ from: 1, to: 16 }],
    marks: [],
    secPerBeat: (durationSec - startSec - TAIL_SEC) / 64,
    startSec,
    confirmedPositions: [0],
  }
}

/** How long a bar lasts in beats: its meter's numerator (the pickup's own length for bar 0), 1.6 times that for a fermata. */
function beatsOf(spec: SyntheticSpec, bar: BarNumber): number {
  if (bar === 0 && spec.pickupUnits !== undefined) return spec.pickupUnits
  const middle = spec.midPickups?.find((pickup) => pickup.bar === bar)
  if (middle !== undefined) return middle.units
  const fermata = spec.marks.some((mark) => mark.bar === bar && mark.kind === 'fermata')
  return meterAt(spec.meters, bar).numerator * (fermata ? FERMATA_FACTOR : 1)
}

/** Every slot of the play order on the recording: where it starts and how long it lasts. */
function slotSpans(spec: SyntheticSpec): Array<{ bar: BarNumber; passIndex: number; startSec: number; lengthSec: number }> {
  let startSec = spec.startSec
  return expandPlayOrder(spec.playOrder, spec.barCount).map((slot) => {
    const lengthSec = beatsOf(spec, slot.bar) * spec.secPerBeat
    const span = { bar: slot.bar, passIndex: slot.passIndex, startSec, lengthSec }
    startSec += lengthSec
    return span
  })
}

export function syntheticTiming(spec: SyntheticSpec): TimingLayer {
  const confirmed = new Set(spec.confirmedPositions)
  const locators: Locator[] = slotSpans(spec).map((span, position) => ({
    bar: span.bar,
    passIndex: span.passIndex,
    timeSec: span.startSec,
    confirmed: confirmed.has(position),
  }))
  return {
    barCount: spec.barCount,
    playOrder: spec.playOrder.map((row) => ({ ...row })),
    meters: spec.meters.map((change) => ({ ...change })),
    marks: spec.marks.map((mark) => ({ ...mark })),
    locators,
    ...(spec.pickupUnits === undefined && spec.midPickups === undefined
      ? {}
      : {
          shortBars: [
            ...(spec.pickupUnits === undefined ? [] : [{ bar: 0, units: spec.pickupUnits }]),
            ...(spec.midPickups ?? []).map((pickup) => ({ bar: pickup.bar, units: pickup.units, unnumbered: true as const })),
          ],
        }),
  }
}

/** The last locator, plus its bar, plus a 2 s tail. */
export function recordingSeconds(spec: SyntheticSpec): number {
  const spans = slotSpans(spec)
  const last = spans[spans.length - 1]
  return last.startSec + last.lengthSec + TAIL_SEC
}

// --- the pages ---------------------------------------------------------------

/** Page pixels a box reaches above the top staff line and below the bottom one, so a note head on a ledger line still sits mostly inside. */
const STAFF_MARGIN = 12

/**
 * The grid of one line of boxes on a page: the width of a box, the distance between lines, and where the staff sits. A
 * box spans its staff from the top line to the bottom line plus the margin, as the boxes of a scanned score will (they
 * come from the staff geometry): `staffTop` is the offset of the top line from the line's origin, `staffGap` the space
 * between two lines.
 */
function gridOf(spec: SyntheticSpec) {
  const pitch = Math.floor((PAGE_HEIGHT - 2 * MARGIN_Y) / spec.linesPerPage)
  const slot = pitch - 80
  const staffTop = Math.round(slot * 0.3)
  const staffGap = Math.round(slot * 0.1)
  const staffH = 4 * staffGap
  return {
    boxW: Math.floor((PAGE_WIDTH - 2 * MARGIN_X) / spec.barsPerLine),
    boxY: staffTop - STAFF_MARGIN,
    boxH: staffH + 2 * STAFF_MARGIN,
    staffTop,
    staffGap,
    pitch,
  }
}

/**
 * missedLineAfter: bars whose following bar line the "OMR" missed in this part (their two boxes come out as one).
 * rests: the bars this part rests (a part's own: the others of the piece may play them).
 * A bar at the end of a line has no bar line to miss; it is ignored.
 */
export function syntheticPageLayer(spec: SyntheticSpec, partId: string, missedLineAfter: number[] = [], rests: BarNumber[] = []): PageLayer {
  const { boxW, boxY, boxH, pitch } = gridOf(spec)
  const missed = new Set(missedLineAfter)
  const perPage = spec.barsPerLine * spec.linesPerPage
  const pickup = spec.pickupUnits !== undefined
  // The pickup's box is narrow, from after the clef to its bar line; the bars of the first line share the rest.
  const pickupW = Math.round(boxW * PICKUP_BOX_FRACTION)
  const firstLineW = pickup ? Math.floor((boxW * spec.barsPerLine - pickupW) / spec.barsPerLine) : boxW
  const bars: BarBox[] = []
  if (pickup) bars.push({ bar: 0, pageIndex: 0, x: MARGIN_X, y: MARGIN_Y + boxY, w: pickupW, h: boxH })
  for (let index = 0; index < spec.barCount; index++) {
    const col = index % spec.barsPerLine
    const line = Math.floor(index / spec.barsPerLine) % spec.linesPerPage
    const width = index < spec.barsPerLine ? firstLineW : boxW
    // The previous original bar (on the same line when col > 0) lost its line to this one if it is in the missed list.
    if (col > 0 && missed.has(index)) {
      bars[bars.length - 1].w += width
      continue
    }
    bars.push({
      bar: bars.length + (pickup ? 0 : 1),
      pageIndex: Math.floor(index / perPage),
      x: MARGIN_X + (index < spec.barsPerLine && pickup ? pickupW : 0) + col * width,
      y: MARGIN_Y + line * pitch + boxY,
      w: width,
      h: boxH,
    })
  }
  return { partId, bars, rests: [...rests] }
}

/** A fixed linear congruential sequence of numbers in 0..1, so the note heads are the same every time. */
function sequence(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 2 ** 32
  }
}

/**
 * The page as SVG markup: paper, five-line staves, bar lines at the box edges, a few note heads per bar. It prints no bar
 * numbers: the editor's overlay numbers every bar itself.
 */
export function syntheticPageSvg(spec: SyntheticSpec, page: PageLayer, pageIndex: number): string {
  const { paper, ink } = tokens.color.dark
  const boxes = page.bars.filter((box) => box.pageIndex === pageIndex)
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${PAGE_WIDTH}" height="${PAGE_HEIGHT}" viewBox="0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}">`,
    `<rect width="${PAGE_WIDTH}" height="${PAGE_HEIGHT}" fill="${paper}"/>`,
  ]

  const { boxY, staffTop, staffGap: gap } = gridOf(spec)
  const edgesByLine = new Map<string, { y: number; xs: Set<number> }>()
  for (const box of boxes) {
    const top = box.y - boxY + staffTop
    for (let k = 0; k < 5; k++) {
      const y = top + k * gap
      parts.push(`<line class="staff" x1="${box.x}" y1="${y}" x2="${box.x + box.w}" y2="${y}" stroke="${ink}" stroke-width="2"/>`)
    }

    const next = sequence(box.bar * 7919 + pageIndex * 104729 + 1)
    const notes = Math.max(2, Math.round(box.w / 65))
    for (let n = 0; n < notes; n++) {
      const cx = box.x + Math.round(box.w * (0.12 + (0.76 * (n + 0.5 * next())) / notes))
      const cy = top + Math.round(next() * 8) * Math.round(gap / 2)
      parts.push(`<ellipse cx="${cx}" cy="${cy}" rx="11" ry="8" fill="${ink}"/>`)
    }

    const line = edgesByLine.get(String(box.y)) ?? { y: box.y, xs: new Set<number>() }
    line.xs.add(box.x)
    line.xs.add(box.x + box.w)
    edgesByLine.set(String(box.y), line)
  }

  for (const { y, xs } of edgesByLine.values()) {
    const top = y - boxY + staffTop
    const bottom = top + 4 * gap
    for (const x of xs) {
      parts.push(`<line class="barline" x1="${x}" y1="${top}" x2="${x}" y2="${bottom}" stroke="${ink}" stroke-width="3"/>`)
    }
  }

  parts.push('</svg>')
  return parts.join('')
}

/**
 * One image per page of the layer (pages 0 to the highest page index of its boxes). Pass the complete layout
 * (syntheticPageLayer without missed lines): a missed bar line is missing from a part's boxes, not from the printed page.
 */
export function syntheticPages(spec: SyntheticSpec, page: PageLayer): PageImage[] {
  const pageCount = page.bars.reduce((count, box) => Math.max(count, box.pageIndex + 1), 0)
  return Array.from({ length: pageCount }, (_, pageIndex) => ({
    pageIndex,
    width: PAGE_WIDTH,
    height: PAGE_HEIGHT,
    url: `data:image/svg+xml;utf8,${encodeURIComponent(syntheticPageSvg(spec, page, pageIndex))}`,
  }))
}

// --- the recording -----------------------------------------------------------

/** Peaks the fakes make for every second of the recording (the processor's real ones come at about 170). */
export const PEAKS_PER_SEC = 40

// The shape of the fake recording: a note struck on every beat, loudest on the downbeat, fading in about 0.3 s, over a
// sustained body, under a swell that rises and falls every four 4/4 bars.
const DOWNBEAT_ATTACK = 0.6
const BEAT_ATTACK = 0.35
const ATTACK_DECAY_SEC = 0.1
const SUSTAIN = 0.6
const SWELL_BEATS = 16
const NOISE = 0.06

/** One-sided peaks (0..1), `count` of them over the recording; deterministic. See the shape above. */
export function syntheticPeaks(spec: SyntheticSpec, count: number): number[] {
  const total = recordingSeconds(spec)
  // Every beat of every bar of the original timing: the downbeat on the locator, the others a beat apart.
  const onsets = slotSpans(spec).flatMap((span) => {
    const quieter = meterAt(spec.meters, span.bar).numerator === 2 ? 0.8 : 1
    const beats = Math.ceil(beatsOf(spec, span.bar) - 1e-9)
    return Array.from({ length: beats }, (_, k) => ({
      timeSec: span.startSec + k * spec.secPerBeat,
      strength: (k === 0 && span.bar !== 0 ? DOWNBEAT_ATTACK : BEAT_ATTACK) * quieter,
    }))
  })
  const swellSec = SWELL_BEATS * spec.secPerBeat
  const next = sequence(2718)
  let at = -1
  return Array.from({ length: count }, (_, i) => {
    const timeSec = ((i + 0.5) / count) * total
    while (at < onsets.length - 1 && onsets[at + 1].timeSec <= timeSec) at++
    const attack = at < 0 ? 0 : onsets[at].strength * Math.exp(-(timeSec - onsets[at].timeSec) / ATTACK_DECAY_SEC)
    const swell = 0.8 + 0.35 * Math.sin((2 * Math.PI * timeSec) / swellSec)
    const value = swell * (SUSTAIN * (at < 0 ? 0.1 : 1) + attack) + NOISE * (next() - 0.5)
    return Math.round(Math.min(1, Math.max(0, value)) * 1000) / 1000
  })
}

/** The beats of a synthetic recording, as a beat tracker would give them: a beat every `secPerBeat`, the first of each bar a downbeat. */
export function recordingBeats(spec: SyntheticSpec): DetectedBeat[] {
  return slotSpans(spec).flatMap((span) =>
    Array.from({ length: Math.ceil(beatsOf(spec, span.bar) - 1e-9) }, (_, k) => ({
      t: Math.round((span.startSec + k * spec.secPerBeat) * 1000) / 1000,
      downbeat: k === 0 && span.bar !== 0 && spec.midPickups?.every((pickup) => pickup.bar !== span.bar) !== false ? 0.95 : 0.05,
    })),
  )
}

/** The peaks of a synthetic recording: PEAKS_PER_SEC of them for every second. */
export function recordingPeaks(spec: SyntheticSpec): number[] {
  return syntheticPeaks(spec, Math.round(recordingSeconds(spec) * PEAKS_PER_SEC))
}
