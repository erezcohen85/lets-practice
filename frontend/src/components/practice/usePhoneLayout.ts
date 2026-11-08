import { useSyncExternalStore } from 'react'

/**
 * A phone held either way: narrower than 600 px, or shorter than 500 px while also narrower than 1024 px. Width alone cannot
 * tell: a phone on its side (844 px) is wider than an upright iPad mini (744 x 1133). From 1024 px a computer keeps its toolbar
 * at any height. An iPad in a Split View narrower than 600 px does count, and so does a computer window dragged that small.
 */
export const PHONE_QUERY = '(max-width: 599.98px), (max-width: 1023.98px) and (max-height: 499.98px)'

function isPhone(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(PHONE_QUERY).matches
}

function subscribe(onChange: () => void): () => void {
  if (typeof window.matchMedia !== 'function') return () => {}
  const list = window.matchMedia(PHONE_QUERY)
  list.addEventListener('change', onChange)
  return () => list.removeEventListener('change', onChange)
}

/** Whether Practice takes its phone layout. Without matchMedia (old browsers, jsdom) it is false. */
export function usePhoneLayout(): boolean {
  return useSyncExternalStore(subscribe, isPhone, () => false)
}
