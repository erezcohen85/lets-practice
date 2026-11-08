import { type PageLayer, type TimingLayer } from '@/domain/types'
import { type RunDocument } from '@/lib/localRun/runApi'

// A small run in the shape run_piece.py writes: 8 bars of 4/4, a downbeat every 2 s from 1 s, two parts of one page.

const BARS = 8

function timing(): TimingLayer {
  return {
    barCount: BARS,
    playOrder: [{ from: 1, to: BARS }],
    meters: [{ fromBar: 1, numerator: 4, denominator: 4 }],
    marks: [],
    locators: Array.from({ length: BARS }, (_, index) => ({ bar: index + 1, passIndex: 0, timeSec: 1 + 2 * index, confirmed: false })),
  }
}

function page(partId: string): PageLayer {
  return {
    partId,
    bars: Array.from({ length: BARS }, (_, index) => ({ bar: index + 1, pageIndex: 0, x: 10 + 45 * (index % 4), y: 5 + 50 * Math.floor(index / 4), w: 45, h: 40 })),
    rests: [],
  }
}

export function sampleRun(id = 'piece-a'): RunDocument {
  return {
    piece: { id, title: 'Synthetic Etude', createdAt: '2026-10-30T10:00:00.000Z', countInBars: 1, durationSec: 20 },
    recording: { kind: 'file', name: 'etude.mp3' },
    audio: 'audio.m4a',
    peaks: Array.from({ length: 800 }, (_, index) => index % 128),
    parts: [
      { id: 'part-flute', name: 'Flute', position: 0, pageCount: 1 },
      { id: 'part-horn', name: 'Horn', position: 1, pageCount: 1 },
    ],
    pageImages: {
      'part-flute': [{ pageIndex: 0, width: 200, height: 100, file: 'pages/part-flute/page-0.webp' }],
      'part-horn': [{ pageIndex: 0, width: 200, height: 100, file: 'pages/part-horn/page-0.webp' }],
    },
    timing: timing(),
    pages: { 'part-flute': page('part-flute'), 'part-horn': page('part-horn') },
    confirmedAt: null,
    canRealign: false,
  }
}
