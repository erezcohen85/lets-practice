import { anchoredScroll, MAX_ZOOM, MIN_ZOOM, pinchZoom } from './pinch'

describe('pinchZoom', () => {
  it('scales the zoom by how far the fingers moved apart', () => {
    expect(pinchZoom(1, 100, 150)).toBeCloseTo(1.5)
    expect(pinchZoom(1.5, 200, 100)).toBeCloseTo(0.75)
  })

  it('stays between 50 and 200 %', () => {
    expect([MIN_ZOOM, MAX_ZOOM]).toEqual([0.5, 2])
    expect(pinchZoom(1, 100, 400)).toBe(2)
    expect(pinchZoom(1, 100, 10)).toBe(0.5)
  })

  it('keeps the zoom for two fingers that start on the same spot', () => {
    expect(pinchZoom(1.2, 0, 50)).toBe(1.2)
  })
})

describe('anchoredScroll', () => {
  it('keeps the point under the fingers under the fingers', () => {
    // Scrolled 100 px, the fingers 50 px into the view, the content twice the size: that point is now 300 px in, so to sit
    // 50 px into the view the scroll goes to 250.
    expect(anchoredScroll(100, 50, 50, 2)).toBe(250)
  })

  it('follows the fingers when they also moved', () => {
    expect(anchoredScroll(100, 50, 80, 2)).toBe(220)
  })

  it('never scrolls before the start', () => {
    expect(anchoredScroll(0, 10, 300, 1)).toBe(0)
  })
})
