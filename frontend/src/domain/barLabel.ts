import { type BarNames } from './barNames'
import { type BarNumber } from './types'

/**
 * Reads a locator label as `barWithPass` writes it: "12" is bar 12 on its first pass, "p7" the pickup before it, "12 (2)" its
 * second pass ("12/2" works too). The pass counts from 1 on screen and from 0 in the data. The bar comes back as the internal
 * number the label names under `names`; anything that names no bar of the piece, or is not a label, is null.
 */
export function parseBarLabel(text: string, names: BarNames): { bar: BarNumber; passIndex: number } | null {
  const match = /^\s*(p?\s*\d+)\s*(?:\(\s*(\d+)\s*\)|\/\s*(\d+))?\s*$/i.exec(text)
  if (match === null) return null
  const bar = names.parse(match[1])
  if (bar === null) return null
  const passText = match[2] ?? match[3]
  const pass = passText === undefined ? 1 : Number(passText)
  return pass < 1 ? null : { bar, passIndex: pass - 1 }
}

/** A time offset in seconds with its sign and two decimals: "+0.42", "-0.12". Zero is "+0.00", never "-0.00". */
export function formatOffset(sec: number): string {
  const rounded = Math.round(sec * 100) / 100
  return `${rounded < 0 ? '-' : '+'}${Math.abs(rounded).toFixed(2)}`
}
