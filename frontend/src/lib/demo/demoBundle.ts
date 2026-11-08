import { type PageLayer, type TimingLayer } from '@/domain/types'

/**
 * The files of the public demo (frontend/public/demo/<bundle>/), written by backend/processor/spikes/export_demo.py (a real
 * piece) or spikes/synthetic_demo.py (the drawn one): demo.json, the audio and the page images, whose names in demo.json are
 * relative to that folder. Peaks are 0..1, stretched to the loudest.
 */
/** Who made the recording or the score, and under what licence. A licence such as CC BY requires this to show with the music. */
export interface DemoCredit {
  what: string
  who: string
  /** The title its licensor gave it, when it has one: CC BY asks for it. */
  title?: string
  licence: string
  /** Where the file came from. */
  source: string
  licenceUrl?: string
  /** What was changed, for a licence that asks to say so. */
  note?: string
}

export interface DemoBundle {
  version: 1
  piece: { id: string; title: string; createdAt: string; countInBars: 0 | 1 | 2 | 3 | 4; durationSec: number }
  audio: string
  peaks: number[]
  parts: Array<{ id: string; name: string; position: number; pageCount: number }>
  pageImages: Record<string, Array<{ pageIndex: number; width: number; height: number; file: string }>>
  timing: TimingLayer
  pages: Record<string, PageLayer>
  /** Left out by a bundle that needs none, such as the drawn one. */
  credits?: DemoCredit[]
}

export const DEMO_BUNDLE_FILE = 'demo.json'

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

const isText = (value: unknown) => typeof value === 'string' && value !== ''
const isLink = (value: unknown) => typeof value === 'string' && value.startsWith('https://')

/** Better no demo than the music without the credit its licence asks for, or with a link that is not a web address. */
function checkCredits(credits: unknown): void {
  if (credits === undefined) return
  if (!Array.isArray(credits)) throw new Error('The demo bundle has unreadable credits')
  for (const credit of credits as unknown[]) {
    const shown = isObject(credit) && isText(credit.what) && isText(credit.who) && isText(credit.licence) && isLink(credit.source)
    const optionalsFine = shown && (credit.licenceUrl === undefined || isLink(credit.licenceUrl)) && (credit.title === undefined || isText(credit.title))
    if (!optionalsFine) throw new Error('The demo bundle has a credit it cannot show')
  }
}

/** The credits in a value from outside (a demo.json, a piece's sample_credits), or null when it is not a list of credits that can all be shown. */
export function readCredits(raw: unknown): DemoCredit[] | null {
  try {
    checkCredits(raw)
  } catch {
    return null
  }
  return Array.isArray(raw) ? (raw as DemoCredit[]) : null
}

/** The bundle in a parsed demo.json; throws when it is not one (a server that answers an unknown address with a web page, a half-copied folder). */
export function parseDemoBundle(raw: unknown): DemoBundle {
  if (!isObject(raw) || raw.version !== 1) throw new Error('The demo file is not a demo bundle')
  const { piece, audio, peaks, parts, pageImages, timing, pages } = raw
  if (!isObject(piece) || typeof piece.id !== 'string' || typeof piece.title !== 'string' || typeof piece.durationSec !== 'number') throw new Error('The demo bundle has no piece')
  if (typeof audio !== 'string' || !Array.isArray(peaks) || !Array.isArray(parts) || parts.length === 0) throw new Error('The demo bundle is incomplete')
  if (!isObject(pageImages) || !isObject(pages)) throw new Error('The demo bundle has no pages')
  if (!isObject(timing) || !Array.isArray(timing.playOrder) || !Array.isArray(timing.locators)) throw new Error('The demo bundle has no timing')
  checkCredits(raw.credits)
  return raw as unknown as DemoBundle
}
