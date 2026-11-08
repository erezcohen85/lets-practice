import { describe, expect, it } from 'vitest'
import { CLOSEST_SNAP_SEC, type DetectedBeat, HERE_SEC, isDownbeat, nearestBeat, snapToBeat } from './beats'

const beat = (t: number, downbeat = 0): DetectedBeat => ({ t, downbeat })
const BEATS = [beat(1, 0.9), beat(1.5), beat(2), beat(2.5), beat(3, 0.8)]

describe('snapToBeat', () => {
  it('moves to the beat after the time', () => {
    expect(snapToBeat(1.7, BEATS, 'next')).toBe(2)
  })

  it('moves to the beat before the time', () => {
    expect(snapToBeat(1.7, BEATS, 'previous')).toBe(1.5)
  })

  it('counts a beat within 20 ms as here and skips to the following one', () => {
    expect(snapToBeat(2.01, BEATS, 'next')).toBe(2.5)
    expect(snapToBeat(1.99, BEATS, 'next')).toBe(2.5)
    expect(snapToBeat(2.01, BEATS, 'previous')).toBe(1.5)
    expect(snapToBeat(1.99, BEATS, 'previous')).toBe(1.5)
  })

  it('takes a beat just past the 20 ms that count as here', () => {
    expect(snapToBeat(2 - HERE_SEC - 0.001, BEATS, 'next')).toBe(2)
    expect(snapToBeat(2 + HERE_SEC + 0.001, BEATS, 'previous')).toBe(2)
  })

  it('gives null past the last beat going next and before the first going previous', () => {
    expect(snapToBeat(3, BEATS, 'next')).toBeNull()
    expect(snapToBeat(3.4, BEATS, 'next')).toBeNull()
    expect(snapToBeat(1, BEATS, 'previous')).toBeNull()
    expect(snapToBeat(0.2, BEATS, 'previous')).toBeNull()
  })

  it('gives null when there are no beats', () => {
    expect(snapToBeat(1, [], 'next')).toBeNull()
    expect(snapToBeat(1, [], 'previous')).toBeNull()
  })

  it('works on a single beat', () => {
    expect(snapToBeat(0, [beat(1)], 'next')).toBe(1)
    expect(snapToBeat(2, [beat(1)], 'previous')).toBe(1)
  })
})

describe('snapToBeat, closest', () => {
  it('takes the nearer beat on either side', () => {
    expect(snapToBeat(1.6, BEATS, 'closest')).toBe(1.5)
    expect(snapToBeat(1.9, BEATS, 'closest')).toBe(2)
  })

  it('takes a beat closer than the one that previous and next skip as here', () => {
    expect(snapToBeat(2 + HERE_SEC / 2, BEATS, 'closest')).toBe(2)
  })

  it('has nothing to do on the beat itself', () => {
    expect(snapToBeat(2, BEATS, 'closest')).toBeNull()
  })

  it('leaves a line with no beat close by: the next beat out belongs to another place', () => {
    const far = [beat(1), beat(3)]
    expect(snapToBeat(1 + CLOSEST_SNAP_SEC, far, 'closest')).toBe(1)
    expect(snapToBeat(1 + CLOSEST_SNAP_SEC + 0.01, far, 'closest')).toBeNull()
    expect(snapToBeat(2, [], 'closest')).toBeNull()
  })
})

describe('nearestBeat', () => {
  it('gives the closest beat within the distance', () => {
    expect(nearestBeat(2.02, BEATS, 0.03)).toBe(2)
    expect(nearestBeat(1.48, BEATS, 0.03)).toBe(1.5)
  })

  it('gives null when no beat is that close', () => {
    expect(nearestBeat(2.25, BEATS, 0.03)).toBeNull()
    expect(nearestBeat(2.25, [], 0.03)).toBeNull()
  })

  it('takes the nearer of two beats the distance reaches', () => {
    expect(nearestBeat(1.76, [beat(1.74), beat(1.78)], 0.03)).toBe(1.74)
    expect(nearestBeat(1.77, [beat(1.74), beat(1.78)], 0.03)).toBe(1.78)
  })

  it('counts a beat exactly the distance away', () => {
    expect(nearestBeat(2.03, BEATS, 0.03)).toBe(2)
  })
})

describe('isDownbeat', () => {
  it('is a beat that is more likely than not the first of a bar', () => {
    expect(isDownbeat(beat(1, 0.9))).toBe(true)
    expect(isDownbeat(beat(1, 0.5))).toBe(true)
    expect(isDownbeat(beat(1, 0.49))).toBe(false)
  })
})
