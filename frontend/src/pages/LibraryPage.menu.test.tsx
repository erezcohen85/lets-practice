import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { createFakes, type Fakes } from '@/lib/fakes'
import { DEMO_USER, setPlan, signInAs, THIRD_USER } from '@/lib/fakes/store'
import { strings } from '@/strings'
import { renderWithApp } from '@/test/render'
import { shareLinkOn } from '@/test/shareLink'

const lib = strings.library

const demo = () => renderWithApp('/library', { seed: 'demo' })
const cardLink = (title: string) => screen.getByRole('link', { name: new RegExp(title) })
const findCards = async () => within(await screen.findByRole('list')).getAllByRole('listitem')

async function openMenu(user: ReturnType<typeof demo>['user'], title: string) {
  await user.click(await screen.findByRole('button', { name: lib.moreFor(title) }))
  await screen.findByRole('menu')
}

const itemNames = () => screen.getAllByRole('menuitem').map((item) => item.textContent)

async function memberOfOneShared(): Promise<{ fakes: Fakes; title: string }> {
  const fakes = createFakes({ signedInAs: THIRD_USER.id, termsAccepted: true })
  setPlan(fakes.store, DEMO_USER.email, 'creator')
  signInAs(fakes.store, DEMO_USER.id)
  const piece = await fakes.data.createPiece({ title: 'Etude', recording: { kind: 'file', file: new File(['x'], 'take.mp3', { type: 'audio/mpeg' }) }, parts: [] })
  const { token } = await shareLinkOn(fakes.data, piece.id)
  signInAs(fakes.store, THIRD_USER.id)
  await fakes.data.joinPiece(token)
  return { fakes, title: 'Etude' }
}

describe('Library: the filters', () => {
  it('has All, Needs review, Ready to practice and Shared with me, in that order', async () => {
    demo()
    await findCards()

    const names = within(screen.getByRole('group', { name: lib.filterLabel }))
      .getAllByRole('button')
      .map((button) => button.textContent)
    expect(names).toEqual([lib.filterAll, lib.filterNeedsReview, lib.filterReady, lib.filterShared])
  })

  it('Ready to practice shows only the pieces that are ready, and not the one still processing', async () => {
    const { user } = demo()
    await findCards()

    await user.click(screen.getByRole('button', { name: lib.filterReady }))

    const cards = await findCards()
    expect(cards.map((card) => card.textContent)).toEqual([expect.stringContaining('Concert March'), expect.stringContaining('Etude No. 4')])
    expect(screen.getByRole('button', { name: lib.filterReady })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('heading', { level: 2, name: lib.myPieces })).toBeInTheDocument()
  })

  it('Shared with me with nothing shared says so, in the empty state, under the heading', async () => {
    const { user } = demo()
    await findCards()

    await user.click(screen.getByRole('button', { name: lib.filterShared }))

    expect(await screen.findByRole('heading', { level: 2, name: lib.sharedWithMe })).toBeInTheDocument()
    expect(screen.getByText(lib.sharedEmptyText)).toBeInTheDocument()
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
    expect(lib.sharedEmptyText).toBe('Nothing has been shared with you yet. When someone sends you a link, the piece shows up here.')
  })

  it('shows the filters to someone who only has shared pieces, and All lists them', async () => {
    const { fakes } = await memberOfOneShared()
    renderWithApp('/library', { fakes })

    expect(await screen.findByRole('group', { name: lib.filterLabel })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: lib.sharedWithMe })).toBeInTheDocument()
  })

  it('the state filters hide the shared section, and Shared with me shows only it', async () => {
    const { fakes } = await memberOfOneShared()
    // The member owns one piece of their own as well.
    setPlan(fakes.store, THIRD_USER.email, 'creator')
    await fakes.data.createPiece({ title: 'Mine', recording: { kind: 'file', file: new File(['x'], 'take.mp3', { type: 'audio/mpeg' }) }, parts: [] })
    const { user } = renderWithApp('/library', { fakes })
    await screen.findByRole('region', { name: lib.sharedWithMe })
    expect(screen.getByRole('region', { name: lib.myPieces })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: lib.filterNeedsReview }))
    expect(screen.queryByRole('region', { name: lib.sharedWithMe })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: lib.filterReady }))
    expect(screen.queryByRole('region', { name: lib.sharedWithMe })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: lib.filterShared }))
    expect(await screen.findByRole('region', { name: lib.sharedWithMe })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: lib.myPieces })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: lib.filterAll }))
    expect(screen.getByRole('region', { name: lib.sharedWithMe })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: lib.myPieces })).toBeInTheDocument()
  })
})

describe('Library: the card menu', () => {
  it('opens beside the card without opening the piece, and offers Rename, Share and Delete in that order', async () => {
    const { user, router } = demo()
    await findCards()

    await openMenu(user, 'Etude No. 4')

    expect(itemNames()).toEqual([lib.menuRename, lib.menuShare, lib.menuDelete])
    expect(screen.getByRole('menuitem', { name: lib.menuDelete }).className).toContain('text-problem')
    expect(router.state.location.pathname).toBe('/library')
  })

  it('is a sibling of the card link, not inside it', async () => {
    demo()
    await findCards()

    const button = await screen.findByRole('button', { name: lib.moreFor('Etude No. 4') })

    expect(cardLink('Etude No. 4')).not.toContainElement(button)
  })

  it('offers only Rename while the piece is processing', async () => {
    const { user } = demo()
    await findCards()

    await openMenu(user, 'Slow Waltz in G')

    expect(itemNames()).toEqual([lib.menuRename])
  })

  it('Rename opens the rename dialog and the card shows the new title', async () => {
    const { user } = demo()
    await findCards()
    await openMenu(user, 'Etude No. 4')

    await user.click(screen.getByRole('menuitem', { name: lib.menuRename }))
    const dialog = await screen.findByRole('dialog', { name: strings.hub.renameTitle })
    const field = within(dialog).getByRole('textbox', { name: strings.hub.renameLabel })
    await user.clear(field)
    await user.type(field, 'Etude No. 5')
    await user.click(within(dialog).getByRole('button', { name: strings.hub.renameSave }))

    expect(await screen.findByRole('link', { name: /Etude No\. 5/ })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Etude No\. 4/ })).not.toBeInTheDocument()
  })

  it('Share opens the share dialog of that piece', async () => {
    const { user } = demo()
    await findCards()
    await openMenu(user, 'Etude No. 4')

    await user.click(screen.getByRole('menuitem', { name: lib.menuShare }))

    const dialog = await screen.findByRole('dialog', { name: strings.share.title })
    expect(await within(dialog).findByLabelText(strings.share.linkLabel)).toBeInTheDocument()
  })

  it('Delete asks first, and then the card is gone and the count drops', async () => {
    const { user, fakes } = demo()
    await findCards()
    await openMenu(user, 'Etude No. 4')

    await user.click(screen.getByRole('menuitem', { name: lib.menuDelete }))
    const dialog = await screen.findByRole('alertdialog', { name: strings.hub.deleteTitle('Etude No. 4') })
    expect(await fakes.data.listPieces()).toHaveLength(5)
    await user.click(within(dialog).getByRole('button', { name: strings.hub.delete }))

    await waitFor(() => expect(screen.queryByRole('link', { name: /Etude No\. 4/ })).not.toBeInTheDocument())
    expect(await fakes.data.listPieces()).toHaveLength(4)
    expect(await screen.findByText(lib.pieceCount(4))).toBeInTheDocument()
  })

  it('Delete works on one piece after another', async () => {
    const { user, fakes } = demo()
    await findCards()

    for (const [title, left] of [['Etude No. 4', 4], ['Concert March', 3]] as const) {
      await openMenu(user, title)
      await user.click(screen.getByRole('menuitem', { name: lib.menuDelete }))
      const dialog = await screen.findByRole('alertdialog', { name: strings.hub.deleteTitle(title) })
      await user.click(within(dialog).getByRole('button', { name: strings.hub.delete }))

      await waitFor(() => expect(screen.queryByRole('link', { name: new RegExp(title) })).not.toBeInTheDocument())
      await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
      expect(await fakes.data.listPieces()).toHaveLength(left)
    }
  })

  it('Delete and Cancel keeps the piece', async () => {
    const { user } = demo()
    await findCards()
    await openMenu(user, 'Etude No. 4')
    await user.click(screen.getByRole('menuitem', { name: lib.menuDelete }))

    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: strings.hub.cancel }))

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(cardLink('Etude No. 4')).toBeInTheDocument()
  })

  it('a member card offers Leave only, asks first with the Leave question, and then the card is gone', async () => {
    const { fakes, title } = await memberOfOneShared()
    const { user } = renderWithApp('/library', { fakes })
    await screen.findByRole('region', { name: lib.sharedWithMe })

    await openMenu(user, title)
    expect(itemNames()).toEqual([lib.menuLeave])
    await user.click(screen.getByRole('menuitem', { name: lib.menuLeave }))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText(strings.hub.leaveQuestion(title))).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: strings.hub.leaveConfirm }))

    await waitFor(() => expect(screen.queryByRole('link', { name: /Etude/ })).not.toBeInTheDocument())
    expect(await fakes.data.listPieces()).toEqual([])
  })

  it('Leave works on one piece after another', async () => {
    const { fakes, title } = await memberOfOneShared()
    signInAs(fakes.store, DEMO_USER.id)
    const second = await fakes.data.createPiece({ title: 'Nocturne', recording: { kind: 'file', file: new File(['x'], 'take.mp3', { type: 'audio/mpeg' }) }, parts: [] })
    const { token } = await shareLinkOn(fakes.data, second.id)
    signInAs(fakes.store, THIRD_USER.id)
    await fakes.data.joinPiece(token)
    const { user } = renderWithApp('/library', { fakes })
    await screen.findByRole('region', { name: lib.sharedWithMe })

    for (const leaving of [title, 'Nocturne']) {
      await openMenu(user, leaving)
      await user.click(screen.getByRole('menuitem', { name: lib.menuLeave }))
      const dialog = await screen.findByRole('alertdialog')
      expect(within(dialog).getByText(strings.hub.leaveQuestion(leaving))).toBeInTheDocument()
      await user.click(within(dialog).getByRole('button', { name: strings.hub.leaveConfirm }))

      await waitFor(() => expect(screen.queryByRole('link', { name: new RegExp(leaving) })).not.toBeInTheDocument())
      await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    }
    expect(await fakes.data.listPieces()).toEqual([])
  })
})

describe('Library: Cards and List', () => {
  const pressed = (name: string) => screen.getByRole('button', { name })

  it('has a Cards / List switch with Cards pressed at first', async () => {
    demo()
    await findCards()

    const group = screen.getByRole('group', { name: lib.viewLabel })
    expect(within(group).getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual([lib.viewCards, lib.viewList])
    expect(pressed(lib.viewCards)).toHaveAttribute('aria-pressed', 'true')
    expect(pressed(lib.viewList)).toHaveAttribute('aria-pressed', 'false')
  })

  it('List puts every piece on its own row, and Cards puts them back in the grid', async () => {
    const { user } = demo()
    const grid = (await screen.findByRole('list')).className
    expect(grid).toContain('md:grid-cols-2')

    await user.click(pressed(lib.viewList))

    expect(screen.getByRole('list').className).not.toContain('md:grid-cols-')
    expect(pressed(lib.viewList)).toHaveAttribute('aria-pressed', 'true')
    expect((await findCards()).length).toBe(5)

    await user.click(pressed(lib.viewCards))
    expect(screen.getByRole('list').className).toContain('md:grid-cols-2')
  })

  it('keeps the choice in the user\'s settings, and a new visit starts with it', async () => {
    const first = demo()
    await findCards()
    await first.user.click(pressed(lib.viewList))

    await waitFor(async () => expect((await first.fakes.data.getProfile()).settings.libraryView).toBe('list'))
    first.unmount()
    renderWithApp('/library', { fakes: first.fakes })
    await findCards()

    expect(pressed(lib.viewList)).toHaveAttribute('aria-pressed', 'true')
  })

  it('has the switch in the heading of the first section, and the same menus in the list view', async () => {
    const { user } = demo()
    await findCards()
    await user.click(pressed(lib.viewList))

    const section = screen.getByRole('region', { name: lib.myPieces })
    expect(within(section).getByRole('group', { name: lib.viewLabel })).toBeInTheDocument()
    expect(within(section).getAllByRole('button', { name: /^More for / })).toHaveLength(5)
  })
})
