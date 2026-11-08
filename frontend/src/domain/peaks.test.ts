import { resamplePeaks } from '@/domain/peaks'

describe('resamplePeaks', () => {
  it('keeps the loudest peak of each group, so a short loud sound still shows', () => {
    expect(resamplePeaks([0.1, 0.9, 0.2, 0.3, 0.8, 0.4], 3)).toEqual([0.9, 0.3, 0.8])
  })

  it('splits groups as evenly as it can when the count does not divide the length', () => {
    expect(resamplePeaks([0.1, 0.2, 0.3, 0.4, 0.5], 2)).toEqual([0.2, 0.5])
  })

  it('leaves peaks alone when there are no more than the wanted count', () => {
    expect(resamplePeaks([0.1, 0.2], 5)).toEqual([0.1, 0.2])
    expect(resamplePeaks([0.1, 0.2], 2)).toEqual([0.1, 0.2])
  })

  it('gives a copy, never the same array', () => {
    const peaks = [0.1, 0.2]
    expect(resamplePeaks(peaks, 5)).not.toBe(peaks)
  })

  it('reduces 200 peaks to 80 bars', () => {
    const peaks = Array.from({ length: 200 }, (_, index) => index / 200)
    const bars = resamplePeaks(peaks, 80)

    expect(bars).toHaveLength(80)
    expect(bars.at(-1)).toBe(199 / 200)
  })

  it('gives nothing for no peaks or no bars', () => {
    expect(resamplePeaks([], 5)).toEqual([])
    expect(resamplePeaks([0.5, 0.6], 0)).toEqual([])
  })
})
