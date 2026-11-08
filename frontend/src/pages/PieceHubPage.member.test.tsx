import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { createFakes, type Fakes } from '@/lib/fakes'
import { addJob, DEMO_USER, latestJobOf, setPlan, OTHER_USER, signInAs } from '@/lib/fakes/store'
import { strings } from '@/strings'
import { renderWithApp } from '@/test/render'
import { TERMS_VERSION } from '@/domain/terms'
import { shareLinkOn } from '@/test/shareLink'

/** The demo seed's first ready piece, joined by the other user, signed in as them. */
async function asMember(): Promise<{ fakes: Fakes; pieceId: string; title: string }> {
  const fakes = createFakes({ seed: 'demo' })
  const list = await fakes.data.listPieces()
  const ready = list.find((piece) => piece.job?.status === 'done' && piece.partCount > 0)!
  const { token } = await shareLinkOn(fakes.data, ready.id)
  signInAs(fakes.store, OTHER_USER.id)
  const profile = fakes.store.profiles.get(OTHER_USER.id)!
  profile.acceptedTermsAt = '2026-11-03T00:00:00Z'
  profile.acceptedTermsVersion = TERMS_VERSION
  await fakes.data.joinPiece(token)
  return { fakes, pieceId: ready.id, title: ready.title }
}

/** The calls that change the piece itself: a member's visit must never make one. */
function spyOnOwnerWrites({ data, processor }: Fakes) {
  return [
    vi.spyOn(data, 'saveTiming'),
    vi.spyOn(data, 'savePageLayer'),
    vi.spyOn(data, 'saveStructureSetAt'),
    vi.spyOn(data, 'renamePiece'),
    vi.spyOn(data, 'renamePart'),
    vi.spyOn(data, 'renameRecording'),
    vi.spyOn(data, 'deletePiece'),
    vi.spyOn(data, 'deletePart'),
    vi.spyOn(data, 'storeParts'),
    vi.spyOn(processor, 'processPiece'),
    vi.spyOn(processor, 'realign'),
    vi.spyOn(processor, 'addParts'),
    vi.spyOn(processor, 'reprocessPart'),
  ]
}

describe('the hub for a member', () => {
  it('shows the title, who shared it, the recording, Practice per part and Leave', async () => {
    const { fakes, pieceId, title } = await asMember()
    renderWithApp(`/pieces/${pieceId}`, { fakes })
    expect(await screen.findByRole('heading', { name: title })).toBeInTheDocument()
    expect(screen.getByText(strings.hub.sharedBy(DEMO_USER.name))).toBeInTheDocument()
    expect(screen.getByRole('button', { name: strings.hub.leave })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: strings.hub.recording })).toBeInTheDocument()
    const part = (await fakes.data.getPiece(pieceId))!.parts[0]!
    const practice = screen.getByRole('link', { name: strings.hub.practicePart(part.name) })
    expect(practice).toHaveAttribute('href', `/pieces/${pieceId}/practice?part=${part.id}`)
    // The same icon-only teal button as the owner's rows.
    expect(practice).toHaveAttribute('title', strings.hub.practice)
    expect(practice).toHaveTextContent('')
    expect(practice).toHaveClass('size-11', 'text-primary-strong', 'border-primary-strong')
    // One Practice link beside the title, not stretched into a grid.
    const big = screen.getByRole('link', { name: strings.hub.practice })
    expect(big.closest('.grid')).toBeNull()
    expect(big).toHaveClass('shrink-0')
  })

  it('hides every owner control', async () => {
    const { fakes, pieceId, title } = await asMember()
    renderWithApp(`/pieces/${pieceId}`, { fakes })
    await screen.findByRole('heading', { name: title })
    for (const name of [strings.hub.editMap, strings.hub.edit, strings.hub.rename, strings.hub.delete, strings.hub.addPart, strings.hub.shareButton]) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument()
      expect(screen.queryByRole('link', { name })).not.toBeInTheDocument()
    }
    const part = (await fakes.data.getPiece(pieceId))!.parts[0]!
    expect(screen.queryByRole('link', { name: strings.hub.editPart(part.name) })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: strings.hub.renamePart(part.name) })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: strings.hub.renameRecording })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: strings.partReprocess.reprocess(part.name) })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: strings.partDelete.delete(part.name) })).not.toBeInTheDocument()
    expect(screen.queryByText(/checked/i)).not.toBeInTheDocument()
    // No three-dot menus: nothing in them is a member's to do.
    expect(screen.queryByRole('button', { name: /^More for / })).not.toBeInTheDocument()
  })

  it('shows the note once after joining', async () => {
    const { fakes, pieceId } = await asMember()
    const { router } = renderWithApp('/library', { fakes })
    await router.navigate(`/pieces/${pieceId}`, { state: { joined: true } })
    expect(await screen.findByText(strings.hub.joinedNote)).toBeInTheDocument()
  })

  it('shows no note when the hub is opened any other way', async () => {
    const { fakes, pieceId, title } = await asMember()
    renderWithApp(`/pieces/${pieceId}`, { fakes })
    await screen.findByRole('heading', { name: title })
    expect(screen.queryByText(strings.hub.joinedNote)).not.toBeInTheDocument()
  })

  it('Leave asks first, then goes to the library', async () => {
    const { fakes, pieceId, title } = await asMember()
    const { user, router } = renderWithApp(`/pieces/${pieceId}`, { fakes })
    await user.click(await screen.findByRole('button', { name: strings.hub.leave }))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText(strings.hub.leaveQuestion(title))).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: strings.hub.leaveConfirm }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/library'))
    expect(await fakes.data.getPiece(pieceId)).toBeNull()
  })

  it('Leave can be cancelled, and a failure is said in the dialog which stays open', async () => {
    const { fakes, pieceId, title } = await asMember()
    const { user, router } = renderWithApp(`/pieces/${pieceId}`, { fakes })
    await user.click(await screen.findByRole('button', { name: strings.hub.leave }))
    let dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: strings.hub.leaveCancel }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(router.state.location.pathname).toBe(`/pieces/${pieceId}`)

    vi.spyOn(fakes.data, 'leavePiece').mockRejectedValueOnce(new Error('offline'))
    await user.click(screen.getByRole('button', { name: strings.hub.leave }))
    dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: strings.hub.leaveConfirm }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(strings.hub.leaveFailed)
    expect(router.state.location.pathname).toBe(`/pieces/${pieceId}`)
    // Behind the open dialog, so hidden from the accessibility tree.
    expect(screen.getByRole('heading', { name: title, hidden: true })).toBeInTheDocument()
  })

  it('shows Being prepared while the first read is running, with no way to the processing screen', async () => {
    const { fakes, pieceId } = await asMember()
    signInAs(fakes.store, DEMO_USER.id)
    await fakes.processor.processPiece(pieceId)
    expect(latestJobOf(fakes.store, pieceId)!.job.kind).toBe('process-piece')
    signInAs(fakes.store, OTHER_USER.id)
    const { router } = renderWithApp(`/pieces/${pieceId}/processing`, { fakes })
    await waitFor(() => expect(router.state.location.pathname).toBe(`/pieces/${pieceId}`))
    expect(await screen.findByText(strings.hub.beingPreparedTitle)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: strings.hub.practice })).not.toBeInTheDocument()
    expect(router.state.location.pathname).toBe(`/pieces/${pieceId}`)
  })

  it.each([
    ['running', (fakes: Fakes, pieceId: string) => void addJob(fakes.store, pieceId, 'realign', 1)],
    [
      'failed',
      (fakes: Fakes, pieceId: string) => {
        addJob(fakes.store, pieceId, 'realign', 1).job.status = 'error'
      },
    ],
  ])('a %s realign leaves the piece practisable: Practice, no Being prepared', async (_name, setUp) => {
    const { fakes, pieceId, title } = await asMember()
    setUp(fakes, pieceId)
    const { router } = renderWithApp(`/pieces/${pieceId}`, { fakes })
    await screen.findByRole('heading', { name: title })
    expect(screen.getByRole('link', { name: strings.hub.practice })).toBeInTheDocument()
    expect(screen.queryByText(strings.hub.beingPreparedTitle)).not.toBeInTheDocument()
    expect(router.state.location.pathname).toBe(`/pieces/${pieceId}`)
  })
})

describe('other routes for a member', () => {
  it('/edit redirects to Practice before the editor saves anything', async () => {
    const { fakes, pieceId } = await asMember()
    const writes = spyOnOwnerWrites(fakes)
    const { router } = renderWithApp(`/pieces/${pieceId}/edit`, { fakes })
    await waitFor(() => expect(router.state.location.pathname).toBe(`/pieces/${pieceId}/practice`))
    await screen.findByText(strings.practice.pieceHub)
    for (const write of writes) expect(write).not.toHaveBeenCalled()
  })

  it('Practice has no Edit map, and writes only the member\'s own memory', async () => {
    const { fakes, pieceId } = await asMember()
    const writes = spyOnOwnerWrites(fakes)
    const setLastPart = vi.spyOn(fakes.data, 'setLastPart')
    renderWithApp(`/pieces/${pieceId}/practice`, { fakes })
    await screen.findByText(strings.practice.pieceHub)
    await waitFor(() => expect(setLastPart).toHaveBeenCalled())
    expect(screen.queryByRole('group', { name: strings.common.viewSwitch })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: strings.common.viewEdit })).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    for (const write of writes) expect(write).not.toHaveBeenCalled()
  })

  it('Practice opens while the owner realigns, instead of bouncing to the hub', async () => {
    const { fakes, pieceId } = await asMember()
    addJob(fakes.store, pieceId, 'realign', 1)
    const { router } = renderWithApp(`/pieces/${pieceId}/practice`, { fakes })
    await screen.findByRole('heading', { level: 1 })
    expect(router.state.location.pathname).toBe(`/pieces/${pieceId}/practice`)
    expect(screen.queryByRole('group', { name: strings.common.viewSwitch })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: strings.common.viewEdit })).not.toBeInTheDocument()
  })

  it('a stranger sees not found', async () => {
    const { fakes, pieceId } = await asMember()
    await fakes.data.leavePiece(pieceId)
    renderWithApp(`/pieces/${pieceId}`, { fakes })
    expect(await screen.findByText(strings.common.notFoundTitle)).toBeInTheDocument()
  })
})

describe('the hub for an owner on a smaller plan', () => {
  it('keeps + Add part and Reprocess: the plan refuses at the click, not by hiding them (task 5 draws the prompt)', async () => {
    const fakes = createFakes({ signedInAs: OTHER_USER.id, termsAccepted: true })
    setPlan(fakes.store, OTHER_USER.email, 'creator')
    const piece = await fakes.data.createPiece({
      title: 'Mine',
      recording: { kind: 'file', file: new File(['x'], 'take.mp3', { type: 'audio/mpeg' }) },
      parts: [{ file: new File(['x'], 'a.pdf'), name: 'A' }],
    })
    await fakes.processor.processPiece(piece.id)
    for (let read = 0; read < 12; read += 1) await fakes.data.getPiece(piece.id) // the fake's job moves on when read
    expect(latestJobOf(fakes.store, piece.id)!.job.status).toBe('done')
    fakes.store.planEmails.clear()
    renderWithApp(`/pieces/${piece.id}`, { fakes })
    await screen.findByRole('heading', { name: 'Mine' })
    expect(screen.getByRole('button', { name: strings.hub.addPart })).toBeInTheDocument()
  })
})
