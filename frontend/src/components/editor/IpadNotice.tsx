import { Info, X } from 'lucide-react'
import { useState, useSyncExternalStore } from 'react'
import { Button } from '@/components/ui/button'
import { strings } from '@/strings'

const NARROW = '(max-width: 1023px)'
const COARSE = '(pointer: coarse)'
const FINE = '(any-pointer: fine)'
const QUERIES = [NARROW, COARSE, FINE]

/** Narrower than 1024 px, or touch only (a coarse pointer and no fine one). Without matchMedia (old browsers, jsdom) it is false. */
function worksBetterOnComputer(): boolean {
  if (typeof window.matchMedia !== 'function') return false
  const matches = (query: string) => window.matchMedia(query).matches
  return matches(NARROW) || (matches(COARSE) && !matches(FINE))
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
 * "Editing works best on a computer." above the score on narrow or touch-only screens, with a Dismiss button. The
 * dismissal lives in this component only, so it holds for the visit and is never stored.
 */
export function IpadNotice() {
  const applies = useSyncExternalStore(subscribe, worksBetterOnComputer, () => false)
  const [dismissed, setDismissed] = useState(false)
  if (!applies || dismissed) return null

  return (
    <div role="note" className="flex items-center gap-3 rounded-card border border-border bg-surface px-4 py-2.5 text-sm text-text-soft">
      <Info className="size-5 shrink-0 text-primary-strong" aria-hidden="true" />
      <span className="flex-1">{strings.editor.ipad.notice}</span>
      <Button variant="ghost" size="icon" aria-label={strings.editor.ipad.dismiss} onClick={() => setDismissed(true)}>
        <X aria-hidden="true" />
      </Button>
    </div>
  )
}
