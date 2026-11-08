import { type BarNumber } from './types'

/** What a step did, for the Undo / Redo tooltips; strings.ts turns it into text. */
export type StepKind =
  | 'add-bar-line'
  | 'delete-bar-line'
  | 'move-bar-line'
  | 'move-line-start'
  | 'move-line-end'
  | 'insert-piece-bar'
  | 'remove-piece-bar'
  | 'set-bars-in-box'
  | 'add-piece-bar-line'
  | 'delete-piece-bar-line'
  | 'set-piece-bars-in-box'
  | 'set-structure'
  | 'add-locator'
  | 'delete-locator'
  | 'move-locator'
  | 'move-locators'
  | 'sounds-right'
  | 'resolved'
  | 'undo-move'
  | 'relabel-locator'
  | 'resolve-all'
  | 'edit-meters'
  | 'edit-play-order'
  | 'relabel-in-order'
  | 'edit-marks'
  | 'edit-short-bars'
  | 'toggle-pickup'
  | 'add-pickup-bar'
  | 'remove-pickup-bar'
  | 'set-pickup-length'
  | 'split-part-pickup'
  | 'shift-part-pickup'
  | 'realign'
  | 'fill-bars'
  | 'resolve-box-flag'
  | 'regrid'

/** bar: the bar the step is about (for bar-line steps, the bar the line sits after; for piece-bar steps, the bar inserted or removed). passIndex: 0 = first pass. count: how many locators a group step moved. */
export interface StepLabel { kind: StepKind; bar?: BarNumber; passIndex?: number; count?: number }

export interface HistoryStep<S> { label: StepLabel; before: S; after: S }

/** past is oldest first; future is next-redo first. */
export interface History<S> {
  readonly past: readonly HistoryStep<S>[]
  readonly present: S
  readonly future: readonly HistoryStep<S>[]
  readonly limit: number
}

export const HISTORY_LIMIT = 100

/** A fresh history (the Editor opens, or the page reloads). limit must be a whole number >= 1, else RangeError. */
export function createHistory<S>(present: S, limit: number = HISTORY_LIMIT): History<S> {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError(`limit ${limit} must be a whole number of at least 1`)
  }
  return { past: [], present, future: [], limit }
}

/** Records one action that turned present into next. next === present (same reference) records nothing and returns history. */
export function record<S>(history: History<S>, label: StepLabel, next: S): History<S> {
  if (next === history.present) return history
  const step: HistoryStep<S> = { label, before: history.present, after: next }
  return {
    past: [...history.past, step].slice(-history.limit),
    present: next,
    future: [],
    limit: history.limit,
  }
}

/** Steps back one action; returns history itself when there is nothing to undo. */
export function undo<S>(history: History<S>): History<S> {
  const step = history.past.at(-1)
  if (step === undefined) return history
  return {
    past: history.past.slice(0, -1),
    present: step.before,
    future: [step, ...history.future],
    limit: history.limit,
  }
}

/** Steps forward one undone action; returns history itself when there is nothing to redo. */
export function redo<S>(history: History<S>): History<S> {
  const step = history.future.at(0)
  if (step === undefined) return history
  return {
    past: [...history.past, step],
    present: step.after,
    future: history.future.slice(1),
    limit: history.limit,
  }
}

export function canUndo<S>(history: History<S>): boolean {
  return history.past.length > 0
}

export function canRedo<S>(history: History<S>): boolean {
  return history.future.length > 0
}

/** The label of the step undo would revert, or null. */
export function nextUndo<S>(history: History<S>): StepLabel | null {
  return history.past.at(-1)?.label ?? null
}

/** The label of the step redo would re-apply, or null. */
export function nextRedo<S>(history: History<S>): StepLabel | null {
  return history.future.at(0)?.label ?? null
}
