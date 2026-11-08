import {
  type BarBox,
  type BarMark,
  type BoxFlag,
  type FlagKind,
  type Job,
  type JobKind,
  type JobStatus,
  type Locator,
  type PageLayer,
  type PlayOrderRow,
  type ReviewFlag,
  type ShortBar,
  type TimingLayer,
} from '@/domain/types'

// The one place that converts between Postgres rows (snake_case, as the processor writes its jsonb) and the app's types.

export interface ReviewFlagRow {
  kind: FlagKind
  severity: 0 | 1 | 2
  expected: number
  found: number
  factor: number | null
  explained_by: 'fermata' | 'rit' | null
  uncertain_line: { time_sec: number; confidence: number } | null
}
export interface LocatorRow { bar_number: number; pass_index: number; time_sec: number; confirmed: boolean; flags: ReviewFlagRow[]; checked: boolean }
export interface MeterRow { from_bar: number; numerator: number; denominator: number }
export interface PlayOrderTableRow { bar_count: number; rows: PlayOrderRow[]; meters: MeterRow[]; marks: BarMark[]; short_bars: ShortBar[] }
export interface BarRow { score_file_id: string; bar_number: number; page_index: number; x: number; y: number; w: number; h: number }
export interface PartLayerRow { id: string; rests: number[]; box_flags: BoxFlag[] }
export interface JobRow {
  id: string
  piece_id: string
  kind: JobKind
  status: JobStatus
  progress: number
  error?: string | null
  failed_parts?: Array<{ id: string; name: string; error: string }>
}

function flagFromRow(row: ReviewFlagRow): ReviewFlag {
  return {
    kind: row.kind,
    severity: row.severity,
    expected: row.expected,
    found: row.found,
    factor: row.factor,
    explainedBy: row.explained_by ?? null,
    uncertainLine: row.uncertain_line === null || row.uncertain_line === undefined ? null : { timeSec: row.uncertain_line.time_sec, confidence: row.uncertain_line.confidence },
  }
}

function flagToRow(flag: ReviewFlag): ReviewFlagRow {
  return {
    kind: flag.kind,
    severity: flag.severity,
    expected: flag.expected,
    found: flag.found,
    factor: flag.factor,
    explained_by: flag.explainedBy,
    uncertain_line: flag.uncertainLine === null ? null : { time_sec: flag.uncertainLine.timeSec, confidence: flag.uncertainLine.confidence },
  }
}

export function locatorFromRow(row: LocatorRow): Locator {
  return { bar: row.bar_number, passIndex: row.pass_index, timeSec: row.time_sec, confirmed: row.confirmed, flags: row.flags.map(flagFromRow), checked: row.checked }
}

export function locatorToRow(locator: Locator): LocatorRow {
  return {
    bar_number: locator.bar,
    pass_index: locator.passIndex,
    time_sec: locator.timeSec,
    confirmed: locator.confirmed,
    flags: (locator.flags ?? []).map(flagToRow),
    checked: locator.checked ?? false,
  }
}

export function timingFromRows(order: PlayOrderTableRow | null, locators: LocatorRow[]): TimingLayer {
  const sorted = locators.map(locatorFromRow).sort((a, b) => a.bar - b.bar || a.passIndex - b.passIndex)
  if (order === null) return { barCount: 0, playOrder: [], meters: [], marks: [], locators: sorted }
  return {
    barCount: order.bar_count,
    playOrder: order.rows,
    meters: order.meters.map((meter) => ({ fromBar: meter.from_bar, numerator: meter.numerator, denominator: meter.denominator })),
    marks: order.marks,
    locators: sorted,
    ...(order.short_bars.length > 0 ? { shortBars: order.short_bars } : {}),
  }
}

export function timingToArgs(pieceId: string, timing: TimingLayer): Record<string, unknown> {
  return {
    target_piece: pieceId,
    new_bar_count: timing.barCount,
    new_rows: timing.playOrder,
    new_meters: timing.meters.map((meter): MeterRow => ({ from_bar: meter.fromBar, numerator: meter.numerator, denominator: meter.denominator })),
    new_marks: timing.marks,
    new_short_bars: timing.shortBars ?? [],
    new_locators: timing.locators.map(locatorToRow),
  }
}

export function pageFromRows(part: PartLayerRow, bars: BarRow[]): PageLayer {
  const boxes = bars
    .map((row): BarBox => ({ bar: row.bar_number, pageIndex: row.page_index, x: row.x, y: row.y, w: row.w, h: row.h }))
    .sort((a, b) => a.bar - b.bar)
  return { partId: part.id, bars: boxes, rests: part.rests, ...(part.box_flags.length > 0 ? { boxFlags: part.box_flags } : {}) }
}

export function pageToArgs(page: PageLayer): Record<string, unknown> {
  return {
    target_part: page.partId,
    new_rests: page.rests,
    new_box_flags: page.boxFlags ?? [],
    new_bars: page.bars.map((box) => ({ bar_number: box.bar, page_index: box.pageIndex, x: box.x, y: box.y, w: box.w, h: box.h })),
  }
}

/** A member's read has no `error` or `failed_parts`: it does not select them. */
export function jobFromRow(row: JobRow): Job {
  const failed = row.failed_parts ?? []
  return {
    id: row.id,
    pieceId: row.piece_id,
    kind: row.kind,
    status: row.status,
    progress: row.progress,
    error: row.error ?? null,
    ...(failed.length > 0 ? { parts: failed.map((part) => ({ id: part.id, name: part.name, state: 'failed' as const, error: part.error })) } : {}),
  }
}
