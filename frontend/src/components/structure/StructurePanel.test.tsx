import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { setBarsInBox } from '@/domain/boxEdits'
import { insertPartBar, removePartBar, shiftPartPickup, splitPartPickup } from '@/domain/partBars'
import { type EditorDoc, deleteBarLine, insertPieceBar, removePieceBar, setMarks, setMeters, setPlayOrder } from '@/domain/pieceEdits'
import { pickupOn } from '@/domain/pickup'
import { demoDoc } from '@/domain/pieceFixtures'
import { formatStructure } from '@/domain/structureText'
import { type PageLayer } from '@/domain/types'
import { strings } from '@/strings'
import { StructurePanel, type StructurePanelProps } from './StructurePanel'
import { barNamesOf } from '@/domain/barNames'

const text = strings.structure
const PARTS = [
  { id: 'clarinet', name: 'Clarinet in B♭ 1' },
  { id: 'trumpet', name: 'Trumpet in B♭ 2' },
  { id: 'flute', name: 'Flute' },
]

function setup(props: Partial<StructurePanelProps> = {}) {
  const onEdit = vi.fn()
  const onOpenChange = vi.fn()
  const user = userEvent.setup()
  const view = render(
    <StructurePanel
      doc={demoDoc()}
      parts={PARTS}
      partId="clarinet"
      barLineMode="ripple"
      open
      section="bars"
      onOpenChange={onOpenChange}
      onEdit={onEdit}
      {...props}
    />,
  )
  return { user, onEdit, onOpenChange, ...view }
}

/** Replaces what a field holds. */
async function fill(user: ReturnType<typeof userEvent.setup>, field: HTMLElement, value: string) {
  await user.clear(field)
  await user.type(field, value)
}

const apply = () => screen.getByRole('button', { name: text.apply })

/** The demo doc with the clarinet resting on `bars`; the trumpet and the flute play them. */
function withClarinetRests(doc: EditorDoc, bars: number[]): EditorDoc {
  return { ...doc, pages: doc.pages.map((page) => (page.partId === 'clarinet' ? { ...page, rests: bars } : page)) }
}

describe('while a realign runs', () => {
  it('disables the form and says why', () => {
    setup({ busy: true })

    expect(screen.getByText(text.busy)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: text.bars.insertApply })).toBeDisabled()
    expect(screen.getByRole('button', { name: text.bars.removeApply })).toBeDisabled()
  })

  it('disables Apply in the other sections too', async () => {
    const { rerender, onOpenChange, onEdit } = setup({ busy: true, section: 'meters' })
    expect(screen.getByRole('button', { name: text.apply })).toBeDisabled()
    rerender(<StructurePanel doc={demoDoc()} parts={PARTS} partId="clarinet" barLineMode="ripple" open section="marks" onOpenChange={onOpenChange} onEdit={onEdit} busy />)

    expect(screen.getByRole('button', { name: text.apply })).toBeDisabled()
  })

  it('shows no note and keeps the forms enabled otherwise', () => {
    setup()

    expect(screen.queryByText(text.busy)).toBeNull()
    expect(screen.getByRole('button', { name: text.bars.insertApply })).toBeEnabled()
  })
})

describe('the collapsed strip', () => {
  it('shows only its title while closed: no chips, no tabs, no text switch', () => {
    setup({ open: false })

    expect(screen.getByRole('button', { name: text.title, expanded: false })).toBeInTheDocument()
    expect(screen.queryByRole('tab')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '64 bars' })).not.toBeInTheDocument()
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
  })

  it('opens and closes with the Structure button', async () => {
    const { user, onOpenChange, rerender } = setup({ open: false })
    const toggle = screen.getByRole('button', { name: text.title, expanded: false })

    await user.click(toggle)
    expect(onOpenChange).toHaveBeenLastCalledWith(true)

    rerender(
      <StructurePanel doc={demoDoc()} parts={PARTS} partId="clarinet" barLineMode="ripple" open section="bars" onOpenChange={onOpenChange} onEdit={vi.fn()} />,
    )
    await user.click(screen.getByRole('button', { name: text.title, expanded: true }))
    expect(onOpenChange).toHaveBeenLastCalledWith(false)
  })

  it('shows no form while closed', () => {
    setup({ open: false })
    expect(screen.queryByRole('button', { name: text.apply })).not.toBeInTheDocument()
  })

  it('has no tabs and no Edit as text while closed', () => {
    setup({ open: false })

    expect(screen.queryByRole('tablist')).toBeNull()
    expect(screen.queryByRole('tab')).toBeNull()
    expect(screen.queryByRole('switch', { name: text.editAsText })).toBeNull()
  })
})

describe('the open panel\'s tabs', () => {
  it('shows the piece\'s four sections and the part\'s two as tabs, with the open one selected, and Edit as text', () => {
    setup({ section: 'playOrder' })

    const [piece, part] = screen.getAllByRole('tablist')
    expect(piece).toHaveAccessibleName(text.groups.piece)
    expect(within(piece).getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Bars', 'Meters', 'Play order', 'Marks'])
    expect(part).toHaveAccessibleName(text.groups.part('Clarinet in B♭ 1'))
    expect(within(part).getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Bars', 'Rests'])
    expect(screen.getByRole('tab', { name: 'Play order' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Marks' })).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByRole('switch', { name: text.editAsText })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '64 bars' })).toBeNull()
  })

  it('opens another section when its tab is pressed', async () => {
    const { user, onOpenChange } = setup()

    await user.click(screen.getByRole('tab', { name: 'Marks' }))

    expect(onOpenChange).toHaveBeenCalledWith(true, 'marks')
  })

  it('turning on Edit as text on Bars moves the panel to Meters, which has the text', async () => {
    const { user, onOpenChange } = setup({ section: 'bars' })

    await user.click(screen.getByRole('switch', { name: text.editAsText }))

    expect(onOpenChange).toHaveBeenCalledWith(true, 'meters')
  })

  it('turns the text off when the panel closes, so it opens on the forms again', async () => {
    const { user, rerender, onOpenChange, onEdit } = setup({ section: 'meters' })
    await user.click(screen.getByRole('switch', { name: text.editAsText }))
    expect(screen.getByRole('textbox', { name: text.text.label })).toBeInTheDocument()

    const panel = (open: boolean) => (
      <StructurePanel doc={demoDoc()} parts={PARTS} partId="clarinet" barLineMode="ripple" open={open} section="meters" onOpenChange={onOpenChange} onEdit={onEdit} />
    )
    rerender(panel(false))
    rerender(panel(true))

    expect(screen.queryByRole('textbox', { name: text.text.label })).toBeNull()
    expect(screen.getByLabelText(text.meters.rowFrom(1))).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: text.editAsText })).not.toBeChecked()
  })
})

const barsText = text.bars
const chip = () => document.querySelector('[data-slot="detected-chip"]') as HTMLElement

/** The Insert row: pick a side, type the bar, Apply. */
async function insertAt(user: ReturnType<typeof userEvent.setup>, bar: string, side: 'before' | 'after' = 'after') {
  await user.click(screen.getByRole('radio', { name: barsText[side] }))
  await fill(user, screen.getByLabelText(barsText.insertField), bar)
  await user.click(screen.getByRole('button', { name: barsText.insertApply }))
}

describe('the Bars section', () => {
  it('shows the safety card, then two boxes: Bars in the piece and Pickup bars, with no per part counts or warnings', () => {
    setup()

    expect(screen.getByText(text.safety.title)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: barsText.pieceTitle })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: text.pickup.title })).toBeInTheDocument()
    expect(screen.queryByText(/Bars in each part/)).toBeNull()
    expect(screen.queryByText(/Fix it in This part/)).toBeNull()
  })

  it('prints the safety card on every Piece tab, and not on the part\'s', () => {
    for (const section of ['bars', 'meters', 'playOrder', 'marks'] as const) {
      const { unmount } = setup({ section })
      expect(screen.getByText(text.safety.title)).toBeInTheDocument()
      unmount()
    }
    setup({ section: 'partBars' })
    expect(screen.queryByText(text.safety.title)).toBeNull()
  })

  it('says the piece is locked when Edit piece structure is off, with its switch on the card asking to turn it on', async () => {
    const onRequestPieceOn = vi.fn()
    const { user } = setup({ pieceOn: false, onRequestPieceOn })

    expect(screen.getByText(text.safety.locked)).toBeInTheDocument()
    const toggle = screen.getByRole('switch', { name: text.safety.title })
    expect(toggle).not.toBeChecked()
    expect(screen.getByRole('button', { name: barsText.insertApply })).toBeDisabled()
    await user.click(toggle)
    expect(onRequestPieceOn).toHaveBeenCalled()
  })

  it('says the changes reach every part when it is on, and its switch turns it off', async () => {
    const onRequestPieceOff = vi.fn()
    const { user } = setup({ pieceOn: true, onRequestPieceOff })

    expect(screen.getByText(text.safety.on)).toBeInTheDocument()
    await user.click(screen.getByRole('switch', { name: text.safety.title }))
    expect(onRequestPieceOff).toHaveBeenCalled()
  })

  it('greys the boxes out while it is off', () => {
    setup({ pieceOn: false })
    expect(screen.getByRole('heading', { name: barsText.pieceTitle }).closest('section')).toHaveClass('pointer-events-none', 'opacity-45')
  })

  it('keeps the Renumber switch in the piece box and says the edits are for the piece only', async () => {
    const onBarLineModeChange = vi.fn()
    const { user } = setup({ barLineMode: 'ripple', onBarLineModeChange })
    expect(screen.getByText(barsText.pieceNote)).toBeInTheDocument()

    const renumber = screen.getByRole('switch', { name: strings.editor.renumber })
    expect(renumber).toBeChecked()
    await user.click(renumber)
    expect(onBarLineModeChange).toHaveBeenCalledWith('plain')
  })

  it('shows Detected as the count at open, and Now only once an edit changed it', () => {
    const { rerender } = setup()
    expect(chip()).toHaveTextContent('Detected: 64 bars')
    expect(chip()).not.toHaveTextContent(barsText.now)

    const inserted = insertPieceBar(demoDoc(), 22, 'ripple')
    if (!inserted.ok) throw new Error('insert must work')
    rerender(
      <StructurePanel doc={inserted.doc} parts={PARTS} partId="clarinet" barLineMode="ripple" open section="bars" onOpenChange={vi.fn()} onEdit={vi.fn()} />,
    )
    expect(chip()).toHaveTextContent('Detected: 64 bars· Now: 65 bars')
  })

  it('inserts after bar 22 with the mode of the switch, as one edit; After is the default', async () => {
    const { user, onEdit } = setup({ barLineMode: 'ripple' })
    expect(screen.getByRole('radio', { name: barsText.after })).toBeChecked()

    await fill(user, screen.getByLabelText(barsText.insertField), '22')
    await user.click(screen.getByRole('button', { name: barsText.insertApply }))

    expect(onEdit).toHaveBeenCalledTimes(1)
    expect(onEdit).toHaveBeenCalledWith(insertPieceBar(demoDoc(), 22, 'ripple'))
  })

  it('inserts before bar n as an insert after bar n - 1, and before bar 1 as after bar 0', async () => {
    const { user, onEdit } = setup()

    await insertAt(user, '22', 'before')
    expect(onEdit).toHaveBeenLastCalledWith(insertPieceBar(demoDoc(), 21, 'ripple'))

    await insertAt(user, '1', 'before')
    expect(onEdit).toHaveBeenLastCalledWith(insertPieceBar(demoDoc(), 0, 'ripple'))
  })

  it('uses plain mode when the switch is off', async () => {
    const { user, onEdit } = setup({ barLineMode: 'plain' })
    await insertAt(user, '22')
    expect(onEdit).toHaveBeenCalledWith(insertPieceBar(demoDoc(), 22, 'plain'))
  })

  it('removes a bar with the mode of the switch', async () => {
    const { user, onEdit } = setup()

    await fill(user, screen.getByLabelText(barsText.removeField), '30')
    await user.click(screen.getByRole('button', { name: barsText.removeApply }))

    expect(onEdit).toHaveBeenCalledWith(removePieceBar(demoDoc(), 30, 'ripple'))
  })

  it('fills the fields from the prefill', () => {
    const { unmount } = setup({ barsPrefill: { action: 'insert', bar: 22 } })
    expect(screen.getByLabelText(barsText.insertField)).toHaveValue('22')
    expect(screen.getByLabelText(barsText.removeField)).toHaveValue('')
    unmount()

    setup({ barsPrefill: { action: 'remove', bar: 40 } })
    expect(screen.getByLabelText(barsText.removeField)).toHaveValue('40')
    expect(screen.getByLabelText(barsText.insertField)).toHaveValue('')
  })

  it('shows an error and applies nothing for a bar outside the piece', async () => {
    const { user, onEdit } = setup()

    await insertAt(user, '65')
    await fill(user, screen.getByLabelText(barsText.removeField), '0')
    await user.click(screen.getByRole('button', { name: barsText.removeApply }))

    expect(screen.getAllByText(text.errors.invalidBarField('1', '64'))).toHaveLength(2)
    expect(onEdit).not.toHaveBeenCalled()
  })

  it('refuses text that is not a whole number', async () => {
    const { user, onEdit } = setup()
    await insertAt(user, 'twelve')
    expect(screen.getByText(text.errors.invalidBarField('1', '64'))).toBeInTheDocument()
    expect(onEdit).not.toHaveBeenCalled()
  })

  it('warns before Apply when a plain insert inside a repeat would clear recording times', async () => {
    const dropped = insertPieceBar(demoDoc(), 12, 'plain')
    if (!dropped.ok) throw new Error('the demo insert must work')
    expect(dropped.droppedLocators.length).toBeGreaterThan(0)
    const { user, onEdit } = setup({ barLineMode: 'plain' })

    await fill(user, screen.getByLabelText(barsText.insertField), '12')

    expect(screen.getByText(barsText.dropped(dropped.droppedLocators.length))).toBeInTheDocument()
    expect(onEdit).not.toHaveBeenCalled()
  })

  it('does not warn when the times move with their bars', async () => {
    const { user } = setup({ barLineMode: 'ripple' })
    await fill(user, screen.getByLabelText(barsText.insertField), '12')
    expect(screen.queryByText(/will be cleared/)).not.toBeInTheDocument()
  })
})

describe('a piece with one part', () => {
  const ONE = [PARTS[0]]
  const oneSetup = (props: Partial<StructurePanelProps> = {}) => setup({ parts: ONE, ...props })
  const short = (doc: EditorDoc): EditorDoc => ({ ...doc, pages: doc.pages.map((page) => (page.partId === 'clarinet' ? { ...page, bars: page.bars.slice(0, -1) } : page)) })
  const tabs = (list: HTMLElement) => within(list).getAllByRole('tab').map((tab) => tab.textContent)

  it('hides the This part group when the part is even, and Rests joins the main row after Marks', () => {
    oneSetup({ section: 'marks' })

    const lists = screen.getAllByRole('tablist')
    expect(lists).toHaveLength(1)
    expect(tabs(lists[0])).toEqual(['Bars', 'Meters', 'Play order', 'Marks', 'Rests'])
    expect(screen.queryByText(text.groups.partLabel)).toBeNull()
    expect(screen.queryByRole('tablist', { name: text.groups.part('Clarinet in B♭ 1') })).toBeNull()
  })

  it('reads "Piece" rather than "Piece · all parts" in the visible label, and keeps the full name for assistive technology', () => {
    oneSetup()

    expect(screen.getByText('Piece')).toBeInTheDocument()
    expect(screen.queryByText(text.groups.piece)).toBeNull()
    expect(screen.getByRole('tablist', { name: text.groups.piece })).toBeInTheDocument()
  })

  it('opens Rests from the main row, with the part\'s own form and no safety card', async () => {
    const { user, onOpenChange, rerender } = oneSetup()
    await user.click(screen.getByRole('tab', { name: new RegExp(`^${text.sections.rests}`) }))
    expect(onOpenChange).toHaveBeenCalledWith(true, 'rests')

    rerender(<StructurePanel doc={demoDoc()} parts={ONE} partId="clarinet" barLineMode="ripple" open section="rests" onOpenChange={onOpenChange} onEdit={vi.fn()} />)
    expect(screen.getByRole('tabpanel')).toBeInTheDocument()
    expect(screen.queryByText(text.safety.on)).toBeNull()
    expect(screen.queryByText(text.safety.locked)).toBeNull()
  })

  it('keeps the This part group with its two tabs while the part\'s bars differ from the piece\'s', () => {
    oneSetup({ doc: short(demoDoc()), section: 'partBars' })

    const [piece, part] = screen.getAllByRole('tablist')
    expect(tabs(piece)).toEqual(['Bars', 'Meters', 'Play order', 'Marks'])
    expect(tabs(part)).toEqual(['Bars', 'Rests'])
    expect(screen.getByText('Piece')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: new RegExp(`^${text.sections.bars} \\(`) })).toHaveAttribute('aria-selected', 'true')
  })

  it('keeps the group when the piece has a pickup and the part has no box for it', () => {
    const picked = pickupOn(demoDoc())
    if (!picked.ok) throw new Error('refused')
    const doc: EditorDoc = {
      ...picked.doc,
      pages: picked.doc.pages.map((page) => {
        if (page.partId !== 'clarinet') return page
        const rest = page.bars.filter((box) => box.bar !== 0)
        return { ...page, bars: [...rest, { ...rest[rest.length - 1], bar: rest[rest.length - 1].bar + 1 }] }
      }),
    }
    oneSetup({ doc, section: 'partBars' })

    expect(screen.getAllByRole('tablist')).toHaveLength(2)
  })

  it('goes back to the normal strip with a second part', () => {
    setup({ section: 'marks' })

    const [piece, part] = screen.getAllByRole('tablist')
    expect(tabs(piece)).toEqual(['Bars', 'Meters', 'Play order', 'Marks'])
    expect(tabs(part)).toEqual(['Bars', 'Rests'])
    expect(screen.getByText(text.groups.piece)).toBeInTheDocument()
  })

  it('falls back to Piece > Bars when the open This part > Bars tab goes away with the group', () => {
    const { onOpenChange } = oneSetup({ section: 'partBars' })

    expect(onOpenChange).toHaveBeenCalledWith(true, 'bars')
  })

  it('does not move the open tab while the group is shown or another tab is open', () => {
    const { onOpenChange, unmount } = oneSetup({ doc: short(demoDoc()), section: 'partBars' })
    expect(onOpenChange).not.toHaveBeenCalled()
    unmount()
    const second = oneSetup({ section: 'rests' })
    expect(second.onOpenChange).not.toHaveBeenCalled()
  })

  it('turning on Edit as text from Rests stays on Rests', async () => {
    const { user, onOpenChange } = oneSetup({ section: 'rests' })
    await user.click(screen.getByRole('switch', { name: text.editAsText }))
    expect(onOpenChange).not.toHaveBeenCalled()
  })
})

describe('the Bars section of This part', () => {
  const partSetup = (props: Partial<StructurePanelProps> = {}) => setup({ section: 'partBars', ...props })

  it('has the heading Bars · part, a Detected chip, no Renumber switch and no multi-rest list', () => {
    partSetup()

    expect(screen.getByRole('heading', { level: 2, name: text.partBarsHeading('Clarinet in B♭ 1') })).toBeInTheDocument()
    expect(chip()).toHaveTextContent('Detected: 64 bars')
    expect(screen.queryByRole('switch', { name: strings.editor.renumber })).toBeNull()
    expect(screen.queryByText(/Multi-rests/)).toBeNull()
    expect(screen.getByText(barsText.partNote)).toBeInTheDocument()
  })

  it('shows "This part" as the visible label of the tab group, the part\'s name in the label for assistive technology', () => {
    partSetup()
    expect(screen.getByText(text.groups.partLabel)).toBeInTheDocument()
    expect(screen.getByRole('tablist', { name: text.groups.part('Clarinet in B♭ 1') })).toBeInTheDocument()
  })

  it('is not locked when Edit piece structure is off', async () => {
    const { user, onEdit } = partSetup({ pieceOn: false })
    await insertAt(user, '5')
    expect(onEdit).toHaveBeenCalledTimes(1)
  })

  it('inserts after bar n by splitting its box, as insertPartBar does', async () => {
    const { user, onEdit } = partSetup()
    await insertAt(user, '5')
    expect(onEdit).toHaveBeenCalledWith(insertPartBar(demoDoc(), 'clarinet', 5, 'after'))
  })

  it('inserts before bar n', async () => {
    const { user, onEdit } = partSetup()
    await insertAt(user, '5', 'before')
    expect(onEdit).toHaveBeenCalledWith(insertPartBar(demoDoc(), 'clarinet', 5, 'before'))
  })

  it('removes bar n by merging it with a neighbour, as removePartBar does', async () => {
    const { user, onEdit } = partSetup()
    await fill(user, screen.getByLabelText(barsText.removeField), '5')
    await user.click(screen.getByRole('button', { name: barsText.removeApply }))
    expect(onEdit).toHaveBeenCalledWith(removePartBar(demoDoc(), 'clarinet', 5))
  })

  it('shows the message of a refusal and applies nothing', async () => {
    const multi = setBarsInBox(demoDoc(), 'clarinet', 5, 3)
    if (!multi.ok) throw new Error('multi-rest must work')
    const { user, onEdit } = partSetup({ doc: multi.doc })
    await insertAt(user, '5')
    expect(screen.getByRole('alert')).toHaveTextContent(barsText.refusals['in-multi-rest'])
    expect(onEdit).not.toHaveBeenCalled()
  })

  it('counts the part\'s own boxes in Now, and the piece\'s count does not change', () => {
    const inserted = insertPartBar(demoDoc(), 'clarinet', 5, 'after')
    if (!inserted.ok) throw new Error('insert must work')
    const { rerender } = partSetup()
    rerender(
      <StructurePanel doc={inserted.doc} parts={PARTS} partId="clarinet" barLineMode="ripple" open section="partBars" onOpenChange={vi.fn()} onEdit={vi.fn()} />,
    )
    expect(chip()).toHaveTextContent('Detected: 64 bars· Now: 65 bars')
  })
})

describe('the Meters section', () => {
  const meterRow = (n: number) => ({
    from: screen.getByLabelText(text.meters.rowFrom(n)),
    beats: screen.getByLabelText(text.meters.rowBeats(n)),
    unit: screen.getByLabelText(text.meters.rowUnit(n)),
  })

  it('has one row per change with the values of the piece, and Apply waits for an edit', () => {
    setup({ section: 'meters' })

    expect(meterRow(1).from).toHaveValue('1')
    expect(meterRow(1).beats).toHaveValue('4')
    expect(meterRow(1).unit).toHaveValue('4')
    expect(meterRow(2).from).toHaveValue('49')
    expect(meterRow(2).beats).toHaveValue('2')
    expect(apply()).toBeDisabled()
  })

  it('applies the edited meters with setMeters, as one edit', async () => {
    const { user, onEdit } = setup({ section: 'meters' })

    await fill(user, meterRow(2).beats, '3')
    await user.selectOptions(meterRow(2).unit, '8')
    await user.click(apply())

    const meters = [
      { fromBar: 1, numerator: 4, denominator: 4 },
      { fromBar: 49, numerator: 3, denominator: 8 },
    ]
    expect(onEdit).toHaveBeenCalledTimes(1)
    expect(onEdit).toHaveBeenCalledWith(setMeters(demoDoc(), meters))
  })

  it('adds and removes rows', async () => {
    const { user, onEdit } = setup({ section: 'meters' })

    await user.click(screen.getByRole('button', { name: text.meters.add }))
    await fill(user, meterRow(3).from, '57')
    await user.click(screen.getByRole('button', { name: text.meters.remove(2) }))
    await user.click(apply())

    expect(onEdit).toHaveBeenCalledWith(
      setMeters(demoDoc(), [
        { fromBar: 1, numerator: 4, denominator: 4 },
        { fromBar: 57, numerator: 4, denominator: 4 },
      ]),
    )
  })

  it('shows the error under an invalid row and calls nothing', async () => {
    const { user, onEdit } = setup({ section: 'meters' })

    await fill(user, meterRow(1).from, '2')
    await fill(user, meterRow(2).beats, '40')
    await user.click(apply())

    expect(screen.getByText(text.errors.firstMeterNotBar1)).toBeInTheDocument()
    expect(screen.getByText(text.errors.badMeter)).toBeInTheDocument()
    expect(onEdit).not.toHaveBeenCalled()
  })

  it('clears an error once the field is edited again', async () => {
    const { user } = setup({ section: 'meters' })

    await fill(user, meterRow(1).from, '2')
    await user.click(apply())
    expect(screen.getByText(text.errors.firstMeterNotBar1)).toBeInTheDocument()

    await fill(user, meterRow(1).from, '1')
    await fill(user, meterRow(1).beats, '3')
    expect(screen.queryByText(text.errors.firstMeterNotBar1)).not.toBeInTheDocument()
  })
})

describe('the Play order section', () => {
  const rowFrom = (n: number) => screen.getByLabelText(text.playOrder.rowFrom(n))
  const rowTo = (n: number) => screen.getByLabelText(text.playOrder.rowTo(n))

  it('has one row per range and counts the bars played under the list', () => {
    setup({ section: 'playOrder' })

    expect(rowFrom(2)).toHaveValue('9')
    expect(rowTo(3)).toHaveValue('64')
    expect(screen.getByText('72 bars played; bars 9-16 twice')).toBeInTheDocument()
  })

  it('shows "bars 9-16 three times" before Apply when the row 9-16 is added a second time', async () => {
    const { user, onEdit } = setup({ section: 'playOrder' })

    await user.click(screen.getByRole('button', { name: text.playOrder.add }))
    await fill(user, rowFrom(4), '9')
    await fill(user, rowTo(4), '16')

    expect(screen.getByText('80 bars played; bars 9-16 three times')).toBeInTheDocument()
    expect(onEdit).not.toHaveBeenCalled()

    await user.click(apply())
    expect(onEdit).toHaveBeenCalledTimes(1)
    expect(onEdit).toHaveBeenCalledWith(
      setPlayOrder(demoDoc(), [
        { from: 1, to: 16 },
        { from: 9, to: 16 },
        { from: 17, to: 64 },
        { from: 9, to: 16 },
      ]),
    )
  })

  it('moves and removes rows', async () => {
    const { user, onEdit } = setup({ section: 'playOrder' })

    await user.click(screen.getByRole('button', { name: text.playOrder.moveUp(3) }))
    await user.click(screen.getByRole('button', { name: text.playOrder.remove(1) }))
    await user.click(apply())

    expect(onEdit).toHaveBeenCalledWith(
      setPlayOrder(demoDoc(), [
        { from: 17, to: 64 },
        { from: 9, to: 16 },
      ]),
    )
  })

  it('cannot move the first row up, the last row down, or remove the only row', async () => {
    const { user } = setup({ section: 'playOrder' })

    expect(screen.getByRole('button', { name: text.playOrder.moveUp(1) })).toBeDisabled()
    expect(screen.getByRole('button', { name: text.playOrder.moveDown(3) })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: text.playOrder.remove(1) }))
    await user.click(screen.getByRole('button', { name: text.playOrder.remove(1) }))
    expect(screen.getByRole('button', { name: text.playOrder.remove(1) })).toBeDisabled()
  })

  it('warns before Apply when the rows would clear recording times', async () => {
    const { user } = setup({ section: 'playOrder' })
    const result = setPlayOrder(demoDoc(), [
      { from: 1, to: 16 },
      { from: 17, to: 64 },
    ])
    if (!result.ok) throw new Error('the demo rows must be valid')

    await user.click(screen.getByRole('button', { name: text.playOrder.remove(2) }))

    expect(result.droppedLocators.length).toBeGreaterThan(0)
    expect(screen.getByText(text.bars.dropped(result.droppedLocators.length))).toBeInTheDocument()
  })

  it('shows the error under an invalid row and calls nothing', async () => {
    const { user, onEdit } = setup({ section: 'playOrder' })

    await fill(user, rowFrom(1), '20')
    await fill(user, rowTo(2), '70')
    await user.click(apply())

    expect(screen.getByText(text.errors.playOrderFromAfterTo)).toBeInTheDocument()
    expect(screen.getByText(text.errors.playOrderOutOfRange('64'))).toBeInTheDocument()
    expect(onEdit).not.toHaveBeenCalled()
  })
})

describe('rests in the part that is open', () => {
  const kind = (row: number) => screen.getByLabelText(text.marks.rowKind(row))
  const from = (row: number) => screen.getByLabelText(text.marks.rowFrom(row))
  const to = (row: number) => screen.getByLabelText(text.marks.rowTo(row))

  /** The clarinet rests on 46-48 and the trumpet on 5; the flute plays everything. */
  function restingDoc(): EditorDoc {
    const doc = demoDoc()
    const rests: Record<string, number[]> = { clarinet: [46, 47, 48], trumpet: [5] }
    return { ...doc, pages: doc.pages.map((page) => ({ ...page, rests: rests[page.partId] ?? [] })) }
  }

  it('lists the rests of the part open now under This part > Rests, and says whose they are', () => {
    setup({ section: 'rests', doc: restingDoc() })

    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(kind(1)).toHaveValue('rest')
    expect(from(1)).toHaveValue('46')
    expect(to(1)).toHaveValue('48')
    expect(screen.getByText(text.marks.restsHint('Clarinet in B♭ 1'))).toBeInTheDocument()
  })

  it('keeps the rests out of the piece\'s Marks, which lists fermata and rit. only', () => {
    setup({ section: 'marks', doc: restingDoc() })

    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(kind(1)).toHaveValue('fermata')
    expect(screen.getByText(text.marks.pieceHint)).toBeInTheDocument()
  })

  it('shows the rests of another part when that part is opened, with the same fermata', () => {
    const { rerender, onEdit, onOpenChange } = setup({ section: 'rests', doc: restingDoc() })

    rerender(<StructurePanel doc={restingDoc()} parts={PARTS} partId="trumpet" barLineMode="ripple" open section="rests" onOpenChange={onOpenChange} onEdit={onEdit} />)

    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(kind(1)).toHaveValue('rest')
    expect(from(1)).toHaveValue('5')
    expect(screen.getByText(text.marks.restsHint('Trumpet in B♭ 2'))).toBeInTheDocument()
  })

  it('shows a part that plays everything with no rests, and a rest added there is written to that part only', async () => {
    const doc = restingDoc()
    const { user, onEdit } = setup({ section: 'rests', doc, partId: 'flute' })
    expect(screen.getByText(text.marks.none)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: text.marks.add }))
    expect(kind(1)).toHaveValue('rest')
    await fill(user, from(1), '10')
    await fill(user, to(1), '11')
    await user.click(apply())

    expect(onEdit).toHaveBeenCalledTimes(1)
    expect(onEdit).toHaveBeenCalledWith(
      setMarks(doc, [{ bar: 28, kind: 'fermata' }, { bar: 10, kind: 'rest' }, { bar: 11, kind: 'rest' }], 'flute'),
    )
    const result = onEdit.mock.calls[0][0]
    expect(result.doc.pages.find((page: { partId: string }) => page.partId === 'flute').rests).toEqual([10, 11])
    expect(result.doc.pages.find((page: { partId: string }) => page.partId === 'clarinet').rests).toEqual([46, 47, 48])
  })

  it('accepts a rest on the last bar of a part that has one bar more than the piece, in the form and in the text', async () => {
    const base = restingDoc()
    // The trumpet had a bar line added: 65 boxes in a piece of 64 bars, and it rests on its last two bars.
    const flute = base.pages.find((page) => page.partId === 'flute')!
    const extra = { ...flute.bars[63], bar: 65 }
    const doc = { ...base, pages: base.pages.map((page) => (page.partId === 'trumpet' ? { ...page, bars: [...page.bars, extra], rests: [64, 65] } : page)) }
    const { user, onEdit } = setup({ section: 'rests', doc, partId: 'trumpet' })
    expect(from(1)).toHaveValue('64')
    expect(to(1)).toHaveValue('65')

    await fill(user, from(1), '63') // a rest run that still ends on the part's own last bar is not refused
    await user.click(apply())
    expect(screen.queryByText(text.errors.markOutOfRange('64'))).toBeNull()
    expect(onEdit).toHaveBeenCalledTimes(1)
    expect(onEdit.mock.calls[0][0].doc.pages.find((page: { partId: string }) => page.partId === 'trumpet').rests).toEqual([63, 64, 65])

    await fill(user, to(1), '66')
    await user.click(apply())
    expect(screen.getByText(text.errors.markOutOfRange('65'))).toBeInTheDocument()
    expect(onEdit).toHaveBeenCalledTimes(1)
  })

  it('the piece\'s Edit as text holds no rests, and refuses one with a pointer to This part > Rests', async () => {
    const doc = restingDoc()
    const { user, onEdit } = setup({ section: 'meters', doc, partId: 'trumpet' })
    await user.click(screen.getByRole('switch', { name: text.editAsText }))
    const area = screen.getByRole('textbox', { name: text.text.label }) as HTMLTextAreaElement
    expect(area.value.split('\n')[2]).toBe('marks: fermata 28')

    await fill(user, area, area.value.replace('fermata 28', 'fermata 28, rest 5'))
    await user.click(apply())
    expect(onEdit).not.toHaveBeenCalled()
    expect(screen.getByText(text.text.lineError(3, text.text.restsInPiece))).toBeInTheDocument()
  })

  it('a piece text edit keeps the open part\'s rests', async () => {
    const doc = restingDoc()
    const { user, onEdit } = setup({ section: 'meters', doc, partId: 'trumpet' })
    await user.click(screen.getByRole('switch', { name: text.editAsText }))
    const area = screen.getByRole('textbox', { name: text.text.label }) as HTMLTextAreaElement

    await fill(user, area, area.value.replace('fermata 28', 'fermata 30'))
    await user.click(apply())

    expect(onEdit).toHaveBeenCalledTimes(1)
    const edited = onEdit.mock.calls[0][0]
    expect(edited.doc.timing.marks).toEqual([{ bar: 30, kind: 'fermata' }])
    expect(edited.doc.pages.find((page: { partId: string }) => page.partId === 'trumpet').rests).toEqual([5])
  })

  it('This part > Rests has its own text line: it shows the part\'s rests and writes them back to that part', async () => {
    const doc = restingDoc()
    const { user, onEdit } = setup({ section: 'rests', doc, partId: 'clarinet' })
    await user.click(screen.getByRole('switch', { name: text.editAsText }))
    const field = screen.getByRole('textbox', { name: text.text.restsLabel }) as HTMLInputElement
    expect(field).toHaveValue('46-48')

    await fill(user, field, '46-48, 60')
    await user.click(apply())

    expect(onEdit).toHaveBeenCalledTimes(1)
    const edited = onEdit.mock.calls[0][0]
    expect(edited.doc.pages.find((page: { partId: string }) => page.partId === 'clarinet').rests).toEqual([46, 47, 48, 60])
    expect(edited.doc.timing.marks).toEqual(doc.timing.marks)
  })

  it('the rests text is judged by the last bar of its part', async () => {
    const base = restingDoc()
    const extra = { ...base.pages[2].bars[63], bar: 65 }
    const doc = { ...base, pages: base.pages.map((page) => (page.partId === 'trumpet' ? { ...page, bars: [...page.bars, extra], rests: [65] } : page)) }
    const { user, onEdit } = setup({ section: 'rests', doc, partId: 'trumpet' })
    await user.click(screen.getByRole('switch', { name: text.editAsText }))
    const field = screen.getByRole('textbox', { name: text.text.restsLabel })

    await fill(user, field, '65-66')
    await user.click(apply())
    expect(onEdit).not.toHaveBeenCalled()
    expect(screen.getByText(text.errors.markOutOfRange('65'))).toBeInTheDocument()

    await fill(user, field, '64-65')
    await user.click(apply())
    expect(onEdit).toHaveBeenCalledTimes(1)
  })
})

describe('the Marks section', () => {
  const from = (row: number) => screen.getByLabelText(text.marks.rowFrom(row))
  const to = (row: number) => screen.getByLabelText(text.marks.rowTo(row))
  const kind = (row: number) => screen.getByLabelText(text.marks.rowKind(row))

  /** Adds a row and fills it; "to" is left empty when not given. */
  async function addRow(user: ReturnType<typeof userEvent.setup>, row: number, markKind: string, first: string, last?: string) {
    await user.click(screen.getByRole('button', { name: text.marks.add }))
    await user.selectOptions(kind(row), markKind)
    await fill(user, from(row), first)
    if (last !== undefined) await fill(user, to(row), last)
  }

  it('lists a single bar as the same bar twice, and applies a new mark with setMarks', async () => {
    const { user, onEdit } = setup({ section: 'marks' })

    expect(from(1)).toHaveValue('28')
    expect(to(1)).toHaveValue('28')
    expect(kind(1)).toHaveValue('fermata')

    await addRow(user, 2, 'fermata', '40')
    await user.click(apply())

    expect(onEdit).toHaveBeenCalledTimes(1)
    expect(onEdit).toHaveBeenCalledWith(
      setMarks(
        demoDoc(),
        [
          { bar: 28, kind: 'fermata' },
          { bar: 40, kind: 'fermata' },
        ],
        'clarinet',
      ),
    )
  })

  it('adds "rest 46-48" in one action as three marks, in This part > Rests', async () => {
    const { user, onEdit } = setup({ section: 'rests' })

    await addRow(user, 1, 'rest', '46', '48')
    await user.click(apply())

    expect(onEdit).toHaveBeenCalledTimes(1)
    expect(onEdit).toHaveBeenCalledWith(
      setMarks(
        demoDoc(),
        [
          { bar: 28, kind: 'fermata' },
          { bar: 46, kind: 'rest' },
          { bar: 47, kind: 'rest' },
          { bar: 48, kind: 'rest' },
        ],
        'clarinet',
      ),
    )
  })

  it('shows a stored run of bars as one row with one delete, and deletes it whole', async () => {
    const doc = withClarinetRests(demoDoc(), [46, 47, 48])
    const { user, onEdit } = setup({ section: 'rests', doc })

    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(from(1)).toHaveValue('46')
    expect(to(1)).toHaveValue('48')
    expect(kind(1)).toHaveValue('rest')

    await user.click(screen.getByRole('button', { name: text.marks.remove(1) }))
    expect(screen.getByText(text.marks.none)).toBeInTheDocument()
    await user.click(apply())

    expect(onEdit).toHaveBeenCalledWith(setMarks(doc, [{ bar: 28, kind: 'fermata' }], 'clarinet'))
  })

  it('adds a rit. passage, and explains what it is while a row has that kind', async () => {
    const { user, onEdit } = setup({ section: 'marks' })

    expect(screen.queryByText(text.marks.ritHint)).toBeNull()
    await addRow(user, 2, 'rit', '15', '16')
    expect(screen.getByText(text.marks.ritHint)).toBeInTheDocument()
    await user.click(apply())

    expect(onEdit).toHaveBeenCalledWith(
      setMarks(
        demoDoc(),
        [
          { bar: 28, kind: 'fermata' },
          { bar: 15, kind: 'rit' },
          { bar: 16, kind: 'rit' },
        ],
        'clarinet',
      ),
    )
  })

  it('removes a mark', async () => {
    const { user, onEdit } = setup({ section: 'marks' })

    await user.click(screen.getByRole('button', { name: text.marks.remove(1) }))
    expect(screen.getByText(text.marks.none)).toBeInTheDocument()
    await user.click(apply())

    expect(onEdit).toHaveBeenCalledWith(setMarks(demoDoc(), [], 'clarinet'))
  })

  it('shows the error under the row that is invalid and calls nothing', async () => {
    const { user, onEdit } = setup({ section: 'marks' })

    await addRow(user, 2, 'fermata', '28')
    await user.click(apply())
    expect(screen.getByText(text.errors.markDuplicate)).toBeInTheDocument()

    await fill(user, from(2), '99')
    await user.click(apply())
    expect(screen.getByText(text.errors.markOutOfRange('64'))).toBeInTheDocument()

    await fill(user, from(2), '60')
    await fill(user, to(2), '70')
    await user.click(apply())
    expect(screen.getByText(text.errors.markOutOfRange('64'))).toBeInTheDocument()

    await fill(user, from(2), '48')
    await fill(user, to(2), '46')
    await user.click(apply())
    expect(screen.getByText(text.errors.markRangeBackwards)).toBeInTheDocument()
    expect(onEdit).not.toHaveBeenCalled()
  })

  it('names the row of a bar that two ranges both cover', async () => {
    const { user, onEdit } = setup({ section: 'rests' })

    await addRow(user, 1, 'rest', '46', '48')
    await addRow(user, 2, 'rest', '48', '49')
    await user.click(apply())

    expect(within(screen.getAllByRole('listitem')[1]).getByText(text.errors.markDuplicate)).toBeInTheDocument()
    expect(within(screen.getAllByRole('listitem')[0]).queryByText(text.errors.markDuplicate)).toBeNull()
    expect(onEdit).not.toHaveBeenCalled()
  })
})

describe('Edit as text', () => {
  const textbox = () => screen.getByRole('textbox', { name: text.text.label })

  async function openText(props: Partial<StructurePanelProps> = {}) {
    const result = setup({ section: 'meters', ...props })
    await result.user.click(screen.getByRole('switch', { name: text.editAsText }))
    return result
  }

  it('swaps the forms for one textarea holding the three lines, and keeps the Bars section as it was', async () => {
    const { user } = await openText()

    expect(textbox()).toHaveValue(formatStructure(demoDoc().timing, 64, barNamesOf(undefined)))
    expect(screen.queryByLabelText(text.meters.rowFrom(1))).not.toBeInTheDocument()

    await user.click(screen.getByRole('switch', { name: text.editAsText }))
    expect(screen.getByLabelText(text.meters.rowFrom(1))).toBeInTheDocument()
  })

  it('applies only the part that changed', async () => {
    const { user, onEdit } = await openText()

    await fill(user, textbox(), formatStructure(demoDoc().timing, 64, barNamesOf(undefined)).replace('2/4 from 49', '3/4 from 49'))
    await user.click(apply())

    expect(onEdit).toHaveBeenCalledTimes(1)
    expect(onEdit).toHaveBeenCalledWith(
      setMeters(demoDoc(), [
        { fromBar: 1, numerator: 4, denominator: 4 },
        { fromBar: 49, numerator: 3, denominator: 4 },
      ]),
    )
  })

  it('applies each changed part as its own edit, in the order meters, play order, marks, each on the one before', async () => {
    const { user, onEdit } = await openText()
    const changed = [
      'meters: 4/4 from 1',
      'play order: 1-16, 17-end',
      'marks: fermata 28, rit 40',
    ].join('\n')

    await fill(user, textbox(), changed)
    await user.click(apply())

    const meters = setMeters(demoDoc(), [{ fromBar: 1, numerator: 4, denominator: 4 }])
    if (!meters.ok) throw new Error('meters must be valid')
    const playOrder = setPlayOrder(meters.doc, [
      { from: 1, to: 16 },
      { from: 17, to: 64 },
    ])
    if (!playOrder.ok) throw new Error('play order must be valid')
    const marks = setMarks(
      playOrder.doc,
      [
        { bar: 28, kind: 'fermata' },
        { bar: 40, kind: 'rit' },
      ],
      'clarinet',
    )
    if (!marks.ok) throw new Error('marks must be valid')
    expect(onEdit).toHaveBeenCalledTimes(3)
    expect(onEdit).toHaveBeenNthCalledWith(1, meters)
    expect(onEdit).toHaveBeenNthCalledWith(2, playOrder)
    expect(onEdit).toHaveBeenNthCalledWith(3, marks)
    // The last doc holds all three changes.
    expect(marks.doc.timing).toMatchObject({ meters: meters.doc.timing.meters, playOrder: playOrder.doc.timing.playOrder })
  })

  it('reads marks as ranges, and writes the doc\'s marks back as ranges, keeping the part\'s rests', async () => {
    const doc = withClarinetRests(demoDoc(), [46, 47, 48])
    const { user, onEdit } = await openText({ doc })

    expect((textbox() as HTMLTextAreaElement).value.split('\n')[2]).toBe('marks: fermata 28')
    await fill(user, textbox(), formatStructure(demoDoc().timing, 64, barNamesOf(undefined)).replace('fermata 28', 'fermata 32'))
    await user.click(apply())

    expect(onEdit).toHaveBeenCalledTimes(1)
    expect(onEdit).toHaveBeenCalledWith(
      setMarks(
        doc,
        [
          { bar: 32, kind: 'fermata' },
          { bar: 46, kind: 'rest' },
          { bar: 47, kind: 'rest' },
          { bar: 48, kind: 'rest' },
        ],
        'clarinet',
      ),
    )
  })

  it('shows what could not be read with its line number and applies nothing', async () => {
    const { user, onEdit } = await openText()

    await fill(user, textbox(), ['meters: 4/4 from 1', 'play order: nine', 'marks: coda 3'].join('\n'))
    await user.click(apply())

    expect(screen.getByText(text.text.lineError(2, text.text.errors['bad-range']))).toBeInTheDocument()
    expect(screen.getByText(text.text.lineError(3, text.text.errors['bad-mark']))).toBeInTheDocument()
    expect(onEdit).not.toHaveBeenCalled()
  })

  it('shows a value that reads but is not valid on its own line, and applies nothing, not even the valid parts', async () => {
    const { user, onEdit } = await openText()

    await fill(user, textbox(), ['meters: 4/4 from 2', 'play order: 1-end', 'marks: fermata 28'].join('\n'))
    await user.click(apply())

    expect(screen.getByText(text.text.lineError(1, text.errors.firstMeterNotBar1))).toBeInTheDocument()
    expect(onEdit).not.toHaveBeenCalled()
  })

  it('does nothing when the text was not changed', async () => {
    const { onEdit } = await openText()
    expect(apply()).toBeDisabled()
    expect(onEdit).not.toHaveBeenCalled()
  })

  it('shows a play order that clears recording times before Apply', async () => {
    const { user } = await openText({ section: 'playOrder' })

    await fill(user, textbox(), ['meters: 4/4 from 1, 2/4 from 49', 'play order: 1-16, 17-end', 'marks: fermata 28'].join('\n'))

    expect(within(screen.getByRole('region', { name: text.title })).getByText(/will be cleared/)).toBeInTheDocument()
  })
})

describe('the open panel', () => {
  const body = () => document.querySelector<HTMLElement>('[data-slot="structure-body"]')!

  it('opens downward from the strip, in the height the page gives it, and scrolls inside', () => {
    setup()

    expect(body()).toHaveClass('absolute', 'top-full', 'h-(--dock-height,262px)', 'overflow-y-auto')
    expect(body()).not.toHaveClass('bottom-full')
  })

  it('closes with Escape', async () => {
    const { user, onOpenChange } = setup()

    await user.keyboard('{Escape}')

    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('does not answer Escape while it is closed', async () => {
    const { user, onOpenChange } = setup({ open: false })

    await user.keyboard('{Escape}')

    expect(onOpenChange).not.toHaveBeenCalled()
  })
})


function pickupDoc(): EditorDoc {
  const result = pickupOn(demoDoc())
  if (!result.ok) throw new Error('no pickup')
  return result.doc
}

/** The doc a panel passed to onEdit last. */
function edited(onEdit: ReturnType<typeof vi.fn>): EditorDoc {
  return onEdit.mock.calls.at(-1)?.[0].doc
}

describe('Pickup bars on the Piece tab', () => {
  it('says no pickup bar was detected, offers one at the top of the piece, and counts it the way the part chips do', () => {
    setup()
    expect(screen.getByText(text.pickup.none)).toBeInTheDocument()
    expect(screen.getByText(text.pickup.hint)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: text.pickup.add })).toBeInTheDocument()
    expect(screen.queryByText(text.pickup.row)).toBeNull()
  })

  it('adds the pickup at the top with pickupOn, in one step: Add opens a row for bar 1, Set applies it', async () => {
    const { user, onEdit } = setup()
    await user.click(screen.getByRole('button', { name: text.pickup.add }))
    expect(onEdit).not.toHaveBeenCalled()
    expect(screen.getByLabelText(text.pickup.beforeField)).toHaveValue('1')
    await user.click(screen.getByRole('button', { name: text.pickup.set }))

    expect(onEdit).toHaveBeenCalledTimes(1)
    expect(onEdit).toHaveBeenCalledWith(pickupOn(demoDoc()))
    const doc = edited(onEdit)
    expect(doc.timing.barCount).toBe(63)
    expect(doc.timing.shortBars).toEqual([{ bar: 0, units: 1 }])
    expect(onEdit.mock.calls[0][0].label).toEqual({ kind: 'toggle-pickup' })
  })

  it('with a pickup shows the chip, the row Top of the piece and the length in beats of the numerator', () => {
    setup({ doc: pickupDoc() })

    expect(screen.getByText(text.pickup.count(1))).toBeInTheDocument()
    const row = document.querySelector('[data-slot=pickup-row]') as HTMLElement
    expect(row).toHaveTextContent(`${text.pickup.before} 1`)
    expect(row).toHaveTextContent(text.pickup.row)
    expect(screen.getByRole('status', { name: text.pickup.length })).toHaveTextContent('1')
    expect(screen.getByText('beat of 4')).toBeInTheDocument()
    // more pickups can be added before any bar, so the button stays
    expect(screen.getByRole('button', { name: text.pickup.add })).toBeInTheDocument()
    expect(screen.getByText('Length is in beats of the time signature (4/4 here).')).toBeInTheDocument()
    expect(screen.queryByText(/quarters/)).toBeNull()
  })

  it('steps the length from 1 to numerator - 1 as one step each', async () => {
    const { user, onEdit } = setup({ doc: pickupDoc() })
    expect(screen.getByRole('button', { name: text.pickup.shorter })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: text.pickup.longer }))
    expect(edited(onEdit).timing.shortBars).toEqual([{ bar: 0, units: 2 }])
    expect(onEdit.mock.calls[0][0].label).toEqual({ kind: 'edit-short-bars' })
  })

  it('stops the length at one beat below the meter, eighths included in 6/8', () => {
    const doc = pickupDoc()
    doc.timing = { ...doc.timing, shortBars: [{ bar: 0, units: 3 }] }
    setup({ doc })
    expect(screen.getByRole('button', { name: text.pickup.longer })).toBeDisabled()

    const six = pickupDoc()
    six.timing = { ...six.timing, meters: [{ fromBar: 1, numerator: 6, denominator: 8 }], shortBars: [{ bar: 0, units: 5 }] }
    setup({ doc: six })
    expect(screen.getAllByRole('button', { name: text.pickup.longer }).at(-1)).toBeDisabled()
    expect(screen.getByText('beats of 6')).toBeInTheDocument()
    expect(screen.getByText('Length is in beats of the time signature (6/8 here), counted in eighths.')).toBeInTheDocument()
  })

  it('removes the pickup with its X, which renumbers back with pickupOff', async () => {
    const { user, onEdit } = setup({ doc: pickupDoc() })
    await user.click(screen.getByRole('button', { name: text.pickup.remove }))

    expect(edited(onEdit).timing.barCount).toBe(64)
    expect(edited(onEdit).timing.shortBars).toBeUndefined()
  })

  it('is greyed out while the piece is locked', () => {
    setup({ pieceOn: false })
    expect(screen.getByRole('heading', { name: text.pickup.title }).closest('section')).toHaveClass('opacity-45')
    expect(screen.getByRole('button', { name: text.pickup.add })).toBeDisabled()
  })

  it('keeps the top of the piece as the only row that has a number: a row shows "Before bar 1" and the note Top of the piece', () => {
    setup({ doc: pickupDoc() })
    expect(screen.queryByLabelText(text.pickup.beforeField)).toBeNull()
    expect(screen.getAllByText(new RegExp(text.pickup.before))).toHaveLength(1)
  })
})

describe('Pickup bars on This part', () => {
  /** A piece with a pickup whose clarinet has the pickup inside its first box (63 boxes). */
  function noBoxZero(): EditorDoc {
    const piece = pickupDoc()
    const merged = deleteBarLine(demoDoc(), 'clarinet', 1)
    if (!merged.ok) throw new Error('merge must work')
    return { ...piece, pages: piece.pages.map((p) => (p.partId === 'clarinet' ? (merged.doc.pages.find((q) => q.partId === 'clarinet') as PageLayer) : p)) }
  }

  it('says there is no pickup in the piece, and points to the Piece tab', () => {
    setup({ section: 'partBars' })
    expect(screen.getByText(strings.structure.partPickup.noPiece)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: strings.structure.partPickup.split })).toBeNull()
  })

  it('says the part has its pickup when it has box 0', () => {
    setup({ section: 'partBars', doc: pickupDoc() })
    expect(screen.getByText(strings.structure.partPickup.has)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: strings.structure.partPickup.split })).toBeNull()
  })

  it('offers the chooser when the piece has a pickup and the part has no box 0: Split the first box', async () => {
    const { user, onEdit } = setup({ section: 'partBars', doc: noBoxZero() })
    expect(screen.getByText(strings.structure.partPickup.ask)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: strings.structure.partPickup.split }))

    expect(onEdit).toHaveBeenCalledWith(splitPartPickup(noBoxZero(), 'clarinet'))
    expect(onEdit.mock.calls[0][0].label).toEqual({ kind: 'split-part-pickup', bar: 0 })
  })

  it('The first box is the pickup moves this part\'s numbers down', async () => {
    // The clarinet kept its 64 boxes numbered 1..64: the pickup was boxed as a full bar.
    const doc = { ...pickupDoc(), pages: pickupDoc().pages.map((p) => (p.partId === 'clarinet' ? (demoDoc().pages[0]) : p)) }
    const { user, onEdit } = setup({ section: 'partBars', doc })

    await user.click(screen.getByRole('button', { name: strings.structure.partPickup.shift }))

    expect(onEdit).toHaveBeenCalledWith(shiftPartPickup(doc, 'clarinet'))
    expect(onEdit.mock.calls[0][0].label).toEqual({ kind: 'shift-part-pickup', bar: 0 })
  })

  it('shows the refusal of a first box that cannot be split', async () => {
    const doc = noBoxZero()
    doc.pages = doc.pages.map((p) => (p.partId === 'clarinet' ? { ...p, bars: p.bars.map((b) => (b.bar === 1 ? { ...b, w: 40 } : b)) } : p))
    const { user, onEdit } = setup({ section: 'partBars', doc })
    await user.click(screen.getByRole('button', { name: strings.structure.partPickup.split }))
    expect(screen.getByRole('alert')).toHaveTextContent(strings.structure.partPickup.refusals['too-narrow'])
    expect(onEdit).not.toHaveBeenCalled()
  })
})

describe('Marks has no Short bars section', () => {
  it('lists fermata and rit. only', () => {
    const doc = pickupDoc()
    doc.timing = { ...doc.timing, shortBars: [{ bar: 0, units: 1 }, { bar: 44, units: 3 }] }
    setup({ doc, section: 'marks' })
    expect(screen.queryByText('Short bars')).toBeNull()
    expect(screen.queryByRole('button', { name: /short bar/i })).toBeNull()
  })
})

describe('short bars in Edit as text', () => {
  it('writes the short bars line, and a change of a length is applied as one step', async () => {
    const doc = pickupDoc()
    const { user, onEdit } = setup({ doc, section: 'meters' })
    await user.click(screen.getByRole('switch', { name: text.editAsText }))
    const box = screen.getByRole('textbox', { name: text.text.label })
    expect(box).toHaveValue(formatStructure(doc.timing, doc.timing.barCount, barNamesOf(doc.timing.shortBars)))
    expect((box as HTMLTextAreaElement).value).toContain('short bars: pickup 1/4')

    fireEvent.change(box, { target: { value: (box as HTMLTextAreaElement).value.replace('pickup 1/4', 'pickup 1/4, 30 2/4') } })
    await user.click(apply())

    expect(onEdit).toHaveBeenCalledTimes(1)
    expect(edited(onEdit).timing.shortBars).toEqual([{ bar: 0, units: 1 }, { bar: 30, units: 2 }])
  })

  it('refuses to add or remove the pickup, and sends the player to Pickup bars', async () => {
    const { user, onEdit } = setup({ section: 'meters' })
    await user.click(screen.getByRole('switch', { name: text.editAsText }))
    const box = screen.getByRole('textbox', { name: text.text.label })

    await user.clear(box)
    await user.type(box, 'meters: 4/4 from 1\nplay order: 1-end\nmarks: none\nshort bars: pickup 1/4')
    await user.click(apply())

    expect(onEdit).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent(text.text.pickupChanged)
  })
})
