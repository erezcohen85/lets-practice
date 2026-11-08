import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { ReviewQueue } from '@/components/review/ReviewQueue'
import { type EditRefusal, type EditResult, type EditorDoc } from '@/domain/pieceEdits'
import { demoDoc } from '@/domain/pieceFixtures'
import { type ReviewItem } from '@/domain/reviewQueue'
import { type BoxFlag } from '@/domain/types'
import { strings } from '@/strings'

const text = strings.review

// The demo clarinet has four boxes per line from x = 100: bars 5 and 9 start a line.
const flags: BoxFlag[] = [
  { bar: 5, verdict: 'signature_inside', note: 'the treble clef is inside', suggestedX: 140 },
  { bar: 7, verdict: 'two_bars', note: 'a bar line in the middle', suggestedX: null },
]

function flaggedDoc(): EditorDoc {
  const doc = demoDoc()
  const crowded = { kind: 'crowded', severity: 1, expected: 4, found: 2, factor: 0.5, explainedBy: null, uncertainLine: null } as const
  return {
    ...doc,
    timing: { ...doc.timing, locators: doc.timing.locators.map((l) => (l.bar === 3 && l.passIndex === 0 ? { ...l, flags: [crowded] } : l)) },
    pages: doc.pages.map((page) => (page.partId === 'clarinet' ? { ...page, boxFlags: flags } : page)),
  }
}

interface Probe { docs: EditorDoc[]; steps: string[]; focused: ReviewItem[]; notices: string[] }

function Harness({ probe }: { probe: Probe }) {
  const [doc, setDoc] = useState(probe.docs[0])
  const apply = (result: EditResult): EditRefusal | null => {
    if (!result.ok) return result.reason
    probe.docs.push(result.doc)
    probe.steps.push(result.label.kind)
    setDoc(result.doc)
    return null
  }
  return (
    <ReviewQueue
      doc={doc}
      partId="clarinet"
      partName="Clarinet"
      selected={null}
      onApply={apply}
      onFocusItem={(item) => probe.focused.push(item)}
      onNotice={(sentence) => probe.notices.push(sentence)}
      realigning={false}
      onRealign={() => undefined}
      onOpenStructure={() => undefined}
    />
  )
}

function setup(start: EditorDoc = flaggedDoc()) {
  const probe: Probe = { docs: [start], steps: [], focused: [], notices: [] }
  const user = userEvent.setup()
  render(<Harness probe={probe} />)
  return { user, probe }
}

const list = () => screen.getByRole('list', { name: text.queue.list })
const firstCards = () => within(list()).getAllByRole('listitem')

describe('box items in the Review Queue', () => {
  it('come first, one per flag, titled with the bar and before the timing items', () => {
    setup()

    const cards = firstCards()
    expect(within(cards[0]).getByRole('button')).toHaveAccessibleName(/^Bar 5\b/)
    expect(within(cards[1]).getByRole('button')).toHaveAccessibleName(/^Bar 7\b/)
    expect(within(cards[2]).getByRole('button')).toHaveAccessibleName(/^Bar 3\b/) // the timing item comes after
  })

  it('say the verdict in words and the model note when opened, and tell the page to select the bar', async () => {
    const { user, probe } = setup()

    await user.click(within(firstCards()[0]).getByRole('button'))

    expect(screen.getByText(text.explain.box.signature_inside)).toBeInTheDocument()
    expect(text.explain.box.signature_inside).toBe('A clef, key or time signature is inside the box')
    expect(screen.getByText('the treble clef is inside')).toBeInTheDocument()
    expect(probe.focused.map((item) => (item.kind === 'box' ? item.bar : null))).toEqual([5])
  })

  it('offer the suggested edge only when the flag has one', async () => {
    const { user } = setup()

    await user.click(within(firstCards()[0]).getByRole('button'))
    expect(screen.getByRole('button', { name: text.queue.useSuggestedEdge })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: text.queue.dismissFlag })).toBeInTheDocument()

    await user.click(within(firstCards()[1]).getByRole('button'))
    expect(screen.queryByRole('button', { name: text.queue.useSuggestedEdge })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: text.queue.dismissFlag })).toBeInTheDocument()
  })

  it('Use the suggested edge moves the line start and removes the flag in one step', async () => {
    const { user, probe } = setup()

    await user.click(within(firstCards()[0]).getByRole('button'))
    await user.click(screen.getByRole('button', { name: text.queue.useSuggestedEdge }))

    expect(probe.steps).toEqual(['resolve-box-flag'])
    const page = probe.docs.at(-1)!.pages.find((p) => p.partId === 'clarinet')!
    expect(page.bars.find((box) => box.bar === 5)!.x).toBe(140)
    expect(page.boxFlags?.map((f) => f.bar)).toEqual([7])
    expect(within(list()).queryByRole('button', { name: /^Bar 5\b/ })).not.toBeInTheDocument()
  })

  it('Dismiss removes the flag and changes no box, in one step', async () => {
    const { user, probe } = setup()

    await user.click(within(firstCards()[1]).getByRole('button'))
    await user.click(screen.getByRole('button', { name: text.queue.dismissFlag }))

    expect(probe.steps).toEqual(['resolve-box-flag'])
    const before = probe.docs[0].pages.find((p) => p.partId === 'clarinet')!
    const after = probe.docs.at(-1)!.pages.find((p) => p.partId === 'clarinet')!
    expect(after.bars).toBe(before.bars)
    expect(after.boxFlags?.map((f) => f.bar)).toEqual([5])
  })
})

// Advanced Reading (8.22): the read moved bar 6 (its left edge from 360 to 380, bar 5 grew to meet it), changed the bar count
// of the line of bar 9, and moved the first box of the line of bar 13, which the box check also flagged for its start.
function readDoc(): EditorDoc {
  const doc = flaggedDoc()
  const read: BoxFlag[] = [
    { bar: 6, verdict: 'read_moved', note: 'Advanced Reading moved this bar.', suggestedX: null, previous: { x: 360, w: 260 } },
    { bar: 9, verdict: 'read_count', note: 'Advanced Reading read 3 bars on this line; the first read had 4.', suggestedX: null },
    { bar: 13, verdict: 'starts_late', note: 'Advanced Reading moved this bar. The clef is inside.', suggestedX: 140, previous: { x: 80, w: 280 } },
  ]
  return {
    ...doc,
    pages: doc.pages.map((page) =>
      page.partId === 'clarinet'
        ? { ...page, boxFlags: read, bars: page.bars.map((box) => (box.bar === 6 ? { ...box, x: 380, w: 240 } : box.bar === 5 ? { ...box, w: 280 } : box)) }
        : page,
    ),
  }
}

const detailButtons = () => within(screen.getByRole('list', { name: text.queue.list })).getAllByRole('button').filter((button) => !button.hasAttribute('aria-expanded'))
const clarinetOf = (doc: EditorDoc) => doc.pages.find((p) => p.partId === 'clarinet')!
const edges = (doc: EditorDoc, bar: number) => {
  const { x, w } = clarinetOf(doc).bars.find((box) => box.bar === bar)!
  return { x, w }
}

describe('Advanced Reading items in the Review Queue', () => {
  it('say in words that the read moved the box, then the note, and offer Put back before Dismiss', async () => {
    const { user } = setup(readDoc())

    await user.click(within(firstCards()[0]).getByRole('button'))

    expect(screen.getByText(text.explain.box.read_moved)).toBeInTheDocument()
    expect(text.explain.box.read_moved).toBe('Moved by Advanced Reading')
    expect(screen.getByText('Advanced Reading moved this bar.')).toBeInTheDocument()
    expect(detailButtons().map((button) => button.textContent)).toEqual([text.queue.putBack, text.queue.dismissFlag])
    expect(text.queue.putBack).toBe('Put back line')
    expect(screen.queryByRole('button', { name: text.queue.useSuggestedEdge })).not.toBeInTheDocument()
  })

  it('offer Put back, then the suggested edge, then Dismiss, for a box the check flagged as well', async () => {
    const { user } = setup(readDoc())

    await user.click(within(firstCards()[2]).getByRole('button'))

    expect(screen.getByText(text.explain.box.starts_late)).toBeInTheDocument()
    expect(detailButtons().map((button) => button.textContent)).toEqual([text.queue.putBack, text.queue.useSuggestedEdge, text.queue.dismissFlag])
  })

  it('say the bars changed and offer no Put back when the read changed a line\'s bar count', async () => {
    const { user } = setup(readDoc())

    await user.click(within(firstCards()[1]).getByRole('button'))

    expect(screen.getByText(text.explain.box.read_count)).toBeInTheDocument()
    expect(text.explain.box.read_count).toBe('Bars changed by Advanced Reading')
    expect(screen.getByText(/read 3 bars on this line/)).toBeInTheDocument()
    expect(detailButtons().map((button) => button.textContent)).toEqual([text.queue.dismissFlag])
    expect(screen.queryByRole('button', { name: text.queue.putBack })).not.toBeInTheDocument()
  })

  it('Put back restores the box and the neighbour that touched it, and removes the flag, in one step', async () => {
    const { user, probe } = setup(readDoc())

    await user.click(within(firstCards()[0]).getByRole('button'))
    await user.click(screen.getByRole('button', { name: text.queue.putBack }))

    expect(probe.steps).toEqual(['resolve-box-flag'])
    const after = probe.docs.at(-1)!
    expect(edges(after, 6)).toEqual({ x: 360, w: 260 })
    expect(edges(after, 5)).toEqual({ x: 100, w: 260 })
    expect(clarinetOf(after).boxFlags?.map((f) => f.bar)).toEqual([9, 13])
    expect(within(list()).queryByRole('button', { name: /^Bar 6\b/ })).not.toBeInTheDocument()
  })

  it('Put back says so when the line cannot go back, and changes nothing', async () => {
    const start = readDoc()
    const refused: EditorDoc = {
      ...start,
      pages: start.pages.map((page) =>
        page.partId === 'clarinet' ? { ...page, boxFlags: page.boxFlags!.map((f) => (f.bar === 6 ? { ...f, previous: { x: 360, w: 0 } } : f)) } : page,
      ),
    }
    const { user, probe } = setup(refused)

    await user.click(within(firstCards()[0]).getByRole('button'))
    await user.click(screen.getByRole('button', { name: text.queue.putBack }))

    expect(probe.notices).toEqual([text.queue.putBackRefused])
    expect(text.queue.putBackRefused).toBe('That line cannot go back as it was.')
    expect(probe.steps).toEqual([])
    expect(within(firstCards()[0]).getByRole('button', { expanded: true })).toBeInTheDocument()
  })

  it('Put back gives no notice when it works', async () => {
    const { user, probe } = setup(readDoc())

    await user.click(within(firstCards()[0]).getByRole('button'))
    await user.click(screen.getByRole('button', { name: text.queue.putBack }))

    expect(probe.notices).toEqual([])
  })

  it('Dismiss keeps the box where the read put it', async () => {
    const { user, probe } = setup(readDoc())

    await user.click(within(firstCards()[0]).getByRole('button'))
    await user.click(screen.getByRole('button', { name: text.queue.dismissFlag }))

    expect(probe.steps).toEqual(['resolve-box-flag'])
    expect(edges(probe.docs.at(-1)!, 6)).toEqual({ x: 380, w: 240 })
  })

  it('Resolve all still dismisses them, and moves no box', async () => {
    const { user, probe } = setup(readDoc())

    await user.click(screen.getByRole('button', { name: text.queue.resolveAll }))

    expect(probe.steps).toEqual(['resolve-all'])
    const after = clarinetOf(probe.docs.at(-1)!)
    expect(after.boxFlags).toBeUndefined()
    expect(after.bars).toBe(clarinetOf(probe.docs[0]).bars)
  })

  it('leave an old flag without old edges as it was: no Put back', async () => {
    const { user } = setup()

    await user.click(within(firstCards()[0]).getByRole('button'))

    expect(screen.queryByRole('button', { name: text.queue.putBack })).not.toBeInTheDocument()
  })
})
