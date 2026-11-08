import { configure, screen, waitFor, within } from '@testing-library/react'
import { createFakes, type Fakes } from '@/lib/fakes'
import { strings } from '@/strings'
import { renderWithApp } from '@/test/render'

const CLARK = 'piece-clark-county'
const text = strings.editor
const COLUMN = 1240 + 2 * 16

// Unlike the other Editor tests, these run on real timers, so Testing Library's 1 s wait is a real second. Mounting the
// whole Editor takes about 0.3 s on a quiet machine and over 1.5 s on a loaded one; the waits below are for work that
// finishes, not for a time limit, so they get 10 s (still under the 20 s test timeout) and a real failure still fails.
configure({ asyncUtilTimeout: 10_000 })

/** The Editor on the first part of Clark County, once its pages have loaded. */
async function open(fakes: Fakes = createFakes({ seed: 'demo' })) {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(COLUMN)
  const detail = (await fakes.data.getPiece(CLARK))!
  const view = renderWithApp(`/pieces/${CLARK}/edit?part=${detail.parts[0].id}`, { fakes })
  await screen.findAllByRole('img', { name: /^Page \d of 4$/ })
  return { ...view, fakes, detail }
}

const chip = (name: RegExp | string) => screen.getByRole('button', { name })

async function rename(user: Awaited<ReturnType<typeof open>>['user'], name: string) {
  await user.click(chip(/^Clarinet/))
  await user.click(await screen.findByRole('menuitem', { name: text.renamePart }))
  const dialog = await screen.findByRole('dialog', { name: strings.hub.renamePartTexts.title })
  const field = within(dialog).getByRole('textbox', { name: strings.hub.renamePartTexts.label })
  await user.clear(field)
  await user.type(field, `${name}{Enter}`)
}

describe('Editor: renaming the part in the top bar', () => {
  it('renames the part: the chip and the part menu show the new name and the dialog closes', async () => {
    const { user } = await open()

    await rename(user, 'Clarinet 1 (solo)')

    await waitFor(() => expect(chip('Clarinet 1 (solo)')).toBeInTheDocument())
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await user.click(chip('Clarinet 1 (solo)'))
    expect(screen.getByRole('menuitemradio', { name: 'Clarinet 1 (solo)' })).toHaveAttribute('aria-checked', 'true')
  })

  it('saves the name through the data client, as the hub would', async () => {
    const { user, fakes, detail } = await open()

    await rename(user, 'Clarinet 1 (solo)')

    await waitFor(async () => expect((await fakes.data.getPiece(CLARK))?.parts[0].name).toBe('Clarinet 1 (solo)'))
    expect((await fakes.data.getPiece(CLARK))?.parts[0].id).toBe(detail.parts[0].id)
  })

  it('does not reload the editor: the score and the open part stay', async () => {
    const { user } = await open()
    const pages = screen.getAllByRole('img', { name: /^Page \d of 4$/ })

    await rename(user, 'Clarinet 1 (solo)')
    await waitFor(() => expect(chip('Clarinet 1 (solo)')).toBeInTheDocument())

    expect(screen.queryByRole('status', { name: strings.common.loading })).toBeNull()
    expect(screen.getAllByRole('img', { name: /^Page \d of 4$/ })).toEqual(pages)
  })

  it('keeps the name after going to the hub and coming back to the editor', async () => {
    const { user, router, detail } = await open()
    await rename(user, 'Clarinet 1 (solo)')
    await waitFor(() => expect(chip('Clarinet 1 (solo)')).toBeInTheDocument())

    await user.click(screen.getByRole('link', { name: text.pieceHub }))
    expect(await screen.findByRole('link', { name: strings.hub.practicePart('Clarinet 1 (solo)') })).toBeInTheDocument()
    await router.navigate(`/pieces/${CLARK}/edit?part=${detail.parts[0].id}`)

    expect(await screen.findByRole('button', { name: 'Clarinet 1 (solo)' })).toBeInTheDocument()
  })

  it('says so and keeps the old name when it could not be saved', async () => {
    const { user, fakes } = await open()
    vi.spyOn(fakes.data, 'renamePart').mockRejectedValueOnce(new Error('down'))

    await rename(user, 'Clarinet 1 (solo)')

    expect(await screen.findByText(strings.hub.renamePartTexts.failed)).toBeInTheDocument()
    // The page behind a modal dialog is hidden from assistive technology, so the chip is looked up as hidden.
    expect(screen.getByRole('button', { name: /^Clarinet/, hidden: true })).toBeInTheDocument()
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})
