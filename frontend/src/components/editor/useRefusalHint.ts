import { useCallback, useEffect, useRef, useState } from 'react'
import { type EditRefusal } from '@/domain/pieceEdits'
import { strings } from '@/strings'

const REFUSAL_TEXT: Record<EditRefusal, string> = { ...strings.editor.refusals, ...strings.review.refusals }

/** The sentence that says why an edit was refused. */
export function refusalText(reason: EditRefusal): string {
  return REFUSAL_TEXT[reason]
}

/** How long the reason for a refused edit stays in the hint line, in ms. */
export const REFUSAL_HINT_MS = 3000

/** The reason for the last refused edit while it should show; a new refusal restarts the time. */
export function useRefusalHint(delayMs: number = REFUSAL_HINT_MS) {
  const [hint, setHint] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => () => clearTimeout(timer.current), [])

  const show = useCallback(
    (reason: EditRefusal) => {
      clearTimeout(timer.current)
      setHint(refusalText(reason))
      timer.current = setTimeout(() => setHint(null), delayMs)
    },
    [delayMs],
  )

  /** A sentence that is not a refusal (what a group Snap did) takes the same place for the same time. */
  const showText = useCallback(
    (sentence: string) => {
      clearTimeout(timer.current)
      setHint(sentence)
      timer.current = setTimeout(() => setHint(null), delayMs)
    },
    [delayMs],
  )

  return { hint, show, showText }
}
