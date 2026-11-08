import { type BarNames } from './barNames'
import { expandMarkRows, formatMarkRange, groupMarks, listedMarks } from './markRanges'
import { formatPlayOrder, parsePlayOrder } from './playOrder'
import { type ListedMark, type ListedMarkKind, type MeterChange, type PageLayer, type PlayOrderRow, type ShortBar, type TimingLayer } from './types'

/** The parts of the timing layer that the Structure panel edits as text. shortBars is only there when the piece has some. */
export interface Structure { meters: MeterChange[]; playOrder: PlayOrderRow[]; marks: ListedMark[]; shortBars?: ShortBar[] }

export type StructureTextError = 'unknown-line' | 'bad-meter' | 'bad-range' | 'bad-mark' | 'bad-short-bar' | 'bad-pickup' | 'missing-line'
export type ParseResult =
  | { ok: true; structure: Structure }
  | { ok: false; errors: { line: number; message: StructureTextError }[] }

/** The structure the panel shows for the part open in the editor: the timing's, with that part's rests among the marks. */
export function structureOf(timing: TimingLayer, page: PageLayer | undefined): Structure {
  return {
    meters: timing.meters,
    playOrder: timing.playOrder,
    marks: listedMarks(timing, page),
    ...(timing.shortBars === undefined ? {} : { shortBars: timing.shortBars }),
  }
}

export type StructurePart = 'meters' | 'playOrder' | 'marks' | 'shortBars' | 'pickups'

/** The parts in the order the text lists them; a part that is missing is reported at its place in this order. */
const PARTS: { part: StructurePart; prefix: string }[] = [
  { part: 'meters', prefix: 'meters' },
  { part: 'playOrder', prefix: 'play order' },
  { part: 'marks', prefix: 'marks' },
  { part: 'shortBars', prefix: 'short bars' },
  { part: 'pickups', prefix: 'pickups' },
]

/** The parts a text must hold; the short bars line is optional (a piece without short bars has none). */
const REQUIRED: StructurePart[] = ['meters', 'playOrder', 'marks']

const NONE = 'none'
const LINE = /^(meters|play order|marks|short bars|pickups)\s*:(.*)$/i
// Bars are labels: "12" or "p7".
const METER = /^(\d+)\s*\/\s*(\d+)\s+from\s+(p?\d+)$/i
const SHORT_BAR = /^(pickup|\d+)\s+(\d+)\s*\/\s*(\d+)$/i
const PICKUP = /^(p\d+)\s+(\d+)\s*\/\s*(\d+)$/i
const MARK = /^(fermata|rest|rit)\.?\s+(p?\d+)(?:\s*[-–]\s*(p?\d+))?$/i

/** The meter's denominator in force at a bar, or undefined with no meters. */
function denominatorAt(meters: MeterChange[], bar: number): number | undefined {
  let found: MeterChange | undefined
  for (const change of [...meters].sort((a, b) => a.fromBar - b.fromBar)) {
    if (found === undefined || change.fromBar <= bar) found = change
  }
  return found?.denominator
}

/**
 * Three lines, the PoC's format: "meters: 4/4 from 1, 2/4 from 49" / "play order: 1-16, 9-16, 17-end" / "marks: fermata 28,
 * rest 40-42, rit 15-16" (the rests are those of the part open in the editor); consecutive bars of one kind are written as a range. A piece with short bars has a fourth,
 * "short bars: pickup 1/8, 44 3/8": the pickup is the top of the piece (it reads p1), then bar 44 holds three eighths. A
 * piece with pickups in the middle has a fifth, "pickups: p7 2/4, p21 1/4". Every bar is written as a label (`names`).
 */
export function formatStructure(structure: Structure, barCount: number, names: BarNames): string {
  const meters = structure.meters.map((change) => `${change.numerator}/${change.denominator} from ${names.label(change.fromBar)}`)
  const marks = groupMarks(structure.marks).map((range) => formatMarkRange(range, names))
  const noteOf = ({ bar, units }: ShortBar) => `${units}/${denominatorAt(structure.meters, bar) ?? 4}`
  const all = structure.shortBars ?? []
  const short = all.filter((entry) => entry.unnumbered !== true).map((entry) => `${entry.bar === 0 ? 'pickup' : names.label(entry.bar)} ${noteOf(entry)}`)
  const pickups = all.filter((entry) => entry.unnumbered === true).map((entry) => `${names.label(entry.bar)} ${noteOf(entry)}`)
  return [
    `meters: ${meters.length === 0 ? NONE : meters.join(', ')}`,
    `play order: ${formatPlayOrder(structure.playOrder, barCount, names)}`,
    `marks: ${marks.length === 0 ? NONE : marks.join(', ')}`,
    ...(short.length === 0 ? [] : [`short bars: ${short.join(', ')}`]),
    ...(pickups.length === 0 ? [] : [`pickups: ${pickups.join(', ')}`]),
  ].join('\n')
}

/** The comma-separated items of a line's text; "none" and nothing at all are no items. */
function itemsOf(body: string): string[] {
  const items = body
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '')
  return items.length === 1 && items[0].toLowerCase() === NONE ? [] : items
}

function readMeters(body: string, names: BarNames): MeterChange[] | null {
  const meters: MeterChange[] = []
  for (const item of itemsOf(body)) {
    const match = METER.exec(item)
    if (match === null) return null
    const fromBar = names.parse(match[3])
    if (fromBar === null) return null
    meters.push({ fromBar, numerator: Number(match[1]), denominator: Number(match[2]) })
  }
  return meters
}

function readMarks(body: string, names: BarNames): ListedMark[] | null {
  const marks: ListedMark[] = []
  for (const item of itemsOf(body)) {
    const match = MARK.exec(item)
    if (match === null) return null
    const from = names.parse(match[2])
    const to = match[3] === undefined ? from : names.parse(match[3])
    if (from === null || to === null || to < from) return null
    marks.push(...expandMarkRows([{ kind: match[1].toLowerCase() as ListedMarkKind, from, to }]).marks)
  }
  return marks
}

/** "pickup 1/8, 44 3/8"; null when an item is not that or its note value is not the meter's at its bar. */
function readShortBars(body: string, meters: MeterChange[] | null, names: BarNames): ShortBar[] | null {
  const shortBars: ShortBar[] = []
  for (const item of itemsOf(body)) {
    const match = SHORT_BAR.exec(item)
    if (match === null) return null
    const bar = match[1].toLowerCase() === 'pickup' ? 0 : names.parse(match[1])
    if (bar === null || (meters !== null && denominatorAt(meters, bar) !== Number(match[3]))) return null
    shortBars.push({ bar, units: Number(match[2]) })
  }
  return shortBars
}

/**
 * "p7 2/4, p21 1/4": pickups with no number of their own, read as the line says them: p1 is the top of the piece, and p9 is the pickup
 * before the numbered bar 9 once every pickup of the line is in place (the bar that reads 9 now becomes it, as "Before bar 9" does in the
 * Pickup bars box). Null when an item is not that or the note value is not the meter's at its bar.
 */
function readPickups(body: string, meters: MeterChange[] | null): ShortBar[] | null {
  const items: { number: number; units: number; denominator: number }[] = []
  for (const item of itemsOf(body)) {
    const match = PICKUP.exec(item)
    if (match === null) return null
    items.push({ number: Number(match[1].slice(1)), units: Number(match[2]), denominator: Number(match[3]) })
  }
  items.sort((a, b) => a.number - b.number)
  const shortBars: ShortBar[] = []
  let before = 0
  for (const { number, units, denominator } of items) {
    if (number < 1) return null
    // The top pickup (p1) is bar 0; any other lies after the pickups with a smaller number.
    const bar = number === 1 ? 0 : number + before
    if (meters !== null && denominatorAt(meters, bar) !== denominator) return null
    shortBars.push(number === 1 ? { bar, units } : { bar, units, unnumbered: true })
    if (number !== 1) before++
  }
  return shortBars
}

function readPlayOrder(body: string, barCount: number, firstBar: number, names: BarNames): PlayOrderRow[] | null {
  try {
    return parsePlayOrder(body, barCount, firstBar, names)
  } catch {
    return null
  }
}

/**
 * Reads the lines back, in any order, ignoring blank lines. Every bar is a label read under `names`: the names of the structure the text
 * was written from, so a label means what it meant on screen. Only the shape is checked here (and, for the play
 * order, that every row lies inside the piece); whether the meters and marks are valid is for validateMeters and
 * validateMarks. Errors carry the 1-based line; a missing line is reported where it belongs (meters 1, play order 2, marks 3).
 */
export function parseStructure(text: string, barCount: number, firstBar: number, names: BarNames): ParseResult {
  const found: Partial<Record<StructurePart, unknown>> = {}
  const errors: { line: number; message: StructureTextError }[] = []
  const lines = text.split('\n')
  // The note value of a short bar is the meter's, so the meters line is read first wherever it stands.
  const metersBody = lines.map((raw) => LINE.exec(raw.trim())).find((match) => match?.[1].toLowerCase() === 'meters')?.[2]
  const meters = metersBody === undefined ? null : readMeters(metersBody, names)
  lines.forEach((raw, index) => {
    const line = index + 1
    const trimmed = raw.trim()
    if (trimmed === '') return
    const match = LINE.exec(trimmed)
    const part = match === null ? undefined : PARTS.find(({ prefix }) => prefix === match[1].toLowerCase())?.part
    if (match === null || part === undefined || part in found) {
      errors.push({ line, message: 'unknown-line' })
      return
    }
    const body = match[2]
    const value =
      part === 'meters'
        ? readMeters(body, names)
        : part === 'marks'
          ? readMarks(body, names)
          : part === 'shortBars'
            ? readShortBars(body, meters, names)
            : part === 'pickups'
              ? readPickups(body, meters)
              : readPlayOrder(body, barCount, firstBar, names)
    found[part] = value
    if (value === null) {
      const message = { meters: 'bad-meter', marks: 'bad-mark', shortBars: 'bad-short-bar', pickups: 'bad-pickup', playOrder: 'bad-range' } as const
      errors.push({ line, message: message[part] })
    }
  })
  PARTS.forEach(({ part }, index) => {
    if (REQUIRED.includes(part) && !(part in found)) errors.push({ line: index + 1, message: 'missing-line' })
  })
  if (errors.length > 0) return { ok: false, errors: errors.sort((a, b) => a.line - b.line) }
  return {
    ok: true,
    structure: {
      meters: found.meters as MeterChange[],
      playOrder: found.playOrder as PlayOrderRow[],
      marks: found.marks as ListedMark[],
      ...(found.shortBars === undefined && found.pickups === undefined
        ? {}
        : { shortBars: [...((found.shortBars as ShortBar[] | undefined) ?? []), ...((found.pickups as ShortBar[] | undefined) ?? [])] }),
    },
  }
}

/** The 1-based line of a part in the text, or the place it belongs when the text has no such line. */
export function structureLineOf(text: string, part: StructurePart): number {
  const { prefix } = PARTS.find((entry) => entry.part === part) as (typeof PARTS)[number]
  const index = text.split('\n').findIndex((raw) => LINE.exec(raw.trim())?.[1].toLowerCase() === prefix)
  return index === -1 ? PARTS.findIndex((entry) => entry.part === part) + 1 : index + 1
}
