import { screen, waitFor, within } from '@testing-library/react'
import { createFakes } from '@/lib/fakes'
import { SentenceError } from '@/lib/processorClient'
import { strings } from '@/strings'
import { chooseFromMenu, chooseFromPieceMenu } from '@/test/hubMenu'
import { renderWithApp } from '@/test/render'

const hub = strings.hub
const suggest = strings.suggestName
const CLARK = 'piece-clark-county'

async function openRename(fakes = createFakes({ seed: 'demo' })) {
  const view = renderWithApp(`/pieces/${CLARK}`, { fakes })
  await screen.findByRole('list', { name: hub.parts })
  await chooseFromPieceMenu(view.user, hub.rename)
  const dialog = await screen.findByRole('dialog', { name: hub.renameTitle })
  return { ...view, fakes, dialog, field: within(dialog).getByRole('textbox', { name: hub.renameLabel }) }
}

describe('Piece hub: Suggest a name in Rename piece', () => {
  it('fills the title field with the suggestion, without saving it', async () => {
    const fakes = createFakes({ seed: 'demo' })
    vi.spyOn(fakes.processor, 'suggestPieceName').mockResolvedValue({ name: 'Clark County Celebration (Smith)', source: 'claude', note: null })
    const { user, dialog, field } = await openRename(fakes)

    await user.click(within(dialog).getByRole('button', { name: suggest.button }))

    await waitFor(() => expect(field).toHaveValue('Clark County Celebration (Smith)'))
    expect((await fakes.data.getPiece(CLARK))?.piece.title).not.toBe('Clark County Celebration (Smith)')
    await user.click(within(dialog).getByRole('button', { name: hub.renameSave }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect((await fakes.data.getPiece(CLARK))?.piece.title).toBe('Clark County Celebration (Smith)')
  })

  it('says it was the fallback and why, and still fills the field', async () => {
    const fakes = createFakes({ seed: 'demo' })
    vi.spyOn(fakes.processor, 'suggestPieceName').mockResolvedValue({ name: 'Live at the park', source: 'fallback', note: 'There is no Anthropic API key. Used the audio file name instead.' })
    const { user, dialog, field } = await openRename(fakes)

    await user.click(within(dialog).getByRole('button', { name: suggest.button }))

    expect(await within(dialog).findByRole('status')).toHaveTextContent('Used the audio file name instead.')
    expect(field).toHaveValue('Live at the park')
  })

  it('leaves the field alone when there is nothing to suggest from', async () => {
    const fakes = createFakes({ seed: 'demo' })
    vi.spyOn(fakes.processor, 'suggestPieceName').mockResolvedValue({ name: '', source: 'fallback', note: 'There was no title or file name to use.' })
    const { user, dialog, field } = await openRename(fakes)
    const before = (field as HTMLInputElement).value

    await user.click(within(dialog).getByRole('button', { name: suggest.button }))

    expect(await within(dialog).findByRole('status')).toHaveTextContent('no title or file name')
    expect(field).toHaveValue(before)
  })

  it('says the server’s sentence, or the generic one, when the call fails', async () => {
    const fakes = createFakes({ seed: 'demo' })
    const ask = vi.spyOn(fakes.processor, 'suggestPieceName').mockRejectedValueOnce(new SentenceError('The local run server did not answer.'))
    const { user, dialog } = await openRename(fakes)

    await user.click(within(dialog).getByRole('button', { name: suggest.button }))
    expect(await within(dialog).findByRole('status')).toHaveTextContent('did not answer')

    ask.mockRejectedValueOnce(new Error('boom'))
    await user.click(within(dialog).getByRole('button', { name: suggest.button }))
    await waitFor(() => expect(within(dialog).getByRole('status')).toHaveTextContent(suggest.failed))
  })

  it('has no suggest button in Rename part', async () => {
    const view = renderWithApp(`/pieces/${CLARK}`, { fakes: createFakes({ seed: 'demo' }) })
    await screen.findByRole('list', { name: hub.parts })
    const row = within(screen.getByRole('list', { name: hub.parts })).getAllByRole('listitem')[0]
    const name = row.querySelector('[data-slot="part-name"]')!.textContent!

    await chooseFromMenu(view.user, name, hub.rename, row)

    const dialog = await screen.findByRole('dialog', { name: hub.renamePartTexts.title })
    expect(within(dialog).queryByRole('button', { name: suggest.button })).toBeNull()
  })
})
