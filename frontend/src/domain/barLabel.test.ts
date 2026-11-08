import { barNamesOf } from './barNames'
import { formatOffset, parseBarLabel } from './barLabel'
import { barWithPass } from '@/strings'

const PLAIN = barNamesOf(undefined)
const TOP = barNamesOf([{ bar: 0, units: 1 }])
const MID = barNamesOf([{ bar: 7, units: 2, unnumbered: true }])

describe('parseBarLabel', () => {
  it('reads "12" as bar 12, first pass, and "12 (2)" as bar 12, second pass (1-based on screen, 0-based in data)', () => {
    expect(parseBarLabel('12', PLAIN)).toEqual({ bar: 12, passIndex: 0 })
    expect(parseBarLabel('12 (2)', PLAIN)).toEqual({ bar: 12, passIndex: 1 })
    expect(parseBarLabel('  9(3) ', PLAIN)).toEqual({ bar: 9, passIndex: 2 })
  })

  it('reads "p1" as the top pickup (bar 0), and "0" no more: the pickup has no number', () => {
    expect(parseBarLabel('p1', TOP)).toEqual({ bar: 0, passIndex: 0 })
    expect(parseBarLabel('P1 (2)', TOP)).toEqual({ bar: 0, passIndex: 1 })
    expect(parseBarLabel('0', TOP)).toBeNull()
    expect(parseBarLabel('p1', PLAIN)).toBeNull()
  })

  it('reads a p label and its pass: "p7", "p7 (2)", "p7/2" name the pickup before 7, and the number 7 the bar after it', () => {
    expect(parseBarLabel('p7', MID)).toEqual({ bar: 7, passIndex: 0 })
    expect(parseBarLabel('p7 (2)', MID)).toEqual({ bar: 7, passIndex: 1 })
    expect(parseBarLabel('p7/2', MID)).toEqual({ bar: 7, passIndex: 1 })
    expect(parseBarLabel('12/3', PLAIN)).toEqual({ bar: 12, passIndex: 2 })
    expect(parseBarLabel('7', MID)).toEqual({ bar: 8, passIndex: 0 })
    expect(parseBarLabel('p9', MID)).toBeNull()
  })

  it('reads back what barWithPass writes', () => {
    for (const [bar, pass] of [[1, 0], [40, 0], [9, 1], [9, 2]] as const) {
      expect(parseBarLabel(barWithPass(String(bar), pass), PLAIN)).toEqual({ bar, passIndex: pass })
    }
  })

  it('refuses anything that is not a bar number with an optional pass', () => {
    for (const text of ['', 'abc', '0 (0)', '12 (0)', '12 (x)', '-3', '1.5', '12 2', '(2)', '12 (2']) {
      expect(parseBarLabel(text, PLAIN)).toBeNull()
    }
  })
})

describe('formatOffset', () => {
  it('writes a signed offset to two decimals', () => {
    expect(formatOffset(0.42)).toBe('+0.42')
    expect(formatOffset(-0.12)).toBe('-0.12')
    expect(formatOffset(0.5)).toBe('+0.50')
  })

  it('never writes a minus sign before zero', () => {
    expect(formatOffset(-0.001)).toBe('+0.00')
    expect(formatOffset(0)).toBe('+0.00')
  })
})
