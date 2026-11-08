import { barNamesOf } from './barNames'
import { restLabels } from './restLabels'
import { type BarBox } from './types'

const PLAIN = barNamesOf(undefined)
const box = (bar: number, x: number, over: Partial<BarBox> = {}): BarBox => ({ bar, pageIndex: 0, x, y: 100, w: 200, h: 80, ...over })

describe('restLabels', () => {
  it('gives each ordinary bar its own number', () => {
    const labels = restLabels([box(1, 0), box(2, 200), box(3, 400)], PLAIN)
    expect([...labels]).toEqual([[1, '1'], [2, '2'], [3, '3']])
  })

  it('writes consecutive bars that share one box as a range on the first of them, and none on the others', () => {
    const labels = restLabels([box(17, 0), box(18, 200), box(19, 200), box(20, 200), box(21, 200), box(22, 400)], PLAIN)
    expect(labels.get(18)).toBe('18–21')
    expect(labels.has(19)).toBe(false)
    expect(labels.has(20)).toBe(false)
    expect(labels.has(21)).toBe(false)
    expect(labels.get(17)).toBe('17')
    expect(labels.get(22)).toBe('22')
  })

  it('treats boxes within 1 px of each other as the same box, and 2 px apart as different', () => {
    expect(restLabels([box(5, 100), box(6, 100.8, { w: 200.9, y: 99.5 })], PLAIN).get(5)).toBe('5–6')
    expect(restLabels([box(5, 100), box(6, 102)], PLAIN).get(6)).toBe('6')
  })

  it('does not group boxes on different pages', () => {
    const labels = restLabels([box(5, 100), box(6, 100, { pageIndex: 1 })], PLAIN)
    expect(labels.get(5)).toBe('5')
    expect(labels.get(6)).toBe('6')
  })

  it('does not group bars that are not consecutive numbers', () => {
    const labels = restLabels([box(5, 100), box(7, 100)], PLAIN)
    expect(labels.get(5)).toBe('5')
    expect(labels.get(7)).toBe('7')
  })

  it('starts a new label at the next bar after the rest', () => {
    const labels = restLabels([box(18, 200), box(19, 200), box(20, 400)], PLAIN)
    expect(labels.get(18)).toBe('18–19')
    expect(labels.get(20)).toBe('20')
  })

  it('labels nothing for no boxes, and does not depend on the order given', () => {
    expect(restLabels([], PLAIN).size).toBe(0)
    expect(restLabels([box(19, 200), box(18, 200)], PLAIN).get(18)).toBe('18–19')
  })
})

describe('restLabels with a pickup', () => {
  it('writes the labels: p7 on the pickup, 7 on the bar after it, and a rest across them as one range', () => {
    const names = barNamesOf([{ bar: 7, units: 2, unnumbered: true }])
    expect([...restLabels([box(6, 0), box(7, 200), box(8, 400)], names)]).toEqual([[6, '6'], [7, 'p7'], [8, '7']])
    expect(restLabels([box(7, 100), box(8, 100), box(9, 100)], names).get(7)).toBe('p7–8')
  })
})
