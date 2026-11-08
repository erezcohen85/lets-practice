import { screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { createFakes, type Fakes } from '@/lib/fakes'
import { DEMO_USER, OTHER_USER, setPlanLimits, signInAs, THIRD_USER } from '@/lib/fakes/store'
import { strings } from '@/strings'
import { renderWithApp } from '@/test/render'
import { TERMS_VERSION } from '@/domain/terms'
import { shareLinkOn } from '@/test/shareLink'

async function shared(): Promise<{
  fakes: Fakes
  pieceId: string
  token: string
}> {
  const fakes = createFakes({ termsAccepted: false })
  signInAs(fakes.store, DEMO_USER.id)
  const piece = await fakes.data.createPiece({
    title: 'Etude',
    recording: { kind: 'file', file: new File(['x'], 'take.mp3', { type: 'audio/mpeg' }) },
    parts: [],
  })
  const { token } = await shareLinkOn(fakes.data, piece.id)
  for (const profile of fakes.store.profiles.values()) {
    profile.acceptedTermsAt = '2026-11-03T00:00:00Z'
    profile.acceptedTermsVersion = TERMS_VERSION
  }
  return { fakes, pieceId: piece.id, token }
}

describe('JoinPage', () => {
  it('joined: goes to the hub with the note', async () => {
    const { fakes, pieceId, token } = await shared()
    signInAs(fakes.store, OTHER_USER.id)
    const { router } = renderWithApp(`/join/${token}`, { fakes })
    await waitFor(() => expect(router.state.location.pathname).toBe(`/pieces/${pieceId}`))
    expect(router.state.location.state).toEqual({ joined: true })
  })
  it('owner and already_member: the hub, no note', async () => {
    const { fakes, pieceId, token } = await shared()
    const { router } = renderWithApp(`/join/${token}`, { fakes })
    await waitFor(() => expect(router.state.location.pathname).toBe(`/pieces/${pieceId}`))
    expect(router.state.location.state).toBeNull()
  })
  it('link_off and not_found say so', async () => {
    const { fakes, pieceId, token } = await shared()
    await fakes.data.setShareEnabled(pieceId, false)
    signInAs(fakes.store, THIRD_USER.id)
    renderWithApp(`/join/${token}`, { fakes })
    expect(await screen.findByText(strings.join.linkOff)).toBeInTheDocument()
  })
  it('an unknown token says so', async () => {
    const { fakes } = await shared()
    renderWithApp('/join/nope', { fakes })
    expect(await screen.findByText(strings.join.notFound)).toBeInTheDocument()
  })
  it('full says so, and adds nobody', async () => {
    const { fakes, pieceId, token } = await shared()
    setPlanLimits(fakes.store, 'unlimited', { members_per_piece: 1, members_per_part: 0 }) // the demo user is the admin
    signInAs(fakes.store, OTHER_USER.id)
    await fakes.data.joinPiece(token)
    signInAs(fakes.store, THIRD_USER.id)

    const { router } = renderWithApp(`/join/${token}`, { fakes })

    expect(await screen.findByText(strings.join.full)).toBeInTheDocument()
    expect(router.state.location.pathname).toBe(`/join/${token}`)
    expect(fakes.store.members.get(pieceId)?.has(THIRD_USER.id)).toBe(false)
  })
  it('a member on hold who opens the link again is told so, not sent to a piece they cannot open', async () => {
    const { fakes, token } = await shared()
        for (const user of [OTHER_USER, THIRD_USER]) {
      signInAs(fakes.store, user.id)
      await fakes.data.joinPiece(token)
    }
    signInAs(fakes.store, DEMO_USER.id)
    setPlanLimits(fakes.store, 'unlimited', { members_per_piece: 1, members_per_part: 0 }) // the demo user is the admin
    signInAs(fakes.store, THIRD_USER.id)

    const { router } = renderWithApp(`/join/${token}`, { fakes })

    expect(await screen.findByText(strings.join.onHold)).toBeInTheDocument()
    expect(router.state.location.pathname).toBe(`/join/${token}`)
  })
  it('a second link opened on the same mounted page joins again', async () => {
    const { fakes, pieceId, token } = await shared()
    signInAs(fakes.store, OTHER_USER.id)
    const { router } = renderWithApp('/join/nope', { fakes })
    expect(await screen.findByText(strings.join.notFound)).toBeInTheDocument()
    await router.navigate(`/join/${token}`)
    await waitFor(() => expect(router.state.location.pathname).toBe(`/pieces/${pieceId}`))
    expect(router.state.location.state).toEqual({ joined: true })
  })
})
