import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { type DockEdit, WaveformDock } from '@/components/waveform/WaveformDock'
import { type DetectedBeat } from '@/domain/beats'
import { type EditRefusal } from '@/domain/pieceEdits'
import { demoDoc } from '@/domain/pieceFixtures'
import { reviewItems } from '@/domain/reviewQueue'
import { type TimingLayer } from '@/domain/types'
import { type ContinueMode } from '@/lib/dataClient'
import { type Transport } from '@/lib/useTransport'
import { strings } from '@/strings'

// The "Ask me" panel over the waveform: after 3 bars in a row are checked by ear, it offers Continue. "Automatically" does it at
// once after the edit that made the plan. "Button only" does neither. The panel's Continue runs the toolbar Continue's own edit.

const text = strings.dock
const g = text.grid
const DURATION = 260
const PEAKS = Array.from({ length: DURATION * 10 }, (_, i) => 0.1 + 0.8 * Math.abs(Math.sin(i / 7)))
const transport: Transport = { ready: true, playing: false, timeSec: 0, durationSec: DURATION, error: false, toggle: vi.fn(), seek: vi.fn() }

// A beat every half second from 1 s.
const BEATS: DetectedBeat[] = Array.from({ length: 100 }, (_, i) => ({ t: 1 + 0.5 * i, downbeat: i % 4 === 0 ? 0.9 : 0.1 }))
const BAR_COUNT = 20

/**
 * Bars 1 to `checkedCount` checked, `stepSec` apart from 1 s (2 s = 4 beats a bar, 0.5 s = 1 beat a bar), then `guesses` bars
 * that are off the beats. The piece has 20 bars, so Continue has the bars after the checked ones to put on the beats.
 */
function runOf(checkedCount: number, { stepSec = 2, guesses = 6 }: { stepSec?: number; guesses?: number } = {}): TimingLayer {
  const checked = Array.from({ length: checkedCount }, (_, i) => ({ bar: i + 1, passIndex: 0, timeSec: 1 + stepSec * i, confirmed: true }))
  const last = 1 + stepSec * (checkedCount - 1)
  const rest = Array.from({ length: guesses }, (_, i) => ({ bar: checkedCount + 1 + i, passIndex: 0, timeSec: last + 0.3 + 1.1 * (i + 1), confirmed: false }))
  return { barCount: BAR_COUNT, playOrder: [{ from: 1, to: BAR_COUNT }], meters: [{ fromBar: 1, numerator: 4, denominator: 4 }], marks: [], locators: [...checked, ...rest] }
}

interface HarnessProps {
  timing?: TimingLayer
  beats?: DetectedBeat[] | null
  mode?: ContinueMode
  onEdit?: (edit: DockEdit) => EditRefusal | null
  editable?: boolean
  /** The selected bar lines, and what the dock does when Escape clears them. */
  selection?: readonly { bar: number; passIndex: number }[]
  onSelectGroup?: (slots: { bar: number; passIndex: number }[]) => void
}

// One object, as the dock gets from its doc: a default made on every render would look like an edit on every render.
const FOUR_CHECKED = runOf(4)

function Harness({ timing = FOUR_CHECKED, beats = BEATS, mode, onEdit = () => null, editable = true, selection = [], onSelectGroup }: HarnessProps) {
  const doc = { ...demoDoc(), timing }
  return (
    <WaveformDock
      peaks={PEAKS}
      durationSec={DURATION}
      timing={timing}
      beats={beats}
      items={reviewItems(doc, 'clarinet')}
      moved={[]}
      transport={transport}
      selected={selection[0] ?? null}
      onSelect={() => {}}
      group={selection.length > 1 ? selection : []}
      onSelectGroup={onSelectGroup}
      filter="all"
      onFilterChange={() => {}}
      beatLines={false}
      onBeatLinesChange={() => {}}
      continueMode={mode}
      onEdit={editable ? onEdit : undefined}
    />
  )
}

const spy = () => vi.fn<(edit: DockEdit) => EditRefusal | null>(() => null)
// the dock's hint line is a status too: the panel is the one named for Continue from my bars
const prompt = () => screen.queryByRole('status', { name: g.promptRegion })
const promptButton = (name: string) => within(screen.getByRole('status', { name: g.promptRegion })).getByRole('button', { name })
const toolbarContinue = () => within(screen.getByRole('group', { name: g.group })).getByRole('button', { name: g.continue })
const previewXs = () => [...document.querySelectorAll<HTMLElement>('[data-slot="dock-grid-preview"]')].map((el) => Number(/translateX\(([\d.]+)px\)/.exec(el.style.transform)![1]))
type Regrid = Extract<DockEdit, { kind: 'regrid' }>
const edits = (onEdit: ReturnType<typeof spy>) => onEdit.mock.calls.map(([edit]) => edit as Regrid)

describe('the Ask me panel', () => {
  it('asks to continue from the checked bars, in a status region with Continue and Not now', () => {
    render(<Harness mode="ask" />)

    const region = screen.getByRole('status', { name: g.promptRegion })
    expect(region).toHaveTextContent('Your bars 1 to 4 hold 4 beats each. Continue that pattern to bar 20?')
    expect(within(region).getAllByRole('button').map((b) => b.textContent)).toEqual([g.promptContinue, g.promptNotNow])
    expect([g.promptContinue, g.promptNotNow]).toEqual(['Continue', 'Not now'])
  })

  it('says "1 beat each" for one beat a bar and "2 beats each" for two', () => {
    const { unmount } = render(<Harness mode="ask" timing={runOf(4, { stepSec: 0.5 })} />)
    expect(prompt()).toHaveTextContent('Your bars 1 to 4 hold 1 beat each. Continue that pattern to bar 20?')
    expect(g.prompt('1', '4', 1, '20')).toBe('Your bars 1 to 4 hold 1 beat each. Continue that pattern to bar 20?')
    unmount()

    render(<Harness mode="ask" timing={runOf(4, { stepSec: 1 })} />)
    expect(prompt()).toHaveTextContent('Your bars 1 to 4 hold 2 beats each. Continue that pattern to bar 20?')
  })

  it("names the bars by the screen's labels", () => {
    expect(g.prompt('p1', '3', 3, '12')).toBe('Your bars p1 to 3 hold 3 beats each. Continue that pattern to bar 12?')
  })

  it('names the bar of the end line when a checked line ends the stretch', () => {
    const timing = runOf(4)
    // bar 11 is checked on a beat further on: Continue goes up to it
    const withEnd: TimingLayer = { ...timing, locators: [...timing.locators.filter((l) => l.bar < 11), { bar: 11, passIndex: 0, timeSec: 25, confirmed: true }] }
    render(<Harness mode="ask" timing={withEnd} />)

    expect(prompt()).toHaveTextContent('Continue that pattern to bar 11?')
  })

  it('is a panel in the More menu look, floating over the top of the waveform and never in the toolbar', () => {
    render(<Harness mode="ask" />)

    const region = screen.getByRole('status', { name: g.promptRegion })
    expect(region.className).toContain('absolute')
    expect(region.className).toContain('rounded-lg')
    expect(region.className).toContain('border-border-strong')
    expect(region.className).toContain('bg-surface-2')
    // it sits beside the stage in the waveform's own box, not among the controls
    expect(region.parentElement).toContainElement(screen.getByRole('group', { name: text.graph }))
    expect(screen.getByRole('group', { name: g.group })).not.toContainElement(region)
    expect(region.closest('[role="group"][aria-label]')).toBeNull()
    expect(region.hasAttribute('title')).toBe(false)
    expect(region.querySelector('[title]')).toBeNull()
  })

  it('has Continue as the app\'s main button and Not now as an outline button', () => {
    render(<Harness mode="ask" />)

    expect(promptButton(g.promptContinue).className).toContain('bg-primary')
    expect(promptButton(g.promptNotNow).className).not.toContain('bg-primary')
    expect(promptButton(g.promptNotNow).className).toContain('border-border')
  })

  it('does the toolbar Continue\'s own edit when Continue is pressed, and goes', async () => {
    const onEdit = spy()
    const toolbar = spy()
    const user = userEvent.setup()
    // what the toolbar's Continue sends for the same doc
    const first = render(<Harness onEdit={toolbar} />)
    await user.click(toolbarContinue())
    first.unmount()

    render(<Harness mode="ask" onEdit={onEdit} />)
    await user.click(promptButton(g.promptContinue))

    expect(onEdit).toHaveBeenCalledTimes(1)
    expect(edits(onEdit)[0]).toEqual(edits(toolbar)[0])
    expect(edits(onEdit)[0]).toMatchObject({ kind: 'regrid', beatsPerBar: 4, stretch: { fromSec: 7, toSec: DURATION, fit: 'between' }, continuedFrom: { first: '1', last: '4' } })
    expect(prompt()).not.toBeInTheDocument()
  })

  it('goes on pressing Not now without changing anything, and stays gone for that run', async () => {
    const onEdit = spy()
    const user = userEvent.setup()
    const { rerender } = render(<Harness mode="ask" onEdit={onEdit} />)

    await user.click(promptButton(g.promptNotNow))

    expect(prompt()).not.toBeInTheDocument()
    expect(onEdit).not.toHaveBeenCalled()
    // the doc changes (another guess moves) but the run is the same one
    rerender(<Harness mode="ask" onEdit={onEdit} timing={runOf(4)} />)
    expect(prompt()).not.toBeInTheDocument()
  })

  it('asks again for a longer run, whose last line is another one', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<Harness mode="ask" />)
    await user.click(promptButton(g.promptNotNow))

    rerender(<Harness mode="ask" timing={runOf(5)} />)

    expect(prompt()).toHaveTextContent('Your bars 2 to 5 hold 4 beats each. Continue that pattern to bar 20?')
  })

  it('does not ask again for a run that was undone back to after Continue was pressed', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<Harness mode="ask" />)
    await user.click(promptButton(g.promptContinue))
    expect(prompt()).not.toBeInTheDocument()

    // the lines were put on the beats, then Undo: the same doc comes back
    rerender(<Harness mode="ask" timing={runOf(4, { guesses: 0 })} />)
    rerender(<Harness mode="ask" timing={runOf(4)} />)

    expect(prompt()).not.toBeInTheDocument()
  })

  describe('Escape', () => {
    it('closes it like Not now while the keyboard focus is on the panel, and the selection is left alone', async () => {
      const onEdit = spy()
      const onSelectGroup = vi.fn()
      const user = userEvent.setup()
      const { rerender } = render(<Harness mode="ask" onEdit={onEdit} selection={[{ bar: 1, passIndex: 0 }]} onSelectGroup={onSelectGroup} />)
      promptButton(g.promptContinue).focus()
      expect(promptButton(g.promptContinue)).toHaveFocus()

      await user.keyboard('{Escape}')

      expect(prompt()).not.toBeInTheDocument()
      expect(onEdit).not.toHaveBeenCalled()
      // the first Escape does only that
      expect(onSelectGroup).not.toHaveBeenCalled()
      rerender(<Harness mode="ask" onEdit={onEdit} timing={runOf(4)} selection={[{ bar: 1, passIndex: 0 }]} onSelectGroup={onSelectGroup} />)
      expect(prompt()).not.toBeInTheDocument()
    })

    it('closes it from Not now too, when that is the focused button', async () => {
      const user = userEvent.setup()
      render(<Harness mode="ask" />)
      promptButton(g.promptNotNow).focus()

      await user.keyboard('{Escape}')

      expect(prompt()).not.toBeInTheDocument()
    })

    it('does only the dock\'s job when the focus is elsewhere: it clears the selection and the panel stays', async () => {
      const onSelectGroup = vi.fn()
      const user = userEvent.setup()
      render(<Harness mode="ask" selection={[{ bar: 1, passIndex: 0 }]} onSelectGroup={onSelectGroup} />)
      ;(document.activeElement as HTMLElement | null)?.blur()
      expect(document.body).toHaveFocus()

      await user.keyboard('{Escape}')

      expect(onSelectGroup).toHaveBeenCalledWith([])
      expect(prompt()).toBeInTheDocument()
    })

    it('keeps the panel when Escape is pressed with the focus on the waveform or on the toolbar', async () => {
      const user = userEvent.setup()
      render(<Harness mode="ask" />)

      screen.getByRole('group', { name: text.graph }).focus()
      await user.keyboard('{Escape}')
      expect(prompt()).toBeInTheDocument()

      toolbarContinue().focus()
      await user.keyboard('{Escape}')
      expect(prompt()).toBeInTheDocument()
    })

    it('does nothing to the panel while typing in a text field', async () => {
      const user = userEvent.setup()
      render(
        <>
          <Harness mode="ask" selection={[{ bar: 1, passIndex: 0 }]} onSelectGroup={() => {}} />
          <input aria-label="somewhere to type" />
        </>,
      )
      screen.getByRole('textbox', { name: 'somewhere to type' }).focus()

      await user.keyboard('{Escape}')

      expect(prompt()).toBeInTheDocument()
    })

    it('turns Add locator off with the first Escape and leaves the panel', async () => {
      const user = userEvent.setup()
      render(<Harness mode="ask" />)
      await user.click(screen.getByRole('button', { name: text.addLocator }))
      expect(screen.getByRole('button', { name: text.addLocator })).toHaveAttribute('aria-pressed', 'true')
      ;(document.activeElement as HTMLElement | null)?.blur()

      await user.keyboard('{Escape}')

      expect(screen.getByRole('button', { name: text.addLocator })).toHaveAttribute('aria-pressed', 'false')
      expect(prompt()).toBeInTheDocument()
    })
  })

  describe('the names', () => {
    it('names the region Continue from my bars, the Settings label, and the toolbar group keeps its own name', () => {
      render(<Harness mode="ask" />)

      expect(g.promptRegion).toBe('Continue from my bars')
      expect(g.promptRegion).toBe(strings.settings.continueMode)
      expect(screen.getByRole('status', { name: g.promptRegion })).toBeInTheDocument()
      expect(screen.getByRole('group', { name: g.group })).toBeInTheDocument()
      expect(screen.queryByRole('status', { name: g.group })).not.toBeInTheDocument()
    })

    it('describes the panel\'s Continue by the sentence, so it is told from the toolbar\'s Continue', () => {
      render(<Harness mode="ask" />)
      const sentence = g.prompt('1', '4', 4, '20')

      expect(promptButton(g.promptContinue)).toHaveAccessibleName(g.promptContinue)
      expect(promptButton(g.promptContinue)).toHaveAccessibleDescription(sentence)
      expect(toolbarContinue()).toHaveAccessibleName(g.continue)
      expect(toolbarContinue()).not.toHaveAccessibleDescription(sentence)
      expect(promptButton(g.promptNotNow)).not.toHaveAccessibleDescription(sentence)
    })
  })

  it('asks only when going on would change two or more lines', () => {
    // 5 bars: the checked 4 and one bar that is missing: one line to add, nothing to move
    const four = runOf(4, { guesses: 0 })
    const oneLine: TimingLayer = { ...four, barCount: 5, playOrder: [{ from: 1, to: 5 }] }
    const { unmount } = render(<Harness mode="ask" timing={oneLine} />)
    expect(prompt()).not.toBeInTheDocument()
    unmount()

    // bar 5 is a guess off the beats: one to add and the old guess to move is two
    const twoLines: TimingLayer = { ...four, barCount: 5, playOrder: [{ from: 1, to: 5 }], locators: [...four.locators, { bar: 5, passIndex: 0, timeSec: 8.3, confirmed: false }] }
    render(<Harness mode="ask" timing={twoLines} />)
    expect(prompt()).toBeInTheDocument()
  })

  it('does not ask with fewer than 4 checked bar lines in a row, with nothing to change, or without beats', () => {
    const { unmount } = render(<Harness mode="ask" timing={runOf(3)} />)
    expect(prompt()).not.toBeInTheDocument()
    unmount()

    // every bar after the checked ones is on the beats already
    const onBeats: TimingLayer = { ...runOf(4), locators: Array.from({ length: BAR_COUNT }, (_, i) => ({ bar: i + 1, passIndex: 0, timeSec: 1 + 2 * i, confirmed: i < 4 })) }
    const second = render(<Harness mode="ask" timing={onBeats} />)
    expect(prompt()).not.toBeInTheDocument()
    second.unmount()

    render(<Harness mode="ask" beats={null} />)
    expect(prompt()).not.toBeInTheDocument()
  })

  it('shows when the beats arrive after the dock opened', () => {
    const { rerender } = render(<Harness mode="ask" beats={null} />)
    expect(prompt()).not.toBeInTheDocument()

    rerender(<Harness mode="ask" />)

    expect(prompt()).toBeInTheDocument()
  })

  it('does not show when the dock cannot edit', () => {
    render(<Harness mode="ask" editable={false} />)

    expect(prompt()).not.toBeInTheDocument()
  })

  it('does not change the toolbar or the waveform: the same stage and toolbar with and without it, and one element added beside the stage', () => {
    const { rerender } = render(<Harness mode="button" />)
    const stage = screen.getByRole('group', { name: text.graph })
    const toolbar = stage.parentElement!.previousElementSibling!
    const toolbarBefore = toolbar.outerHTML
    const stageBefore = stage.outerHTML
    const siblingsBefore = stage.parentElement!.children.length
    expect(prompt()).not.toBeInTheDocument()

    rerender(<Harness mode="ask" />)

    expect(prompt()).toBeInTheDocument()
    expect(screen.getByRole('group', { name: text.graph })).toBe(stage)
    expect(stage.outerHTML).toBe(stageBefore)
    expect(stage.parentElement!.previousElementSibling).toBe(toolbar)
    expect(toolbar.outerHTML).toBe(toolbarBefore)
    // the element added is absolute, so the stage keeps its height
    expect(stage.parentElement!.children.length).toBe(siblingsBefore + 1)
    expect(stage.parentElement!.firstElementChild).toBe(stage)
    expect(prompt()!.className).toContain('absolute')
  })

  describe('the preview', () => {
    it('shows the lines the toolbar Continue shows while the pointer is on its Continue, and takes them away after', async () => {
      const user = userEvent.setup()
      render(<Harness mode="ask" />)
      await user.hover(toolbarContinue())
      const toolbarLines = previewXs()
      await user.unhover(toolbarContinue())
      expect(toolbarLines.length).toBeGreaterThan(0)
      expect(previewXs()).toEqual([])

      await user.hover(promptButton(g.promptContinue))
      expect(previewXs()).toEqual(toolbarLines)

      await user.unhover(promptButton(g.promptContinue))
      expect(previewXs()).toEqual([])
    })

    it('shows nothing for Not now, shows them for the keyboard too, and ends when Continue is pressed', async () => {
      const user = userEvent.setup()
      render(<Harness mode="ask" />)

      await user.hover(promptButton(g.promptNotNow))
      expect(previewXs()).toEqual([])
      await user.unhover(promptButton(g.promptNotNow))

      fireEvent.focus(promptButton(g.promptContinue))
      expect(previewXs().length).toBeGreaterThan(0)
      fireEvent.blur(promptButton(g.promptContinue))
      expect(previewXs()).toEqual([])

      await user.hover(promptButton(g.promptContinue))
      expect(previewXs().length).toBeGreaterThan(0)
      await user.click(promptButton(g.promptContinue))
      expect(prompt()).not.toBeInTheDocument()
      expect(previewXs()).toEqual([])
    })
  })
})

describe('Button only', () => {
  it('shows no panel and does nothing by itself', () => {
    const onEdit = spy()
    const { rerender } = render(<Harness mode="button" onEdit={onEdit} timing={runOf(3)} />)

    rerender(<Harness mode="button" onEdit={onEdit} timing={runOf(4)} />)

    expect(prompt()).not.toBeInTheDocument()
    expect(onEdit).not.toHaveBeenCalled()
    expect(toolbarContinue()).not.toHaveAttribute('aria-disabled')
  })

  it('is what a dock does that was not told a way: no panel, no edit', () => {
    const onEdit = spy()
    const { rerender } = render(<Harness onEdit={onEdit} timing={runOf(3)} />)

    rerender(<Harness onEdit={onEdit} timing={runOf(4)} />)

    expect(prompt()).not.toBeInTheDocument()
    expect(onEdit).not.toHaveBeenCalled()
  })
})

describe('Automatically', () => {
  it('puts the lines on the beats at once when an edit makes the plan, with the toolbar Continue\'s own edit, and shows no panel', async () => {
    const onEdit = spy()
    const toolbar = spy()
    const first = render(<Harness onEdit={toolbar} />)
    await userEvent.setup().click(toolbarContinue())
    first.unmount()

    const { rerender } = render(<Harness mode="auto" onEdit={onEdit} timing={runOf(3)} />)
    expect(onEdit).not.toHaveBeenCalled()

    // the fourth line is checked
    rerender(<Harness mode="auto" onEdit={onEdit} timing={runOf(4)} />)

    expect(onEdit).toHaveBeenCalledTimes(1)
    expect(edits(onEdit)[0]).toEqual(edits(toolbar)[0])
    expect(edits(onEdit)[0]).toMatchObject({ kind: 'regrid', beatsPerBar: 4, continuedFrom: { first: '1', last: '4' } })
    expect(prompt()).not.toBeInTheDocument()
  })

  it('does nothing on open, though the plan is there, and not when the beats arrive', () => {
    const onEdit = spy()
    const { rerender } = render(<Harness mode="auto" onEdit={onEdit} beats={null} />)

    rerender(<Harness mode="auto" onEdit={onEdit} />)

    expect(onEdit).not.toHaveBeenCalled()
  })

  it('does nothing for an edit that leaves the plan as it was', () => {
    const onEdit = spy()
    const { rerender } = render(<Harness mode="auto" onEdit={onEdit} timing={runOf(4)} />)

    // another guess is moved: the same run is still waiting
    rerender(<Harness mode="auto" onEdit={onEdit} timing={runOf(4, { guesses: 5 })} />)

    expect(onEdit).not.toHaveBeenCalled()
  })

  it('does it once for a run: not again after an Undo brings the plan back', () => {
    const onEdit = spy()
    const { rerender } = render(<Harness mode="auto" onEdit={onEdit} timing={runOf(3)} />)
    rerender(<Harness mode="auto" onEdit={onEdit} timing={runOf(4)} />)
    expect(onEdit).toHaveBeenCalledTimes(1)

    // the lines were placed (the doc has no plan left), then undone (the same doc comes back)
    rerender(<Harness mode="auto" onEdit={onEdit} timing={runOf(4, { guesses: 0 })} />)
    rerender(<Harness mode="auto" onEdit={onEdit} timing={runOf(4)} />)

    expect(onEdit).toHaveBeenCalledTimes(1)
  })

  it('does not start Continue from the run that was waiting when the Editor opened when Undo goes back past the check of the next bar', () => {
    const onEdit = spy()
    const { rerender } = render(<Harness mode="auto" onEdit={onEdit} timing={runOf(4)} />) // opens with bars 1 to 4 checked: nothing happens
    expect(onEdit).not.toHaveBeenCalled()

    rerender(<Harness mode="auto" onEdit={onEdit} timing={runOf(5)} />) // bar 5 is checked: Continue from bars 2 to 5
    expect(edits(onEdit).map((edit) => edit.continuedFrom)).toEqual([{ first: '2', last: '5' }])
    rerender(<Harness mode="auto" onEdit={onEdit} timing={runOf(5)} />) // Undo of that Continue: the same doc as after the check
    rerender(<Harness mode="auto" onEdit={onEdit} timing={runOf(4)} />) // Undo of the check of bar 5: no line was just checked

    expect(edits(onEdit).map((edit) => edit.continuedFrom)).toEqual([{ first: '2', last: '5' }])
  })

  it('does nothing when a line is unchecked, though that leaves a run that is new', () => {
    const onEdit = spy()
    const five = runOf(5)
    const { rerender } = render(<Harness mode="auto" onEdit={onEdit} timing={five} />) // opens with bars 1 to 5 checked

    rerender(<Harness mode="auto" onEdit={onEdit} timing={{ ...five, locators: five.locators.map((l) => (l.bar === 5 ? { ...l, confirmed: false } : l)) }} />)

    expect(prompt()).not.toBeInTheDocument()
    expect(onEdit).not.toHaveBeenCalled()
  })

  it('does it when a guess that was already in place is checked where it stands', () => {
    const onEdit = spy()
    const four = runOf(4)
    const unchecked: TimingLayer = { ...four, locators: four.locators.map((l) => (l.bar === 4 ? { ...l, confirmed: false } : l)) }
    const { rerender } = render(<Harness mode="auto" onEdit={onEdit} timing={unchecked} />)
    expect(onEdit).not.toHaveBeenCalled()

    // the same lines at the same times: only the check of bar 4 is new
    rerender(<Harness mode="auto" onEdit={onEdit} timing={four} />)

    expect(edits(onEdit).map((edit) => edit.continuedFrom)).toEqual([{ first: '1', last: '4' }])
  })

  it('does nothing for an edit that only fills in bars with no line, or renumbers, with the run\'s lines checked as before', () => {
    const onEdit = spy()
    const four = runOf(4, { guesses: 0 })
    const { rerender } = render(<Harness mode="auto" onEdit={onEdit} timing={{ ...four, barCount: 8, playOrder: [{ from: 1, to: 8 }] }} />)

    // the Editor's own fill puts a guess on each missing bar: no line was checked
    rerender(<Harness mode="auto" onEdit={onEdit} timing={{ ...four, barCount: 8, playOrder: [{ from: 1, to: 8 }], locators: [...four.locators, ...[5, 6, 7, 8].map((bar) => ({ bar, passIndex: 0, timeSec: 7.3 + bar, confirmed: false }))] }} />)

    expect(onEdit).not.toHaveBeenCalled()
  })

  it('does it again for the next run, which ends on another line', () => {
    const onEdit = spy()
    const { rerender } = render(<Harness mode="auto" onEdit={onEdit} timing={runOf(3)} />)
    rerender(<Harness mode="auto" onEdit={onEdit} timing={runOf(4)} />)

    rerender(<Harness mode="auto" onEdit={onEdit} timing={runOf(5)} />)

    expect(onEdit).toHaveBeenCalledTimes(2)
    expect(edits(onEdit)[1]).toMatchObject({ continuedFrom: { first: '2', last: '5' } })
  })

  it('does nothing when the dock cannot edit, or the plan changes only one line', () => {
    const onEdit = spy()
    const { rerender } = render(<Harness mode="auto" editable={false} timing={runOf(3)} />)
    rerender(<Harness mode="auto" editable={false} onEdit={onEdit} timing={runOf(4)} />)
    expect(onEdit).not.toHaveBeenCalled()

    const four = runOf(4, { guesses: 0 })
    const oneLine: TimingLayer = { ...four, barCount: 5, playOrder: [{ from: 1, to: 5 }] }
    const second = render(<Harness mode="auto" onEdit={onEdit} timing={{ ...oneLine, locators: oneLine.locators.map((l) => ({ ...l, confirmed: l.bar < 4 })) }} />)
    second.rerender(<Harness mode="auto" onEdit={onEdit} timing={oneLine} />)
    expect(onEdit).not.toHaveBeenCalled()
  })

  it('does it only once when the dock draws twice for the same edit', () => {
    const onEdit = spy()
    const { rerender } = render(<Harness mode="auto" onEdit={onEdit} timing={runOf(3)} />)
    const four = runOf(4)

    rerender(<Harness mode="auto" onEdit={onEdit} timing={four} />)
    rerender(<Harness mode="auto" onEdit={onEdit} timing={four} />)

    expect(onEdit).toHaveBeenCalledTimes(1)
  })
})
