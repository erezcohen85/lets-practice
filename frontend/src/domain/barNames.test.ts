import { barNamesOf, labelRange } from './barNames'

// Internal bars 0..10 with a pickup at 0 and an unnumbered pickup at internal bar 7:
// internal: 0   1 2 3 4 5 6  7   8 9 10
// label:    p1  1 2 3 4 5 6  p7  7 8 9
const names = barNamesOf([
  { bar: 0, units: 1 },
  { bar: 7, units: 2, unnumbered: true },
])

describe('barNamesOf label', () => {
  it('reads every bar of a piece with no short bars as its internal number', () => {
    const plain = barNamesOf(undefined)
    expect([1, 2, 40].map((bar) => plain.label(bar))).toEqual(['1', '2', '40'])
  })

  it('reads the top pickup (bar 0) as p1, with or without a flag, and bar 1 as 1', () => {
    expect(names.label(0)).toBe('p1')
    expect(names.label(1)).toBe('1')
    expect(barNamesOf(undefined).label(0)).toBe('p1')
  })

  it('reads a numbered short bar by its number: a short bar without the flag keeps its number', () => {
    const short = barNamesOf([{ bar: 44, units: 3 }])
    expect(short.label(44)).toBe('44')
    expect(short.label(45)).toBe('45')
  })

  it('reads an unnumbered bar as p plus the number of the next numbered bar, and the bars after it one lower', () => {
    expect([5, 6, 7, 8, 9, 10].map((bar) => names.label(bar))).toEqual(['5', '6', 'p7', '7', '8', '9'])
  })

  it('counts every unnumbered bar before a bar, not only the nearest', () => {
    const two = barNamesOf([
      { bar: 3, units: 1, unnumbered: true },
      { bar: 9, units: 1, unnumbered: true },
    ])
    expect([1, 2, 3, 4, 5, 8, 9, 10, 11].map((bar) => two.label(bar))).toEqual(['1', '2', 'p3', '3', '4', '7', 'p8', '8', '9'])
  })
})

describe('barNamesOf parse', () => {
  it('reads a typed label back to the internal bar, whatever the case or the spaces', () => {
    expect(names.parse('p7')).toBe(7)
    expect(names.parse('P7')).toBe(7)
    expect(names.parse(' p 7 ')).toBe(7)
    expect(names.parse('7')).toBe(8)
    expect(names.parse('6')).toBe(6)
    expect(names.parse('1')).toBe(1)
    expect(names.parse('p1')).toBe(0)
  })

  it('round-trips every bar: parse(label(bar)) is the bar', () => {
    for (let bar = 0; bar <= 12; bar++) expect(names.parse(names.label(bar))).toBe(bar)
  })

  it('refuses a p label where no pickup exists, and anything that is not a label', () => {
    expect(names.parse('p9')).toBeNull()
    expect(names.parse('p2')).toBeNull()
    expect(barNamesOf(undefined).parse('p1')).toBeNull()
    for (const text of ['', 'p', 'abc', '0', 'p0', '-3', '1.5', '7 8', 'pp7', '7p']) expect(names.parse(text)).toBeNull()
  })

  it('does not check the end of the piece: a label past the last bar still reads, for the caller to range-check', () => {
    expect(names.parse('99')).toBe(100)
  })
})

describe('barNamesOf helpers', () => {
  it('says whether a bar takes no number', () => {
    expect(names.isUnnumbered(0)).toBe(true)
    expect(names.isUnnumbered(7)).toBe(true)
    expect(names.isUnnumbered(8)).toBe(false)
  })

  it('counts the numbered bars of a piece of barCount bars: the pickups are not in the count', () => {
    expect(names.numberedCount(10)).toBe(9)
    expect(barNamesOf(undefined).numberedCount(64)).toBe(64)
  })

  it('writes a range of labels, with a single bar alone', () => {
    expect(labelRange(names, 0, 6)).toBe('p1-6')
    expect(labelRange(names, 7, 9)).toBe('p7-8')
    expect(labelRange(names, 8, 8)).toBe('7')
  })
})
