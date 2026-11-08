import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { ReviewQueue } from '@/components/review/ReviewQueue'
import { formatClock } from '@/components/waveform/dockLayout'
import { type SlotRef } from '@/components/waveform/WaveformDock'
import { formatOffset } from '@/domain/barLabel'
import { type EditRefusal, type EditResult, type EditorDoc } from '@/domain/pieceEdits'
import { demoDoc, SHORT_PART_ID } from '@/domain/pieceFixtures'
import { type ReviewItem } from '@/domain/reviewQueue'
import { dragLocator, removeLocator } from '@/domain/timingEdits'
import { type ReviewFlag } from '@/domain/types'
import { strings } from '@/strings'

const text = strings.review

const flag = (rest: Partial<ReviewFlag>): ReviewFlag => ({
  kind: 'stretched',
  severity: 1,
  expected: 4.1,
  found: 5.74,
  factor: 1.4,
  explainedBy: null,
  uncertainLine: null,
  ...rest,
})

/** The demo doc with five flagged bars: 6 and 28 are checked, 41, 43 and 45 are still open. */
function flaggedDoc(): EditorDoc {
  const doc = demoDoc()
  const flags: Record<number, { flag: ReviewFlag; checked: boolean }> = {
    6: { flag: flag({ kind: 'crowded', factor: 0.56 }), checked: true },
    28: { flag: flag({ severity: 0, explainedBy: 'fermata', factor: 1.6 }), checked: true },
    41: { flag: flag({}), checked: false },
    43: { flag: flag({ kind: 'crowded', factor: 0.61 }), checked: false },
    45: { flag: flag({ kind: 'beat-count', severity: 2, expected: 4, found: 3, factor: null }), checked: false },
  }
  return {
    ...doc,
    timing: {
      ...doc.timing,
      locators: doc.timing.locators.map((locator) => {
        const seeded = locator.passIndex === 0 ? flags[locator.bar] : undefined
        return seeded === undefined ? locator : { ...locator, flags: [seeded.flag], checked: seeded.checked }
      }),
    },
  }
}

const timeOf = (doc: EditorDoc, bar: number) => doc.timing.locators.find((l) => l.bar === bar && l.passIndex === 0)!.timeSec

/** What the queue's callbacks saw: the docs it was handed back (the last is the current one), the steps, the cards the page was told to focus. */
interface Probe { docs: EditorDoc[]; steps: string[]; focused: ReviewItem[]; realigns: string[]; structures: string[] }
const docOf = (probe: Probe) => probe.docs[probe.docs.length - 1]

/** The queue holding a doc the way the Editor does: an applied result replaces the doc and is recorded as a step. */
function Harness({ probe, partId = 'clarinet', selected = null, canRealign = true }: { probe: Probe; partId?: string; selected?: SlotRef | null; canRealign?: boolean }) {
  const [doc, setDoc] = useState(docOf(probe))
  const apply = (result: EditResult): EditRefusal | null => {
    if (!result.ok) return result.reason
    probe.docs.push(result.doc)
    probe.steps.push(result.label.kind)
    setDoc(result.doc)
    return null
  }
  return (
    <>
      <button onClick={() => apply(dragLocator(doc, 41, 0, timeOf(doc, 41) + 0.4))}>drag 41</button>
      <button onClick={() => apply(dragLocator(doc, 43, 0, timeOf(doc, 43) - 0.2))}>drag 43</button>
      <button onClick={() => apply(removeLocator(doc, 10, 0, 'plain'))}>delete 10</button>
      <input aria-label="elsewhere" />
      <ReviewQueue
        doc={doc}
        partId={partId}
        partName="Clarinet"
        selected={selected}
        onApply={apply}
        onFocusItem={(item) => probe.focused.push(item)}
        realigning={false}
        canRealign={canRealign}
        onRealign={() => probe.realigns.push('realign')}
        onOpenStructure={() => probe.structures.push('structure')}
      />
    </>
  )
}

function setup(options: { doc?: EditorDoc; partId?: string; selected?: SlotRef | null; canRealign?: boolean } = {}) {
  const probe: Probe = { docs: [options.doc ?? flaggedDoc()], steps: [], focused: [], realigns: [], structures: [] }
  const user = userEvent.setup()
  render(<Harness probe={probe} partId={options.partId} selected={options.selected} canRealign={options.canRealign} />)
  return { user, probe }
}

const card = (bar: number) => screen.getByRole('button', { name: new RegExp(`^Bar ${bar}\\b`) })
const cardItem = (bar: number) => card(bar).closest('li')!
const checkedCount = () => screen.getByRole('progressbar').getAttribute('aria-valuenow')
const hatched = () => document.querySelector('[data-slot="review-progress-moved"]')

describe('the Review Queue', () => {
  it('says x of y checked with the progress bar and one card per item, with no hint line', () => {
    setup()

    expect(screen.getByRole('heading', { name: text.queue.title })).toBeInTheDocument()
    expect(screen.getByText(text.queue.checked(2, 5))).toBeInTheDocument()
    expect(text.queue.checked(7, 12)).toBe('7 of 12 checked')
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuemax', '5')
    expect(checkedCount()).toBe('2')
    expect(screen.queryByText(/Press N for the next one/)).toBeNull()
    expect(within(screen.getByRole('list', { name: text.queue.list })).getAllByRole('listitem')).toHaveLength(5)
  })

  it('shows the bar, the chip and the time on a card, with a check on the checked ones', () => {
    const { probe } = setup()

    expect(card(6)).toHaveTextContent(`Bar 6 Crowded Checked ${formatClock(timeOf(docOf(probe), 6))}`)
    expect(card(28)).toHaveTextContent('Explained by score')
    expect(card(41)).toHaveTextContent(`Bar 41 Stretched 1.4x ${formatClock(timeOf(docOf(probe), 41))}`)
    expect(card(41)).not.toHaveTextContent(text.queue.checkedMark)
  })

  it('opens a card on a click: its explanation and Sounds right, one card at a time, and tells the page', async () => {
    const { user, probe } = setup()

    await user.click(card(41))

    expect(card(41)).toHaveAttribute('aria-expanded', 'true')
    expect(within(cardItem(41)).getByText('Bar 41 is 1.4x longer than the bars around it.')).toBeInTheDocument()
    expect(within(cardItem(41)).getByRole('button', { name: text.queue.soundsRight })).toBeInTheDocument()
    expect(probe.focused.map((item) => item.kind === 'flag' && item.bar)).toEqual([41])

    await user.click(card(45))
    expect(card(41)).toHaveAttribute('aria-expanded', 'false')
    expect(card(45)).toHaveAttribute('aria-expanded', 'true')
    expect(within(cardItem(45)).getByText('3 beats heard, 4 notated.')).toBeInTheDocument()

    await user.click(card(45))
    expect(card(45)).toHaveAttribute('aria-expanded', 'false')
  })

  it('confirms and checks an item with Sounds right: one step, and the progress moves', async () => {
    const { user, probe } = setup()
    await user.click(card(41))

    await user.click(within(cardItem(41)).getByRole('button', { name: text.queue.soundsRight }))

    expect(probe.steps).toEqual(['sounds-right'])
    expect(card(41)).toHaveTextContent(text.queue.checkedMark)
    expect(screen.getByText(text.queue.checked(3, 5))).toBeInTheDocument()
    expect(checkedCount()).toBe('3')
    expect(within(cardItem(41)).queryByRole('button', { name: text.queue.soundsRight })).toBeNull()
  })

  it('opens the next open item on N, wrapping, and never on the checked ones', async () => {
    const { user, probe } = setup()
    const open = () => within(screen.getByRole('list', { name: text.queue.list })).getAllByRole('button', { expanded: true }).map((button) => button.textContent)

    await user.keyboard('n')
    expect(open()).toEqual([expect.stringMatching(/^Bar 41/)])
    await user.keyboard('n')
    expect(open()).toEqual([expect.stringMatching(/^Bar 43/)])
    await user.keyboard('n')
    expect(open()).toEqual([expect.stringMatching(/^Bar 45/)])
    await user.keyboard('n')
    expect(open()).toEqual([expect.stringMatching(/^Bar 41/)])
    expect(probe.focused.map((item) => item.kind === 'flag' && item.bar)).toEqual([41, 43, 45, 41])
  })

  it('leaves N to a text field', async () => {
    const { user, probe } = setup()

    await user.click(screen.getByRole('textbox', { name: 'elsewhere' }))
    await user.keyboard('n')

    expect(probe.focused).toEqual([])
  })

  it('turns a dragged item into Resolved and Undo move, with the progress hatched', async () => {
    const { user, probe } = setup()
    await user.click(card(41))
    expect(hatched()).toBeNull()

    await user.click(screen.getByRole('button', { name: 'drag 41' }))

    const item = cardItem(41)
    // The header keeps its one flag chip; the moved state is said inside the open card.
    expect(card(41)).not.toHaveTextContent(text.chips.moved)
    expect(within(item).getByText(text.explain.moved(formatOffset(0.4)))).toBeInTheDocument()
    expect(within(item).getByRole('button', { name: text.queue.resolved })).toBeInTheDocument()
    expect(within(item).getByRole('button', { name: text.queue.undoMove })).toBeInTheDocument()
    expect(within(item).queryByRole('button', { name: text.queue.soundsRight })).toBeNull()
    expect(hatched()).not.toBeNull()
    expect(screen.getByText(text.queue.hatched(1))).toBeInTheDocument()
    expect(screen.getByText(text.queue.movedByYou(1))).toBeInTheDocument()
    expect(probe.steps).toEqual(['move-locator'])
  })

  it('resolves a moved item: checked, no longer hatched, the time kept', async () => {
    const { user, probe } = setup()
    await user.click(card(41))
    await user.click(screen.getByRole('button', { name: 'drag 41' }))
    const moved = timeOf(docOf(probe), 41)

    await user.click(within(cardItem(41)).getByRole('button', { name: text.queue.resolved }))

    expect(probe.steps).toEqual(['move-locator', 'resolved'])
    expect(timeOf(docOf(probe), 41)).toBe(moved)
    expect(hatched()).toBeNull()
    expect(screen.getByText(text.queue.checked(3, 5))).toBeInTheDocument()
    expect(screen.queryByText(text.queue.movedByYou(1))).toBeNull()
  })

  it('puts the old time back with Undo move, as a step of its own', async () => {
    const { user, probe } = setup()
    const before = timeOf(docOf(probe), 41)
    await user.click(card(41))
    await user.click(screen.getByRole('button', { name: 'drag 41' }))
    expect(timeOf(docOf(probe), 41)).not.toBe(before)

    await user.click(within(cardItem(41)).getByRole('button', { name: text.queue.undoMove }))

    expect(timeOf(docOf(probe), 41)).toBe(before)
    expect(probe.steps).toEqual(['move-locator', 'undo-move'])
    expect(hatched()).toBeNull()
    expect(within(cardItem(41)).getByRole('button', { name: text.queue.soundsRight })).toBeInTheDocument()
    expect(screen.getByText(text.queue.checked(2, 5))).toBeInTheDocument()
  })

  it('has no "Resolved both" / "Resolved all" button in the Moved by you row, only its count', async () => {
    const { user } = setup()
    await user.click(screen.getByRole('button', { name: 'drag 41' }))
    await user.click(screen.getByRole('button', { name: 'drag 43' }))

    expect(screen.getByText(text.queue.movedByYou(2))).toBeInTheDocument()
    expect(screen.getByText(text.queue.hatched(2))).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Resolved (both|all)$/ })).toBeNull()
  })

  describe('Resolve all', () => {
    const resolveAll = () => screen.getByRole('button', { name: text.queue.resolveAll })

    it('sits on its own line under the title row, aligned to the end, with the CheckCheck icon', () => {
      setup()

      expect(text.queue.resolveAll).toBe('Resolve all')
      const title = screen.getByRole('heading', { name: text.queue.title }).parentElement!
      const line = resolveAll().parentElement!
      expect(title.nextElementSibling).toBe(line)
      expect(line).toHaveClass('justify-end')
      expect(resolveAll().querySelector('svg.lucide-check-check')).not.toBeNull()
    })

    it('checks every open item in one step: the open flag items and a moved one', async () => {
      const { user, probe } = setup()
      await user.click(screen.getByRole('button', { name: 'drag 41' }))
      expect(screen.getByText(text.queue.checked(2, 5))).toBeInTheDocument()

      await user.click(resolveAll())

      expect(probe.steps).toEqual(['move-locator', 'resolve-all'])
      expect(screen.getByText(text.queue.checked(5, 5))).toBeInTheDocument()
      expect(hatched()).toBeNull()
      expect(resolveAll()).toBeDisabled()
    })

    it('is disabled when nothing is open that it can check', () => {
      setup({ doc: demoDoc() })

      expect(resolveAll()).toBeDisabled()
    })

    it('leaves a bar without a time in the list, and is off when only that is left', async () => {
      const { user, probe } = setup()
      await user.click(screen.getByRole('button', { name: 'delete 10' }))

      await user.click(resolveAll())

      expect(probe.steps).toEqual(['delete-locator', 'resolve-all'])
      expect(card(10)).toHaveTextContent(text.chips.unmatched)
      expect(resolveAll()).toBeDisabled()
    })
  })

  describe('folding to the rail', () => {
    it('folds to a rail with the title, the open count and a button to unfold, and has no Resolve all there', async () => {
      const { user } = setup()

      await user.click(screen.getByRole('button', { name: text.queue.hide }))

      expect(screen.queryByRole('button', { name: text.queue.resolveAll })).toBeNull()
      expect(screen.queryByRole('list', { name: text.queue.list })).toBeNull()
      const badge = document.querySelector('[data-slot="review-rail-badge"]')!
      expect(badge).toHaveTextContent('3')
      expect(badge).toHaveAttribute('title', text.queue.left(3))
      expect(text.queue.left(5)).toBe('5 problems left to check')

      await user.click(screen.getByRole('button', { name: text.queue.show }))
      expect(screen.getByRole('list', { name: text.queue.list })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: text.queue.resolveAll })).toBeInTheDocument()
    })

    it('still opens the next problem on N and resolves a moved one on R while folded', async () => {
      const { user, probe } = setup()
      await user.click(screen.getByRole('button', { name: 'drag 41' }))
      await user.click(screen.getByRole('button', { name: text.queue.hide }))

      await user.keyboard('n')
      expect(probe.focused).toHaveLength(1)
      await user.keyboard('r')

      expect(probe.steps).toEqual(['move-locator', 'resolved'])
    })
  })

  it('resolves the open moved item on R, and does nothing when it is not moved', async () => {
    const { user, probe } = setup()
    await user.click(card(41))
    await user.keyboard('r')
    expect(probe.steps).toEqual([])

    await user.click(screen.getByRole('button', { name: 'drag 41' }))
    await user.keyboard('r')

    expect(probe.steps).toEqual(['move-locator', 'resolved'])
  })

  it('resolves the selected moved item on R when no card is open', async () => {
    const { user, probe } = setup({ selected: { bar: 43, passIndex: 0 } })
    await user.click(screen.getByRole('button', { name: 'drag 43' }))

    await user.keyboard('r')

    expect(probe.steps).toEqual(['move-locator', 'resolved'])
  })

  it('leaves R to a text field', async () => {
    const { user, probe } = setup()
    await user.click(card(41))
    await user.click(screen.getByRole('button', { name: 'drag 41' }))

    await user.click(screen.getByRole('textbox', { name: 'elsewhere' }))
    await user.keyboard('r')

    expect(probe.steps).toEqual(['move-locator'])
  })

  it('lists a bar without a time as "No time yet" with Realign', async () => {
    const { user, probe } = setup()
    await user.click(screen.getByRole('button', { name: 'delete 10' }))

    expect(card(10)).toHaveTextContent(text.chips.unmatched)
    await user.click(card(10))
    expect(within(cardItem(10)).getByText(text.explain.unmatched('10'))).toBeInTheDocument()
    await user.click(within(cardItem(10)).getByRole('button', { name: strings.editor.status.realign }))

    expect(probe.realigns).toHaveLength(1)
  })

  it('offers no Realign on a bar without a time when canRealign is off, and still explains it', async () => {
    const { user } = setup({ canRealign: false })
    await user.click(screen.getByRole('button', { name: 'delete 10' }))

    await user.click(card(10))

    expect(within(cardItem(10)).getByText(text.explain.unmatched('10'))).toBeInTheDocument()
    expect(within(cardItem(10)).queryByRole('button', { name: strings.editor.status.realign })).toBeNull()
  })

  it('lists a part whose bars differ from the piece as "Bar count" with Open Structure', async () => {
    const { user, probe } = setup({ partId: SHORT_PART_ID })

    expect(screen.getByRole('button', { name: new RegExp(text.chips.part) })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: new RegExp(text.chips.part) }))
    await user.click(screen.getByRole('button', { name: strings.editor.status.openStructure }))

    expect(probe.structures).toHaveLength(1)
  })

  it('says so when there is nothing to check', () => {
    const doc = demoDoc()
    setup({ doc })

    expect(screen.getByText(text.queue.empty)).toBeInTheDocument()
  })
  it('keeps the bar label and the time on one line and lets a long chip truncate, with its full text in the title', () => {
    setup()

    const chip = within(card(28)).getByText('Explained by score')
    expect(chip).toHaveClass('truncate', 'whitespace-nowrap')
    expect(chip).toHaveAttribute('title', 'Explained by score')
    expect(within(card(28)).getByText('Bar 28')).toHaveClass('shrink-0', 'whitespace-nowrap')
    expect(within(card(28)).getByText(formatClock(timeOf(flaggedDoc(), 28)))).toHaveClass('shrink-0', 'whitespace-nowrap')
  })

  it('scrolls the whole open card into view in the list, on a click and on N', async () => {
    const scroll = vi.fn()
    Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, writable: true, value: scroll })
    try {
      const { user } = setup()

      await user.click(card(41))
      expect(scroll).toHaveBeenLastCalledWith({ block: 'nearest' })
      expect(scroll.mock.contexts.at(-1)).toBe(cardItem(41))

      await user.keyboard('n')
      expect(scroll).toHaveBeenCalledTimes(2)
      expect(scroll.mock.contexts.at(-1)).toBe(cardItem(43))

      // Closing a card scrolls nothing.
      await user.click(card(43))
      expect(scroll).toHaveBeenCalledTimes(2)
    } finally {
      Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
    }
  })

  it('scrolls the open card whole into view again when its content changes, and not on other re-renders', async () => {
    const scroll = vi.fn()
    Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, writable: true, value: scroll })
    try {
      const { user } = setup()
      await user.click(card(41))
      expect(scroll).toHaveBeenCalledTimes(1)

      // Dragging the line swaps the card to its moved sentence and actions, which are taller.
      await user.click(screen.getByRole('button', { name: 'drag 41' }))
      expect(scroll).toHaveBeenCalledTimes(2)
      expect(scroll.mock.contexts.at(-1)).toBe(cardItem(41))

      // An edit that leaves the open card as it is scrolls nothing.
      await user.click(screen.getByRole('button', { name: 'delete 10' }))
      expect(scroll).toHaveBeenCalledTimes(2)

      // Undo move changes it back.
      await user.click(within(cardItem(41)).getByRole('button', { name: text.queue.undoMove }))
      expect(scroll).toHaveBeenCalledTimes(3)
    } finally {
      Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
    }
  })
})
