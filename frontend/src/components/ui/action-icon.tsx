import { Check, Copy, Library, Minus, Pencil, Plus, RefreshCw, RotateCcw, RotateCw, Save, Trash2, Undo2, Upload, Wrench, X, type LucideIcon } from 'lucide-react'

// One icon per action, so the same action looks the same on every filled coloured button (Erez, 2026-11-05). None of
// them points left or right, so none needs flipping in a right-to-left page.
const icons = {
  add: Plus,
  remove: Minus,
  retry: RotateCw,
  // Reset link: the arrow turns back, as the old link is undone (the board, Hub.png).
  reset: RotateCcw,
  realign: RefreshCw,
  save: Save,
  copy: Copy,
  confirm: Check,
  upload: Upload,
  library: Library,
  edit: Pencil,
  undo: Undo2,
  dismiss: X,
  fix: Wrench,
  delete: Trash2,
} satisfies Record<string, LucideIcon>

export type ActionName = keyof typeof icons

/** The icon at the start of a button's label. Hidden from assistive technology: the label is the name. */
export function ActionIcon({ action }: { action: ActionName }) {
  const Icon = icons[action]
  return <Icon data-icon="inline-start" aria-hidden="true" />
}
