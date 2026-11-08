import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { createFakes } from '@/lib/fakes'
import { OTHER_USER, setPlan, setPlanLimits } from '@/lib/fakes/store'
import { strings } from '@/strings'
import { renderWithApp } from '@/test/render'
import { trialFakes } from '@/test/planFixtures'

// The Library on a plan: the usage line, and the New piece click that asks the plan first (plans and limits, Task 5).

const p = strings.plans
const newPiece = () => screen.findByRole('link', { name: strings.library.newPiece })

describe('Library: the usage line', () => {
  it('says how many of the Trial pieces are used, and where to get more', async () => {
    renderWithApp('/library', { fakes: await trialFakes(2) })
    expect(await screen.findByText(p.usedLine(2, 3, 'Trial'))).toBeInTheDocument()
    expect(p.usedLine(2, 3, 'Trial')).toBe('2 of 3 trial pieces used.')
    expect(screen.getByText(p.upgrade)).toBeInTheDocument()
  })

  it('has no line on a plan without a limit on pieces made', async () => {
    const fakes = await trialFakes(2)
    setPlan(fakes.store, OTHER_USER.email, 'unlimited')
    renderWithApp('/library', { fakes })
    await newPiece()
    expect(screen.queryByText(/pieces used\./)).not.toBeInTheDocument()
    expect(screen.queryByText(p.upgrade)).not.toBeInTheDocument()
  })

  it('has no line for the admin', async () => {
    renderWithApp('/library', { seed: 'demo' })
    await newPiece()
    expect(screen.queryByText(/pieces used\./)).not.toBeInTheDocument()
    expect(screen.queryByText(p.upgrade)).not.toBeInTheDocument()
  })

  it('shows the line when the library is empty, beside the New piece in the empty state', async () => {
    renderWithApp('/library', { fakes: await trialFakes(0) })
    expect(await screen.findByText(p.usedLine(0, 3, 'Trial'))).toBeInTheDocument()
  })
})

describe('Library: New piece asks the plan', () => {
  it('opens the form while the plan has room', async () => {
    const { user, router } = renderWithApp('/library', { fakes: await trialFakes(2) })
    await user.click(await newPiece())
    await waitFor(() => expect(router.state.location.pathname).toBe('/pieces/new'))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('opens the prompt with the sentence, and stays on the Library, when the pieces made are used up', async () => {
    const { user, router } = renderWithApp('/library', { fakes: await trialFakes(3) })
    expect(await screen.findByText(p.usedLine(3, 3, 'Trial'))).toBeInTheDocument()

    await user.click(await newPiece())

    const prompt = await screen.findByRole('alertdialog')
    expect(within(prompt).getByText(p.promptTitle('pieces_created_max', 'Trial'))).toBeInTheDocument()
    expect(within(prompt).getByText(/includes 3 pieces, and you have made all 3/)).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/library')
    await user.click(within(prompt).getByRole('button', { name: p.ok }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  })

  it('names the pause when new pieces are paused for the plan', async () => {
    const fakes = await trialFakes(1)
    setPlanLimits(fakes.store, 'trial', { new_pieces_paused: true })
    const { user, router } = renderWithApp('/library', { fakes })
    await user.click(await newPiece())
    const prompt = await screen.findByRole('alertdialog')
    expect(within(prompt).getByText(p.promptTitle('new_pieces_paused', 'Trial'))).toBeInTheDocument()
    expect(within(prompt).getByText(/New pieces are paused for Trial/)).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/library')
  })

  it('the New piece of the empty state asks too', async () => {
    const fakes = createFakes({ signedInAs: OTHER_USER.id, termsAccepted: true })
    setPlanLimits(fakes.store, 'trial', { pieces_created_max: 0 })
    const { user, router } = renderWithApp('/library', { fakes })
    await user.click(await newPiece())
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/library')
  })

  it('lets the admin through whatever the plan says', async () => {
    const fakes = createFakes({ seed: 'demo' })
    setPlanLimits(fakes.store, 'unlimited', { new_pieces_paused: true })
    const { user, router } = renderWithApp('/library', { fakes })
    await user.click(await newPiece())
    await waitFor(() => expect(router.state.location.pathname).toBe('/pieces/new'))
  })
})

describe('Library: Delete on a plan that counts pieces made', () => {
  async function askDelete() {
    const fakes = await trialFakes(3)
    const view = renderWithApp('/library', { fakes })
    await view.user.click(await screen.findByRole('button', { name: strings.library.moreFor('Etude 2') }))
    await view.user.click(await screen.findByRole('menuitem', { name: strings.library.menuDelete }))
    return { ...view, dialog: await screen.findByRole('alertdialog') }
  }

  it('keeps its question and adds that the count does not go down', async () => {
    const { dialog } = await askDelete()
    expect(within(dialog).getByText(strings.hub.deleteText)).toBeInTheDocument()
    expect(within(dialog).getByText(p.deleteNote('Trial', 3, 3))).toBeInTheDocument()
  })

  it('frees the stored slot and not the made one: the line still says 3 of 3 after the delete', async () => {
    const { user, dialog, fakes } = await askDelete()
    await user.click(within(dialog).getByRole('button', { name: strings.hub.delete }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    await waitFor(() => expect(screen.queryByRole('link', { name: /Etude 2/ })).not.toBeInTheDocument())
    expect(await screen.findByText(p.usedLine(3, 3, 'Trial'))).toBeInTheDocument()
    expect((await fakes.data.myPlan()).usage).toMatchObject({ pieces_created: 3, pieces_stored: 2 })
  })

  it('has no such note for the admin', async () => {
    const { user } = renderWithApp('/library', { seed: 'demo' })
    await user.click(await screen.findByRole('button', { name: strings.library.moreFor('Concert March') }))
    await user.click(await screen.findByRole('menuitem', { name: strings.library.menuDelete }))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).queryByText(/don't come back/)).not.toBeInTheDocument()
  })
})
