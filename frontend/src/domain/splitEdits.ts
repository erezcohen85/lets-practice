import { MAX_PART_NAME } from '@/domain/names'

// The split screen's edits (UX plan part 8): one PDF that holds several parts, cut into page ranges. A list of parts
// always covers every page of the PDF once, in order, each with at least one page; every edit here keeps that true. The
// rules of what may be sent are the processor's (POST /runs with a split): names 1 to 80 characters, at least one part
// kept. The number of parts is not limited (Erez, 2026-11-06); the PDF's 120 pages and 50 MB are.

/**
 * A proposed part: a name, its pages (1-based, both included), whether it goes into the piece, and the pages inside that
 * range the user discarded (sorted). A part always keeps at least one page that is not discarded.
 */
export interface SplitPart { name: string; fromPage: number; toPage: number; keep: boolean; skipPages: number[] }

/** What goes to the processor for a part that is kept. */
export interface SplitRange { name: string; fromPage: number; toPage: number; skipPages: number[] }

/** One page of the PDF as the processor read it. `thumb` is an address the browser can load (a small grayscale image). */
export interface SplitPage { page: number; partName: string | null; printedPage: number | null; fullScore: boolean; thumb: string }

/** The processor's reading of a PDF that holds several parts (POST /split). */
export interface SplitProposal {
  /** What the upload names to say which staged PDF the ranges are cut from. */
  splitId: string
  pageCount: number
  /** More than half of the pages hold a full score: the app stops there. */
  fullScore: boolean
  parts: Array<{ name: string; fromPage: number; toPage: number }>
  pages: SplitPage[]
  /** One sentence for the screen (a page header that could not be read, no names found), or null. */
  note: string | null
}

const NUMBER_SUFFIX = / \(\d+\)$/

const sameName = (name: string) => name.trim().toLowerCase()

/** `base (n)` for the lowest n from 2 that no name in `taken` (compared as sameName does) has; the whole name stays inside the limit. */
function freeName(base: string, taken: Set<string>): string {
  for (let number = 2; ; number += 1) {
    const suffix = ` (${number})`
    const name = `${base.slice(0, MAX_PART_NAME - suffix.length)}${suffix}`
    if (!taken.has(sameName(name))) return name
  }
}

/** The parts of a proposal with a repeated name numbered: Violin, Violin (2), Violin (3). The first keeps its name. */
export function numberDuplicates(parts: SplitPart[]): SplitPart[] {
  const taken = new Set(parts.map((entry) => sameName(entry.name)))
  const seen = new Set<string>()
  return parts.map((entry) => {
    const key = sameName(entry.name)
    if (!seen.has(key)) {
      seen.add(key)
      return entry
    }
    const name = freeName(entry.name.trim(), taken)
    taken.add(sameName(name))
    seen.add(sameName(name))
    return { ...entry, name }
  })
}

export const renameSplitPart = (parts: SplitPart[], index: number, name: string): SplitPart[] =>
  parts.map((entry, at) => (at === index ? { ...entry, name } : entry))

export const setKeep = (parts: SplitPart[], index: number, keep: boolean): SplitPart[] =>
  parts.map((entry, at) => (at === index ? { ...entry, keep } : entry))

export const pageTotal = (entry: SplitPart) => entry.toPage - entry.fromPage + 1

/** How many pages of the part go into the piece: its range without the discarded pages. */
export const keptPageCount = (entry: SplitPart) => pageTotal(entry) - entry.skipPages.length

/** The pages of a part that stay, as runs from page to page: pages 1-6 without 4 are [[1, 3], [5, 6]]. */
export function pageRuns(entry: SplitPart): Array<[number, number]> {
  const runs: Array<[number, number]> = []
  for (let page = entry.fromPage; page <= entry.toPage; page += 1) {
    if (entry.skipPages.includes(page)) continue
    const last = runs[runs.length - 1]
    if (last !== undefined && last[1] === page - 1) last[1] = page
    else runs.push([page, page])
  }
  return runs
}

/** Whether `page` of the part can be discarded: it is inside the part, not discarded yet, and another page stays. */
export const canSkipPage = (entry: SplitPart, page: number): boolean =>
  page >= entry.fromPage && page <= entry.toPage && !entry.skipPages.includes(page) && keptPageCount(entry) > 1

/** Discards the page of part `index`, or restores it when it was discarded. A page that cannot be discarded leaves the list as it was. */
export function toggleSkipPage(parts: SplitPart[], index: number, page: number): SplitPart[] {
  const entry = parts[index]
  if (entry === undefined) return parts
  if (entry.skipPages.includes(page)) {
    return parts.map((other, at) => (at === index ? { ...other, skipPages: other.skipPages.filter((skipped) => skipped !== page) } : other))
  }
  if (!canSkipPage(entry, page)) return parts
  return parts.map((other, at) => (at === index ? { ...other, skipPages: [...other.skipPages, page].sort((a, b) => a - b) } : other))
}

/**
 * Whether the boundary between part `index` and the next one can move one page: +1 gives the next part's first page to
 * this part, -1 gives this part's last page to the next one. The part that gives a page needs another page that is not
 * discarded to stay.
 */
export function canMoveBoundary(parts: SplitPart[], index: number, direction: 1 | -1): boolean {
  const next = parts[index + 1]
  if (parts[index] === undefined || next === undefined) return false
  const giver = direction === 1 ? next : parts[index]
  const given = direction === 1 ? giver.fromPage : giver.toPage
  return keptPageCount(giver) - (giver.skipPages.includes(given) ? 0 : 1) >= 1
}

/** The boundary moves one page and the page's discard goes with it. */
export function moveBoundary(parts: SplitPart[], index: number, direction: 1 | -1): SplitPart[] {
  if (!canMoveBoundary(parts, index, direction)) return parts
  const giver = direction === 1 ? parts[index + 1] : parts[index]
  const page = direction === 1 ? giver.fromPage : giver.toPage
  const moving = giver.skipPages.includes(page)
  const without = (skipPages: number[]) => skipPages.filter((skipped) => skipped !== page)
  const withPage = (skipPages: number[]) => [...skipPages, page].sort((a, b) => a - b)
  return parts.map((entry, at) => {
    if (at === index) return { ...entry, toPage: entry.toPage + direction, skipPages: moving ? (direction === 1 ? withPage(entry.skipPages) : without(entry.skipPages)) : entry.skipPages }
    if (at === index + 1) return { ...entry, fromPage: entry.fromPage + direction, skipPages: moving ? (direction === 1 ? without(entry.skipPages) : withPage(entry.skipPages)) : entry.skipPages }
    return entry
  })
}

/** Part `index` and the next one as one part: the first one's name, all their pages. It is kept when either was, so no page the user wanted is dropped. */
export function mergeWithNext(parts: SplitPart[], index: number): SplitPart[] {
  const next = parts[index + 1]
  if (parts[index] === undefined || next === undefined) return parts
  const merged = { ...parts[index], toPage: next.toPage, keep: parts[index].keep || next.keep, skipPages: [...parts[index].skipPages, ...next.skipPages] }
  return [...parts.slice(0, index), merged, ...parts.slice(index + 2)]
}

/** Whether part `index` can be cut so that a new part starts at `page`: inside the part, past its first page, and each side keeps a page that is not discarded. */
export function canSplitAt(parts: SplitPart[], index: number, page: number): boolean {
  const entry = parts[index]
  if (entry === undefined || page <= entry.fromPage || page > entry.toPage) return false
  const before = entry.skipPages.filter((skipped) => skipped < page).length
  const after = entry.skipPages.length - before
  return page - entry.fromPage - before >= 1 && entry.toPage - page + 1 - after >= 1
}

/** Part `index` cut so that a new part starts at `page`; the new one is "<name> (2)", or the next number that is free. The discarded pages stay with their pages. */
export function splitAtPage(parts: SplitPart[], index: number, page: number): SplitPart[] {
  if (!canSplitAt(parts, index, page)) return parts
  const entry = parts[index]
  const taken = new Set(parts.map((other) => sameName(other.name)))
  const name = freeName(entry.name.trim().replace(NUMBER_SUFFIX, ''), taken)
  const first = { ...entry, toPage: page - 1, skipPages: entry.skipPages.filter((skipped) => skipped < page) }
  const second = { name, fromPage: page, toPage: entry.toPage, keep: entry.keep, skipPages: entry.skipPages.filter((skipped) => skipped >= page) }
  return [...parts.slice(0, index), first, second, ...parts.slice(index + 1)]
}

export const keptCount = (parts: SplitPart[]) => parts.filter((entry) => entry.keep).length

/** The parts to send: the kept ones, in page order, with trimmed names. */
export function partsToKeep(parts: SplitPart[]): SplitRange[] {
  return parts.filter((entry) => entry.keep).map(({ name, fromPage, toPage, skipPages }) => ({ name: name.trim(), fromPage, toPage, skipPages: [...skipPages] }))
}

export type SplitNameProblem = 'empty' | 'too-long'
export interface SplitProblems {
  /** By index in the list; only kept parts are checked. */
  names: Record<number, SplitNameProblem>
  kept: 'none' | null
}

/** What the processor would refuse in this split. */
export function splitProblems(parts: SplitPart[]): SplitProblems {
  const names: Record<number, SplitNameProblem> = {}
  parts.forEach((entry, index) => {
    if (!entry.keep) return
    const name = entry.name.trim()
    if (name === '') names[index] = 'empty'
    else if (name.length > MAX_PART_NAME) names[index] = 'too-long'
  })
  const count = keptCount(parts)
  return { names, kept: count === 0 ? 'none' : null }
}

/** True when there is nothing to fix. */
export const splitIsValid = (problems: SplitProblems) => problems.kept === null && Object.keys(problems.names).length === 0

/** The processor's refusal of a split it no longer has (it keeps a staged PDF for a day): the form then sends the user back to choose the PDF. */
export const SPLIT_EXPIRED = 'This split has expired: choose the PDF again.'
