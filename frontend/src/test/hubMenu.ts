import { screen, within } from '@testing-library/react'
import { type UserEvent } from '@testing-library/user-event'
import { strings } from '@/strings'

/** Opens the three-dot menu named "More for <name>" (inside `scope` when given) and returns its panel. */
export async function openMoreMenu(user: UserEvent, name: string, scope?: HTMLElement) {
  const trigger = (scope === undefined ? screen : within(scope)).getByRole('button', { name: strings.hub.moreFor(name) })
  await user.click(trigger)
  return screen.findByRole('menu')
}

/** Opens a three-dot menu and picks one item by its text, as a user would. */
export async function chooseFromMenu(user: UserEvent, name: string, item: string, scope?: HTMLElement) {
  await openMoreMenu(user, name, scope)
  await user.click(await screen.findByRole('menuitem', { name: item }))
}

/** Picks an item of the piece's own menu, the one beside the title (named after the page's heading). */
export async function chooseFromPieceMenu(user: UserEvent, item: string) {
  await chooseFromMenu(user, screen.getByRole('heading', { level: 1 }).textContent ?? '', item)
}
