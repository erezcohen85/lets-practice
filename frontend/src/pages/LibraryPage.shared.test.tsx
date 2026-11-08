import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { createFakes, type Fakes } from '@/lib/fakes'
import { DEMO_USER, OTHER_USER, setPlan, setPlanLimits, signInAs, THIRD_USER } from '@/lib/fakes/store'
import { strings } from '@/strings'
import { renderWithApp } from '@/test/render'
import { shareLinkOn } from '@/test/shareLink'

const YT = { kind: 'file', file: new File(['x'], 'take.mp3', { type: 'audio/mpeg' }) } as const

async function shareFrom(fakes: Fakes, ownerId: string, ownerEmail: string, title: string, viewerId: string) {
  setPlan(fakes.store, ownerEmail, 'creator')
  signInAs(fakes.store, ownerId)
  const piece = await fakes.data.createPiece({
    title,
    recording: YT,
    parts: [],
  })
  const { token } = await shareLinkOn(fakes.data, piece.id)
  signInAs(fakes.store, viewerId)
  await fakes.data.joinPiece(token)
  return piece
}

function member(): Fakes {
  const fakes = createFakes({ signedInAs: THIRD_USER.id, termsAccepted: true })
  return fakes
}

describe('Library with shared pieces', () => {
  it('hides Shared with me when it is empty', async () => {
    renderWithApp('/library', { seed: 'demo' })
    await screen.findByText(strings.library.myPieces)
    // The words are also a filter's name, so the section itself is looked for.
    expect(screen.queryByRole('region', { name: strings.library.sharedWithMe })).not.toBeInTheDocument()
  })

  it('one owner: a card with who shared it, no review status, and no chips', async () => {
    const fakes = member()
    await shareFrom(fakes, DEMO_USER.id, DEMO_USER.email, 'Etude', THIRD_USER.id)
    renderWithApp('/library', { fakes })
    const section = await screen.findByRole('region', {
      name: strings.library.sharedWithMe,
    })
    expect(within(section).getByText('Etude')).toBeInTheDocument()
    expect(within(section).getByText(strings.library.sharedBy(DEMO_USER.name))).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: strings.library.ownerFilterLabel })).not.toBeInTheDocument()
    expect(screen.queryByText(strings.library.myPieces)).not.toBeInTheDocument()
  })

  it('a piece being processed shows Being prepared and links to the hub', async () => {
    const fakes = member()
    const piece = await shareFrom(fakes, DEMO_USER.id, DEMO_USER.email, 'Etude', THIRD_USER.id)
    signInAs(fakes.store, DEMO_USER.id)
    await fakes.processor.processPiece(piece.id)
    signInAs(fakes.store, THIRD_USER.id)
    renderWithApp('/library', { fakes })
    expect(await screen.findByText(strings.library.beingPrepared)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Etude/ })).toHaveAttribute('href', `/pieces/${piece.id}`)
  })

  it('two owners: chips filter the list and combine with search', async () => {
    const fakes = member()
    await shareFrom(fakes, DEMO_USER.id, DEMO_USER.email, 'Etude', THIRD_USER.id)
    await shareFrom(fakes, OTHER_USER.id, OTHER_USER.email, 'Waltz', THIRD_USER.id)
    await shareFrom(fakes, OTHER_USER.id, OTHER_USER.email, 'Etude', THIRD_USER.id)
    const { user } = renderWithApp('/library', { fakes })
    const chips = await screen.findByRole('group', {
      name: strings.library.ownerFilterLabel,
    })
    expect(
      within(chips)
        .getAllByRole('button')
        .map((chip) => chip.textContent),
    ).toEqual([strings.library.ownerAll, DEMO_USER.name, OTHER_USER.name])

    expect(screen.getAllByText('Etude')).toHaveLength(2) // the same music from two owners is two cards
    await user.click(within(chips).getByRole('button', { name: OTHER_USER.name }))
    expect(screen.getByText('Waltz')).toBeInTheDocument()
    expect(screen.getAllByText('Etude')).toHaveLength(1)

    await user.type(screen.getByLabelText(strings.library.searchLabel), 'waltz')
    expect(screen.getByText('Waltz')).toBeInTheDocument()
    expect(screen.queryByText('Etude')).not.toBeInTheDocument()
  })
})

describe('Library with a piece the member is on hold for', () => {
  /** The demo user's Etude, joined by OTHER and then THIRD; its limit then goes down to one, so THIRD (signed in) is on hold. */
  async function heldEtude(fakes: Fakes) {
    signInAs(fakes.store, DEMO_USER.id)
    const piece = await fakes.data.createPiece({ title: 'Etude', recording: YT, parts: [] })
    const { token } = await shareLinkOn(fakes.data, piece.id)
    for (const person of [OTHER_USER, THIRD_USER]) {
      signInAs(fakes.store, person.id)
      await fakes.data.joinPiece(token)
    }
    signInAs(fakes.store, DEMO_USER.id)
    setPlanLimits(fakes.store, 'unlimited', { members_per_piece: 1, members_per_part: 0 }) // the demo user is the admin
    signInAs(fakes.store, THIRD_USER.id)
    return piece
  }

  it('shows it in Shared with me as a card that cannot be opened, saying it is on hold and who shared it', async () => {
    const fakes = member()
    await heldEtude(fakes)
    renderWithApp('/library', { fakes })

    const section = await screen.findByRole('region', { name: strings.library.sharedWithMe })
    const card = within(section).getByText('Etude').closest('li')!
    expect(within(card).getByText(strings.library.onHold)).toBeInTheDocument()
    expect(within(card).getByText(strings.library.sharedBy(DEMO_USER.name))).toBeInTheDocument()
    expect(within(card).queryByRole('link')).not.toBeInTheDocument()
    expect(screen.getByText(strings.library.pieceCount(1))).toBeInTheDocument()
  })

  it('with only a held piece, the Library is not empty and Shared with me shows it', async () => {
    const fakes = member()
    await heldEtude(fakes)
    const { user } = renderWithApp('/library', { fakes })

    expect(await screen.findByText(strings.library.onHold)).toBeInTheDocument()
    expect(screen.queryByText(strings.library.emptyTitle)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: strings.library.filterShared }))
    expect(screen.getByText(strings.library.onHold)).toBeInTheDocument()
    expect(screen.queryByText(strings.library.sharedEmptyText)).not.toBeInTheDocument()
  })

  it('its owner gets a chip like any other; the chips and the search narrow it too', async () => {
    const fakes = member()
    await heldEtude(fakes)
    await shareFrom(fakes, OTHER_USER.id, OTHER_USER.email, 'Waltz', THIRD_USER.id)
    const { user } = renderWithApp('/library', { fakes })
    const chips = await screen.findByRole('group', { name: strings.library.ownerFilterLabel })
    expect(within(chips).getAllByRole('button').map((chip) => chip.textContent)).toEqual([strings.library.ownerAll, DEMO_USER.name, OTHER_USER.name])

    await user.click(within(chips).getByRole('button', { name: OTHER_USER.name }))
    expect(screen.getByText('Waltz')).toBeInTheDocument()
    expect(screen.queryByText('Etude')).not.toBeInTheDocument()

    await user.click(within(chips).getByRole('button', { name: DEMO_USER.name }))
    expect(screen.getByText('Etude')).toBeInTheDocument()
    expect(screen.queryByText('Waltz')).not.toBeInTheDocument()

    await user.click(within(chips).getByRole('button', { name: strings.library.ownerAll }))
    await user.type(screen.getByLabelText(strings.library.searchLabel), 'etu')
    expect(screen.getByText('Etude')).toBeInTheDocument()
    expect(screen.queryByText('Waltz')).not.toBeInTheDocument()
  })

  it('the two state filters hide it, as they hide every shared piece', async () => {
    const fakes = member()
    await heldEtude(fakes)
    const { user } = renderWithApp('/library', { fakes })
    await screen.findByText(strings.library.onHold)

    await user.click(screen.getByRole('button', { name: strings.library.filterReady }))
    expect(screen.queryByText(strings.library.onHold)).not.toBeInTheDocument()
  })

  it('can be left from its menu, and is then gone', async () => {
    const fakes = member()
    const piece = await heldEtude(fakes)
    const { user } = renderWithApp('/library', { fakes })
    await screen.findByText(strings.library.onHold)

    await user.click(screen.getByRole('button', { name: strings.library.moreFor('Etude') }))
    await user.click(await screen.findByRole('menuitem', { name: strings.library.menuLeave }))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText(strings.hub.leaveQuestion('Etude'))).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: strings.hub.leaveConfirm }))

    await waitFor(() => expect(screen.queryByText(strings.library.onHold)).not.toBeInTheDocument())
    expect(fakes.store.members.get(piece.id)?.has(THIRD_USER.id)).toBe(false)
  })

  it('when the held pieces cannot be read, the rest of the Library still shows', async () => {
    const fakes = member()
    await heldEtude(fakes)
    await shareFrom(fakes, OTHER_USER.id, OTHER_USER.email, 'Waltz', THIRD_USER.id)
    vi.spyOn(fakes.data, 'listHeldPieces').mockRejectedValue(new Error('offline'))
    renderWithApp('/library', { fakes })

    expect(await screen.findByText('Waltz')).toBeInTheDocument()
    expect(screen.queryByText(strings.library.errorTitle)).not.toBeInTheDocument()
  })
})
