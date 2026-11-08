import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { type JobKind } from '@/domain/types'
import { createFakes, type Fakes } from '@/lib/fakes'
import { DEMO_USER, latestJobOf, recordUsage, setPlan, setPlanLimits } from '@/lib/fakes/store'
import { PlanLimitError } from '@/lib/processorClient'
import { strings } from '@/strings'
import { chooseFromMenu, chooseFromPieceMenu, openMoreMenu } from '@/test/hubMenu'
import { demoOnTrial, pdf } from '@/test/planFixtures'
import { renderWithApp } from '@/test/render'
import { shareLinkOn } from '@/test/shareLink'

// The piece hub on a plan: Share's switch, + Add part, Reprocess and Suggest a name each ask the plan first; the server's refusal opens the same prompt.

const hub = strings.hub
const p = strings.plans
const rp = strings.partReprocess
const MARCH = 'piece-concert-march'
const ETUDE = 'piece-etude-4'

async function openHub(fakes: Fakes, pieceId = MARCH) {
  const view = renderWithApp(`/pieces/${pieceId}`, { fakes })
  await screen.findByRole('list', { name: hub.parts })
  return { ...view, fakes }
}
const prompt = () => screen.findByRole('alertdialog')
const partsList = () => screen.getByRole('list', { name: hub.parts, hidden: true })
const partRows = () => within(partsList()).getAllByRole('listitem', { hidden: true })
const partId = (fakes: Fakes, pieceId: string, name: string) => [...fakes.store.parts.values()].find((part) => part.pieceId === pieceId && part.name === name)!.id

describe('Hub: Share', () => {
  async function openShare(fakes: Fakes, pieceId = MARCH) {
    const view = await openHub(fakes, pieceId)
    await view.user.click(screen.getByRole('button', { name: hub.shareButton }))
    const dialog = await screen.findByRole('dialog', { name: strings.share.title })
    return { ...view, dialog, switcher: await within(dialog).findByRole('switch', { name: strings.share.switchLabel }) }
  }

  it('opens the prompt, and leaves the switch off, when another piece already uses the shared piece the plan includes', async () => {
    const fakes = demoOnTrial()
    await shareLinkOn(fakes.data, 'piece-clark-county')
    const { user, switcher } = await openShare(fakes)
    const setShare = vi.spyOn(fakes.data, 'setShareEnabled')

    await user.click(switcher)

    const dialog = await prompt()
    expect(within(dialog).getByText(p.promptTitle('shared_pieces_max', 'Trial'))).toBeInTheDocument()
    expect(within(dialog).getByText(/Trial includes 1 shared piece/)).toBeInTheDocument()
    expect(setShare).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: p.ok }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(screen.getByRole('switch', { name: strings.share.switchLabel })).not.toBeChecked()
    // The rights question is not asked for a switch the plan refused.
    expect(screen.queryByText(strings.share.rightsTitle)).not.toBeInTheDocument()
  })

  it('goes on to the rights question when the plan has room', async () => {
    const { user, switcher } = await openShare(demoOnTrial())
    await user.click(switcher)
    expect(await screen.findByText(strings.share.rightsTitle)).toBeInTheDocument()
    expect(screen.queryByText(p.promptTitle('shared_pieces_max', 'Trial'))).not.toBeInTheDocument()
  })

  it('never asks to turn a link off', async () => {
    const fakes = demoOnTrial()
    await shareLinkOn(fakes.data, MARCH)
    // The plan is cut to no shared pieces afterwards; the link that is on can still be turned off.
    setPlanLimits(fakes.store, 'trial', { shared_pieces_max: 0 })
    const { user, switcher } = await openShare(fakes)
    expect(switcher).toBeChecked()
    await user.click(switcher)
    await waitFor(() => expect(screen.getByRole('switch', { name: strings.share.switchLabel })).not.toBeChecked())
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('opens the prompt when the server refuses the last step, after the rights were confirmed', async () => {
    const fakes = demoOnTrial()
    const { user, switcher } = await openShare(fakes)
    await user.click(switcher)
    const question = await screen.findByRole('alertdialog')
    await user.click(within(question).getByRole('checkbox'))
    // Another tab turned a second link on meanwhile.
    await shareLinkOn(fakes.data, 'piece-clark-county')
    await user.click(within(question).getByRole('button', { name: strings.share.rightsConfirm }))

    expect(await screen.findByText(p.promptTitle('shared_pieces_max', 'Trial'))).toBeInTheDocument()
    expect(within(question).queryByText(strings.share.failed)).not.toBeInTheDocument()
  })

  it('opens the prompt when the server refuses a link that is already confirmed', async () => {
    const fakes = demoOnTrial()
    await shareLinkOn(fakes.data, MARCH)
    await fakes.data.setShareEnabled(MARCH, false)
    const { user, switcher } = await openShare(fakes)
    vi.spyOn(fakes.data, 'setShareEnabled').mockRejectedValue(new PlanLimitError('shared_pieces_max'))
    await user.click(switcher)
    expect(await screen.findByText(p.promptTitle('shared_pieces_max', 'Trial'))).toBeInTheDocument()
    expect(screen.queryByText(strings.share.failed)).not.toBeInTheDocument()
  })

  it('lets the admin through', async () => {
    const { user, switcher } = await openShare(createFakes({ seed: 'demo' }))
    await user.click(switcher)
    expect(await screen.findByText(strings.share.rightsTitle)).toBeInTheDocument()
  })
})

describe('Hub: + Add part', () => {
  it('opens the prompt on Trial, where a piece has one part, and does not open the dialog', async () => {
    const { user } = await openHub(demoOnTrial(), ETUDE)
    await user.click(screen.getByRole('button', { name: hub.addPart }))
    const dialog = await prompt()
    expect(within(dialog).getByText(p.promptTitle('parts_per_piece_max', 'Trial'))).toBeInTheDocument()
    expect(within(dialog).getByText(/Trial pieces have one part/)).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: hub.addPartsTitle })).not.toBeInTheDocument()
  })

  it('opens the dialog on a plan without a limit on parts', async () => {
    const fakes = demoOnTrial()
    setPlan(fakes.store, DEMO_USER.email, 'creator')
    const { user } = await openHub(fakes, ETUDE)
    await user.click(screen.getByRole('button', { name: hub.addPart }))
    expect(await screen.findByRole('dialog', { name: hub.addPartsTitle })).toBeInTheDocument()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('counts the parts the piece has when PDFs are added in the dialog', async () => {
    const fakes = demoOnTrial()
    setPlan(fakes.store, DEMO_USER.email, 'creator')
    setPlanLimits(fakes.store, 'creator', { parts_per_piece_max: 3 })
    const { user } = await openHub(fakes) // Concert March has two parts
    await user.click(screen.getByRole('button', { name: hub.addPart }))
    const dialog = await screen.findByRole('dialog', { name: hub.addPartsTitle })
    const drop = () => within(dialog).getByLabelText(strings.newPiece.dropZone)
    await user.upload(drop(), [pdf('third.pdf')])
    await waitFor(() => expect(within(dialog).getAllByRole('textbox', { name: strings.newPiece.partName })).toHaveLength(1))

    await user.upload(drop(), [pdf('fourth.pdf')])

    expect(await prompt()).toBeInTheDocument()
    expect(screen.getByText(/have up to 3 parts/)).toBeInTheDocument()
    expect(within(dialog).getAllByRole('textbox', { name: strings.newPiece.partName, hidden: true })).toHaveLength(1)
  })

  it('opens the prompt, and keeps the dialog and its rows, when the server refuses the add', async () => {
    const fakes = demoOnTrial()
    setPlan(fakes.store, DEMO_USER.email, 'creator')
    const { user } = await openHub(fakes, ETUDE)
    vi.spyOn(fakes.processor, 'addParts').mockRejectedValue(new PlanLimitError('advanced_reading_parts_per_month'))
    await user.click(screen.getByRole('button', { name: hub.addPart }))
    const dialog = await screen.findByRole('dialog', { name: hub.addPartsTitle })
    await user.upload(within(dialog).getByLabelText(strings.newPiece.dropZone), [pdf('second.pdf')])
    await waitFor(() => expect(within(dialog).getAllByRole('textbox', { name: strings.newPiece.partName })).toHaveLength(1))

    await user.click(within(dialog).getByRole('button', { name: hub.addPartsSubmit }))

    expect(await screen.findByText(p.promptTitle('advanced_reading_parts_per_month', 'Creator'))).toBeInTheDocument()
    expect(within(dialog).queryByText(hub.addPartsFailed)).not.toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: hub.addPartsSubmit, hidden: true })).toBeEnabled()
  })

  it('has no limit for the admin', async () => {
    const { user } = await openHub(createFakes({ seed: 'demo' }), ETUDE)
    await user.click(screen.getByRole('button', { name: hub.addPart }))
    expect(await screen.findByRole('dialog', { name: hub.addPartsTitle })).toBeInTheDocument()
  })
})

describe('Hub: Reprocess', () => {
  async function openReprocess(fakes: Fakes, pieceId = MARCH, index = 0) {
    const view = await openHub(fakes, pieceId)
    const row = partRows()[index]!
    const name = row.querySelector('[data-slot="part-name"]')?.textContent ?? ''
    await chooseFromMenu(view.user, name, rp.submit, row)
    return { ...view, name }
  }
  const useUp = (fakes: Fakes, pieceId: string, name: string, times: number) => {
    for (let i = 0; i < times; i++) recordUsage(fakes.store, fakes.store.users.get(DEMO_USER.id)!, 'read_again', pieceId, partId(fakes, pieceId, name))
  }

  it('opens the prompt when the part has used its reads, and starts nothing', async () => {
    const fakes = demoOnTrial()
    useUp(fakes, MARCH, 'Clarinet in B♭ 1', 2)
    const reprocess = vi.spyOn(fakes.processor, 'reprocessPart')
    await openReprocess(fakes)
    const dialog = await prompt()
    expect(within(dialog).getByText(p.promptTitle('read_again_per_part_max', 'Trial'))).toBeInTheDocument()
    expect(within(dialog).getByText(/lets you reprocess each part twice/)).toBeInTheDocument()
    expect(screen.queryByRole('alertdialog', { name: rp.title('Clarinet in B♭ 1') })).not.toBeInTheDocument()
    expect(reprocess).not.toHaveBeenCalled()
  })

  it('asks the question with what is left when the part has reads left', async () => {
    const fakes = demoOnTrial()
    useUp(fakes, MARCH, 'Clarinet in B♭ 1', 1)
    await openReprocess(fakes)
    const dialog = await screen.findByRole('alertdialog', { name: rp.title('Clarinet in B♭ 1') })
    expect(within(dialog).getByText(p.readAgainConfirm('Trial', 1))).toBeInTheDocument()
  })

  it('says how many reads each part has left, in its row', async () => {
    const fakes = demoOnTrial()
    useUp(fakes, MARCH, 'Clarinet in B♭ 1', 1)
    await openHub(fakes)
    const [first, second] = partRows()
    expect(within(first!).getByText(p.readAgainLeft('Trial', 1, 2))).toBeInTheDocument()
    expect(within(second!).getByText(p.readAgainLeft('Trial', 2, 2))).toBeInTheDocument()
  })

  it('says it under the list for a piece of one part', async () => {
    await openHub(demoOnTrial(), ETUDE)
    expect(screen.getByText(p.readAgainLeft('Trial', 2, 2))).toBeInTheDocument()
  })

  it('shows no counts to the admin or on a plan without that limit', async () => {
    await openHub(createFakes({ seed: 'demo' }))
    expect(screen.queryByText(/reprocesses left/)).not.toBeInTheDocument()
  })

  it('opens the prompt when the server refuses after the page let it through', async () => {
    const fakes = demoOnTrial()
    const { user } = await openReprocess(fakes)
    const dialog = await screen.findByRole('alertdialog', { name: rp.title('Clarinet in B♭ 1') })
    vi.spyOn(fakes.processor, 'reprocessPart').mockRejectedValue(new PlanLimitError('read_again_per_part_max'))

    await user.click(within(dialog).getByRole('button', { name: rp.submit }))

    expect(await screen.findByText(p.promptTitle('read_again_per_part_max', 'Trial'))).toBeInTheDocument()
    expect(within(dialog).queryByText(rp.failed)).not.toBeInTheDocument()
  })

  it('refuses the Advanced Reading tick of a plan without it', async () => {
    const fakes = demoOnTrial()
    const { user } = await openReprocess(fakes)
    const dialog = await screen.findByRole('alertdialog', { name: rp.title('Clarinet in B♭ 1') })
    await user.click(within(dialog).getByRole('button', { name: strings.boxCheck.advanced }))
    await user.click(within(dialog).getByRole('checkbox'))
    expect(await screen.findByText(p.promptTitle('advanced_reading', 'Trial'))).toBeInTheDocument()
    // Base UI draws a button and a hidden input for one tick; neither is on.
    for (const box of within(dialog).getAllByRole('checkbox', { hidden: true })) expect(box).not.toBeChecked()
  })

  it('starts the job when it is allowed', async () => {
    const fakes = demoOnTrial()
    const { user, router } = await openReprocess(fakes)
    const dialog = await screen.findByRole('alertdialog', { name: rp.title('Clarinet in B♭ 1') })
    await user.click(within(dialog).getByRole('button', { name: rp.submit }))
    await waitFor(() => expect(router.state.location.pathname).toBe(`/pieces/${MARCH}/processing`))
    expect(fakes.store.reprocessed).toHaveLength(1)
  })
})

describe('Hub: Suggest a name in Rename', () => {
  it('opens the prompt when the plan does not include it', async () => {
    const fakes = demoOnTrial()
    setPlanLimits(fakes.store, 'trial', { suggest_name: false })
    const { user } = await openHub(fakes)
    await chooseFromPieceMenu(user, hub.rename)
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: strings.suggestName.button }))
    expect(await screen.findByText('Suggest a name is not in your plan.')).toBeInTheDocument()
  })
})

describe('Hub: Delete', () => {
  it('adds that the count does not go down, on a plan that counts pieces made', async () => {
    const { user } = await openHub(demoOnTrial())
    await chooseFromPieceMenu(user, hub.delete)
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText(/pieces don't come back when you delete one/)).toBeInTheDocument()
  })
})

describe('Hub: a job the plan refused', () => {
  function endedWith(kind: JobKind, error: string, parts?: { id: string; name: string; state: 'failed'; error: string }[]): Fakes {
    const fakes = demoOnTrial()
    const stored = latestJobOf(fakes.store, MARCH)!
    stored.job = { ...stored.job, kind, status: 'error', progress: 0.35, error, parts: parts ?? [] }
    return fakes
  }

  it('says the plan sentence for a first reading the processor refused', async () => {
    const fakes = endedWith('process-piece', 'plan_limit:pages_per_part_max')
    renderWithApp(`/pieces/${MARCH}`, { fakes })
    expect(await screen.findByText(/Trial reads PDFs of up to 20 pages/)).toBeInTheDocument()
    expect(screen.queryByText('plan_limit:pages_per_part_max')).not.toBeInTheDocument()
  })

  it('says the plan sentence in the notice of a realign the processor refused', async () => {
    const fakes = endedWith('realign', 'plan_limit:realign_per_piece_max')
    renderWithApp(`/pieces/${MARCH}`, { fakes })
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/Trial lets you realign each piece 5 times/)
    expect(alert).not.toHaveTextContent('plan_limit:')
  })

  it('says the job sentence for a part Advanced Reading was refused for, in the skipped parts notice', async () => {
    const fakes = endedWith('add-parts', 'plan_limit:advanced_reading', [{ id: 'x', name: 'Oboe', state: 'failed', error: 'plan_limit:advanced_reading' }])
    renderWithApp(`/pieces/${MARCH}`, { fakes })
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/Advanced Reading is not included in Trial, so this part was not read/)
    expect(alert).not.toHaveTextContent('plan_limit:')
  })

  it('opens the prompt, not "could not retry", when the retry of a realign is refused', async () => {
    const fakes = endedWith('realign', 'The server restarted while this was running. Try again.')
    vi.spyOn(fakes.processor, 'realign').mockRejectedValue(new PlanLimitError('realign_per_piece_max'))
    const { user } = renderWithApp(`/pieces/${MARCH}`, { fakes })
    const alert = await screen.findByRole('alert')
    await user.click(within(alert).getByRole('button', { name: strings.common.retry }))
    expect(await screen.findByText(p.promptTitle('realign_per_piece_max', 'Trial'))).toBeInTheDocument()
    expect(screen.queryByText(hub.retryFailed, { exact: false })).not.toBeInTheDocument()
  })
})

// openMoreMenu is imported for the part-row helpers above; keep the import used when a test only needs the menu.
void openMoreMenu
