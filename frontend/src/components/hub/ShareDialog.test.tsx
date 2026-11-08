import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { createFakes, type Fakes } from '@/lib/fakes'
import { DEMO_USER, newCreatedAt, setPlanLimits, OTHER_USER, signInAs, THIRD_USER } from '@/lib/fakes/store'
import { strings } from '@/strings'
import { renderWithApp } from '@/test/render'

/** `linkOn` false opens the dialog on a piece that was never shared, so the link starts off as a new one does. */
async function setup(withMember = false, prepare?: (fakes: Fakes, pieceId: string) => void, linkOn = true) {
  const fakes: Fakes = createFakes({ seed: 'demo' })
  const ready = (await fakes.data.listPieces()).find((piece) => piece.job?.status === 'done')!
  if (linkOn) {
    await fakes.data.getShare(ready.id)
    await fakes.data.setShareEnabled(ready.id, true, true)
  }
  if (withMember) {
    const { token } = await fakes.data.getShare(ready.id)
    signInAs(fakes.store, OTHER_USER.id)
    await fakes.data.joinPiece(token)
    signInAs(fakes.store, DEMO_USER.id)
  }
  prepare?.(fakes, ready.id)
  const rendered = renderWithApp(`/pieces/${ready.id}`, { fakes })
  await rendered.user.click(await screen.findByRole('button', { name: strings.hub.shareButton }))
  const dialog = await screen.findByRole('dialog', { name: strings.share.title })
  return { ...rendered, fakes, pieceId: ready.id, dialog }
}

const questionGone = () => waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
const linkField = (dialog: HTMLElement) => within(dialog).findByLabelText<HTMLInputElement>(strings.share.linkLabel)

const rightsQuestion = () => screen.findByRole('alertdialog', { name: strings.share.rightsTitle })

describe('the Share dialog', () => {
  it('opening it makes the link, and shows it with the explanation', async () => {
    const { fakes, pieceId, dialog } = await setup()
    const { token } = await fakes.data.getShare(pieceId)
    expect(within(dialog).getByText(strings.share.explanation)).toBeInTheDocument()
    expect(await within(dialog).findByDisplayValue(`${window.location.origin}/join/${token}`)).toBeInTheDocument()
    expect(within(dialog).getByText(strings.share.noMembers)).toBeInTheDocument()
  })

  it('Copy writes the link and says so', async () => {
    const { user, fakes, pieceId, dialog } = await setup()
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
    await within(dialog).findByLabelText(strings.share.linkLabel)
    await user.click(within(dialog).getByRole('button', { name: strings.share.copy }))
    const { token } = await fakes.data.getShare(pieceId)
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/join/${token}`)
    expect(await within(dialog).findByRole('button', { name: strings.share.copied })).toBeInTheDocument()
  })

  it('the switch turns new joins off and on', async () => {
    const { user, fakes, pieceId, dialog } = await setup()
    const toggle = await within(dialog).findByRole('switch', { name: strings.share.switchLabel })
    expect(toggle).toBeChecked()
    await user.click(toggle)
    await waitFor(() => expect(fakes.store.shares.get(pieceId)?.enabled).toBe(false))
    const { token } = fakes.store.shares.get(pieceId)!
    signInAs(fakes.store, THIRD_USER.id)
    expect((await fakes.data.joinPiece(token)).status).toBe('link_off')
  })

  it('says under the link that it is off while the switch is off, and says nothing while it is on', async () => {
    const { user, dialog } = await setup()
    const toggle = await within(dialog).findByRole('switch', { name: strings.share.switchLabel })
    expect(strings.share.linkOff).toBe('This link is off. Nobody new can join.')
    expect(within(dialog).queryByText(strings.share.linkOff)).not.toBeInTheDocument()

    await user.click(toggle)
    expect(await within(dialog).findByText(strings.share.linkOff)).toBeInTheDocument()
    // It sits with the link, between the link row and the switch.
    const note = within(dialog).getByText(strings.share.linkOff)
    expect(within(dialog).getByLabelText<HTMLInputElement>(strings.share.linkLabel).compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(note.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    await user.click(toggle)
    await waitFor(() => expect(within(dialog).queryByText(strings.share.linkOff)).not.toBeInTheDocument())
  })

  it('does not say the link is off when switching it off could not be saved', async () => {
    const { user, fakes, dialog } = await setup()
    vi.spyOn(fakes.data, 'setShareEnabled').mockRejectedValueOnce(new Error('offline'))
    await user.click(await within(dialog).findByRole('switch', { name: strings.share.switchLabel }))
    expect(await within(dialog).findByText(strings.share.failed)).toBeInTheDocument()
    expect(within(dialog).queryByText(strings.share.linkOff)).not.toBeInTheDocument()
  })

  it('its switch is the Settings switch, 52 by 30 pixels', async () => {
    const { dialog } = await setup()
    const toggle = await within(dialog).findByRole('switch', { name: strings.share.switchLabel })
    expect(toggle.className).toContain('h-[30px]')
    expect(toggle.className).toContain('w-[52px]')
  })

  it('says what the dialog is for in the board\'s words', async () => {
    const { dialog } = await setup()

    expect(strings.share.explanation).toBe("Let other musicians practice this piece. They can't change it.")
    expect(within(dialog).getByText(strings.share.explanation)).toBeInTheDocument()
  })

  it('Reset link is the solid red button with the turn-back arrow, and says beside it what it does', async () => {
    const { dialog } = await setup()
    await within(dialog).findByLabelText(strings.share.linkLabel)
    const reset = within(dialog).getByRole('button', { name: strings.share.reset })

    expect(reset).toHaveClass('bg-danger', 'text-on-danger', 'h-11')
    expect(reset.querySelector('svg')).toHaveClass('lucide-rotate-ccw')
    const hint = within(dialog).getByText(strings.share.resetHint)
    expect(strings.share.resetHint).toBe('Makes a new link. The old link stops working. People who already joined keep their access.')
    expect(hint).toHaveClass('text-text-muted')
    expect(hint.parentElement).toContainElement(reset)
  })

  it('a member is removed with a 44 px red trash button that names them, in its label and its tooltip, and still asks first', async () => {
    const { user, dialog } = await setup(true)
    const name = strings.share.removeLabel(OTHER_USER.name)
    const remove = await within(dialog).findByRole('button', { name })

    expect(remove).toHaveAttribute('title', name)
    expect(remove).toHaveClass('size-11', 'text-danger-bright')
    expect(remove.querySelector('svg')).toHaveClass('lucide-trash-2')
    expect(remove).not.toHaveTextContent(strings.share.remove)
    await user.click(remove)
    expect(within(await screen.findByRole('alertdialog')).getByText(strings.share.removeQuestion(OTHER_USER.name))).toBeInTheDocument()
  })

  it('Reset asks first, and then the link changes and the question closes', async () => {
    const { user, fakes, pieceId, dialog } = await setup()
    const before = (await linkField(dialog)).value
    const tokenBefore = fakes.store.shares.get(pieceId)!.token
    await user.click(within(dialog).getByRole('button', { name: strings.share.reset }))
    const confirm = await screen.findByRole('alertdialog')
    expect(within(confirm).getByText(strings.share.resetQuestion)).toBeInTheDocument()
    expect(fakes.store.shares.get(pieceId)!.token).toBe(tokenBefore)
    expect(screen.getByLabelText<HTMLInputElement>(strings.share.linkLabel).value).toBe(before)
    await user.click(within(confirm).getByRole('button', { name: strings.share.resetConfirm }))
    await questionGone()
    expect(fakes.store.shares.get(pieceId)!.token).not.toBe(tokenBefore)
    expect(screen.getByLabelText<HTMLInputElement>(strings.share.linkLabel).value).not.toBe(before)
  })

  it('lists members, and Remove asks first', async () => {
    const { user, fakes, pieceId, dialog } = await setup(true)
    expect(await within(dialog).findByText(OTHER_USER.name)).toBeInTheDocument()
    expect(within(dialog).getByText(OTHER_USER.email)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: strings.share.removeLabel(OTHER_USER.name) }))
    const confirm = await screen.findByRole('alertdialog')
    expect(within(confirm).getByText(strings.share.removeQuestion(OTHER_USER.name))).toBeInTheDocument()
    await user.click(within(confirm).getByRole('button', { name: strings.share.removeConfirm }))
    await questionGone()
    expect(await screen.findByText(strings.share.noMembers)).toBeInTheDocument()
    expect(screen.queryByText(OTHER_USER.name)).not.toBeInTheDocument()
    expect(await fakes.data.listMembers(pieceId)).toEqual([])
  })

  it('asking about a reset or a removal and then cancelling changes nothing and keeps the dialog open', async () => {
    const { user, fakes, pieceId, dialog } = await setup(true)
    const before = (await linkField(dialog)).value
    await user.click(within(dialog).getByRole('button', { name: strings.share.reset }))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: strings.share.cancel }))
    await user.click(await within(dialog).findByRole('button', { name: strings.share.removeLabel(OTHER_USER.name) }))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: strings.share.cancel }))
    expect(screen.getByRole('dialog', { name: strings.share.title })).toBeInTheDocument()
    expect((await linkField(dialog)).value).toBe(before)
    expect(await fakes.data.listMembers(pieceId)).toHaveLength(1)
  })

  it('Close closes the dialog, and opening it again loads the link again', async () => {
    const { user, dialog } = await setup()
    const before = (await linkField(dialog)).value
    await user.click(within(dialog).getByRole('button', { name: strings.share.close }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: strings.hub.shareButton }))
    expect((await linkField(await screen.findByRole('dialog', { name: strings.share.title }))).value).toBe(before)
  })

  it('a double click on Reset link, or on Remove, runs the change once', async () => {
    const { user, fakes, dialog } = await setup(true)
    const reset = vi.spyOn(fakes.data, 'resetShareLink')
    const remove = vi.spyOn(fakes.data, 'removeMember')
    await within(dialog).findByLabelText(strings.share.linkLabel)
    await user.click(within(dialog).getByRole('button', { name: strings.share.reset }))
    await user.dblClick(within(await screen.findByRole('alertdialog')).getByRole('button', { name: strings.share.resetConfirm }))
    await questionGone()
    expect(reset).toHaveBeenCalledTimes(1)
    await user.click(within(dialog).getByRole('button', { name: strings.share.removeLabel(OTHER_USER.name) }))
    await user.dblClick(within(await screen.findByRole('alertdialog')).getByRole('button', { name: strings.share.removeConfirm }))
    await questionGone()
    expect(remove).toHaveBeenCalledTimes(1)
  })

  describe('when something fails', () => {
    it('no link shows when it could not be loaded, and reopening tries again', async () => {
      const { user, fakes, dialog } = await setup(false, (fakes) => {
        vi.spyOn(fakes.data, 'getShare').mockRejectedValueOnce(new Error('offline'))
      })
      expect(await within(dialog).findByText(strings.share.failed)).toBeInTheDocument()
      expect(within(dialog).queryByLabelText(strings.share.linkLabel)).not.toBeInTheDocument()
      expect(within(dialog).queryByText(strings.share.loading)).not.toBeInTheDocument()
      await user.click(within(dialog).getByRole('button', { name: strings.share.close }))
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      await user.click(screen.getByRole('button', { name: strings.hub.shareButton }))
      const again = await screen.findByRole('dialog', { name: strings.share.title })
      const { token } = await fakes.data.getShare(
        (await fakes.data.listPieces()).find((piece) => piece.job?.status === 'done')!.id,
      )
      expect((await linkField(again)).value).toBe(`${window.location.origin}/join/${token}`)
      expect(within(again).queryByText(strings.share.failed)).not.toBeInTheDocument()
    })

    it('no link shows when the members could not be loaded', async () => {
      const { dialog } = await setup(false, (fakes) => {
        vi.spyOn(fakes.data, 'listMembers').mockRejectedValueOnce(new Error('offline'))
      })
      expect(await within(dialog).findByText(strings.share.failed)).toBeInTheDocument()
      expect(within(dialog).queryByLabelText(strings.share.linkLabel)).not.toBeInTheDocument()
    })

    it('a switch that could not be saved says so and stays as it was', async () => {
      const { user, fakes, dialog } = await setup()
      vi.spyOn(fakes.data, 'setShareEnabled').mockRejectedValueOnce(new Error('offline'))
      const toggle = await within(dialog).findByRole('switch', { name: strings.share.switchLabel })
      await user.click(toggle)
      expect(await within(dialog).findByText(strings.share.failed)).toBeInTheDocument()
      expect(toggle).toBeChecked()
    })

    it('a reset that failed says so in the open question, changes nothing, and can be tried again', async () => {
      const { user, fakes, pieceId, dialog } = await setup()
      const reset = vi.spyOn(fakes.data, 'resetShareLink').mockRejectedValueOnce(new Error('offline'))
      const before = (await linkField(dialog)).value
      const tokenBefore = fakes.store.shares.get(pieceId)!.token
      await user.click(within(dialog).getByRole('button', { name: strings.share.reset }))
      const question = await screen.findByRole('alertdialog')
      await user.click(within(question).getByRole('button', { name: strings.share.resetConfirm }))
      expect(await within(question).findByText(strings.share.failed)).toBeInTheDocument()
      expect(screen.getByRole('alertdialog')).toBe(question)
      expect(within(question).getByRole('button', { name: strings.share.resetConfirm })).toBeEnabled()
      expect(screen.getByLabelText<HTMLInputElement>(strings.share.linkLabel).value).toBe(before)
      expect(fakes.store.shares.get(pieceId)!.token).toBe(tokenBefore)
      await user.click(within(question).getByRole('button', { name: strings.share.resetConfirm }))
      await questionGone()
      expect(reset).toHaveBeenCalledTimes(2)
      expect(screen.getByLabelText<HTMLInputElement>(strings.share.linkLabel).value).not.toBe(before)
    })

    it('a failure shown in a question is gone when the question is cancelled and asked again', async () => {
      const { user, fakes, dialog } = await setup()
      vi.spyOn(fakes.data, 'resetShareLink').mockRejectedValueOnce(new Error('offline'))
      await within(dialog).findByLabelText(strings.share.linkLabel)
      await user.click(within(dialog).getByRole('button', { name: strings.share.reset }))
      const question = await screen.findByRole('alertdialog')
      await user.click(within(question).getByRole('button', { name: strings.share.resetConfirm }))
      await within(question).findByText(strings.share.failed)
      await user.click(within(question).getByRole('button', { name: strings.share.cancel }))
      await questionGone()
      await user.click(within(dialog).getByRole('button', { name: strings.share.reset }))
      expect(within(await screen.findByRole('alertdialog')).queryByText(strings.share.failed)).not.toBeInTheDocument()
    })

    it('a removal that failed says so in the open question, keeps the member, and can be tried again', async () => {
      const { user, fakes, pieceId, dialog } = await setup(true)
      const remove = vi.spyOn(fakes.data, 'removeMember').mockRejectedValueOnce(new Error('offline'))
      await user.click(await within(dialog).findByRole('button', { name: strings.share.removeLabel(OTHER_USER.name) }))
      const question = await screen.findByRole('alertdialog')
      await user.click(within(question).getByRole('button', { name: strings.share.removeConfirm }))
      expect(await within(question).findByText(strings.share.failed)).toBeInTheDocument()
      expect(screen.getByRole('alertdialog')).toBe(question)
      expect(within(dialog).getByText(OTHER_USER.name)).toBeInTheDocument()
      expect(await fakes.data.listMembers(pieceId)).toHaveLength(1)
      await user.click(within(question).getByRole('button', { name: strings.share.removeConfirm }))
      await questionGone()
      expect(remove).toHaveBeenCalledTimes(2)
      expect(within(dialog).queryByText(OTHER_USER.name)).not.toBeInTheDocument()
    })

    it('a removal that worked needs no second read of the list', async () => {
      const { user, fakes, dialog } = await setup(true)
      await within(dialog).findByText(OTHER_USER.name)
      vi.spyOn(fakes.data, 'listMembers').mockRejectedValue(new Error('offline'))
      await user.click(within(dialog).getByRole('button', { name: strings.share.removeLabel(OTHER_USER.name) }))
      await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: strings.share.removeConfirm }))
      await questionGone()
      expect(within(dialog).queryByText(OTHER_USER.name)).not.toBeInTheDocument()
      expect(within(dialog).getByText(strings.share.noMembers)).toBeInTheDocument()
      expect(within(dialog).queryByText(strings.share.failed)).not.toBeInTheDocument()
    })

    it('a copy that failed says so and does not say Copied', async () => {
      const { user, dialog } = await setup()
      vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValueOnce(new Error('denied'))
      await within(dialog).findByLabelText(strings.share.linkLabel)
      await user.click(within(dialog).getByRole('button', { name: strings.share.copy }))
      expect(await within(dialog).findByText(strings.share.failed)).toBeInTheDocument()
      expect(within(dialog).queryByRole('button', { name: strings.share.copied })).not.toBeInTheDocument()
    })
  })
  describe('the rights question (the music rule, Decision 2026-11-06)', () => {
    it('a piece that was never shared opens with its link off and the switch off', async () => {
      const { fakes, pieceId, dialog } = await setup(false, undefined, false)
      const toggle = await within(dialog).findByRole('switch', { name: strings.share.switchLabel })

      expect(toggle).not.toBeChecked()
      expect(within(dialog).getByText(strings.share.linkOff)).toBeInTheDocument()
      expect(fakes.store.shares.get(pieceId)).toMatchObject({ enabled: false, rightsConfirmedAt: null })
    })

    it('turning it on asks first, in the words of the board: a title, the sentence, a tick and the button', async () => {
      const { user, fakes, pieceId, dialog } = await setup(false, undefined, false)
      const toggle = await within(dialog).findByRole('switch', { name: strings.share.switchLabel })
      expect(strings.share.rightsTitle).toBe('Before you share this piece')
      expect(strings.share.rightsBody).toBe('Please confirm that this piece is your own music, in the public domain, or used with permission.')
      expect(strings.share.rightsTick).toBe('I confirm')
      expect(strings.share.rightsConfirm).toBe('Turn on sharing')

      await user.click(toggle)

      const question = await rightsQuestion()
      expect(within(question).getByText(strings.share.rightsBody)).toBeInTheDocument()
      expect(within(question).getByRole('checkbox', { name: strings.share.rightsTick })).not.toBeChecked()
      expect(within(question).getByRole('button', { name: strings.share.rightsConfirm })).toBeDisabled()
      // Nothing is saved, and the switch is still off, until it is answered.
      expect(fakes.store.shares.get(pieceId)).toMatchObject({ enabled: false, rightsConfirmedAt: null })
      expect(toggle).not.toBeChecked()
    })

    it('ticking enables the button; it turns the link on and saves the time, once', async () => {
      const { user, fakes, pieceId, dialog } = await setup(false, undefined, false)
      await user.click(await within(dialog).findByRole('switch', { name: strings.share.switchLabel }))
      const question = await rightsQuestion()

      await user.click(within(question).getByRole('checkbox', { name: strings.share.rightsTick }))
      const turnOn = within(question).getByRole('button', { name: strings.share.rightsConfirm })
      expect(turnOn).toBeEnabled()
      await user.click(turnOn)
      await questionGone()

      expect(fakes.store.shares.get(pieceId)!.enabled).toBe(true)
      expect(fakes.store.shares.get(pieceId)!.rightsConfirmedAt).not.toBeNull()
      expect(within(dialog).getByRole('switch', { name: strings.share.switchLabel })).toBeChecked()
      expect(within(dialog).queryByText(strings.share.linkOff)).not.toBeInTheDocument()
      signInAs(fakes.store, THIRD_USER.id)
      expect((await fakes.data.joinPiece(fakes.store.shares.get(pieceId)!.token)).status).toBe('joined')
    })

    it('cancelling changes nothing, and the tick starts empty the next time it is asked', async () => {
      const { user, fakes, pieceId, dialog } = await setup(false, undefined, false)
      const toggle = await within(dialog).findByRole('switch', { name: strings.share.switchLabel })
      await user.click(toggle)
      let question = await rightsQuestion()
      await user.click(within(question).getByRole('checkbox', { name: strings.share.rightsTick }))
      await user.click(within(question).getByRole('button', { name: strings.share.cancel }))
      await questionGone()

      expect(fakes.store.shares.get(pieceId)).toMatchObject({ enabled: false, rightsConfirmedAt: null })
      expect(toggle).not.toBeChecked()
      await user.click(toggle)
      question = await rightsQuestion()
      expect(within(question).getByRole('checkbox', { name: strings.share.rightsTick })).not.toBeChecked()
      expect(within(question).getByRole('button', { name: strings.share.rightsConfirm })).toBeDisabled()
    })

    it('once confirmed for the piece it is not asked again: off and on go straight through', async () => {
      const { user, fakes, pieceId, dialog } = await setup(false, undefined, false)
      const toggle = await within(dialog).findByRole('switch', { name: strings.share.switchLabel })
      await user.click(toggle)
      const question = await rightsQuestion()
      await user.click(within(question).getByRole('checkbox', { name: strings.share.rightsTick }))
      await user.click(within(question).getByRole('button', { name: strings.share.rightsConfirm }))
      await questionGone()
      const confirmedAt = fakes.store.shares.get(pieceId)!.rightsConfirmedAt

      await user.click(toggle)
      await waitFor(() => expect(fakes.store.shares.get(pieceId)!.enabled).toBe(false))
      await user.click(toggle)
      await waitFor(() => expect(fakes.store.shares.get(pieceId)!.enabled).toBe(true))

      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
      expect(fakes.store.shares.get(pieceId)!.rightsConfirmedAt).toBe(confirmedAt)
    })

    it('a link that was already on before the rule stays on, and asks when it is turned on again after being turned off', async () => {
      const { user, fakes, pieceId, dialog } = await setup(false, (made, id) => {
        made.store.shares.set(id, { token: 'old-token', enabled: true, rightsConfirmedAt: null })
      }, false)
      const toggle = await within(dialog).findByRole('switch', { name: strings.share.switchLabel })
      expect(toggle).toBeChecked()

      await user.click(toggle)
      await waitFor(() => expect(fakes.store.shares.get(pieceId)!.enabled).toBe(false))
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
      await user.click(toggle)

      expect(await rightsQuestion()).toBeInTheDocument()
      expect(fakes.store.shares.get(pieceId)!.enabled).toBe(false)
    })

    it('a save that failed says so in the open question and changes nothing; the same question can be answered again', async () => {
      const { user, fakes, pieceId, dialog } = await setup(false, undefined, false)
      const save = vi.spyOn(fakes.data, 'setShareEnabled').mockRejectedValueOnce(new Error('offline'))
      const toggle = await within(dialog).findByRole('switch', { name: strings.share.switchLabel })
      await user.click(toggle)
      const question = await rightsQuestion()
      await user.click(within(question).getByRole('checkbox', { name: strings.share.rightsTick }))
      await user.click(within(question).getByRole('button', { name: strings.share.rightsConfirm }))

      expect(await within(question).findByText(strings.share.failed)).toBeInTheDocument()
      expect(fakes.store.shares.get(pieceId)).toMatchObject({ enabled: false, rightsConfirmedAt: null })
      expect(toggle).not.toBeChecked()

      await user.click(within(question).getByRole('button', { name: strings.share.rightsConfirm }))
      await questionGone()
      expect(save).toHaveBeenCalledTimes(2)
      expect(save).toHaveBeenLastCalledWith(pieceId, true, true)
      expect(fakes.store.shares.get(pieceId)!.enabled).toBe(true)
    })

    it('the data client itself refuses to turn a never-confirmed link on', async () => {
      const { fakes, pieceId } = await setup(false, undefined, false)
      await fakes.data.getShare(pieceId)

      await expect(fakes.data.setShareEnabled(pieceId, true)).rejects.toThrow(/confirm the rights/)
      expect(fakes.store.shares.get(pieceId)!.enabled).toBe(false)
    })
  })

  describe('the member limit', () => {
    /** OTHER joined first, then THIRD; the demo user's pieces admit one member, so THIRD is on hold. */
    const overLimit = (fakes: Fakes, pieceId: string) => {
      fakes.store.members.get(pieceId)!.set(THIRD_USER.id, newCreatedAt(fakes.store))
      setPlanLimits(fakes.store, 'unlimited', { members_per_piece: 1, members_per_part: 0 }) // the demo user is the admin: the Unlimited row
    }
    const rowOf = (dialog: HTMLElement, name: string) => within(dialog).getByText(name).closest('li')!

    it('says how many joined of how many the piece admits', async () => {
      const { dialog } = await setup(true)
      expect(await within(dialog).findByText(strings.share.memberCount(1, 30))).toBeInTheDocument()
      expect(within(dialog).queryByText(strings.share.onHold)).not.toBeInTheDocument()
    })

    it('over the limit it says so, how many are on hold, and marks each of them with the words On hold', async () => {
      const { dialog } = await setup(true, overLimit)

      expect(await within(dialog).findByText(strings.share.memberCount(2, 1))).toBeInTheDocument()
      expect(within(dialog).getByText(strings.share.overLimit(1, 1))).toBeInTheDocument()
      expect(within(rowOf(dialog, THIRD_USER.name)).getByText(strings.share.onHold)).toBeInTheDocument()
      expect(within(rowOf(dialog, OTHER_USER.name)).queryByText(strings.share.onHold)).not.toBeInTheDocument()
    })

    it('says how many people are on hold when there are several', () => {
      expect(strings.share.overLimit(30, 2)).toBe(
        'This piece is over its limit of 30 members. The 2 people who joined last are on hold until there is room. Remove someone to let them in.',
      )
      expect(strings.share.overLimit(30, 1)).toBe(
        'This piece is over its limit of 30 members. The person who joined last is on hold until there is room. Remove someone to let them in.',
      )
    })

    it('removing the older member lets the held one in at once, with no second read', async () => {
      const { user, fakes, pieceId, dialog } = await setup(true, overLimit)
      await within(dialog).findByText(strings.share.overLimit(1, 1))
      const reads = vi.spyOn(fakes.data, 'listMembers')

      await user.click(within(dialog).getByRole('button', { name: strings.share.removeLabel(OTHER_USER.name) }))
      await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: strings.share.removeConfirm }))
      await questionGone()

      expect(within(dialog).getByText(strings.share.memberCount(1, 1))).toBeInTheDocument()
      expect(within(dialog).queryByText(strings.share.overLimit(1, 1))).not.toBeInTheDocument()
      expect(within(rowOf(dialog, THIRD_USER.name)).queryByText(strings.share.onHold)).not.toBeInTheDocument()
      expect(reads).not.toHaveBeenCalled()
      expect((await fakes.data.listMembers(pieceId)).map((member) => member.onHold)).toEqual([false])
    })

    it('a limit that could not be loaded leaves out only the count line', async () => {
      const { dialog } = await setup(true, (fakes) => {
        vi.spyOn(fakes.data, 'getMemberLimit').mockRejectedValue(new Error('offline'))
      })

      expect(await within(dialog).findByText(OTHER_USER.name)).toBeInTheDocument()
      expect(await linkField(dialog)).toBeInTheDocument()
      expect(within(dialog).queryByText(strings.share.memberCount(1, 30))).not.toBeInTheDocument()
      expect(within(dialog).queryByText(strings.share.failed)).not.toBeInTheDocument()
    })

    it('the rights tick and its sentence are as they were', () => {
      expect(strings.share.rightsTick).toBe('I confirm')
      expect(strings.share.rightsBody).toBe('Please confirm that this piece is your own music, in the public domain, or used with permission.')
    })
  })
})
