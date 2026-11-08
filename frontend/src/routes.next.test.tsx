import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { createFakes } from '@/lib/fakes'
import { signInAs, DEMO_USER } from '@/lib/fakes/store'
import { strings } from '@/strings'
import { renderWithApp } from '@/test/render'
import { shareLinkOn } from '@/test/shareLink'

describe('the terms gate and the return path', () => {
  it('a signed-out visitor to a join link goes through landing, sign-in and terms, and ends on the join page', async () => {
    const fakes = createFakes()
    signInAs(fakes.store, DEMO_USER.id)
    const piece = await fakes.data.createPiece({ title: 'Etude', recording: { kind: 'file', file: new File(['x'], 'take.mp3', { type: 'audio/mpeg' }) }, parts: [] })
    const { token } = await shareLinkOn(fakes.data, piece.id)
    fakes.store.currentUserId = null

    const { user, router } = renderWithApp(`/join/${token}`, { fakes })
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
    expect(router.state.location.search).toBe(`?next=${encodeURIComponent(`/join/${token}`)}`)

    // The demo user signs in, who owns the piece: the gate first, then the hub through the join page.
    await user.click((await screen.findByRole('button', { name: strings.landing.signInOrUp })))
    await waitFor(() => expect(router.state.location.pathname).toBe('/terms'))
    expect(router.state.location.search).toContain('next=')
    await user.click(await screen.findByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: strings.terms.accept }))
    await waitFor(() => expect(router.state.location.pathname).toBe(`/pieces/${piece.id}`))
  })

  it('sign-in hands a safe next to the data client, and a hostile one is dropped', async () => {
    const safe = renderWithApp('/?next=/join/abc')
    const signIn = vi.spyOn(safe.fakes.data, 'signInWithGoogle')
    await safe.user.click((await screen.findByRole('button', { name: strings.landing.signInOrUp })))
    expect(signIn).toHaveBeenCalledWith('/join/abc')
    safe.unmount()

    const hostile = renderWithApp('/?next=//evil.com')
    const hostileSignIn = vi.spyOn(hostile.fakes.data, 'signInWithGoogle')
    await hostile.user.click((await screen.findByRole('button', { name: strings.landing.signInOrUp })))
    expect(hostileSignIn).toHaveBeenCalledWith(null)
  })

  it('an older terms version opens the gate again', async () => {
    const fakes = createFakes({ seed: 'demo' })
    fakes.store.profiles.get(DEMO_USER.id)!.acceptedTermsVersion = '2020-01-01'
    const { router } = renderWithApp('/library', { fakes })
    await waitFor(() => expect(router.state.location.pathname).toBe('/terms'))
  })

  it('a hostile next is ignored', async () => {
    const fakes = createFakes({ signedIn: true })
    const { user, router } = renderWithApp('/terms?next=//evil.com', { fakes })
    await user.click(await screen.findByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: strings.terms.accept }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/library'))
  })

  it('a next that is not a join path is not carried by a guard', async () => {
    const fakes = createFakes()
    const { router } = renderWithApp('/settings', { fakes })
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
    expect(router.state.location.search).toBe('')
  })
})

describe('the agreement', () => {
  it('a visitor can read every section and the version line', async () => {
    renderWithApp('/terms')
    const box = await screen.findByRole('region', { name: strings.terms.boxLabel })
    expect(within(box).getByText(strings.terms.versionLine)).toBeInTheDocument()
    for (const section of strings.terms.sections) {
      expect(within(box).getByText(section.heading)).toBeInTheDocument()
      for (const text of section.blocks.flat()) expect(within(box).getByText(text)).toBeInTheDocument()
    }
    expect(strings.terms.sections).toHaveLength(15)
  })
})
