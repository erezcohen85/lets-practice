import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { strings } from '@/strings'

/** Answers "This changes the whole piece" with Change the piece, and waits for the dialog to go (Decisions 2026-11-03). */
export async function confirmPieceChange(user?: { click(element: Element): Promise<void> }) {
  const dialog = await screen.findByRole('alertdialog', { name: strings.editor.pieceEditing.confirmTitle })
  const button = within(dialog).getByRole('button', { name: strings.editor.pieceEditing.confirmAction })
  if (user === undefined) fireEvent.click(button)
  else await user.click(button)
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
}

/** Turns on "Edit piece structure" unless it is on already (the Edit sheet's switch, then Turn on in its warning) and waits for the warning to go. */
export async function turnOnPieceEditing(user?: { click(element: Element): Promise<void> }) {
  const toggle = screen.getAllByRole('switch', { name: strings.editor.pieceEditing.switch })[0]
  if (toggle.getAttribute('aria-checked') === 'true' || (toggle as HTMLInputElement).checked) return
  if (user === undefined) fireEvent.click(toggle)
  else await user.click(toggle)
  const dialog = await screen.findByRole('alertdialog', { name: strings.editor.pieceEditing.warningTitle })
  const button = within(dialog).getByRole('button', { name: strings.editor.pieceEditing.turnOn })
  if (user === undefined) fireEvent.click(button)
  else await user.click(button)
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
}
