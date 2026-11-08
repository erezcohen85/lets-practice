import { type LoopColour } from '@/lib/dataClient'
import { cursorVar } from './cursorColour'

/**
 * The loop colour the user chose (Settings), as scoped variables for the Practice screen: the loop's mark on the score, its band
 * on the overview and its field read these four, while `--lp-loop` keeps its other jobs (the Edit side of the switch, Stems' tag).
 * Violet is the loop tokens themselves, so it looks exactly as before; any other colour gets its soft, tint and handle shades
 * derived from its token by `color-mix`, so they follow the theme.
 */
export function loopVars(colour: LoopColour): Record<string, string> {
  if (colour === 'violet') {
    return {
      '--lp-loop-user': 'var(--lp-loop)',
      '--lp-loop-user-soft': 'var(--lp-loop-soft)',
      '--lp-loop-user-tint': 'var(--lp-loop-tint)',
      '--lp-loop-user-handle': 'var(--lp-loop-handle)',
    }
  }
  const base = cursorVar[colour]
  return {
    '--lp-loop-user': base,
    // Lighter than the colour on the dark theme and darker on the light one: it is mixed toward the text colour.
    '--lp-loop-user-soft': `color-mix(in oklab, ${base} 65%, var(--lp-text))`,
    '--lp-loop-user-tint': `color-mix(in oklab, ${base} 18%, transparent)`,
    '--lp-loop-user-handle': `color-mix(in oklab, ${base} 88%, var(--lp-ink))`,
  }
}

/**
 * The classes that read those variables (violet where nothing sets them). They are classes of their own, not Tailwind colours,
 * because the variables belong to the Practice screen and are not tokens.
 */
export const loopClass = {
  tint: 'bg-[color:var(--lp-loop-user-tint,var(--lp-loop-tint))]',
  handle: 'bg-[color:var(--lp-loop-user-handle,var(--lp-loop-handle))]',
  handleBorder: 'border-[color:var(--lp-loop-user-handle,var(--lp-loop-handle))]',
  soft: 'text-[color:var(--lp-loop-user-soft,var(--lp-loop-soft))]',
} as const
