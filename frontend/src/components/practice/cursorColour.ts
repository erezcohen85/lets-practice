import { type CursorColour } from '@/lib/dataClient'

// The settings' colours, as the tokens the swatches use. The Record makes the compiler check every colour is covered.
export const cursorVar: Record<CursorColour, string> = {
  // Violet is the loop's own token, not a --lp-cursor-* one: the five rows of Settings share one list.
  violet: 'var(--lp-loop)',
  teal: 'var(--lp-cursor-teal)',
  amber: 'var(--lp-cursor-amber)',
  pink: 'var(--lp-cursor-pink)',
  blue: 'var(--lp-cursor-blue)',
}
