import { type ReactNode } from 'react'
import { type BarNames } from '@/domain/barNames'
import { BarNamesContext } from '@/lib/barNamesContext'

/** Gives the screen below it the names its bars go by (see useBarNames). */
export function BarNamesProvider({ names, children }: { names: BarNames; children: ReactNode }) {
  return <BarNamesContext.Provider value={names}>{children}</BarNamesContext.Provider>
}
