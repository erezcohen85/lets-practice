import { screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { downloadText } from '@/components/admin/download'
import { type Person } from '@/domain/adminDraft'
import { peopleCsv } from '@/domain/peopleCsv'
import { createFakes, type Fakes } from '@/lib/fakes'
import { OTHER_USER, THIRD_USER, DEMO_USER, recordUsage, setPlan, setPlanLimits } from '@/lib/fakes/store'
import { strings } from '@/strings'
import { renderWithApp } from '@/test/render'

vi.mock('@/components/admin/download', () => ({ downloadText: vi.fn() }))

const text = strings.admin
const limit = strings.admin.limits

// The people of the demo store: the admin (signed in today), OTHER (2 days ago), THIRD (12 days ago). Here OTHER is on Creator, and
// NOA has a Creator assignment but has not signed in yet. THIRD is on Trial by default (no assignment).
const NOA = 'noa@example.com'
function fakesWithPeople(): Fakes {
  const fakes = createFakes({ seed: 'demo' })
  setPlan(fakes.store, OTHER_USER.email, 'creator')
  setPlan(fakes.store, NOA, 'creator')
  return fakes
}

const barText = () => within(screen.getByRole('region', { name: text.bar.label })).getByRole('status')
const saveButton = () => within(screen.getByRole('region', { name: text.bar.label })).getByRole('button', { name: text.bar.save })
const discardButton = () => screen.getByRole('button', { name: text.bar.discard })
const field = (label: string) => screen.getByRole('textbox', { name: label })
const rowOf = (email: string) => screen.getByText(email).closest('li') as HTMLElement
const peopleList = () => screen.getByRole('list', { name: text.peopleList })
const emailsShown = () => within(peopleList()).queryAllByRole('listitem').map((li) => li.querySelector('[dir="ltr"]')!.textContent)
const planMenuOf = (email: string) => screen.getByRole('combobox', { name: text.planFor(email) })

async function openApp(fakes: Fakes = fakesWithPeople()) {
  const view = renderWithApp('/admin', { fakes })
  await screen.findByRole('tab', { name: text.tabPlans })
  return view
}

type App = Awaited<ReturnType<typeof openApp>>

async function typeIn(user: App['user'], label: string, value: string) {
  await user.clear(field(label))
  if (value !== '') await user.type(field(label), value)
}

beforeEach(() => {
  vi.mocked(downloadText).mockClear()
})

describe('the admin page', () => {
  it('sends a non-admin to the library', async () => {
    const { router } = renderWithApp('/admin', { signedInAs: OTHER_USER.id, termsAccepted: true })
    await waitFor(() => expect(router.state.location.pathname).toBe('/library'))
  })

  it('says so when the data cannot be read, and reads again on Try again', async () => {
    const fakes = fakesWithPeople()
    vi.spyOn(fakes.data, 'adminOverview').mockRejectedValueOnce(new Error('offline'))
    const { user } = renderWithApp('/admin', { fakes })

    await user.click(await screen.findByRole('button', { name: strings.common.retry }))
    expect(await screen.findByRole('tab', { name: text.tabPlans })).toBeInTheDocument()
  })

  it('has the tabs Plans and People, Plans first with Trial open, and a way back to Settings', async () => {
    await openApp()

    expect(screen.getByRole('tab', { name: text.tabPlans })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: text.tabPeople })).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByRole('tablist', { name: text.tabsLabel })).toBeInTheDocument()
    expect(screen.getByRole('tabpanel')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: strings.common.settings })).toHaveAttribute('href', '/settings')
    expect(screen.getByRole('heading', { level: 1, name: text.title })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Trial/ })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: /^Creator/ })).toHaveAttribute('aria-expanded', 'false')
  })

  it('moves between the tabs with the arrow keys', async () => {
    const { user } = await openApp()
    screen.getByRole('tab', { name: text.tabPlans }).focus()
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: text.tabPeople })).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{ArrowLeft}')
    expect(screen.getByRole('tab', { name: text.tabPlans })).toHaveAttribute('aria-selected', 'true')
  })
})

describe('the Plans tab', () => {
  it('shows a card per plan with its people and a summary line, one open at a time', async () => {
    const { user } = await openApp()

    const trial = screen.getByRole('button', { name: /^Trial/ })
    expect(trial).toHaveTextContent(text.people(1))
    expect(trial).toHaveTextContent('3 pieces ever, 1 part each, Advanced Reading off, 1 shared piece')
    expect(screen.getByRole('button', { name: /^Creator/ })).toHaveTextContent(text.people(2))
    expect(screen.getByRole('button', { name: /^Unlimited/ })).toHaveTextContent('Pieces: no limit, any number of parts, Advanced Reading on, sharing: no limit')

    await user.click(screen.getByRole('button', { name: /^Creator/ }))
    expect(screen.getByRole('button', { name: /^Creator/ })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: /^Trial/ })).toHaveAttribute('aria-expanded', 'false')
    expect(field(limit.pieces_stored_max.label)).toHaveValue('50')
  })

  it('generates a row for every limit in groups, with hints, No limit switches, On or Off text and the daily count', async () => {
    await openApp()

    for (const name of Object.values(text.groups)) expect(screen.getByRole('heading', { level: 3, name })).toBeInTheDocument()
    expect(field(limit.pieces_created_max.label)).toHaveValue('3')
    expect(screen.getByRole('switch', { name: text.noLimitFor(limit.pieces_created_max.label) })).not.toBeChecked()
    // The members limits and the limits with a ceiling are never "no limit": they show the ceiling hint instead.
    expect(screen.queryByRole('switch', { name: text.noLimitFor(limit.members_per_piece.label) })).toBeNull()
    expect(screen.queryByRole('switch', { name: text.noLimitFor(limit.pages_per_part_max.label) })).toBeNull()
    expect(screen.getByText(limit.members_per_piece.hint!)).toBeInTheDocument()
    expect(screen.getByText(limit.pages_per_part_max.hint!)).toBeInTheDocument()
    // A switch says On or Off in words beside it.
    const reading = screen.getByRole('switch', { name: limit.advanced_reading.label })
    expect(reading).not.toBeChecked()
    expect(within(reading.closest('li')!).getByText(text.off)).toBeInTheDocument()
    expect(within(screen.getByRole('switch', { name: limit.suggest_name.label }).closest('li')!).getByText(text.on)).toBeInTheDocument()
    expect(screen.getByText(text.newPiecesToday(0, 20))).toBeInTheDocument()
  })

  it('tags a changed row "Changed, was N"; No limit empties the field and turning it off brings the saved number back', async () => {
    const { user } = await openApp()
    const noLimit = screen.getByRole('switch', { name: text.noLimitFor(limit.pieces_created_max.label) })

    await user.click(noLimit)
    expect(noLimit).toBeChecked()
    expect(field(limit.pieces_created_max.label)).toBeDisabled()
    expect(field(limit.pieces_created_max.label)).toHaveValue('')
    expect(noLimit.closest('li')).toHaveTextContent(text.changedWas('3'))
    expect(barText()).toHaveTextContent('1 unsaved change')
    expect(screen.getByRole('button', { name: /^Trial/ })).toHaveTextContent('1 unsaved change')

    await user.click(noLimit)
    expect(field(limit.pieces_created_max.label)).toHaveValue('3')
    expect(barText()).toHaveTextContent(text.bar.none)

    await user.click(screen.getByRole('switch', { name: limit.advanced_reading.label }))
    const changedRow = within(screen.getByRole('switch', { name: limit.advanced_reading.label }).closest('li')!)
    expect(changedRow.getByText(text.on)).toBeInTheDocument()
    expect(changedRow.getByText(text.changedWas(text.wasOff))).toBeInTheDocument()
  })
})

describe('the save bar', () => {
  it('starts with No changes, and Save changes and Discard changes disabled', async () => {
    await openApp()

    expect(barText()).toHaveTextContent(text.bar.none)
    expect(saveButton()).toBeDisabled()
    expect(discardButton()).toBeDisabled()
  })

  it('counts the unsaved changes, enables both buttons, and Discard takes them back', async () => {
    const { user } = await openApp()

    await typeIn(user, limit.pieces_created_max.label, '4')
    expect(barText()).toHaveTextContent('1 unsaved change')
    expect(saveButton()).toBeEnabled()
    expect(discardButton()).toBeEnabled()

    await user.click(screen.getByRole('switch', { name: limit.advanced_reading.label }))
    expect(barText()).toHaveTextContent('2 unsaved changes')

    await user.click(discardButton())
    expect(barText()).toHaveTextContent(text.bar.none)
    expect(field(limit.pieces_created_max.label)).toHaveValue('3')
    expect(saveButton()).toBeDisabled()
  })

  it('keeps the draft when switching between the tabs: one draft, one count', async () => {
    const { user } = await openApp()
    await typeIn(user, limit.pieces_created_max.label, '4')

    await user.click(screen.getByRole('tab', { name: text.tabPeople }))
    expect(barText()).toHaveTextContent('1 unsaved change')
    await user.click(screen.getByRole('button', { name: text.removeLabel(OTHER_USER.email) }))
    expect(barText()).toHaveTextContent('2 unsaved changes')

    await user.click(screen.getByRole('tab', { name: text.tabPlans }))
    expect(field(limit.pieces_created_max.label)).toHaveValue('4')
    expect(barText()).toHaveTextContent('2 unsaved changes')
  })

  it('blocks Save on a number that cannot be saved, marks the row, opens the first card with a problem and tells the way out', async () => {
    const fakes = fakesWithPeople()
    const save = vi.spyOn(fakes.data, 'saveAdminChanges')
    const { user } = await openApp(fakes)

    await user.click(screen.getByRole('button', { name: /^Creator/ }))
    await typeIn(user, limit.pages_per_part_max.label, '101')
    await user.click(screen.getByRole('button', { name: /^Trial/ }))
    expect(screen.getByRole('button', { name: /^Creator/ })).toHaveAttribute('aria-expanded', 'false')

    await user.click(saveButton())
    expect(save).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /^Creator/ })).toHaveAttribute('aria-expanded', 'true')
    expect(barText()).toHaveTextContent(text.bar.fix)
    expect(field(limit.pages_per_part_max.label)).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText(text.fix(text.fixRange(1, 100)))).toBeInTheDocument()

    // Fixing the number takes the mark and the message away.
    await typeIn(user, limit.pages_per_part_max.label, '90')
    expect(screen.queryByText(text.fix(text.fixRange(1, 100)))).toBeNull()
    expect(barText()).toHaveTextContent('1 unsaved change')
  })

  it('marks an empty field and a number that is not whole, and a count below its minimum', async () => {
    const { user } = await openApp()
    await typeIn(user, limit.parts_per_piece_max.label, '0')
    await user.click(saveButton())
    expect(screen.getByText(text.fix(text.fixMin(1)))).toBeInTheDocument()

    await typeIn(user, limit.parts_per_piece_max.label, '')
    expect(screen.getByText(text.fix(text.fixMin(1)))).toBeInTheDocument()
    await typeIn(user, limit.parts_per_piece_max.label, '2.5')
    expect(screen.getByText(text.fix(text.fixMin(1)))).toBeInTheDocument()
  })

  it('saves the plans and the people in one call, reads the data again, and says Saved with both buttons disabled', async () => {
    const fakes = fakesWithPeople()
    const save = vi.spyOn(fakes.data, 'saveAdminChanges')
    const overview = vi.spyOn(fakes.data, 'adminOverview')
    const { user } = await openApp(fakes)

    await typeIn(user, limit.pieces_created_max.label, '4')
    await user.click(screen.getByRole('tab', { name: text.tabPeople }))
    await user.selectOptions(planMenuOf(THIRD_USER.email), 'creator')
    await user.type(screen.getByRole('textbox', { name: text.emailLabel }), 'New@Example.com ')
    await user.selectOptions(screen.getByRole('combobox', { name: text.planLabel }), 'unlimited')
    await user.click(screen.getByRole('button', { name: text.add }))
    expect(barText()).toHaveTextContent('3 unsaved changes')
    const reads = overview.mock.calls.length

    await user.click(saveButton())
    await waitFor(() => expect(barText()).toHaveTextContent(text.bar.saved))
    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith({
      plans: [{ id: 'trial', pieces_created_max: 4 }],
      people: [
        { email: THIRD_USER.email, plan_id: 'creator' },
        { email: 'new@example.com', plan_id: 'unlimited' },
      ],
    })
    expect(overview.mock.calls.length).toBe(reads + 1)
    expect(saveButton()).toBeDisabled()
    expect(discardButton()).toBeDisabled()
    // What is shown now is what was saved.
    expect(within(rowOf('new@example.com')).queryByText(text.tagNew)).toBeNull()
    expect(planMenuOf(THIRD_USER.email)).toHaveValue('creator')
    await user.click(screen.getByRole('tab', { name: text.tabPlans }))
    expect(field(limit.pieces_created_max.label)).toHaveValue('4')

    // A change after that is a new draft.
    await typeIn(user, limit.pieces_created_max.label, '5')
    expect(barText()).toHaveTextContent('1 unsaved change')
  })

  it('shows the error of a save that fails, keeps the draft, and saves on the next try', async () => {
    const fakes = fakesWithPeople()
    vi.spyOn(fakes.data, 'saveAdminChanges').mockRejectedValueOnce(new Error('offline'))
    const { user } = await openApp(fakes)
    await typeIn(user, limit.pieces_created_max.label, '4')

    await user.click(saveButton())
    await waitFor(() => expect(barText()).toHaveTextContent(text.bar.failed))
    expect(field(limit.pieces_created_max.label)).toHaveValue('4')
    expect(saveButton()).toBeEnabled()

    await user.click(saveButton())
    await waitFor(() => expect(barText()).toHaveTextContent(text.bar.saved))
    expect(field(limit.pieces_created_max.label)).toHaveValue('4')
  })

  it('does not ask before a plain save', async () => {
    const fakes = fakesWithPeople()
    // A pause that is already on, turned off, is not a question either.
    setPlanLimits(fakes.store, 'creator', { new_pieces_paused: true })
    const save = vi.spyOn(fakes.data, 'saveAdminChanges')
    const { user } = await openApp(fakes)
    await user.click(screen.getByRole('button', { name: /^Creator/ }))
    await user.click(screen.getByRole('switch', { name: limit.new_pieces_paused.label }))

    await user.click(saveButton())
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('asks before a save that pauses a plan, and saves only on Save changes', async () => {
    const fakes = fakesWithPeople()
    const save = vi.spyOn(fakes.data, 'saveAdminChanges')
    const { user } = await openApp(fakes)
    await user.click(screen.getByRole('switch', { name: limit.new_pieces_paused.label }))

    await user.click(saveButton())
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText(text.confirm.title(1))).toBeInTheDocument()
    expect(within(dialog).getByText(text.confirm.pauses(['Trial']))).toBeInTheDocument()
    expect(save).not.toHaveBeenCalled()

    await user.click(within(dialog).getByRole('button', { name: text.confirm.keepEditing }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(save).not.toHaveBeenCalled()
    expect(barText()).toHaveTextContent('1 unsaved change')

    await user.click(saveButton())
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: text.confirm.save }))
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(barText()).toHaveTextContent(text.bar.saved))
  })

  it('asks before a save that removes someone, and says what stays', async () => {
    const fakes = fakesWithPeople()
    const save = vi.spyOn(fakes.data, 'saveAdminChanges')
    const { user } = await openApp(fakes)
    await user.click(screen.getByRole('tab', { name: text.tabPeople }))
    await user.click(screen.getByRole('button', { name: text.removeLabel(NOA) }))

    await user.click(saveButton())
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText(text.confirm.removes(1))).toBeInTheDocument()
    expect(save).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: text.confirm.save }))
    await waitFor(() => expect(save).toHaveBeenCalledWith({ plans: [], people: [{ email: NOA, remove: true }] }))
    await waitFor(() => expect(barText()).toHaveTextContent(text.bar.saved))
    // Remove takes the plan assignment away: noa had never signed in, so nobody is left to show.
    expect(screen.queryByText(NOA)).toBeNull()
  })

  it('says inside the question when the save fails, and keeps it open', async () => {
    const fakes = fakesWithPeople()
    vi.spyOn(fakes.data, 'saveAdminChanges').mockRejectedValueOnce(new Error('offline'))
    const { user } = await openApp(fakes)
    await user.click(screen.getByRole('switch', { name: limit.new_pieces_paused.label }))
    await user.click(saveButton())
    const dialog = await screen.findByRole('alertdialog')

    await user.click(within(dialog).getByRole('button', { name: text.confirm.save }))
    expect(await within(dialog).findByText(text.confirm.failed)).toBeInTheDocument()
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
  })
})

describe('the People tab', () => {
  async function openPeople() {
    const app = await openApp()
    await app.user.click(screen.getByRole('tab', { name: text.tabPeople }))
    return app
  }

  it('shows each person with name, last sign-in, plan menu, usage, and Remove only where there is an assignment', async () => {
    await openPeople()

    expect(emailsShown()).toEqual([DEMO_USER.email, OTHER_USER.email, THIRD_USER.email, NOA])
    const admin = within(rowOf(DEMO_USER.email))
    expect(admin.getByText(text.adminPlan)).toBeInTheDocument()
    expect(admin.queryByRole('combobox')).toBeNull()
    expect(admin.queryByRole('button', { name: /^Remove/ })).toBeNull()
    expect(admin.getByText(text.signedInToday)).toBeInTheDocument()

    const other = within(rowOf(OTHER_USER.email))
    expect(other.getByText('Other')).toBeInTheDocument()
    expect(other.getByText(text.signedInDaysAgo(2))).toBeInTheDocument()
    expect(planMenuOf(OTHER_USER.email)).toHaveValue('creator')
    expect(other.getByRole('button', { name: text.removeLabel(OTHER_USER.email) })).toBeInTheDocument()

    // Trial by default: nothing to remove.
    const third = within(rowOf(THIRD_USER.email))
    expect(planMenuOf(THIRD_USER.email)).toHaveValue('trial')
    expect(third.queryByRole('button', { name: /^Remove/ })).toBeNull()
    expect(third.getByText(/^Signed in \d+ [A-Z][a-z]{2}/)).toBeInTheDocument()
    expect(third).toBeDefined()
    expect(rowOf(THIRD_USER.email)).toHaveTextContent('0 of 3 trial pieces used, 0 shared of 1')

    const noa = within(rowOf(NOA))
    expect(noa.getByText(text.notSignedIn)).toBeInTheDocument()
    expect(noa.getByText(text.usageNone)).toBeInTheDocument()
    expect(rowOf(OTHER_USER.email)).toHaveTextContent('0 of 50 pieces stored, 0 shared')
  })

  it('tags people at a limit and near a limit, in words', async () => {
    const fakes = fakesWithPeople()
    setPlan(fakes.store, OTHER_USER.email, 'trial')
    for (let i = 0; i < 3; i += 1) recordUsage(fakes.store, THIRD_USER, 'piece_created', `piece-${i}`)
    for (let i = 0; i < 2; i += 1) recordUsage(fakes.store, OTHER_USER, 'piece_created', `other-${i}`)
    const { user } = await openApp(fakes)
    await user.click(screen.getByRole('tab', { name: text.tabPeople }))

    expect(within(rowOf(THIRD_USER.email)).getByText(text.atLimit)).toBeInTheDocument()
    expect(within(rowOf(OTHER_USER.email)).getByText(text.nearLimit)).toBeInTheDocument()
    expect(within(rowOf(DEMO_USER.email)).queryByText(text.atLimit)).toBeNull()

    await user.click(screen.getByRole('button', { name: text.atLimit }))
    expect(emailsShown()).toEqual([THIRD_USER.email])
    await user.click(screen.getByRole('button', { name: text.nearLimit }))
    expect(emailsShown()).toEqual([OTHER_USER.email])
  })

  it('stages a plan change with its tag and Undo', async () => {
    const { user } = await openPeople()

    await user.selectOptions(planMenuOf(OTHER_USER.email), 'trial')
    expect(within(rowOf(OTHER_USER.email)).getByText(text.tagPlanChanged('Creator', 'Trial'))).toBeInTheDocument()
    expect(barText()).toHaveTextContent('1 unsaved change')

    await user.click(within(rowOf(OTHER_USER.email)).getByRole('button', { name: text.undoLabel(OTHER_USER.email) }))
    expect(planMenuOf(OTHER_USER.email)).toHaveValue('creator')
    expect(barText()).toHaveTextContent(text.bar.none)
  })

  it('stages a removal: Will be removed with Undo, no menu to use, and Undo takes it back', async () => {
    const { user } = await openPeople()

    await user.click(screen.getByRole('button', { name: text.removeLabel(OTHER_USER.email) }))
    const row = within(rowOf(OTHER_USER.email))
    expect(row.getByText(text.tagRemoved)).toBeInTheDocument()
    expect(planMenuOf(OTHER_USER.email)).toBeDisabled()
    expect(row.queryByRole('button', { name: text.removeLabel(OTHER_USER.email) })).toBeNull()
    expect(barText()).toHaveTextContent('1 unsaved change')

    await user.click(row.getByRole('button', { name: text.undoLabel(OTHER_USER.email) }))
    expect(planMenuOf(OTHER_USER.email)).toBeEnabled()
    expect(barText()).toHaveTextContent(text.bar.none)
  })

  it('puts the plan menu back to Trial after an email is added, and keeps the plan when the add is refused', async () => {
    const { user } = await openPeople()
    const email = screen.getByRole('textbox', { name: text.emailLabel })
    const menu = screen.getByRole('combobox', { name: text.planLabel })

    await user.type(email, 'nope')
    await user.selectOptions(menu, 'unlimited')
    await user.click(screen.getByRole('button', { name: text.add }))
    expect(screen.getByRole('alert')).toHaveTextContent(text.invalid)
    expect(menu).toHaveValue('unlimited')

    await user.clear(email)
    await user.type(email, 'again@example.com')
    await user.click(screen.getByRole('button', { name: text.add }))
    expect(planMenuOf('again@example.com')).toHaveValue('unlimited')
    expect(menu).toHaveValue('trial')
  })

  it('adds an email with a plan as New, with the errors for an address that is not one and one already listed', async () => {
    const { user } = await openPeople()
    const email = screen.getByRole('textbox', { name: text.emailLabel })

    await user.type(email, 'nope')
    await user.click(screen.getByRole('button', { name: text.add }))
    expect(screen.getByRole('alert')).toHaveTextContent(text.invalid)

    await user.clear(email)
    await user.type(email, OTHER_USER.email.toUpperCase())
    await user.click(screen.getByRole('button', { name: text.add }))
    expect(screen.getByRole('alert')).toHaveTextContent(text.duplicate)
    expect(barText()).toHaveTextContent(text.bar.none)

    await user.clear(email)
    await user.type(email, '  Fresh@Example.com ')
    await user.selectOptions(screen.getByRole('combobox', { name: text.planLabel }), 'unlimited')
    await user.click(screen.getByRole('button', { name: text.add }))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(email).toHaveValue('')
    expect(within(rowOf('fresh@example.com')).getByText(text.tagNew)).toBeInTheDocument()
    expect(planMenuOf('fresh@example.com')).toHaveValue('unlimited')
    expect(barText()).toHaveTextContent('1 unsaved change')

    // Staging the same address twice is a duplicate too; Remove drops a new person.
    await user.type(email, 'fresh@example.com')
    await user.click(screen.getByRole('button', { name: text.add }))
    expect(screen.getByRole('alert')).toHaveTextContent(text.duplicate)
    await user.click(screen.getByRole('button', { name: text.removeLabel('fresh@example.com') }))
    expect(screen.queryByText('fresh@example.com')).toBeNull()
    expect(barText()).toHaveTextContent(text.bar.none)
  })

  it('counts the people on each plan in the Plan filter and filters by it', async () => {
    const { user } = await openPeople()
    expect(screen.getByText(text.showing(4, 4))).toBeInTheDocument()
    for (const name of ['All 4', 'Trial 1', 'Creator 2', 'Unlimited 1']) expect(screen.getByRole('button', { name })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'All 4' })).toHaveAttribute('aria-pressed', 'true')

    await user.click(screen.getByRole('button', { name: 'Creator 2' }))
    expect(screen.getByRole('button', { name: 'Creator 2' })).toHaveAttribute('aria-pressed', 'true')
    expect(emailsShown()).toEqual([OTHER_USER.email, NOA])
    expect(screen.getByText(text.showing(2, 4))).toBeInTheDocument()

    // The counts follow the draft: the move shows in them at once.
    await user.selectOptions(planMenuOf(OTHER_USER.email), 'trial')
    expect(screen.getByRole('button', { name: 'Creator 1' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Trial 2' })).toBeInTheDocument()
  })

  it('filters by signed-in status, and a filter never changes the draft', async () => {
    const { user } = await openPeople()
    await user.click(screen.getByRole('button', { name: text.notSignedIn }))
    expect(emailsShown()).toEqual([NOA])
    await user.click(screen.getByRole('button', { name: text.signedIn }))
    expect(emailsShown()).toEqual([DEMO_USER.email, OTHER_USER.email, THIRD_USER.email])
    expect(barText()).toHaveTextContent(text.bar.none)
  })

  it('searches by name or email, and says so when nobody matches, with a way to clear', async () => {
    const { user } = await openPeople()
    const search = screen.getByRole('searchbox', { name: text.searchLabel })

    await user.type(search, 'THI')
    expect(emailsShown()).toEqual([THIRD_USER.email])
    await user.clear(search)
    await user.type(search, 'noa@')
    expect(emailsShown()).toEqual([NOA])

    await user.clear(search)
    await user.type(search, 'zzz')
    expect(screen.getByText(text.noMatch)).toBeInTheDocument()
    expect(screen.getByText(text.showing(0, 4))).toBeInTheDocument()
    expect(emailsShown()).toEqual([])

    const clears = screen.getAllByRole('button', { name: text.clearFilters })
    await user.click(clears[clears.length - 1]!)
    expect(search).toHaveValue('')
    expect(screen.queryByText(text.noMatch)).toBeNull()
    expect(screen.getByText(text.showing(4, 4))).toBeInTheDocument()
  })

  it('shows only the people with unsaved changes when asked, including new and removed ones', async () => {
    const { user } = await openPeople()
    const only = screen.getByRole('switch', { name: text.unsavedOnly })
    expect(only).not.toBeChecked()
    expect(only.parentElement).toHaveTextContent(text.off)

    await user.click(only)
    expect(only.parentElement).toHaveTextContent(text.on)
    expect(emailsShown()).toEqual([])

    await user.click(only)
    await user.selectOptions(planMenuOf(THIRD_USER.email), 'creator')
    await user.click(screen.getByRole('button', { name: text.removeLabel(NOA) }))
    await user.type(screen.getByRole('textbox', { name: text.emailLabel }), 'fresh@example.com')
    await user.click(screen.getByRole('button', { name: text.add }))
    await user.click(only)
    expect(emailsShown()).toEqual([THIRD_USER.email, 'fresh@example.com', NOA])

    // Clearing the filters keeps the staged rows.
    await user.click(screen.getAllByRole('button', { name: text.clearFilters })[0]!)
    expect(emailsShown()).toHaveLength(5)
    expect(barText()).toHaveTextContent('3 unsaved changes')
  })

  it('sorts by last sign-in, newest first by default, and by the other three; people not signed in yet go last under the sign-in sorts', async () => {
    const { user } = await openPeople()
    const sort = screen.getByRole('combobox', { name: text.sortLabel })
    expect(sort).toHaveValue('signInNewest')
    expect(emailsShown()).toEqual([DEMO_USER.email, OTHER_USER.email, THIRD_USER.email, NOA])

    await user.selectOptions(sort, 'signInOldest')
    expect(emailsShown()).toEqual([THIRD_USER.email, OTHER_USER.email, DEMO_USER.email, NOA])
    await user.selectOptions(sort, 'email')
    expect(emailsShown()).toEqual([DEMO_USER.email, NOA, OTHER_USER.email, THIRD_USER.email])
    await user.selectOptions(sort, 'plan')
    expect(emailsShown()).toEqual([THIRD_USER.email, NOA, OTHER_USER.email, DEMO_USER.email])
    // Sorting is not a filter and not a change.
    expect(screen.getByRole('button', { name: text.clearFilters })).toBeDisabled()
    expect(barText()).toHaveTextContent(text.bar.none)
  })

  it('keeps the filters when switching tabs', async () => {
    const { user } = await openPeople()
    await user.click(screen.getByRole('button', { name: 'Creator 2' }))
    await user.click(screen.getByRole('tab', { name: text.tabPlans }))
    await user.click(screen.getByRole('tab', { name: text.tabPeople }))
    expect(emailsShown()).toEqual([OTHER_USER.email, NOA])
  })
})

describe('the CSV export', () => {
  const planNames = { trial: 'Trial', creator: 'Creator', unlimited: 'Unlimited' }

  it('downloads the saved people the search and filters show, in the current sort, and says how many', async () => {
    const fakes = fakesWithPeople()
    const { user } = await openApp(fakes)
    await user.click(screen.getByRole('tab', { name: text.tabPeople }))
    await user.click(screen.getByRole('button', { name: 'Creator 2' }))
    await user.selectOptions(screen.getByRole('combobox', { name: text.sortLabel }), 'email')

    expect(screen.queryByText(text.exportNote)).toBeNull()
    await user.click(screen.getByRole('button', { name: text.exportLabel(2) }))

    const saved = (await fakes.data.adminOverview()).people
    const pick = (email: string): Person => saved.find((person) => person.email === email)!
    expect(downloadText).toHaveBeenCalledTimes(1)
    const [csv, fileName] = vi.mocked(downloadText).mock.calls[0]!
    expect(csv).toBe(peopleCsv([pick(NOA), pick(OTHER_USER.email)], planNames))
    expect(fileName).toMatch(/^lets-practice-people-\d{4}-\d{2}-\d{2}\.csv$/)
    expect(screen.getByText(text.exported(2, fileName))).toBeInTheDocument()
  })

  it('exports the saved rows, not the draft, and says so when there are unsaved changes', async () => {
    const fakes = fakesWithPeople()
    const { user } = await openApp(fakes)
    await user.click(screen.getByRole('tab', { name: text.tabPeople }))
    await user.type(screen.getByRole('textbox', { name: text.emailLabel }), 'fresh@example.com')
    await user.selectOptions(screen.getByRole('combobox', { name: text.planLabel }), 'creator')
    await user.click(screen.getByRole('button', { name: text.add }))
    await user.selectOptions(planMenuOf(THIRD_USER.email), 'creator')
    await user.click(screen.getByRole('button', { name: 'Creator 4' }))

    // The view shows four people; three of them are saved, and the file has those three as they are saved (THIRD still on Trial).
    expect(emailsShown()).toHaveLength(4)
    expect(screen.getByText(text.exportNote)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: text.exportLabel(3) }))

    const [csv] = vi.mocked(downloadText).mock.calls[0]!
    const saved = (await fakes.data.adminOverview()).people
    const pick = (email: string): Person => saved.find((person) => person.email === email)!
    expect(csv).toBe(peopleCsv([pick(OTHER_USER.email), pick(THIRD_USER.email), pick(NOA)], planNames))
    expect(csv).not.toContain('fresh@example.com')
  })

  it('leaves out a saved person the filters hide because of a staged plan, and writes the others with their saved plan', async () => {
    const fakes = fakesWithPeople()
    const { user } = await openApp(fakes)
    await user.click(screen.getByRole('tab', { name: text.tabPeople }))
    await user.selectOptions(planMenuOf(OTHER_USER.email), 'trial')
    await user.click(screen.getByRole('button', { name: 'Creator 1' }))
    expect(emailsShown()).toEqual([NOA])

    await user.click(screen.getByRole('button', { name: text.exportLabel(1) }))
    const [csv] = vi.mocked(downloadText).mock.calls[0]!
    expect(csv).toContain(NOA)
    expect(csv).not.toContain(OTHER_USER.email)
  })
})

describe('leaving with unsaved changes', () => {
  it('goes straight back to Settings when nothing is unsaved', async () => {
    const { user, router } = await openApp()
    await user.click(screen.getByRole('link', { name: strings.common.settings }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/settings'))
  })

  it('asks Leave or Stay, and Stay keeps the page and the draft', async () => {
    const { user, router } = await openApp()
    await typeIn(user, limit.pieces_created_max.label, '4')

    await user.click(screen.getByRole('link', { name: strings.common.settings }))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText(text.leave.title)).toBeInTheDocument()
    expect(within(dialog).getByText(text.leave.text(1))).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: text.leave.stay }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(router.state.location.pathname).toBe('/admin')
    expect(field(limit.pieces_created_max.label)).toHaveValue('4')
    expect(barText()).toHaveTextContent('1 unsaved change')
  })

  it('leaves on Leave, and the question says how many changes are lost', async () => {
    const { user, router } = await openApp()
    await typeIn(user, limit.pieces_created_max.label, '4')
    await user.click(screen.getByRole('switch', { name: limit.advanced_reading.label }))

    await user.click(screen.getByRole('link', { name: strings.common.settings }))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText(text.leave.text(2))).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: text.leave.leave }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/settings'))
  })

  it('does not ask after a save, or after Discard', async () => {
    const { user, router } = await openApp()
    await typeIn(user, limit.pieces_created_max.label, '4')
    await user.click(saveButton())
    await waitFor(() => expect(barText()).toHaveTextContent(text.bar.saved))
    await user.click(screen.getByRole('link', { name: strings.common.settings }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/settings'))
  })

  it('has the browser ask before the tab is closed, only while something is unsaved', async () => {
    const { user } = await openApp()
    const clean = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(clean)
    expect(clean.defaultPrevented).toBe(false)

    await typeIn(user, limit.pieces_created_max.label, '4')
    const dirty = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(dirty)
    expect(dirty.defaultPrevented).toBe(true)
  })
})
