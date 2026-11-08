import { screen, waitFor, within } from '@testing-library/react'
import { TERMS_VERSION } from '@/domain/terms'
import { createFakes, type Fakes } from '@/lib/fakes'
import { DEMO_USER, setPlan, OTHER_USER, signInAs } from '@/lib/fakes/store'
import { type Job } from '@/domain/types'
import { strings } from '@/strings'
import { renderWithApp } from '@/test/render'
import { shareLinkOn } from '@/test/shareLink'

const text = strings.settings
const del = text.deleteAccountDialog

const pathNow = (router: { state: { location: { pathname: string } } }) => router.state.location.pathname
const pdf = new File(['x'], 'a.pdf', { type: 'application/pdf' })
const newPiece = (title: string) => ({ title, recording: { kind: 'file' as const, file: new File(['x'], 'take.mp3', { type: 'audio/mpeg' }) }, parts: [{ file: pdf, name: 'A' }] })

/** OTHER_USER (not the admin) is signed in, owns two pieces and has joined one of the demo user's. */
async function memberWithPieces() {
  const fakes = createFakes({ termsAccepted: true })
  signInAs(fakes.store, DEMO_USER.id)
  const shared = await fakes.data.createPiece(newPiece('Shared with me'))
  const { token } = await shareLinkOn(fakes.data, shared.id)
  setPlan(fakes.store, OTHER_USER.email, 'creator')
  signInAs(fakes.store, OTHER_USER.id)
  await fakes.data.joinPiece(token)
  await fakes.data.createPiece(newPiece('First'))
  await fakes.data.createPiece(newPiece('Second'))
  fakes.store.profiles.get(OTHER_USER.id)!.acceptedTermsAt = '2026-11-05T09:00:00.000Z'
  fakes.store.profiles.get(OTHER_USER.id)!.acceptedTermsVersion = TERMS_VERSION
  return { fakes, shared }
}

const ownPieces = (fakes: Fakes) => [...fakes.store.pieces.values()].filter((piece) => piece.ownerId === OTHER_USER.id)
const openButton = () => screen.findByRole('button', { name: text.deleteAccount })
const dialog = () => screen.findByRole('alertdialog')

async function openFirst(rendered: ReturnType<typeof renderWithApp>) {
  await rendered.user.click(await openButton())
  return within(await dialog())
}
async function openSecond(rendered: ReturnType<typeof renderWithApp>) {
  const first = await openFirst(rendered)
  await rendered.user.click(first.getByRole('button', { name: del.continue }))
  return within(await dialog())
}

describe('Delete account in Settings', () => {
  it('shows the button under Account for a user who is not the admin', async () => {
    const { fakes } = await memberWithPieces()
    renderWithApp('/settings', { fakes })

    const account = within(await screen.findByRole('region', { name: text.account }))

    expect(account.getByRole('button', { name: text.deleteAccount })).toBeEnabled()
    expect(account.queryByText(text.adminCannotDelete)).not.toBeInTheDocument()
  })

  it('shows a note and no button for the admin', async () => {
    renderWithApp('/settings', { signedIn: true, termsAccepted: true })

    const account = within(await screen.findByRole('region', { name: text.account }))

    expect(account.getByText(text.adminCannotDelete)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: text.deleteAccount })).not.toBeInTheDocument()
  })

  it('opens a first message that says what is lost, with the number of pieces, and Cancel focused', async () => {
    const { fakes } = await memberWithPieces()
    const rendered = renderWithApp('/settings', { fakes })

    const first = await openFirst(rendered)

    expect(first.getByRole('heading', { name: del.firstTitle })).toBeInTheDocument()
    expect(first.getByText(del.firstText)).toBeInTheDocument()
    expect(await first.findByText(del.pieceCount(2))).toBeInTheDocument()
    expect(first.getByRole('button', { name: text.cancel })).toHaveFocus()
    expect(ownPieces(fakes)).toHaveLength(2)
  })

  it('Cancel at the first message deletes nothing and closes', async () => {
    const { fakes } = await memberWithPieces()
    const rendered = renderWithApp('/settings', { fakes })

    const first = await openFirst(rendered)
    await rendered.user.click(first.getByRole('button', { name: text.cancel }))

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(ownPieces(fakes)).toHaveLength(2)
    expect(fakes.store.users.has(OTHER_USER.id)).toBe(true)
  })

  it('Continue opens the final question, with Cancel focused, and nothing is deleted yet', async () => {
    const { fakes } = await memberWithPieces()
    const rendered = renderWithApp('/settings', { fakes })

    const second = await openSecond(rendered)

    expect(second.getByRole('heading', { name: del.secondTitle })).toBeInTheDocument()
    expect(second.getByRole('button', { name: text.cancel })).toHaveFocus()
    expect(second.getByRole('button', { name: del.confirm })).toBeInTheDocument()
    expect(ownPieces(fakes)).toHaveLength(2)
    expect(fakes.store.users.has(OTHER_USER.id)).toBe(true)
  })

  it('Cancel at the final question deletes nothing, and the next time starts at the first message again', async () => {
    const { fakes } = await memberWithPieces()
    const rendered = renderWithApp('/settings', { fakes })

    const second = await openSecond(rendered)
    await rendered.user.click(second.getByRole('button', { name: text.cancel }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())

    expect(ownPieces(fakes)).toHaveLength(2)
    expect(fakes.store.users.has(OTHER_USER.id)).toBe(true)
    await openFirst(rendered)
    expect(within(await dialog()).getByRole('heading', { name: del.firstTitle })).toBeInTheDocument()
  })

  it('Escape closes it at either step without deleting', async () => {
    const { fakes } = await memberWithPieces()
    const rendered = renderWithApp('/settings', { fakes })

    await openFirst(rendered)
    await rendered.user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    await openSecond(rendered)
    await rendered.user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())

    expect(ownPieces(fakes)).toHaveLength(2)
    expect(fakes.store.users.has(OTHER_USER.id)).toBe(true)
  })

  it('after both steps deletes the owned pieces and the account, keeps the joined piece, and lands on the landing page', async () => {
    const { fakes, shared } = await memberWithPieces()
    const rendered = renderWithApp('/settings', { fakes })

    const second = await openSecond(rendered)
    await rendered.user.click(second.getByRole('button', { name: del.confirm }))

    await waitFor(() => expect(pathNow(rendered.router)).toBe('/'))
    expect(await screen.findByRole('heading', { level: 1, name: strings.landing.headline.join(' ') })).toBeInTheDocument()
    expect(ownPieces(fakes)).toEqual([])
    expect(fakes.store.users.has(OTHER_USER.id)).toBe(false)
    expect(fakes.store.pieces.has(shared.id)).toBe(true)
    expect(await fakes.data.getUser()).toBeNull()
  })

  it('stops before deleting anything when a piece is still processing, and says so', async () => {
    const { fakes } = await memberWithPieces()
    const busy = ownPieces(fakes)[1]!
    const job: Job = { id: 'job-busy', pieceId: busy.id, kind: 'process-piece', status: 'running', progress: 0.4, error: null }
    fakes.store.jobs.set(job.id, { job, stagesDone: 1 })
    const rendered = renderWithApp('/settings', { fakes })

    const second = await openSecond(rendered)
    await rendered.user.click(second.getByRole('button', { name: del.confirm }))

    expect(await within(await dialog()).findByRole('alert')).toHaveTextContent(del.failed.busy)
    expect(ownPieces(fakes)).toHaveLength(2)
    expect(fakes.store.users.has(OTHER_USER.id)).toBe(true)
    expect(pathNow(rendered.router)).toBe('/settings')
  })

  it('says which step failed, and that trying again is safe, when the pieces cannot all be deleted', async () => {
    const { fakes } = await memberWithPieces()
    fakes.data.deletePiece = () => Promise.reject(new Error('offline'))
    const rendered = renderWithApp('/settings', { fakes })

    const second = await openSecond(rendered)
    await rendered.user.click(second.getByRole('button', { name: del.confirm }))

    expect(await within(await dialog()).findByRole('alert')).toHaveTextContent(del.failed.pieces)
    expect(fakes.store.users.has(OTHER_USER.id)).toBe(true)
    expect(pathNow(rendered.router)).toBe('/settings')
    expect(within(await dialog()).getByRole('button', { name: del.confirm })).toBeEnabled()
  })

  it('says which step failed when the account itself cannot be deleted', async () => {
    const { fakes } = await memberWithPieces()
    fakes.data.deleteAccount = () => Promise.reject(new Error('offline'))
    const rendered = renderWithApp('/settings', { fakes })

    const second = await openSecond(rendered)
    await rendered.user.click(second.getByRole('button', { name: del.confirm }))

    expect(await within(await dialog()).findByRole('alert')).toHaveTextContent(del.failed.account)
    expect(ownPieces(fakes)).toEqual([])
    expect(fakes.store.users.has(OTHER_USER.id)).toBe(true)
  })

  it('can be tried again after a failure', async () => {
    const { fakes } = await memberWithPieces()
    const real = fakes.data.deleteAccount.bind(fakes.data)
    fakes.data.deleteAccount = vi.fn().mockRejectedValueOnce(new Error('offline')).mockImplementation(real)
    const rendered = renderWithApp('/settings', { fakes })

    const second = await openSecond(rendered)
    await rendered.user.click(second.getByRole('button', { name: del.confirm }))
    await within(await dialog()).findByRole('alert')
    await rendered.user.click(within(await dialog()).getByRole('button', { name: del.confirm }))

    await waitFor(() => expect(pathNow(rendered.router)).toBe('/'))
    expect(fakes.store.users.has(OTHER_USER.id)).toBe(false)
  })
})
