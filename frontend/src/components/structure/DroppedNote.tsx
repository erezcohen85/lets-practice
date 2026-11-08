import { strings } from '@/strings'

/** Said before Apply, when the edit would clear recording times (a plain bar change inside a repeat, a shorter play order). */
export function DroppedNote({ count }: { count: number }) {
  if (count === 0) return null
  return <p className="text-sm text-warning-text">{strings.structure.bars.dropped(count)}</p>
}
