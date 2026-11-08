import { createContext, useContext, useMemo } from 'react'
import { barNamesOf, type BarNames } from '@/domain/barNames'
import { type ShortBar } from '@/domain/types'

const PLAIN = barNamesOf(undefined)

/** The names the bars of the screen go by; every bar reads as its own number until a BarNamesProvider says otherwise. */
export const BarNamesContext = createContext<BarNames>(PLAIN)

/** The names of a piece's bars from its short-bar list; the same object while the list is the same one. */
export function useBarNamesOf(shortBars: readonly ShortBar[] | undefined): BarNames {
  return useMemo(() => barNamesOf(shortBars), [shortBars])
}

/**
 * The names the piece's bars go by on this screen (p7 for a pickup with no number, the top pickup p1). A component that shows a
 * bar reads `useBarNames()` and writes `names.label(bar)`; the bar itself stays the internal number.
 */
export function useBarNames(): BarNames {
  return useContext(BarNamesContext)
}
