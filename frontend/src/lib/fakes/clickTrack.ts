import { buildTimeline } from '@/domain/tempo'
import { type TimingLayer } from '@/domain/types'

// The fakes' recording: a click track made from the stored timing, so the editor has something to play and the ear can
// check the locators. 8 kHz, 8-bit, mono PCM: a 30 ms 1 kHz click on every downbeat (the locators) and a 20 ms 600 Hz
// click on every other beat; the beats are spread evenly inside each bar. Silence is 128 (unsigned 8-bit).

const SAMPLE_RATE = 8000
const HEADER_BYTES = 44
const SILENCE = 128
const DOWNBEAT = { hz: 1000, sec: 0.03, amplitude: 110 }
const BEAT = { hz: 600, sec: 0.02, amplitude: 70 }
const CHUNK = 0x8000

interface Click { hz: number; sec: number; amplitude: number }

/** The WAV bytes of the click track, `durationSec` long; all silence when the timing has fewer than two located bars. */
export function clickTrackWav(timing: TimingLayer, durationSec: number): Uint8Array {
  const samples = Math.max(0, Math.round(durationSec * SAMPLE_RATE))
  const bytes = new Uint8Array(HEADER_BYTES + samples).fill(SILENCE, HEADER_BYTES)
  writeHeader(new DataView(bytes.buffer), samples)

  for (const { startSec, endSec, meter } of buildTimeline(timing, durationSec)) {
    const beatSec = (endSec - startSec) / meter.numerator
    for (let beat = 0; beat < meter.numerator; beat++) {
      writeClick(bytes, samples, startSec + beat * beatSec, beat === 0 ? DOWNBEAT : BEAT)
    }
  }
  return bytes
}

/** The same bytes as a 'data:audio/wav;base64,...' URL, which an <audio> element can load. */
export function clickTrackUrl(timing: TimingLayer, durationSec: number): string {
  return `data:audio/wav;base64,${toBase64(clickTrackWav(timing, durationSec))}`
}

function writeHeader(view: DataView, samples: number): void {
  const text = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i))
  }
  text(0, 'RIFF')
  view.setUint32(4, HEADER_BYTES - 8 + samples, true)
  text(8, 'WAVEfmt ')
  view.setUint32(16, 16, true) // size of the fmt chunk
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, SAMPLE_RATE, true)
  view.setUint32(28, SAMPLE_RATE, true) // bytes a second: one byte a sample
  view.setUint16(32, 1, true) // block align
  view.setUint16(34, 8, true) // bits a sample
  text(36, 'data')
  view.setUint32(40, samples, true)
}

/** A sine that fades out linearly; it starts a quarter of a sample into its wave so that the first sample is not silence. */
function writeClick(bytes: Uint8Array, samples: number, startSec: number, click: Click): void {
  const first = Math.round(startSec * SAMPLE_RATE)
  const length = Math.round(click.sec * SAMPLE_RATE)
  for (let i = 0; i < length; i++) {
    const at = first + i
    if (at < 0 || at >= samples) continue
    const wave = Math.sin((2 * Math.PI * click.hz * (i + 0.5)) / SAMPLE_RATE)
    bytes[HEADER_BYTES + at] = SILENCE + Math.round(click.amplitude * (1 - i / length) * wave)
  }
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += CHUNK) binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  return btoa(binary)
}
