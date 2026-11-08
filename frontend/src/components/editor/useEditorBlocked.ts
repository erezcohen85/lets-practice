import { useSyncExternalStore } from 'react'
import { PHONE_QUERY } from '@/components/practice/usePhoneLayout'

/** A mouse or a trackpad: a computer, whatever the size of its window. */
export const MOUSE_QUERY = '(any-pointer: fine)'

const QUERIES = [PHONE_QUERY, MOUSE_QUERY]

/** A phone: the screen is phone-sized (Practice's phone rule) and there is no mouse or trackpad. */
function isBlocked(): boolean {
  if (typeof window.matchMedia !== 'function') return false
  return window.matchMedia(PHONE_QUERY).matches && !window.matchMedia(MOUSE_QUERY).matches
}

function subscribe(onChange: () => void): () => void {
  if (typeof window.matchMedia !== 'function') return () => {}
  const lists = QUERIES.map((query) => window.matchMedia(query))
  for (const list of lists) list.addEventListener('change', onChange)
  return () => {
    for (const list of lists) list.removeEventListener('change', onChange)
  }
}

/**
 * Whether the editor is closed on this screen: it needs a computer or a tablet (Decisions 2026-11-08). True on a phone,
 * either way up, and on an iPad in a Split View narrower than 600 px; never on a computer, however small its window.
 * Without matchMedia (old browsers, jsdom) it is false.
 */
export function useEditorBlocked(): boolean {
  return useSyncExternalStore(subscribe, isBlocked, () => false)
}
