import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { type DockEdit, type SlotRef, WaveformDock } from '@/components/waveform/WaveformDock'
import { timeToX } from '@/components/waveform/useDockView'
import { hintOf } from '@/components/ui/hint'
import { type DetectedBeat } from '@/domain/beats'
import { type EditRefusal } from '@/domain/pieceEdits'
import { demoDoc } from '@/domain/pieceFixtures'
import { reviewItems } from '@/domain/reviewQueue'
import { type TimingLayer } from '@/domain/types'
import { type Transport } from '@/lib/useTransport'
import { strings } from '@/strings'

// Bar lines on the beats: the group after Snap in the dock's toolbar. Each control sends one 'regrid' edit; the stretch
// comes from the selection; the pointer on a control shows what it would put on the waveform.

const text = strings.dock
const g = text.grid
const DURATION = 260
const PEAKS = Array.from({ length: DURATION * 10 }, (_, i) => 0.1 + 0.8 * Math.abs(Math.sin(i / 7)))
const WIDTH = 1000
const WINDOW = { startSec: 0, spanSec: 12 }
const xOf = (t: number) => timeToX(t, WINDOW, WIDTH)
const transport: Transport = { ready: true, playing: false, timeSec: 0, durationSec: DURATION, error: false, toggle: vi.fn(), seek: vi.fn() }

// The recording has a beat every half second from 1 s. Lines are the aligner's guesses unless a test checks them.
const BEAT_SEC = 0.5
const BEATS: DetectedBeat[] = Array.from({ length: 100 }, (_, i) => ({ t: 1 + BEAT_SEC * i, downbeat: i % 4 === 0 ? 0.9 : 0.1 }))
const BAR_COUNT = 20

/** Bars 1 to `bars` on every `step`-th beat, so `step` beats a bar; `checked` bars are confirmed. */
function timingOf(step: number, bars = 12, checked: readonly number[] = []): TimingLayer {
  return {
    barCount: BAR_COUNT,
    playOrder: [{ from: 1, to: BAR_COUNT }],
    meters: [{ fromBar: 1, numerator: 4, denominator: 4 }],
    marks: [],
    locators: Array.from({ length: bars }, (_, i) => ({ bar: i + 1, passIndex: 0, timeSec: 1 + BEAT_SEC * step * i, confirmed: checked.includes(i + 1) })),
  }
}
const bar = (n: number): SlotRef => ({ bar: n, passIndex: 0 })

function Harness({
  timing = timingOf(4),
  beats = BEATS,
  selection = [],
  onEdit = () => null,
  editable = true,
  durationSec = DURATION,
}: {
  timing?: TimingLayer
  beats?: DetectedBeat[] | null
  selection?: SlotRef[]
  onEdit?: (edit: DockEdit) => EditRefusal | null
  editable?: boolean
  durationSec?: number
}) {
  const doc = { ...demoDoc(), timing }
  return (
    <WaveformDock
      peaks={PEAKS}
      durationSec={durationSec}
      timing={timing}
      beats={beats}
      items={reviewItems(doc, 'clarinet')}
      moved={[]}
      transport={transport}
      selected={selection[0] ?? null}
      onSelect={() => {}}
      group={selection.length > 1 ? selection : []}
      onSelectGroup={() => {}}
      filter="all"
      onFilterChange={() => {}}
      beatLines={false}
      onBeatLinesChange={() => {}}
      onEdit={editable ? onEdit : undefined}
    />
  )
}

/** A control that is off says so with aria-disabled and stays in the tab order, so focus is never dropped when it turns off. */
function expectOff(element: HTMLElement) {
  expect(element).toHaveAttribute('aria-disabled', 'true')
  expect(element).not.toBeDisabled()
}
const expectOn = (element: HTMLElement) => expect(element).not.toHaveAttribute('aria-disabled')

const spy = () => vi.fn<(edit: DockEdit) => EditRefusal | null>(() => null)
const button = (name: string) => screen.getByRole('button', { name })
const lastEdit = (onEdit: ReturnType<typeof spy>) => onEdit.mock.calls.at(-1)![0] as Extract<DockEdit, { kind: 'regrid' }>
const previewXs = () => [...document.querySelectorAll<HTMLElement>('[data-slot="dock-grid-preview"]')].map((el) => Number(/translateX\(([\d.]+)px\)/.exec(el.style.transform)![1]))
const dimmedBars = () => [...document.querySelectorAll<HTMLElement>('[data-slot="dock-locator"][data-dimmed="true"]')].map((el) => Number(el.dataset.bar))

describe('the Bar lines on the beats group', () => {
  it('follows the Snap group and holds Continue, Half-time, Double-time and the beats a bar 1 to 6', () => {
    render(<Harness />)

    const snap = screen.getByRole('group', { name: text.snapGroup })
    const grid = screen.getByRole('group', { name: g.group })
    expect(snap.compareDocumentPosition(grid) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(within(grid).getByRole('button', { name: g.continue })).toBeInTheDocument()
    expect(within(grid).getByRole('button', { name: g.halfTime })).toBeInTheDocument()
    expect(within(grid).getByRole('button', { name: g.doubleTime })).toBeInTheDocument()
    const beatsGroup = within(grid).getByRole('group', { name: g.beatsABarWord })
    expect(within(beatsGroup).getAllByRole('button').map((b) => b.textContent)).toEqual(['1', '2', '3', '4', '5', '6'])
    expect(within(beatsGroup).getByRole('button', { name: g.beatsABar(1) })).toBeInTheDocument()
    expect(within(beatsGroup).getByRole('button', { name: g.beatsABar(4) })).toBeInTheDocument()
    expect(within(beatsGroup).getByRole('button', { name: g.beatsABar(5) })).toBeInTheDocument()
    expect(within(beatsGroup).getByRole('button', { name: g.beatsABar(6) })).toBeInTheDocument()
  })

  it('shows the Half-time, Double-time and 1 to 6 buttons only from 1700 px, with the word "Beats a bar"; Continue at every width', () => {
    render(<Harness />)

    const wide = button(g.halfTime).closest('[class*="min-[1700px]:flex"]')!
    expect(wide.className).toContain('hidden')
    expect(within(wide as HTMLElement).getByRole('button', { name: g.doubleTime })).toBeInTheDocument()
    expect(within(wide as HTMLElement).getByText(g.beatsABarWord, { selector: 'span:not([data-slot])' })).toBeInTheDocument()
    expect(within(wide as HTMLElement).getAllByRole('button').map((b) => b.textContent)).toEqual(['', '', '1', '2', '3', '4', '5', '6'])
    expect(button(g.continue).closest('.hidden')).toBeNull()
    expect(button(g.continue).textContent).toBe(g.continue)
    expect(button(g.continue).querySelector('svg')).not.toBeNull()
  })

  it('never wraps inside, and keeps its name', () => {
    render(<Harness />)

    const group = screen.getByRole('group', { name: g.group })
    expect(group.className).toContain('whitespace-nowrap')
    expect(group.className).not.toContain('flex-wrap')
  })

  it('hides the word Locators before the filter below 1700 px, and the filter group keeps its name', () => {
    render(<Harness />)

    const word = screen.getByText(text.locators, { selector: 'span' })
    expect(word.className).toContain('max-[1699px]:hidden')
    expect(screen.getByRole('group', { name: text.locators })).toBeInTheDocument()
  })

  it('is off when the dock cannot edit', () => {
    render(<Harness editable={false} selection={[bar(1), bar(4)]} />)

    for (const name of [g.continue, g.halfTime, g.doubleTime, g.beatsABar(1), g.beatsABar(2), g.beatsABar(3), g.beatsABar(4), g.beatsABar(5), g.beatsABar(6)]) {
      expectOff(button(name))
    }
    expect(screen.getByRole('button', { name: g.beatsMenu })).toBeDisabled()
  })
})

describe('what each control sends', () => {
  it('Double-time over the selected lines halves the beats a bar, on the stretch from the first to the last', async () => {
    const onEdit = spy()
    render(<Harness onEdit={onEdit} selection={[bar(1), bar(4)]} />)

    await userEvent.setup().click(button(g.doubleTime))

    expect(onEdit).toHaveBeenCalledTimes(1)
    expect(onEdit.mock.calls[0][0]).toMatchObject({ kind: 'regrid', stretch: { fromSec: 1, toSec: 7, fit: 'ripple' }, beatsPerBar: 2, offsetSec: 0, continuedFrom: null })
  })

  it('Half-time doubles them', async () => {
    const onEdit = spy()
    // a line every 2 beats: bars 1 to 5 are 1, 2, 3, 4, 5 s
    render(<Harness onEdit={onEdit} timing={timingOf(2)} selection={[bar(1), bar(5)]} />)

    await userEvent.setup().click(button(g.halfTime))

    expect(lastEdit(onEdit)).toMatchObject({ stretch: { fromSec: 1, toSec: 5, fit: 'ripple' }, beatsPerBar: 4 })
  })

  it('a triple goes to 1 beat a bar on Double-time', async () => {
    const onEdit = spy()
    render(<Harness onEdit={onEdit} timing={timingOf(3)} selection={[bar(1), bar(4)]} />)

    await userEvent.setup().click(button(g.doubleTime))

    expect(lastEdit(onEdit)).toMatchObject({ beatsPerBar: 1 })
  })

  it('Half-time takes three beats a bar to six', async () => {
    const onEdit = spy()
    render(<Harness onEdit={onEdit} timing={timingOf(3)} selection={[bar(1), bar(4)]} />)

    await userEvent.setup().click(button(g.halfTime))

    expect(lastEdit(onEdit)).toMatchObject({ beatsPerBar: 6 })
  })

  it('Double-time takes six beats a bar to three', async () => {
    const onEdit = spy()
    render(<Harness onEdit={onEdit} timing={timingOf(6)} selection={[bar(1), bar(4)]} />)

    await userEvent.setup().click(button(g.doubleTime))

    expect(lastEdit(onEdit)).toMatchObject({ beatsPerBar: 3 })
  })

  it('shows five and six beats a bar as the pressed segment', () => {
    const { unmount } = render(<Harness timing={timingOf(5)} selection={[bar(1), bar(4)]} />)
    expect(button(g.beatsABar(5)).getAttribute('aria-pressed')).toBe('true')
    expect(button(g.beatsABar(4)).getAttribute('aria-pressed')).toBe('false')
    unmount()
    render(<Harness timing={timingOf(6)} selection={[bar(1), bar(4)]} />)
    expect(button(g.beatsABar(6)).getAttribute('aria-pressed')).toBe('true')
  })

  it.each([1, 2, 3, 5, 6])('the segment %i puts the lines on every %i-th beat', async (beats) => {
    const onEdit = spy()
    render(<Harness onEdit={onEdit} selection={[bar(1), bar(4)]} />)

    await userEvent.setup().click(button(g.beatsABar(beats)))

    expect(lastEdit(onEdit)).toMatchObject({ kind: 'regrid', beatsPerBar: beats, stretch: { fromSec: 1, toSec: 7, fit: 'ripple' }, continuedFrom: null })
    expect(lastEdit(onEdit).beats).toBe(BEATS)
  })

  it('shows the beats a bar the stretch has now as the pressed segment', () => {
    render(<Harness selection={[bar(1), bar(4)]} />)

    expect([1, 2, 3, 4, 5, 6].map((n) => button(g.beatsABar(n)).getAttribute('aria-pressed'))).toEqual(['false', 'false', 'false', 'true', 'false', 'false'])
  })

  it('does not offer the pressed number when the lines are on those beats already', () => {
    render(<Harness selection={[bar(1), bar(4)]} />)

    expectOff(button(g.beatsABar(4)))
    expect(hintOf(button(g.beatsABar(4)))).toBe(g.nothingChanges)
  })
})

// A piece that changes its meter: bars 1 to 4 in 4/4, four beats apart; from bar 5 in 2/4, two beats apart. The lines of bars 1 to 9 are set.
describe('a stretch with bars of more than one meter', () => {
  const beatOf = (barNumber: number): number => (barNumber <= 5 ? 4 * (barNumber - 1) : 16 + 2 * (barNumber - 5))
  const mixed: TimingLayer = {
    barCount: BAR_COUNT,
    playOrder: [{ from: 1, to: BAR_COUNT }],
    meters: [
      { fromBar: 1, numerator: 4, denominator: 4 },
      { fromBar: 5, numerator: 2, denominator: 4 },
    ],
    marks: [],
    locators: Array.from({ length: 9 }, (_, i) => ({ bar: i + 1, passIndex: 0, timeSec: 1 + BEAT_SEC * beatOf(i + 1), confirmed: false })),
  }
  const pressedSegments = () => [1, 2, 3, 4, 5, 6].map((n) => button(g.beatsABar(n)).getAttribute('aria-pressed'))

  it('counts the beats a bar in bars of the first bar\'s meter, so 4/4 bars and 2/4 bars of half the length are 4 beats a bar', () => {
    render(<Harness timing={mixed} selection={[bar(1), bar(9)]} />)

    expect(pressedSegments()).toEqual(['false', 'false', 'false', 'true', 'false', 'false'])
  })

  it('counts them in the meter the stretch begins in', () => {
    render(<Harness timing={mixed} selection={[bar(5), bar(9)]} />)

    expect(pressedSegments()).toEqual(['false', 'true', 'false', 'false', 'false', 'false'])
  })

  it('Double-time halves that count, over the stretch from the first line to the last', async () => {
    const onEdit = spy()
    render(<Harness onEdit={onEdit} timing={mixed} selection={[bar(1), bar(9)]} />)

    await userEvent.setup().click(button(g.doubleTime))

    expect(lastEdit(onEdit)).toMatchObject({ beatsPerBar: 2, stretch: { fromSec: 1, toSec: 1 + BEAT_SEC * beatOf(9), fit: 'ripple' } })
  })

  it('puts the bars of the second meter on their share of the beats a bar when a segment is pressed', () => {
    render(<Harness timing={mixed} selection={[bar(1), bar(9)]} />)

    // at 2 beats a bar in 4/4 a 2/4 bar is one beat: the lines of bars 5 to 9 would move
    expectOn(button(g.beatsABar(2)))
    // at 4 beats a bar they are where they should be
    expectOff(button(g.beatsABar(4)))
    expect(hintOf(button(g.beatsABar(4)))).toBe(g.nothingChanges)
  })
})

describe('the stretch', () => {
  it('one selected line: from it to the next checked line', async () => {
    const onEdit = spy()
    render(<Harness onEdit={onEdit} timing={timingOf(4, 12, [5])} selection={[bar(2)]} />)

    await userEvent.setup().click(button(g.beatsABar(2)))

    expect(lastEdit(onEdit).stretch).toEqual({ fromSec: 3, toSec: 9, fit: 'ripple' })
  })

  it('one selected line with no checked line after it: to the end of the recording', async () => {
    const onEdit = spy()
    render(<Harness onEdit={onEdit} selection={[bar(2)]} />)

    await userEvent.setup().click(button(g.beatsABar(2)))

    expect(lastEdit(onEdit).stretch).toEqual({ fromSec: 3, toSec: DURATION, fit: 'ripple' })
  })

  it('nothing selected: asks before changing the whole piece, and Cancel changes nothing', async () => {
    const onEdit = spy()
    const user = userEvent.setup()
    render(<Harness onEdit={onEdit} />)

    await user.click(button(g.beatsABar(2)))

    const question = await screen.findByRole('alertdialog')
    expect(within(question).getByText(g.wholeTitle)).toBeInTheDocument()
    expect(within(question).getByText(g.wholeText)).toBeInTheDocument()
    expect(g.wholeText).toBe('Nothing is selected, so this puts bar lines on the beats from the first bar to the end. You can undo it.')
    expect(onEdit).not.toHaveBeenCalled()

    await user.click(within(question).getByRole('button', { name: g.wholeCancel }))

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(onEdit).not.toHaveBeenCalled()
  })

  it('nothing selected: "Change the whole piece" sends the edit from the first line to the end', async () => {
    const onEdit = spy()
    const user = userEvent.setup()
    render(<Harness onEdit={onEdit} />)

    await user.click(button(g.beatsABar(2)))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: g.wholeConfirm }))

    await waitFor(() => expect(onEdit).toHaveBeenCalledTimes(1))
    expect(lastEdit(onEdit)).toMatchObject({ stretch: { fromSec: 1, toSec: DURATION, fit: 'ripple' }, beatsPerBar: 2 })
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  })

  it('asks for Half-time and Double-time too, but not when something is selected', async () => {
    const onEdit = spy()
    const user = userEvent.setup()
    const { unmount } = render(<Harness onEdit={onEdit} />)
    await user.click(button(g.doubleTime))
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument()
    unmount()

    render(<Harness onEdit={onEdit} selection={[bar(1), bar(4)]} />)
    await user.click(button(g.doubleTime))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(onEdit).toHaveBeenCalledTimes(1)
  })

  it('a selection with no bar line is not the whole piece', () => {
    render(<Harness selection={[bar(15)]} />)

    expectOff(button(g.halfTime))
    expect(hintOf(button(g.halfTime))).toBe(g.selectionNoLine)
    expectOff(button(g.beatsABar(2)))
  })
})

describe('Continue', () => {
  // Bars 1 to 4 checked on every 4th beat (1, 3, 5, 7 s); the guesses after them are 1 s apart, the other pulse.
  const learnable = (): TimingLayer => {
    const timing = timingOf(4, 4, [1, 2, 3, 4])
    return { ...timing, locators: [...timing.locators, ...Array.from({ length: 6 }, (_, i) => ({ bar: 5 + i, passIndex: 0, timeSec: 8 + i, confirmed: false }))] }
  }

  it('goes on from the checked bars with the pulse they show, and says which bars it learned from', async () => {
    const onEdit = spy()
    render(<Harness onEdit={onEdit} timing={learnable()} />)

    await userEvent.setup().click(button(g.continue))

    expect(onEdit).toHaveBeenCalledTimes(1)
    expect(lastEdit(onEdit)).toMatchObject({ kind: 'regrid', beatsPerBar: 4, offsetSec: expect.closeTo(0, 6), stretch: { fromSec: 7, toSec: DURATION, fit: 'between' }, continuedFrom: { first: '1', last: '4' } })
  })

  it('names the meter the bars were checked in, so the apply and the preview count the beats a bar in it', async () => {
    // bars 1 to 3 in 4/4, four beats each; bar 4, where the 4th checked line starts, is the first bar of a 2/4 section
    const onEdit = spy()
    const timing: TimingLayer = { ...learnable(), meters: [{ fromBar: 1, numerator: 4, denominator: 4 }, { fromBar: 4, numerator: 2, denominator: 4 }] }
    render(<Harness onEdit={onEdit} timing={timing} />)

    await userEvent.setup().click(button(g.continue))

    expect(lastEdit(onEdit)).toMatchObject({ beatsPerBar: 4, referenceMeter: { numerator: 4, denominator: 4 } })
  })

  it('needs no confirmation: its stretch is its own, though nothing is selected', async () => {
    const onEdit = spy()
    render(<Harness onEdit={onEdit} timing={learnable()} />)

    await userEvent.setup().click(button(g.continue))

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('from the selected line when one is selected', async () => {
    const onEdit = spy()
    render(<Harness onEdit={onEdit} timing={learnable()} selection={[bar(4)]} />)

    await userEvent.setup().click(button(g.continue))

    expect(lastEdit(onEdit).stretch.fromSec).toBe(7)
  })

  it('shows the pulse it would learn as the pressed segment when the stretch has too few lines to measure', () => {
    // bar 4 is the last line there is: the stretch holds one line, but the 4 checked bars say 4 beats a bar
    render(<Harness timing={timingOf(4, 4, [1, 2, 3, 4])} selection={[bar(4)]} />)

    expect(hintOf(button(g.halfTime))).toBe(g.cannotMeasure)
    expect([1, 2, 3, 4, 5, 6].map((n) => button(g.beatsABar(n)).getAttribute('aria-pressed'))).toEqual(['false', 'false', 'false', 'true', 'false', 'false'])
  })

  it('is off, and says what to do, when there are no 4 checked bars in a row', () => {
    render(<Harness timing={timingOf(4, 12, [1, 2, 3])} />)

    expectOff(button(g.continue))
    expect(hintOf(button(g.continue))).toBe(g.nothingToLearn)
    expect(g.nothingToLearn).toBe('Check 3 bars in a row by ear first: Sounds right on 4 bar lines.')
  })

  it('is off, and says why, when four lines are checked but their bars do not hold the same number of beats', () => {
    // bar 3 sits half a second late: the bars hold 4, 5 and 3 beats, so there is no pulse to go on with
    const steady = timingOf(4, 12, [1, 2, 3, 4])
    const timing = { ...steady, locators: steady.locators.map((l) => (l.bar === 3 ? { ...l, timeSec: l.timeSec + 0.5 } : l)) }
    render(<Harness timing={timing} />)

    expectOff(button(g.continue))
    expect(hintOf(button(g.continue))).toBe(g.notSteady)
    expect(hintOf(button(g.continue))).not.toBe(g.nothingToLearn)
    expect(g.notSteady).toBe('Your last 3 checked bars do not hold the same number of beats, or a bar line is not on a beat.')
  })

  it('says the same with the last checked line selected, and not that the selected line is the wrong one', () => {
    const steady = timingOf(4, 12, [1, 2, 3, 4])
    const timing = { ...steady, locators: steady.locators.map((l) => (l.bar === 3 ? { ...l, timeSec: l.timeSec + 0.5 } : l)) }
    render(<Harness timing={timing} selection={[bar(4)]} />)

    expect(hintOf(button(g.continue))).toBe(g.notSteady)
  })

  it('is off, and says so, when the recording ends at the last checked line', () => {
    // bar 4 is at 7 s and the recording is 7 s long
    render(<Harness timing={timingOf(4, 12, [1, 2, 3, 4])} durationSec={7} />)

    expectOff(button(g.continue))
    expect(hintOf(button(g.continue))).toBe(g.noRoom)
  })

  it('is off, and says so, when the selected line is not where a run of checked bars ends', () => {
    render(<Harness timing={learnable()} selection={[bar(2)]} />)

    expectOff(button(g.continue))
    expect(hintOf(button(g.continue))).toBe(g.continueElsewhere)
  })

  it('is off when going on would change nothing', () => {
    // every line after the checked ones is on the pulse already
    const timing = timingOf(4, 12, [1, 2, 3, 4])
    render(<Harness timing={{ ...timing, barCount: 12, playOrder: [{ from: 1, to: 12 }] }} beats={BEATS.slice(0, 40)} />)

    // 12 bars on every 4th beat; the beats end at 20.5 s, bar 12 at 23 s is past them, and the grid goes on at the last gap
    expect(hintOf(button(g.continue))).toBe(g.nothingChanges)
    expectOff(button(g.continue))
  })

  it('says in its hover text which bars it works from', () => {
    render(<Harness timing={learnable()} />)

    expect(hintOf(button(g.continue))).toBe(g.continueOn('1', '4'))
  })
})

describe('the hover text, and why a control is off', () => {
  it('names what a control does when it is on', () => {
    render(<Harness selection={[bar(1), bar(4)]} />)

    expect(hintOf(button(g.doubleTime))).toBe(g.doubleTimeOn(2, 4))
    expect(hintOf(button(g.beatsABar(3)))).toBe(g.beatsOn(3))
    expect(g.beatsOn(1)).toBe('Put a bar line on every beat.')
    expect(g.beatsOn(3)).toBe('Put a bar line on every 3 beats.')
  })

  it('says there are no beats when the recording has none', () => {
    render(<Harness beats={null} selection={[bar(1), bar(4)]} />)

    for (const name of [g.continue, g.halfTime, g.doubleTime, g.beatsABar(1), g.beatsABar(4)]) {
      expectOff(button(name))
      expect(hintOf(button(name))).toBe('This recording has no detected beats.')
    }
  })

  it('says Half-time would be more than 6 beats a bar', () => {
    render(<Harness selection={[bar(1), bar(4)]} />)

    expectOff(button(g.halfTime))
    expect(hintOf(button(g.halfTime))).toBe(g.halfTimeTooMany(4))
    expect(g.halfTimeTooMany(4)).toBe('Already 4 beats a bar: Half-time would make it 8, and the most is 6.')
    expect(g.halfTimeTooMany(5)).toBe('Already 5 beats a bar: Half-time would make it 10, and the most is 6.')
  })

  it('says Double-time would not make a whole number of beats from 5 beats a bar', () => {
    render(<Harness timing={timingOf(5)} selection={[bar(1), bar(4)]} />)

    expectOff(button(g.doubleTime))
    expect(hintOf(button(g.doubleTime))).toBe(g.doubleTimeNotWhole(5))
    expect(g.doubleTimeNotWhole(5)).toBe('Already 5 beats a bar: Double-time would not make a whole number of beats.')
    expectOff(button(g.halfTime))
    expect(hintOf(button(g.halfTime))).toBe(g.halfTimeTooMany(5))
  })

  it('says Double-time would be less than 1 beat a bar', () => {
    render(<Harness timing={timingOf(1)} selection={[bar(1), bar(4)]} />)

    expectOff(button(g.doubleTime))
    expect(hintOf(button(g.doubleTime))).toBe(g.doubleTimeTooFew)
  })

  it('says it cannot tell the beats a bar when the lines are seven beats apart: that is not one of the choices', () => {
    render(<Harness timing={timingOf(7)} selection={[bar(1), bar(4)]} />)

    expectOff(button(g.halfTime))
    expect(hintOf(button(g.halfTime))).toBe(g.cannotMeasure)
    expectOff(button(g.doubleTime))
    expect(hintOf(button(g.doubleTime))).toBe(g.cannotMeasure)
    // no segment is pressed: the stretch does not hold a number of beats the buttons have
    expect([1, 2, 3, 4, 5, 6].map((n) => button(g.beatsABar(n)).getAttribute('aria-pressed'))).toEqual(['false', 'false', 'false', 'false', 'false', 'false'])
  })

  it('says it cannot tell the beats a bar from fewer than two lines', () => {
    const timing = timingOf(4, 1)
    render(<Harness timing={timing} selection={[bar(1)]} />)

    expectOff(button(g.halfTime))
    expect(hintOf(button(g.halfTime))).toBe(g.cannotMeasure)
  })

  it('says nothing would change when the lines are on the beats already', () => {
    render(<Harness timing={timingOf(2, 12)} selection={[bar(1), bar(5)]} />)

    expect(hintOf(button(g.beatsABar(2)))).toBe(g.nothingChanges)
  })

  it('has no browser title on any of its controls', () => {
    render(<Harness selection={[bar(1), bar(4)]} />)

    const group = screen.getByRole('group', { name: g.group })
    expect(group.querySelectorAll('[title]')).toHaveLength(0)
  })
})

describe('the preview on the waveform', () => {
  it('shows faint dashed lines at the new bar lines while the pointer is on a control, and takes them away after', async () => {
    const user = userEvent.setup()
    render(<Harness selection={[bar(1), bar(4)]} />)
    expect(previewXs()).toEqual([])

    await user.hover(button(g.doubleTime))

    // every 2 beats over 1 to 7 s: new lines at 2, 4 and 6 s, all in the first 12 s window
    expect(previewXs()).toHaveLength(3)
    previewXs().forEach((x, index) => expect(x).toBeCloseTo(xOf([2, 4, 6][index]), 3))
    const first = document.querySelector('[data-slot="dock-grid-preview"]')!
    expect(first).toHaveAttribute('aria-hidden', 'true')
    expect(first.className).toContain('border-dashed')
    expect(first.className).toContain('border-text-soft')

    await user.unhover(button(g.doubleTime))
    expect(previewXs()).toEqual([])
  })

  it('shows the lines of a segment and of Continue too, and for the keyboard as well as the pointer', async () => {
    const user = userEvent.setup()
    render(<Harness selection={[bar(1), bar(4)]} />)

    await user.hover(button(g.beatsABar(2)))
    expect(previewXs()).toHaveLength(3)
    await user.unhover(button(g.beatsABar(2)))

    fireEvent.focus(button(g.doubleTime))
    expect(previewXs()).toHaveLength(3)
    fireEvent.blur(button(g.doubleTime))
    expect(previewXs()).toEqual([])
  })

  it('draws only the new lines that are in the window', async () => {
    const user = userEvent.setup()
    // lines at 1, 3, ... 23 s; the window is 0 to 12 s
    render(<Harness selection={[bar(1), bar(12)]} />)

    await user.hover(button(g.doubleTime))

    // the plan has new lines every 2 s up to 22 s; the window ends at 12 s, which still shows the line on its edge
    expect(previewXs()).toHaveLength(6)
    expect(Math.max(...previewXs())).toBeCloseTo(xOf(12), 3)
  })

  it('dims the guesses that would go, and not the lines that stay', async () => {
    const user = userEvent.setup()
    // a line every 2 beats; Half-time over bars 1 to 5 keeps 1 and 3 s and drops the guesses at 2 and 4 s
    render(<Harness timing={timingOf(2)} selection={[bar(1), bar(5)]} />)
    expect(dimmedBars()).toEqual([])

    await user.hover(button(g.halfTime))

    expect(dimmedBars()).toEqual([2, 4])
    expect(previewXs()).toEqual([])

    await user.unhover(button(g.halfTime))
    expect(dimmedBars()).toEqual([])
  })

  it('shows nothing for a control that is off', async () => {
    const user = userEvent.setup()
    render(<Harness selection={[bar(1), bar(4)]} />)

    await user.hover(button(g.halfTime))

    expect(previewXs()).toEqual([])
  })

  it('goes after the control is pressed', async () => {
    const user = userEvent.setup()
    render(<Harness selection={[bar(1), bar(4)]} />)

    await user.hover(button(g.doubleTime))
    expect(previewXs()).toHaveLength(3)
    await user.click(button(g.doubleTime))

    expect(previewXs()).toEqual([])
  })
})

describe('the keyboard', () => {
  it('tabs into the segments, moves along them with the arrows, presses one, and tabs back in', async () => {
    const onEdit = spy()
    const user = userEvent.setup()
    render(<Harness onEdit={onEdit} selection={[bar(1), bar(4)]} />)
    const segments = () => within(screen.getByRole('group', { name: g.beatsABarWord })).getAllByRole('button')
    expectOff(button(g.beatsABar(4)))

    button(g.doubleTime).focus()
    await user.tab()
    expect(button(g.beatsABar(1))).toHaveFocus()
    await user.keyboard('{ArrowRight}{ArrowRight}')
    expect(button(g.beatsABar(3))).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(lastEdit(onEdit)).toMatchObject({ kind: 'regrid', beatsPerBar: 3 })

    await user.tab()
    expect(segments()).not.toContain(document.activeElement)
    await user.tab({ shift: true })
    expect(segments()).toContain(document.activeElement)
  })

  it('pressing an off control with the keyboard sends nothing and keeps the focus', async () => {
    const onEdit = spy()
    const user = userEvent.setup()
    render(<Harness onEdit={onEdit} selection={[bar(1), bar(4)]} />)

    button(g.halfTime).focus()
    expectOff(button(g.halfTime))
    await user.keyboard('{Enter}')

    expect(onEdit).not.toHaveBeenCalled()
    expect(button(g.halfTime)).toHaveFocus()
  })

  it('leaves Continue and Half-time in the tab order when they are off', async () => {
    const user = userEvent.setup()
    render(<Harness selection={[bar(1), bar(4)]} />)
    expectOff(button(g.continue))
    expectOff(button(g.halfTime))
    expectOn(button(g.doubleTime))

    button(g.continue).focus()
    expect(button(g.continue)).toHaveFocus()
    // (a browser shows the Beats button below 1700 px and the buttons from it; the test has no screen width and has both)
    await user.tab()
    expect(screen.getByRole('button', { name: g.beatsMenu })).toHaveFocus()
    await user.tab()
    expect(button(g.halfTime)).toHaveFocus()
    await user.tab()
    expect(button(g.doubleTime)).toHaveFocus()
  })
})

describe('the pressed segment', () => {
  it('is filled like the selected filter, and not faded when it is off', () => {
    render(<Harness selection={[bar(1), bar(4)]} />)

    const pressed = button(g.beatsABar(4))
    expect(pressed).toHaveAttribute('aria-pressed', 'true')
    expectOff(pressed)
    // the filter group draws its selected button with the default variant: the primary fill and its label colour
    expect(pressed.className).toContain('aria-pressed:bg-primary')
    expect(pressed.className).toContain('aria-pressed:text-primary-foreground')
    // an off segment fades, except the one that says what the stretch has now
    expect(pressed.className).toContain('aria-disabled:opacity-50')
    expect(pressed.className).toContain('aria-pressed:aria-disabled:opacity-100')
    expect(button(g.beatsABar(1)).className).not.toContain('aria-pressed:bg-surface-3')
  })
})

describe('the Beats menu (below 1700 px)', () => {
  const trigger = () => screen.getByRole('button', { name: g.beatsMenu })
  /** The menu item of that name, plain or radio. */
  const item = (name: string): HTMLElement => {
    const found = [...screen.queryAllByRole('menuitem', { name }), ...screen.queryAllByRole('menuitemradio', { name })]
    if (found.length !== 1) throw new Error(`expected one menu item named ${name}, found ${found.length}`)
    return found[0]
  }

  it('is one outline button with a chevron, in the group, that opens a menu; from 1700 px it is hidden', () => {
    render(<Harness />)

    const group = screen.getByRole('group', { name: g.group })
    expect(within(group).getByRole('button', { name: g.beatsMenu })).toBe(trigger())
    expect(trigger()).toHaveAttribute('aria-haspopup', 'menu')
    expect(trigger()).toHaveAttribute('aria-expanded', 'false')
    expect(trigger().textContent).toBe(g.beatsMenu)
    expect(trigger().querySelector('svg')).not.toBeNull()
    expect(trigger().closest('[data-slot="hint"]')!.className).toContain('min-[1700px]:hidden')
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('lists Half-time, Double-time and 1 to 6 beats a bar, and marks the beats a bar the stretch has now', async () => {
    const user = userEvent.setup()
    render(<Harness selection={[bar(1), bar(4)]} />)

    await user.click(trigger())

    const menu = await screen.findByRole('menu')
    expect(within(menu).getAllByRole('menuitem').map((el) => el.textContent?.slice(0, 9))).toEqual(['Half-time', 'Double-ti'])
    const radios = within(menu).getAllByRole('menuitemradio')
    expect(radios.map((el) => el.getAttribute('aria-checked'))).toEqual(['false', 'false', 'false', 'true', 'false', 'false'])
    expect(radios.map((el) => el.querySelector('svg') !== null)).toEqual([false, false, false, true, false, false])
    expect(radios.map((el) => el.textContent?.slice(0, g.beatsABar(1).length))).toEqual([1, 2, 3, 4, 5, 6].map((n) => g.beatsABar(n).slice(0, g.beatsABar(1).length)))
    expect(item(g.beatsABar(4))).toBeInTheDocument()
    expect(item(g.beatsABar(5))).toBeInTheDocument()
    expect(item(g.beatsABar(6))).toBeInTheDocument()
  })

  it('keeps an off item in the list with its reason as a second line in the soft text colour', async () => {
    const user = userEvent.setup()
    render(<Harness selection={[bar(1), bar(4)]} />)

    await user.click(trigger())
    await screen.findByRole('menu')

    const half = item(g.halfTime)
    expect(half).toHaveAttribute('aria-disabled', 'true')
    const reason = within(half).getByText(g.halfTimeTooMany(4))
    expect(reason.className).toContain('text-text-soft')
    expect(half).toHaveAccessibleDescription(g.halfTimeTooMany(4))
    // the pressed number is off too: nothing would change
    const four = item(g.beatsABar(4))
    expect(four).toHaveAttribute('aria-disabled', 'true')
    expect(within(four).getByText(g.nothingChanges)).toBeInTheDocument()
    // an item that works has no second line
    expect(item(g.doubleTime)).not.toHaveAttribute('aria-disabled')
    expect(item(g.doubleTime).textContent).toBe(g.doubleTime)
    expect(item(g.beatsABar(2)).textContent).toBe(g.beatsABar(2))
  })

  it('choosing an item sends the same edit as the button, and closes the menu', async () => {
    const onEdit = spy()
    const user = userEvent.setup()
    render(<Harness onEdit={onEdit} selection={[bar(1), bar(4)]} />)

    await user.click(trigger())
    await user.click(await screen.findByRole('menuitem', { name: g.doubleTime }))

    expect(onEdit).toHaveBeenCalledTimes(1)
    expect(lastEdit(onEdit)).toMatchObject({ kind: 'regrid', stretch: { fromSec: 1, toSec: 7, fit: 'ripple' }, beatsPerBar: 2, offsetSec: 0, continuedFrom: null })
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())

    await user.click(trigger())
    await user.click(await screen.findByRole('menuitemradio', { name: g.beatsABar(3) }))
    expect(lastEdit(onEdit)).toMatchObject({ beatsPerBar: 3 })
  })

  it('choosing an off item sends nothing and leaves the menu open', async () => {
    const onEdit = spy()
    const user = userEvent.setup()
    render(<Harness onEdit={onEdit} selection={[bar(1), bar(4)]} />)

    await user.click(trigger())
    await user.click(await screen.findByRole('menuitem', { name: g.halfTime }))

    expect(onEdit).not.toHaveBeenCalled()
    expect(screen.getByRole('menu')).toBeInTheDocument()
  })

  it('with nothing selected, choosing an item asks about the whole piece first', async () => {
    const onEdit = spy()
    const user = userEvent.setup()
    render(<Harness onEdit={onEdit} />)

    await user.click(trigger())
    await user.click(await screen.findByRole('menuitemradio', { name: g.beatsABar(2) }))

    const question = await screen.findByRole('alertdialog')
    expect(within(question).getByText(g.wholeTitle)).toBeInTheDocument()
    expect(onEdit).not.toHaveBeenCalled()
    await user.click(within(question).getByRole('button', { name: g.wholeConfirm }))
    await waitFor(() => expect(onEdit).toHaveBeenCalledTimes(1))
    expect(lastEdit(onEdit)).toMatchObject({ stretch: { fromSec: 1, toSec: DURATION, fit: 'ripple' }, beatsPerBar: 2 })
  })

  it('works with the keyboard: Enter opens it, the arrows move past an off item, Enter chooses', async () => {
    const onEdit = spy()
    const user = userEvent.setup()
    render(<Harness onEdit={onEdit} selection={[bar(1), bar(4)]} />)

    trigger().focus()
    await user.keyboard('{Enter}')
    await screen.findByRole('menu')
    // Half-time is off: its reason is on the screen, and the arrows go by it to the first item that works
    await waitFor(() => expect(item(g.doubleTime)).toHaveFocus())
    await user.keyboard('{ArrowDown}')
    expect(item(g.beatsABar(1))).toHaveFocus()
    await user.keyboard('{ArrowUp}')
    expect(item(g.doubleTime)).toHaveFocus()
    await user.keyboard('{Enter}')

    expect(lastEdit(onEdit)).toMatchObject({ beatsPerBar: 2 })
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
  })

  it('shows the preview lines of the highlighted item, as hovering the button does, and takes them away on leaving or closing', async () => {
    const user = userEvent.setup()
    render(<Harness selection={[bar(1), bar(4)]} />)
    await user.click(trigger())
    await screen.findByRole('menu')

    await user.hover(item(g.doubleTime))
    expect(previewXs()).toHaveLength(3)
    previewXs().forEach((x, index) => expect(x).toBeCloseTo(xOf([2, 4, 6][index]), 3))
    await user.unhover(item(g.doubleTime))
    expect(previewXs()).toEqual([])

    fireEvent.focus(item(g.beatsABar(2)))
    expect(previewXs()).toHaveLength(3)
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
    expect(previewXs()).toEqual([])
  })

  it('shows nothing for the highlighted item that is off', async () => {
    const user = userEvent.setup()
    render(<Harness selection={[bar(1), bar(4)]} />)
    await user.click(trigger())
    await screen.findByRole('menu')

    await user.hover(item(g.halfTime))

    expect(previewXs()).toEqual([])
  })

  it('dims the guesses an item would remove, as the button does', async () => {
    const user = userEvent.setup()
    render(<Harness timing={timingOf(2)} selection={[bar(1), bar(5)]} />)
    await user.click(trigger())
    await screen.findByRole('menu')

    await user.hover(item(g.halfTime))

    expect(dimmedBars()).toEqual([2, 4])
  })
})
