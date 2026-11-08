import { describe, expect, it } from 'vitest'
import { jobFromRow, locatorFromRow, locatorToRow, pageFromRows, pageToArgs, timingFromRows, timingToArgs } from '@/lib/supabase/rows'

const flagRow = { kind: 'crowded', severity: 1, expected: 2, found: 1, factor: 0.5, explained_by: 'rit', uncertain_line: { time_sec: 3, confidence: 0.4 } } as const

describe('rows', () => {
  it('reads a locator in the app shape and writes it back', () => {
    const row = { bar_number: 0, pass_index: 1, time_sec: 2.5, confirmed: true, flags: [flagRow], checked: true }
    const locator = locatorFromRow(row)
    expect(locator).toEqual({
      bar: 0,
      passIndex: 1,
      timeSec: 2.5,
      confirmed: true,
      checked: true,
      flags: [{ kind: 'crowded', severity: 1, expected: 2, found: 1, factor: 0.5, explainedBy: 'rit', uncertainLine: { timeSec: 3, confidence: 0.4 } }],
    })
    expect(locatorToRow(locator)).toEqual(row)
  })

  it('reads the pulse flag the processor writes, with its numbers as stored, and writes it back the same; the older kinds read as before', () => {
    const pulseRow = { kind: 'pulse', severity: 1, expected: 2.9375, found: 1.03, factor: 0.35, explained_by: null, uncertain_line: null } as const
    const older = ['skipped-repeat', 'pickup', 'other-downbeat', 'weak-downbeat', 'beat-count', 'stretched', 'crowded'] as const
    const row = { bar_number: 0, pass_index: 0, time_sec: 0.5, confirmed: false, flags: [pulseRow, ...older.map((kind) => ({ ...pulseRow, kind }))], checked: false }

    const locator = locatorFromRow(row)

    expect(locator.flags?.map((flag) => flag.kind)).toEqual(['pulse', ...older])
    expect(locator.flags?.[0]).toEqual({ kind: 'pulse', severity: 1, expected: 2.9375, found: 1.03, factor: 0.35, explainedBy: null, uncertainLine: null })
    expect(locatorToRow(locator)).toEqual(row)
  })

  it('writes a locator with no flags and no checked', () => {
    expect(locatorToRow({ bar: 1, passIndex: 0, timeSec: 1, confirmed: false })).toEqual({ bar_number: 1, pass_index: 0, time_sec: 1, confirmed: false, flags: [], checked: false })
  })

  it('reads the timing, its meters in the app shape, sorted locators, and no shortBars key when there are none', () => {
    const timing = timingFromRows(
      { bar_count: 8, rows: [{ from: 1, to: 8 }], meters: [{ from_bar: 1, numerator: 6, denominator: 8 }], marks: [{ bar: 2, kind: 'fermata' }], short_bars: [] },
      [
        { bar_number: 2, pass_index: 0, time_sec: 2, confirmed: false, flags: [], checked: false },
        { bar_number: 1, pass_index: 0, time_sec: 1, confirmed: false, flags: [], checked: false },
      ],
    )
    expect(timing.meters).toEqual([{ fromBar: 1, numerator: 6, denominator: 8 }])
    expect(timing.locators.map((locator) => locator.bar)).toEqual([1, 2])
    expect('shortBars' in timing).toBe(false)
  })

  it('gives an empty timing before the piece has one', () => {
    expect(timingFromRows(null, [])).toEqual({ barCount: 0, playOrder: [], meters: [], marks: [], locators: [] })
  })

  it('writes the timing as the arguments of save_timing', () => {
    const args = timingToArgs('p', { barCount: 8, playOrder: [{ from: 0, to: 8 }], meters: [{ fromBar: 1, numerator: 6, denominator: 8 }], marks: [], locators: [], shortBars: [{ bar: 0, units: 1 }] })
    expect(args).toEqual({
      target_piece: 'p',
      new_bar_count: 8,
      new_rows: [{ from: 0, to: 8 }],
      new_meters: [{ from_bar: 1, numerator: 6, denominator: 8 }],
      new_marks: [],
      new_short_bars: [{ bar: 0, units: 1 }],
      new_locators: [],
    })
  })

  it('reads a page layer with sorted boxes, and no boxFlags key when there are none', () => {
    const page = pageFromRows({ id: 'f', rests: [3], box_flags: [] }, [
      { score_file_id: 'f', bar_number: 2, page_index: 0, x: 1, y: 1, w: 1, h: 1 },
      { score_file_id: 'f', bar_number: 1, page_index: 0, x: 0, y: 0, w: 1, h: 1 },
    ])
    expect(page.bars.map((box) => box.bar)).toEqual([1, 2])
    expect(page.rests).toEqual([3])
    expect('boxFlags' in page).toBe(false)
  })

  it('reads the flags of Advanced Reading as stored, with their old edges, and writes them back the same', () => {
    const flags = [
      { bar: 2, verdict: 'read_moved' as const, note: 'Advanced Reading moved this bar.', suggestedX: null, previous: { x: 4, w: 30 } },
      { bar: 1, verdict: 'starts_late' as const, note: 'An older flag, with no old edges.', suggestedX: 3 },
    ]
    const page = pageFromRows({ id: 'f', rests: [], box_flags: flags }, [])
    expect(page.boxFlags).toEqual(flags)
    expect(pageToArgs(page).new_box_flags).toEqual(flags)
  })

  it('reads an owner job with its failed parts, and a member job with no error text', () => {
    expect(jobFromRow({ id: 'j', piece_id: 'p', kind: 'add-parts', status: 'done', progress: 1, error: null, failed_parts: [{ id: 'a', name: 'Tuba', error: 'No staves.' }] })).toEqual({
      id: 'j',
      pieceId: 'p',
      kind: 'add-parts',
      status: 'done',
      progress: 1,
      error: null,
      parts: [{ id: 'a', name: 'Tuba', state: 'failed', error: 'No staves.' }],
    })
    const member = jobFromRow({ id: 'j', piece_id: 'p', kind: 'realign', status: 'error', progress: 0.5 })
    expect(member.error).toBeNull()
    expect('parts' in member).toBe(false)
  })
})
