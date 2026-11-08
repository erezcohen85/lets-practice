import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { type EditorDoc, setMarks, setMeters, setPlayOrder } from '@/domain/pieceEdits'
import { markPickupBar, pickupOn, setPickupBarUnits, unmarkPickupBar } from '@/domain/pickup'
import { demoDoc } from '@/domain/pieceFixtures'
import { strings } from '@/strings'
import { StructurePanel, type StructurePanelProps } from './StructurePanel'

// A pickup in the middle of the piece reads p7 and takes no number: the bars after it read one lower. These tests use a doc with
// the top pickup (p1) and an unnumbered pickup at internal bar 7: p1, 1..6, p7, 7..
const text = strings.structure
const PARTS = [
  { id: 'clarinet', name: 'Clarinet in B♭ 1' },
  { id: 'trumpet', name: 'Trumpet in B♭ 2' },
  { id: 'flute', name: 'Flute' },
]

function ok(result: ReturnType<typeof pickupOn>): EditorDoc {
  if (!result.ok) throw new Error(`refused: ${result.reason}`)
  return result.doc
}

/** 64 bars, no short bar. */
const plain = () => demoDoc()
/** The top pickup and the pickup p7: 63 numbered-or-not bars after bar 0. */
const both = () => ok(markPickupBar(ok(pickupOn(demoDoc())), 7, 2))
/** Only p7 (internal bar 7). */
const middleOnly = () => ok(markPickupBar(demoDoc(), 7, 2))

function setup(props: Partial<StructurePanelProps> = {}) {
  const onEdit = vi.fn()
  const user = userEvent.setup()
  const view = render(
    <StructurePanel doc={plain()} parts={PARTS} partId="clarinet" barLineMode="ripple" open section="bars" onOpenChange={vi.fn()} onEdit={onEdit} {...props} />,
  )
  return { user, onEdit, ...view }
}

const edited = (onEdit: ReturnType<typeof vi.fn>): EditorDoc => onEdit.mock.calls.at(-1)?.[0].doc
const apply = () => screen.getByRole('button', { name: text.apply })
const rows = () => Array.from(document.querySelectorAll<HTMLElement>('[data-slot=pickup-row]'))

describe('the Pickup bars box with two rows', () => {
  it('counts the pickups in its chip and lists the top of the piece and the bar before 7, each with its length', () => {
    setup({ doc: both() })

    expect(screen.getByText(text.pickup.count(2))).toBeInTheDocument()
    expect(rows()).toHaveLength(2)
    expect(rows()[0]).toHaveTextContent(`${text.pickup.before} 1`)
    expect(rows()[0]).toHaveTextContent(text.pickup.row)
    expect(rows()[1]).toHaveTextContent(`${text.pickup.before} 7`)
    expect(rows()[1]).not.toHaveTextContent(text.pickup.row)
    expect(within(rows()[1]).getByRole('status', { name: text.pickup.length })).toHaveTextContent('2')
  })

  it('says "No pickup bar detected" with none, and shows the copy for before any bar', () => {
    setup()
    expect(screen.getByText(text.pickup.none)).toBeInTheDocument()
    expect(screen.getByText('Missed a pickup? Add one at the top of the piece or before any bar.')).toBeInTheDocument()
  })

  it('adds a pickup before bar 7: the bar that reads 7 is marked short and unnumbered, in one step, with no confirm', async () => {
    const { user, onEdit } = setup()
    await user.click(screen.getByRole('button', { name: text.pickup.add }))
    const field = screen.getByLabelText(text.pickup.beforeField)
    // the first row of a piece without a top pickup starts at bar 1
    expect(field).toHaveValue('1')
    await user.clear(field)
    await user.type(field, '7')
    await user.click(screen.getByRole('button', { name: text.pickup.set }))

    expect(onEdit).toHaveBeenCalledTimes(1)
    expect(edited(onEdit).timing.shortBars).toEqual([{ bar: 7, units: 1, unnumbered: true }])
    expect(edited(onEdit).timing.barCount).toBe(64)
    expect(onEdit.mock.calls[0][0].label).toEqual({ kind: 'add-pickup-bar', bar: 7 })
  })

  it('reads the typed bar as a label: with p7 in place, "8" is the bar after the bar that reads 7', async () => {
    const { user, onEdit } = setup({ doc: middleOnly() })
    await user.click(screen.getByRole('button', { name: text.pickup.add }))
    await user.clear(screen.getByLabelText(text.pickup.beforeField))
    await user.type(screen.getByLabelText(text.pickup.beforeField), '9')
    await user.click(screen.getByRole('button', { name: text.pickup.set }))

    // numbered bar 9 is internal bar 10
    expect(edited(onEdit).timing.shortBars).toEqual([{ bar: 7, units: 2, unnumbered: true }, { bar: 10, units: 1, unnumbered: true }])
  })

  it('removes a pickup with its X: the numbers come back, in one step', async () => {
    const { user, onEdit } = setup({ doc: both() })
    await user.click(within(rows()[1]).getByRole('button', { name: new RegExp(text.pickup.remove) }))

    expect(edited(onEdit).timing.shortBars).toEqual([{ bar: 0, units: 1 }])
    expect(onEdit.mock.calls[0][0].label).toEqual({ kind: 'remove-pickup-bar', bar: 7 })
    expect(onEdit).toHaveBeenCalledWith(unmarkPickupBar(both(), 7))
  })

  it('steps the length of a pickup in the middle as one step each', async () => {
    const { user, onEdit } = setup({ doc: middleOnly() })
    await user.click(within(rows()[0]).getByRole('button', { name: text.pickup.longer }))

    expect(onEdit).toHaveBeenCalledWith(setPickupBarUnits(middleOnly(), 7, 3))
    expect(within(rows()[0]).getByRole('button', { name: text.pickup.longer })).toBeEnabled()
  })

  it('refuses with a sentence each: the last bar, a bar in a multi-rest, a bar already a pickup, a bar next to one, a bar that is not in the piece, the top twice', async () => {
    const multi = middleOnly()
    // the flute rests bars 20-22 in one box
    multi.pages = multi.pages.map((page) =>
      page.partId === 'flute'
        ? { ...page, bars: page.bars.map((box) => (box.bar >= 20 && box.bar <= 22 ? { ...box, x: 100, y: 100, w: 300, h: 100 } : box)) }
        : page,
    )
    const { user, onEdit } = setup({ doc: multi })
    const tryBar = async (typed: string) => {
      await user.click(screen.getByRole('button', { name: text.pickup.add }))
      const fields = screen.getAllByLabelText(text.pickup.beforeField)
      await user.clear(fields.at(-1) as HTMLElement)
      await user.type(fields.at(-1) as HTMLElement, typed)
      await user.click(screen.getAllByRole('button', { name: text.pickup.set }).at(-1) as HTMLElement)
      return screen.getByRole('alert').textContent
    }

    // the last bar reads 63 (64 bars, one of them a pickup)
    expect(await tryBar('63')).toBe(text.pickup.refusals['pickup-edge'])
    // internal bar 21 reads 20
    expect(await tryBar('20')).toBe(text.pickup.refusals['in-multi-rest'])
    expect(await tryBar('p7')).toBe(text.pickup.refusals['already-pickup'])
    expect(await tryBar('7')).toBe(text.pickup.refusals['next-to-pickup'])
    expect(await tryBar('99')).toBe(strings.structure.errors.invalidBarField('1', '63'))
    expect(await tryBar('x')).toBe(strings.structure.errors.invalidBarField('1', '63'))
    expect(onEdit).not.toHaveBeenCalled()
  })

  it('cannot add the top of the piece twice', async () => {
    const { user, onEdit } = setup({ doc: both() })
    await user.click(screen.getByRole('button', { name: text.pickup.add }))
    await user.type(screen.getByLabelText(text.pickup.beforeField), '1')
    await user.click(screen.getByRole('button', { name: text.pickup.set }))

    expect(screen.getByRole('alert')).toHaveTextContent(text.pickup.topTaken)
    expect(onEdit).not.toHaveBeenCalled()
  })

  it('counts the numbered bars in the Detected chip: 64 bars with p7 are 63 bars + pickup', () => {
    setup({ doc: middleOnly() })
    expect(screen.getByText('63 bars + pickup')).toBeInTheDocument()
  })
})

describe('the Structure fields take labels and show them back', () => {
  it('Play order: rows show p1-14 and accept p7; a typed p label is the internal bar', async () => {
    const { user, onEdit } = setup({ doc: both(), section: 'playOrder' })
    const fields = screen.getAllByRole('textbox')
    // the demo rows [1-16, 9-16, 17-64] after the top pickup are [0-15, 8-15, 16-63]: p1-14, 7-14, 15-62
    expect(fields.map((field) => (field as HTMLInputElement).value)).toEqual(['p1', '14', '7', '14', '15', '62'])
    fireEvent.change(fields[1], { target: { value: 'p7' } })
    await user.click(apply())

    expect(onEdit).toHaveBeenCalledWith(setPlayOrder(both(), [{ from: 0, to: 7 }, { from: 8, to: 15 }, { from: 16, to: 63 }]))
  })

  it('Play order: a p label where there is no such pickup gives the field\'s normal error', async () => {
    const { user, onEdit } = setup({ doc: both(), section: 'playOrder' })
    fireEvent.change(screen.getAllByRole('textbox')[1], { target: { value: 'p9' } })
    await user.click(apply())

    expect(onEdit).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent(text.errors.playOrderOutOfRange('62', 'p1'))
  })

  it('Meters: the meter from bar 48 shows from 47 and accepts a p label', async () => {
    const { user, onEdit } = setup({ doc: both(), section: 'meters' })
    const from = screen.getAllByLabelText(/from bar$/)
    expect((from[1] as HTMLInputElement).value).toBe('47')
    fireEvent.change(from[1], { target: { value: '50' } })
    await user.click(apply())

    // the numbered bar 50 is internal bar 51
    expect(onEdit).toHaveBeenCalledWith(setMeters(both(), [{ fromBar: 1, numerator: 4, denominator: 4 }, { fromBar: 51, numerator: 2, denominator: 4 }]))

    fireEvent.change(from[1], { target: { value: 'p9' } })
    await user.click(apply())
    expect(screen.getByRole('alert')).toHaveTextContent(text.errors.meterOutOfRange('62'))
  })

  it('Marks: a fermata on p7 is shown as p7 and applies to the internal bar 7', async () => {
    const doc = ok(setMarks(both(), [{ bar: 7, kind: 'fermata' }], 'clarinet'))
    const { user, onEdit } = setup({ doc, section: 'marks' })
    const from = screen.getByLabelText(/Mark 1: from bar/) as HTMLInputElement
    expect(from.value).toBe('p7')
    expect(screen.getByLabelText(/Mark 1: to bar/)).toHaveValue('p7')
    fireEvent.change(from, { target: { value: '8' } })
    fireEvent.change(screen.getByLabelText(/Mark 1: to bar/), { target: { value: '8' } })
    await user.click(apply())

    // the numbered bar 8 is internal bar 9
    expect(edited(onEdit).timing.marks).toEqual([{ bar: 9, kind: 'fermata' }])
  })

  it('Rests of this part: a rest is written and read as a label', async () => {
    const { user, onEdit } = setup({ doc: both(), section: 'rests', open: true })
    await user.click(screen.getByRole('switch', { name: text.editAsText }))
    const box = screen.getByRole('textbox', { name: text.text.restsLabel })
    await user.type(box, 'p7-9')
    await user.click(apply())

    expect(edited(onEdit).pages.find((page) => page.partId === 'clarinet')?.rests).toEqual([7, 8, 9, 10])
  })

  it('Insert and Remove: Before p7 inserts after internal bar 6; a p label that does not exist is the normal error', async () => {
    const { user, onEdit } = setup({ doc: both() })
    await user.click(screen.getByRole('radio', { name: text.bars.before }))
    await user.type(screen.getByLabelText(text.bars.insertField), 'p7')
    await user.click(screen.getByRole('button', { name: text.bars.insertApply }))

    expect(onEdit).toHaveBeenCalledTimes(1)
    expect(onEdit.mock.calls[0][0].label).toEqual({ kind: 'insert-piece-bar', bar: 7 })

    await user.clear(screen.getByLabelText(text.bars.removeField))
    await user.type(screen.getByLabelText(text.bars.removeField), 'p9')
    await user.click(screen.getByRole('button', { name: text.bars.removeApply }))
    expect(screen.getByText(strings.structure.errors.invalidBarField('1', '62'))).toBeInTheDocument()
  })

  it('Edit as text: writes the pickups line and the labels, and reads a new pickups line back', async () => {
    const { user, onEdit } = setup({ doc: both(), section: 'meters' })
    await user.click(screen.getByRole('switch', { name: text.editAsText }))
    const box = screen.getByRole('textbox', { name: text.text.label }) as HTMLTextAreaElement
    expect(box.value).toContain('play order: p1-14, 7-14, 15-end')
    expect(box.value).toContain('short bars: pickup 1/4')
    expect(box.value).toContain('pickups: p7 2/4')

    fireEvent.change(box, { target: { value: box.value.replace('pickups: p7 2/4', 'pickups: p7 2/4, p21 1/4') } })
    await user.click(apply())

    // p21 is the pickup before the bar that reads 21: internal 21 + 1 pickup before it = 22... counted once p7 is in place: 21 + 1
    expect(edited(onEdit).timing.shortBars).toEqual([
      { bar: 0, units: 1 },
      { bar: 7, units: 2, unnumbered: true },
      { bar: 22, units: 1, unnumbered: true },
    ])
  })

  it('Edit as text: a p label that names no bar is the line\'s normal error', async () => {
    const { user, onEdit } = setup({ doc: both(), section: 'meters' })
    await user.click(screen.getByRole('switch', { name: text.editAsText }))
    const box = screen.getByRole('textbox', { name: text.text.label }) as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: box.value.replace('p1-14', 'p9-14') } })
    await user.click(apply())

    expect(onEdit).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent(text.text.errors['bad-range'])
  })
})
