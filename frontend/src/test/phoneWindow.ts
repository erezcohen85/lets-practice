import { MOUSE_QUERY } from '@/components/editor/useEditorBlocked'
import { PHONE_QUERY } from '@/components/practice/usePhoneLayout'

/**
 * A window that is a phone or is not, for `usePhoneLayout`; every other media query is false. `resize` is the phone rule
 * turning on or off while the screen is open. `mouse` adds a mouse or trackpad (`(any-pointer: fine)`), as on a computer
 * whose window is dragged to phone size. Pair it with `vi.unstubAllGlobals()` in `afterEach`.
 */
export function stubPhoneWindow(phone: boolean, { mouse = false }: { mouse?: boolean } = {}) {
  let matches = phone
  const listeners = new Set<() => void>()
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: (query === PHONE_QUERY && matches) || (query === MOUSE_QUERY && mouse),
    media: query,
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
  }))
  return {
    resize(next: boolean) {
      matches = next
      for (const listener of listeners) listener()
    },
  }
}
