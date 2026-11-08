import { useState } from 'react'
import { usePlanGate } from '@/lib/plan'
import { sentenceOf, type NameSuggestion } from '@/lib/processorClient'
import { strings } from '@/strings'

const t = strings.suggestName

/**
 * The state of a "Suggest a name" button: `ask` makes one call, gives a name to `apply` (an empty one is not applied) and
 * keeps the note that says why the name came from the fallback, or that the call failed. A plan without the feature opens the
 * "Not in your plan" prompt instead of asking (also when only the server knows: its refusal opens the same prompt).
 */
export function useNameSuggestion(ask: () => Promise<NameSuggestion>, apply: (name: string) => void) {
  const gate = usePlanGate()
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const suggest = async () => {
    if (!gate.check({ type: 'suggestName' })) return
    setBusy(true)
    setNote(null)
    try {
      const suggestion = await gate.run(null, ask)
      // undefined: the plan refused it, and the prompt is open.
      if (suggestion !== undefined) {
        if (suggestion.name !== '') apply(suggestion.name)
        setNote(suggestion.note)
      }
    } catch (error) {
      setNote(sentenceOf(error) ?? t.failed)
    }
    setBusy(false)
  }
  return { busy, note, suggest, clearNote: () => setNote(null) }
}
