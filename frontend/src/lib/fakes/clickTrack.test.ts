import { type TimingLayer } from '@/domain/types'
import { clickTrackUrl, clickTrackWav } from '@/lib/fakes/clickTrack'

const RATE = 8000
const SILENCE = 128

// 4 bars of 4/4 at 2 s a bar (0.5 s a beat), the first bar on 1 s.
const TIMING: TimingLayer = {
  barCount: 4,
  playOrder: [{ from: 1, to: 4 }],
  meters: [{ fromBar: 1, numerator: 4, denominator: 4 }],
  marks: [],
  locators: [
    { bar: 1, passIndex: 0, timeSec: 1, confirmed: true },
    { bar: 2, passIndex: 0, timeSec: 3, confirmed: false },
    { bar: 3, passIndex: 0, timeSec: 5, confirmed: false },
    { bar: 4, passIndex: 0, timeSec: 7, confirmed: false },
  ],
}

function ascii(bytes: Uint8Array, from: number, to: number): string {
  return String.fromCharCode(...bytes.slice(from, to))
}

function activeBetween(bytes: Uint8Array, fromSec: number, toSec: number): boolean {
  for (let i = 44 + Math.round(fromSec * RATE); i < 44 + Math.round(toSec * RATE); i++) if (bytes[i] !== SILENCE) return true
  return false
}

describe('clickTrackWav', () => {
  it('writes a valid 44-byte RIFF header for 8 kHz, 8-bit, mono PCM', () => {
    const bytes = clickTrackWav(TIMING, 10)
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

    expect(ascii(bytes, 0, 4)).toBe('RIFF')
    expect(view.getUint32(4, true)).toBe(bytes.length - 8)
    expect(ascii(bytes, 8, 16)).toBe('WAVEfmt ')
    expect(view.getUint32(16, true)).toBe(16)
    expect(view.getUint16(20, true)).toBe(1) // PCM
    expect(view.getUint16(22, true)).toBe(1) // mono
    expect(view.getUint32(24, true)).toBe(RATE)
    expect(view.getUint32(28, true)).toBe(RATE) // byte rate: 1 byte a sample
    expect(view.getUint16(32, true)).toBe(1) // block align
    expect(view.getUint16(34, true)).toBe(8)
    expect(ascii(bytes, 36, 40)).toBe('data')
    expect(view.getUint32(40, true)).toBe(10 * RATE)
  })

  it('is 44 bytes plus one byte per sample of the duration', () => {
    expect(clickTrackWav(TIMING, 10)).toHaveLength(44 + 10 * RATE)
    expect(clickTrackWav(TIMING, 0.5)).toHaveLength(44 + 4000)
  })

  it('starts a click on the sample of each locator', () => {
    const bytes = clickTrackWav(TIMING, 10)

    for (const locator of TIMING.locators) {
      const start = 44 + Math.round(locator.timeSec * RATE)
      expect(bytes[start]).not.toBe(SILENCE)
      expect(bytes[start - 1]).toBe(SILENCE)
    }
  })

  it('makes the downbeat click 30 ms long and the other beats 20 ms long', () => {
    const bytes = clickTrackWav(TIMING, 10)

    expect(activeBetween(bytes, 1, 1.03)).toBe(true)
    expect(activeBetween(bytes, 1.032, 1.49)).toBe(false) // silent after 30 ms
    expect(activeBetween(bytes, 1.5, 1.52)).toBe(true) // beat 2 of bar 1
    expect(activeBetween(bytes, 1.522, 1.99)).toBe(false) // silent after 20 ms
  })

  it('puts a quieter click on every other beat, spread evenly inside the bar', () => {
    const bytes = clickTrackWav(TIMING, 10)

    for (const beatSec of [1.5, 2, 2.5]) expect(bytes[44 + Math.round(beatSec * RATE)]).not.toBe(SILENCE)
    expect(activeBetween(bytes, 1.1, 1.45)).toBe(false)
    expect(activeBetween(bytes, 2.1, 2.45)).toBe(false)
  })

  it('is silent before the first bar and after the last one ends', () => {
    const bytes = clickTrackWav(TIMING, 10)

    expect(activeBetween(bytes, 0, 1)).toBe(false)
    expect(activeBetween(bytes, 9.1, 10)).toBe(false)
  })

  it('has as many beats as the meter says', () => {
    const waltz: TimingLayer = {
      ...TIMING,
      meters: [{ fromBar: 1, numerator: 3, denominator: 4 }],
    }
    const bytes = clickTrackWav(waltz, 10)

    expect(bytes[44 + Math.round(1 * RATE)]).not.toBe(SILENCE)
    expect(bytes[44 + Math.round((1 + 2 / 3) * RATE)]).not.toBe(SILENCE)
    expect(bytes[44 + Math.round((1 + 1) * RATE)]).toBe(SILENCE) // 2 s a 3-beat bar: beats on 1, 1.667, 2.333 ...
  })

  it('is all silence for a timing layer without two locators', () => {
    const none: TimingLayer = { ...TIMING, locators: [] }
    const bytes = clickTrackWav(none, 2)

    expect(bytes.slice(44).every((byte) => byte === SILENCE)).toBe(true)
  })
})

describe('clickTrackUrl', () => {
  it('is a base64 data URL of the same bytes', () => {
    const url = clickTrackUrl(TIMING, 3)
    const prefix = 'data:audio/wav;base64,'

    expect(url.startsWith(prefix)).toBe(true)
    const decoded = Uint8Array.from(atob(url.slice(prefix.length)), (char) => char.charCodeAt(0))
    expect(decoded).toEqual(clickTrackWav(TIMING, 3))
  })
})
