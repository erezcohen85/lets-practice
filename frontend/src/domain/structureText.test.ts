import { barNamesOf } from './barNames'
import { demoDoc } from './pieceFixtures'
import { formatStructure, parseStructure, structureLineOf, type Structure } from './structureText'

const demo = (): Structure => {
  const { meters, playOrder, marks } = demoDoc().timing
  return { meters, playOrder, marks }
}

const DEMO_TEXT = ['meters: 4/4 from 1, 2/4 from 49', 'play order: 1-16, 9-16, 17-end', 'marks: fermata 28'].join('\n')

const PLAIN = barNamesOf(undefined)
const TOP = barNamesOf([{ bar: 0, units: 1 }])

describe('formatStructure', () => {
  it('writes the three lines of the PoC format', () => {
    expect(formatStructure(demo(), 64, PLAIN)).toBe(DEMO_TEXT)
  })

  it('writes several marks in order and "none" for an empty list', () => {
    const marks = [
      { bar: 28, kind: 'fermata' as const },
      { bar: 40, kind: 'rest' as const },
    ]
    expect(formatStructure({ ...demo(), marks }, 64, PLAIN).split('\n')[2]).toBe('marks: fermata 28, rest 40')
    expect(formatStructure({ ...demo(), marks: [] }, 64, PLAIN).split('\n')[2]).toBe('marks: none')
  })

  it('writes consecutive bars of one kind as a range, and a single bar as one number', () => {
    const marks = [
      { bar: 46, kind: 'rest' as const },
      { bar: 47, kind: 'rest' as const },
      { bar: 48, kind: 'rest' as const },
      { bar: 32, kind: 'fermata' as const },
    ]
    expect(formatStructure({ ...demo(), marks }, 64, PLAIN).split('\n')[2]).toBe('marks: rest 46-48, fermata 32')
  })
})

describe('parseStructure', () => {
  it('reads back what formatStructure wrote, for the demo structure', () => {
    expect(parseStructure(formatStructure(demo(), 64, PLAIN), 64, 1, PLAIN)).toEqual({ ok: true, structure: demo() })
  })

  it('reads lines in any order, with blank lines, capitals and spaces around the separators', () => {
    const text = ['', 'Marks: Fermata 28, rest 40', '', 'PLAY ORDER: 1 - 8 , 9-end', 'meters: 3 / 4 from 1'].join('\n')

    expect(parseStructure(text, 64, 1, PLAIN)).toEqual({
      ok: true,
      structure: {
        meters: [{ fromBar: 1, numerator: 3, denominator: 4 }],
        playOrder: [
          { from: 1, to: 8 },
          { from: 9, to: 64 },
        ],
        marks: [
          { bar: 28, kind: 'fermata' },
          { bar: 40, kind: 'rest' },
        ],
      },
    })
  })

  it('reads rit. marks, with or without the dot, and a span across a meter change back as it was written', () => {
    const marks = [
      { bar: 47, kind: 'rit' as const },
      { bar: 48, kind: 'rit' as const },
      { bar: 49, kind: 'rit' as const },
      { bar: 50, kind: 'rit' as const },
    ]
    const structure = { ...demo(), marks }

    expect(parseStructure(formatStructure(structure, 64, PLAIN), 64, 1, PLAIN)).toEqual({ ok: true, structure })
    expect(parseStructure(DEMO_TEXT.replace('fermata 28', 'Rit. 15, rit 16'), 64, 1, PLAIN)).toMatchObject({
      ok: true,
      structure: {
        marks: [
          { bar: 15, kind: 'rit' },
          { bar: 16, kind: 'rit' },
        ],
      },
    })
  })

  it('reads a range as one mark per bar, and a single bar as before', () => {
    const marks = parseStructure(DEMO_TEXT.replace('fermata 28', 'rest 46-48, fermata 32, Rit. 30 - 31, rest 5–5'), 64, 1, PLAIN)

    expect(marks).toMatchObject({
      ok: true,
      structure: {
        marks: [
          { bar: 46, kind: 'rest' },
          { bar: 47, kind: 'rest' },
          { bar: 48, kind: 'rest' },
          { bar: 32, kind: 'fermata' },
          { bar: 30, kind: 'rit' },
          { bar: 31, kind: 'rit' },
          { bar: 5, kind: 'rest' },
        ],
      },
    })
  })

  it('writes and reads back a range that crosses a meter change (49 is where 2/4 starts)', () => {
    const marks = [47, 48, 49, 50].map((bar) => ({ bar, kind: 'rest' as const }))
    const structure = { ...demo(), marks }
    const text = formatStructure(structure, 64, PLAIN)

    expect(text.split('\n')[2]).toBe('marks: rest 47-50')
    expect(parseStructure(text, 64, 1, PLAIN)).toEqual({ ok: true, structure })
  })

  it('reads "none" and an empty list as no marks', () => {
    expect(parseStructure(DEMO_TEXT.replace('fermata 28', 'none'), 64, 1, PLAIN)).toMatchObject({ ok: true, structure: { marks: [] } })
    expect(parseStructure(DEMO_TEXT.replace('fermata 28', ''), 64, 1, PLAIN)).toMatchObject({ ok: true, structure: { marks: [] } })
  })

  it('reports a line that starts with another word, with its line number', () => {
    const text = ['meters: 4/4 from 1', 'tempo: 120', 'play order: 1-end', 'marks: none'].join('\n')
    expect(parseStructure(text, 64, 1, PLAIN)).toEqual({ ok: false, errors: [{ line: 2, message: 'unknown-line' }] })
  })

  it('reports a meter it cannot read', () => {
    const text = DEMO_TEXT.replace('2/4 from 49', 'two four from 49')
    expect(parseStructure(text, 64, 1, PLAIN)).toEqual({ ok: false, errors: [{ line: 1, message: 'bad-meter' }] })
    expect(parseStructure(DEMO_TEXT.replace('4/4 from 1', '4/4'), 64, 1, PLAIN)).toMatchObject({ ok: false })
  })

  it('reports a play-order row it cannot read or that leaves the piece', () => {
    expect(parseStructure(DEMO_TEXT.replace('9-16', 'nine-16'), 64, 1, PLAIN)).toEqual({
      ok: false,
      errors: [{ line: 2, message: 'bad-range' }],
    })
    expect(parseStructure(DEMO_TEXT.replace('17-end', '17-70'), 64, 1, PLAIN)).toEqual({
      ok: false,
      errors: [{ line: 2, message: 'bad-range' }],
    })
    expect(parseStructure(DEMO_TEXT.replace('9-16', '16-9'), 64, 1, PLAIN)).toMatchObject({ ok: false })
  })

  it('reports a mark it cannot read', () => {
    expect(parseStructure(DEMO_TEXT.replace('fermata 28', 'coda 28'), 64, 1, PLAIN)).toEqual({
      ok: false,
      errors: [{ line: 3, message: 'bad-mark' }],
    })
    expect(parseStructure(DEMO_TEXT.replace('fermata 28', 'fermata'), 64, 1, PLAIN)).toMatchObject({ ok: false })
  })

  it('reports a mark range that runs backwards or is open at one end', () => {
    for (const bad of ['rest 48-46', 'rest 46-', 'rest -48', 'rest 46-48-50']) {
      expect(parseStructure(DEMO_TEXT.replace('fermata 28', bad), 64, 1, PLAIN)).toEqual({
        ok: false,
        errors: [{ line: 3, message: 'bad-mark' }],
      })
    }
  })

  it('reports a line that is missing, at the place it belongs', () => {
    const text = ['meters: 4/4 from 1', 'marks: none'].join('\n')
    expect(parseStructure(text, 64, 1, PLAIN)).toEqual({ ok: false, errors: [{ line: 2, message: 'missing-line' }] })
    expect(parseStructure('', 64, 1, PLAIN)).toEqual({
      ok: false,
      errors: [
        { line: 1, message: 'missing-line' },
        { line: 2, message: 'missing-line' },
        { line: 3, message: 'missing-line' },
      ],
    })
  })

  it('reports every bad line, in line order', () => {
    const text = ['meters: x', 'play order: 65', 'marks: rest'].join('\n')
    expect(parseStructure(text, 64, 1, PLAIN)).toEqual({
      ok: false,
      errors: [
        { line: 1, message: 'bad-meter' },
        { line: 2, message: 'bad-range' },
        { line: 3, message: 'bad-mark' },
      ],
    })
  })

  it('treats a second line of the same kind as unknown', () => {
    expect(parseStructure(`${DEMO_TEXT}\nmarks: none`, 64, 1, PLAIN)).toEqual({
      ok: false,
      errors: [{ line: 4, message: 'unknown-line' }],
    })
  })
})

describe('structureLineOf', () => {
  it('finds the line of each part, or where it belongs when the text has no such line', () => {
    const text = ['', 'marks: none', 'meters: 4/4 from 1', 'play order: 1-end'].join('\n')
    expect(structureLineOf(text, 'marks')).toBe(2)
    expect(structureLineOf(text, 'meters')).toBe(3)
    expect(structureLineOf(text, 'playOrder')).toBe(4)
    expect(structureLineOf('meters: 4/4 from 1', 'marks')).toBe(3)
  })
})

describe('short bars in the text', () => {
  const sixEight = (): Structure => ({
    meters: [{ fromBar: 1, numerator: 6, denominator: 8 }],
    playOrder: [{ from: 0, to: 42 }, { from: 21, to: 55 }],
    marks: [],
    shortBars: [{ bar: 0, units: 1 }, { bar: 44, units: 3 }],
  })
  const TEXT = ['meters: 6/8 from 1', 'play order: p1-42, 21-end', 'marks: none', 'short bars: pickup 1/8, 44 3/8'].join('\n')

  it('writes a fourth line with the pickup as "pickup" and the note value of the meter at each bar', () => {
    expect(formatStructure(sixEight(), 55, TOP)).toBe(TEXT)
  })

  it('writes no fourth line for a piece without short bars', () => {
    expect(formatStructure({ ...sixEight(), shortBars: [] }, 55, TOP).split('\n')).toHaveLength(3)
  })

  it('reads back what it wrote, and a text without the line has no short bars', () => {
    expect(parseStructure(TEXT, 55, 0, TOP)).toEqual({ ok: true, structure: sixEight() })
    const without = parseStructure(TEXT.split('\n').slice(0, 3).join('\n'), 55, 0, TOP)
    expect(without.ok && without.structure.shortBars).toBeUndefined()
  })

  it('reads an empty play order as straight through from the pickup', () => {
    const result = parseStructure('meters: 6/8 from 1\nplay order:\nmarks: none\nshort bars: pickup 1/8', 55, 0, TOP)

    expect(result.ok && result.structure.playOrder).toEqual([{ from: 0, to: 55 }])
  })

  it('refuses a short bar that is not written like "pickup 1/8" or "44 3/8", or whose note value is not the meter', () => {
    for (const body of ['pickup', '44', '44 3', 'bar 44 3/8', 'pickup 1/4', '44 3/8 extra']) {
      const result = parseStructure(`meters: 6/8 from 1\nplay order: 1-end\nmarks: none\nshort bars: ${body}`, 55, 1, TOP)
      expect(result, body).toEqual({ ok: false, errors: [{ line: 4, message: 'bad-short-bar' }] })
    }
  })

  it('finds the line of the short bars', () => {
    expect(structureLineOf(TEXT, 'shortBars')).toBe(4)
    expect(structureLineOf(TEXT.split('\n').slice(0, 3).join('\n'), 'shortBars')).toBe(4)
  })
})

describe('pickups in the middle of the piece, in the text', () => {
  // 4/4, 64 bars; bar 0 is the top pickup, bars 7 and 21 are unnumbered pickups: p1, 1..6, p7, 7..19, p20 ...
  const names = barNamesOf([{ bar: 0, units: 1 }, { bar: 7, units: 2, unnumbered: true }, { bar: 21, units: 1, unnumbered: true }, { bar: 44, units: 3 }])
  const structure = (): Structure => ({
    meters: [{ fromBar: 1, numerator: 4, denominator: 4 }],
    playOrder: [{ from: 0, to: 20 }, { from: 21, to: 64 }],
    marks: [{ bar: 7, kind: 'fermata' }],
    shortBars: [{ bar: 0, units: 1 }, { bar: 7, units: 2, unnumbered: true }, { bar: 21, units: 1, unnumbered: true }, { bar: 44, units: 3 }],
  })
  const TEXT = [
    'meters: 4/4 from 1',
    'play order: p1-19, p20-end',
    'marks: fermata p7',
    'short bars: pickup 1/4, 42 3/4',
    'pickups: p7 2/4, p20 1/4',
  ].join('\n')

  it('keeps numbered short bars in the short bars line and writes the unnumbered ones in a pickups line, all as labels', () => {
    expect(formatStructure(structure(), 64, names)).toBe(TEXT)
  })

  it('writes no pickups line when the piece has none in the middle', () => {
    expect(formatStructure({ ...structure(), shortBars: [{ bar: 44, units: 3 }] }, 64, PLAIN).split('\n').some((line) => line.startsWith('pickups'))).toBe(false)
  })

  it('reads back what it wrote, under the names it was written from', () => {
    const parsed = parseStructure(TEXT, 64, 0, names)
    expect(parsed.ok && parsed.structure.playOrder).toEqual(structure().playOrder)
    expect(parsed.ok && parsed.structure.marks).toEqual(structure().marks)
    expect(parsed.ok && [...(parsed.structure.shortBars ?? [])].sort((a, b) => a.bar - b.bar)).toEqual(structure().shortBars)
  })

  it('adds a pickup written in the pickups line: p9 becomes the bar that reads 9 now, and p9 shows back as p9', () => {
    const text = 'meters: 4/4 from 1\nplay order: 1-end\nmarks: none\npickups: p9 2/4'
    const parsed = parseStructure(text, 64, 1, PLAIN)
    const shortBars = parsed.ok ? parsed.structure.shortBars : undefined
    expect(shortBars).toEqual([{ bar: 9, units: 2, unnumbered: true }])
    expect(barNamesOf(shortBars).label(9)).toBe('p9')
  })

  it('places a second new pickup after the first: p7 and p9 are internal bars 7 and 10', () => {
    const text = 'meters: 4/4 from 1\nplay order: 1-end\nmarks: none\npickups: p9 1/4, p7 2/4'
    const parsed = parseStructure(text, 64, 1, PLAIN)
    expect(parsed.ok && parsed.structure.shortBars).toEqual([{ bar: 7, units: 2, unnumbered: true }, { bar: 10, units: 1, unnumbered: true }])
  })

  it('reads p1 in the pickups line as the top pickup, and p1 in the other lines only where the piece has one', () => {
    const text = 'meters: 4/4 from 1\nplay order: p1-end\nmarks: none\npickups: p1 1/4'
    const parsed = parseStructure(text, 64, 0, names)
    expect(parsed.ok && parsed.structure.shortBars).toEqual([{ bar: 0, units: 1 }])
    expect(parseStructure('meters: 4/4 from 1\nplay order: p1-end\nmarks: none', 64, 1, PLAIN)).toEqual({ ok: false, errors: [{ line: 2, message: 'bad-range' }] })
  })

  it('refuses a p label where no pickup exists in the play order, marks and meters, naming the line', () => {
    const base = 'meters: 4/4 from 1\nplay order: 1-end\nmarks: fermata 3'
    expect(parseStructure(base.replace('1-end', '1-p9'), 64, 1, names)).toEqual({ ok: false, errors: [{ line: 2, message: 'bad-range' }] })
    expect(parseStructure(base.replace('fermata 3', 'fermata p9'), 64, 1, names)).toEqual({ ok: false, errors: [{ line: 3, message: 'bad-mark' }] })
    expect(parseStructure(base.replace('4/4 from 1', '4/4 from p9'), 64, 1, names)).toEqual({ ok: false, errors: [{ line: 1, message: 'bad-meter' }] })
  })

  it('refuses a pickups item that is not like "p7 2/4", or whose note value is not the meter', () => {
    for (const body of ['7 2/4', 'p7', 'p7 2', 'p0 1/4', 'p7 2/8', 'pickup 1/4']) {
      const result = parseStructure(`meters: 4/4 from 1\nplay order: 1-end\nmarks: none\npickups: ${body}`, 64, 1, PLAIN)
      expect(result, body).toEqual({ ok: false, errors: [{ line: 4, message: 'bad-pickup' }] })
    }
  })

  it('finds the line of the pickups', () => {
    expect(structureLineOf(TEXT, 'pickups')).toBe(5)
  })
})
