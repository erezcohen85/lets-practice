import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { addBarLine, deleteBarLine, moveBarLine, moveLineEnd, moveLineStart, type EditResult } from '@/domain/pieceEdits'
import { demoDoc, SHORT_PART_ID } from '@/domain/pieceFixtures'
import { DEMO_SPEC, PAGE_HEIGHT, PAGE_WIDTH, syntheticPageLayer, syntheticPages } from '@/lib/fakes/syntheticPiece'
import { type EditMode } from '@/lib/useEditorDoc'
import { strings } from '@/strings'
import { type BarState, ScoreView } from './ScoreView'
import { useEditLayer } from './useEditLayer'

const doc = demoDoc()
const part = doc.pages.find((page) => page.partId === SHORT_PART_ID)!
const pages = syntheticPages(DEMO_SPEC, syntheticPageLayer(DEMO_SPEC, SHORT_PART_ID))

// The column is the scroll container minus its padding (16 px each side): one page wide at zoom 1, so one image pixel
// is one screen pixel and the stubbed page rectangle below sits at the origin.
const COLUMN = PAGE_WIDTH + 2 * 16

function Harness({ mode, onResult, zoom = 1 }: { mode: EditMode; onResult(result: EditResult): void; zoom?: number }) {
  const { onPointer, overlay } = useEditLayer({ mode, doc, partId: SHORT_PART_ID, onResult, pageWidth: () => PAGE_WIDTH })
  return (
    <ScoreView
      pages={pages}
      page={part}
      barStates={new Map<number, BarState>()}
      zoom={zoom}
      currentPage={0}
      onPageInView={() => {}}
      onPointer={onPointer}
      overlay={overlay}
    />
  )
}

function setup(mode: EditMode, zoom = 1) {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(COLUMN)
  const onResult = vi.fn<(result: EditResult) => void>()
  const user = userEvent.setup()
  const view = render(<Harness mode={mode} onResult={onResult} zoom={zoom} />)
  return { user, onResult, ...view }
}

const pageEl = (index: number) => document.querySelector<HTMLElement>(`[data-slot="score-page"][data-page-index="${index}"]`)!

/** Gives the page the rectangle it has at `scale`, at the origin (jsdom has no layout). */
function stubRect(index: number, scale = 1) {
  const el = pageEl(index)
  const width = PAGE_WIDTH * scale
  const height = PAGE_HEIGHT * scale
  el.getBoundingClientRect = () => ({ left: 0, top: 0, width, height, right: width, bottom: height, x: 0, y: 0, toJSON() {} })
  return el
}

const handle = () => document.querySelector<HTMLElement>('[data-slot="edit-handle"]')
const addLine = () => document.querySelector<HTMLElement>('[data-slot="edit-add-line"]')
const deleteLine = () => document.querySelector<HTMLElement>('[data-slot="edit-delete-line"]')

afterEach(() => vi.restoreAllMocks())

// The trumpet's first staff line: bars 1-4, boxes 260 wide from x 100, y 150 to 450; lines at x 360, 620, 880.
describe('Move mode', () => {
  it('shows a drag handle on a bar line the pointer is near, and nothing elsewhere', () => {
    setup('move')
    const page = stubRect(0)

    fireEvent.pointerMove(page, { clientX: 366, clientY: 300 })
    expect(handle()).toBeInTheDocument()
    expect(handle()!.style.left).toBe('357px') // 6 px wide, centred on the line at 360
    expect(handle()).toHaveClass('cursor-ew-resize')

    fireEvent.pointerMove(page, { clientX: 480, clientY: 300 })
    expect(handle()).toBeNull()
  })

  it('shows a handle on the start of a line and on its end', () => {
    setup('move')
    const page = stubRect(0)

    fireEvent.pointerMove(page, { clientX: 100, clientY: 300 })
    expect(handle()).toBeInTheDocument()
    expect(handle()!.style.left).toBe('97px')
    fireEvent.pointerMove(page, { clientX: 1146, clientY: 300 }) // 6 px past the end of the line at 1140
    expect(handle()).toBeInTheDocument()
    expect(handle()!.style.left).toBe('1137px')
    fireEvent.pointerMove(page, { clientX: 1160, clientY: 300 })
    expect(handle()).toBeNull()
  })

  it('shows no handle on the start or the end of a line in Add and Delete modes', () => {
    for (const mode of ['add', 'delete'] as const) {
      const { unmount } = setup(mode)
      const page = stubRect(0)

      fireEvent.pointerMove(page, { clientX: 1140, clientY: 300 })
      expect(handle()).toBeNull()
      unmount()
      vi.restoreAllMocks()
    }
  })

  it('drags the end of a line and applies moveLineEnd on release', async () => {
    const { user, onResult } = setup('move')
    const page = stubRect(0)

    await user.pointer([
      { keys: '[MouseLeft>]', target: page, coords: { clientX: 1140, clientY: 300 } },
      { target: page, coords: { clientX: 1180, clientY: 320 } },
    ])
    expect(handle()).toHaveAttribute('data-dragging', 'true')
    expect(handle()!.style.left).toBe('1177px')

    await user.pointer({ keys: '[/MouseLeft]', target: page, coords: { clientX: 1180, clientY: 320 } })

    expect(onResult).toHaveBeenCalledTimes(1)
    expect(onResult).toHaveBeenCalledWith(moveLineEnd(doc, SHORT_PART_ID, 4, 1180, PAGE_WIDTH))
    expect(onResult.mock.calls[0][0].ok).toBe(true)
    expect(handle()).toBeNull()
  })

  it('drags the end of a line with a finger as it does with a mouse (the page gets pointer events for both)', () => {
    const { onResult } = setup('move')
    const page = stubRect(0)

    fireEvent.pointerDown(page, { clientX: 1136, clientY: 300, pointerType: 'touch' })
    fireEvent.pointerMove(page, { clientX: 1100, clientY: 310, pointerType: 'touch' })
    fireEvent.pointerUp(page, { clientX: 1100, clientY: 310, pointerType: 'touch' })

    expect(onResult).toHaveBeenCalledWith(moveLineEnd(doc, SHORT_PART_ID, 4, 1100, PAGE_WIDTH))
  })

  it('holds the end of a line between the minimum width after the start of its box and the page edge', () => {
    setup('move')
    const page = stubRect(0)

    fireEvent.pointerDown(page, { clientX: 1140, clientY: 300 })
    fireEvent.pointerMove(page, { clientX: 5, clientY: 300 })
    expect(handle()!.style.left).toBe('889px') // the box starts at 880; 12 px stay, less the half handle
    fireEvent.pointerMove(page, { clientX: PAGE_WIDTH + 400, clientY: 300 })
    expect(handle()!.style.left).toBe(`${PAGE_WIDTH - 3}px`)
  })

  it('passes a refused move of the end on, so the page can say why', () => {
    const { onResult } = setup('move')
    const page = stubRect(0)

    fireEvent.pointerDown(page, { clientX: 1140, clientY: 300 })
    fireEvent.pointerMove(page, { clientX: 885, clientY: 300 })
    fireEvent.pointerUp(page, { clientX: 885, clientY: 300 })

    expect(onResult).toHaveBeenCalledWith({ ok: false, reason: 'too-narrow' })
  })

  it('applies nothing for a click on the end of a line without a drag', () => {
    const { onResult } = setup('move')
    const page = stubRect(0)

    fireEvent.pointerDown(page, { clientX: 1140, clientY: 300 })
    fireEvent.pointerUp(page, { clientX: 1140.4, clientY: 300 })

    expect(onResult).not.toHaveBeenCalled()
  })

  it('drags the start of a line and applies moveLineStart on release', async () => {
    const { user, onResult } = setup('move')
    const page = stubRect(0)

    await user.pointer([
      { keys: '[MouseLeft>]', target: page, coords: { clientX: 100, clientY: 300 } },
      { target: page, coords: { clientX: 60, clientY: 320 } },
    ])
    expect(handle()).toHaveAttribute('data-dragging', 'true')
    expect(handle()!.style.left).toBe('57px')

    await user.pointer({ keys: '[/MouseLeft]', target: page, coords: { clientX: 60, clientY: 320 } })

    expect(onResult).toHaveBeenCalledTimes(1)
    expect(onResult).toHaveBeenCalledWith(moveLineStart(doc, SHORT_PART_ID, 1, 60))
    expect(onResult.mock.calls[0][0].ok).toBe(true)
  })

  it('holds the start of a line between the page edge and the minimum width before the end of its box', () => {
    setup('move')
    const page = stubRect(0)

    fireEvent.pointerDown(page, { clientX: 100, clientY: 300 })
    fireEvent.pointerMove(page, { clientX: 900, clientY: 300 })
    expect(handle()!.style.left).toBe('345px') // the box ends at 360; 12 px stay, less the half handle
    fireEvent.pointerMove(page, { clientX: 0, clientY: 300 })
    expect(handle()!.style.left).toBe('-3px')
  })

  it('previews the line under the pointer while dragging and applies moveBarLine on release', async () => {
    const { user, onResult } = setup('move')
    const page = stubRect(0)

    await user.pointer([
      { keys: '[MouseLeft>]', target: page, coords: { clientX: 360, clientY: 300 } },
      { target: page, coords: { clientX: 400, clientY: 320 } },
    ])
    expect(handle()).toHaveAttribute('data-dragging', 'true')
    expect(handle()!.style.left).toBe('397px')
    expect(onResult).not.toHaveBeenCalled()

    await user.pointer({ keys: '[/MouseLeft]', target: page, coords: { clientX: 410, clientY: 320 } })

    expect(onResult).toHaveBeenCalledTimes(1)
    expect(onResult).toHaveBeenCalledWith(moveBarLine(doc, SHORT_PART_ID, 1, 410))
    expect(onResult.mock.calls[0][0].ok).toBe(true)
    expect(handle()).toBeNull()
  })

  it('holds the preview inside the two bars either side of the line', () => {
    setup('move')
    const page = stubRect(0)

    fireEvent.pointerDown(page, { clientX: 360, clientY: 300 })
    fireEvent.pointerMove(page, { clientX: 1000, clientY: 300 })

    expect(handle()!.style.left).toBe('617px') // the right edge of bar 2 at 620, less the half handle
  })

  it('passes a refused move on, so the page can say why', () => {
    const { onResult } = setup('move')
    const page = stubRect(0)

    fireEvent.pointerDown(page, { clientX: 360, clientY: 300 })
    fireEvent.pointerMove(page, { clientX: 105, clientY: 300 })
    fireEvent.pointerUp(page, { clientX: 105, clientY: 300 })

    expect(onResult).toHaveBeenCalledWith({ ok: false, reason: 'too-narrow' })
  })

  it('applies nothing for a click without a drag', () => {
    const { onResult } = setup('move')
    const page = stubRect(0)

    fireEvent.pointerDown(page, { clientX: 360, clientY: 300 })
    fireEvent.pointerUp(page, { clientX: 360.4, clientY: 300 })

    expect(onResult).not.toHaveBeenCalled()
  })

  it('cancels a drag that leaves the page: nothing is applied, even if the pointer comes back and lets go', () => {
    const { onResult } = setup('move')
    const page = stubRect(0)

    fireEvent.pointerDown(page, { clientX: 360, clientY: 300 })
    fireEvent.pointerMove(page, { clientX: 400, clientY: 300 })
    fireEvent.pointerLeave(page, { clientX: 1300, clientY: 300 })
    expect(handle()).toBeNull()
    fireEvent.pointerUp(page, { clientX: 450, clientY: 300 })

    expect(onResult).not.toHaveBeenCalled()
  })

  it('cancels a drag released over another page', () => {
    const { onResult } = setup('move')
    const first = stubRect(0)
    const second = stubRect(1)

    fireEvent.pointerDown(first, { clientX: 360, clientY: 300 })
    fireEvent.pointerUp(second, { clientX: 400, clientY: 300 })

    expect(onResult).not.toHaveBeenCalled()
  })

  it('does not start a drag when the press is not on a bar line', () => {
    const { onResult } = setup('move')
    const page = stubRect(0)

    fireEvent.pointerDown(page, { clientX: 480, clientY: 300 })
    fireEvent.pointerMove(page, { clientX: 520, clientY: 300 })
    fireEvent.pointerUp(page, { clientX: 520, clientY: 300 })

    expect(handle()).toBeNull()
    expect(onResult).not.toHaveBeenCalled()
  })

  it('ignores the Shift key', () => {
    const { onResult } = setup('move')
    const page = stubRect(0)

    fireEvent.pointerDown(page, { clientX: 360, clientY: 300, shiftKey: true })
    fireEvent.pointerUp(page, { clientX: 410, clientY: 300, shiftKey: true })

    expect(onResult).toHaveBeenCalledWith(moveBarLine(doc, SHORT_PART_ID, 1, 410))
  })
})

describe('Add bar line mode', () => {
  it('shows a dashed line and the tag at the pointer inside a bar', () => {
    setup('add')
    const page = stubRect(0)

    fireEvent.pointerMove(page, { clientX: 450, clientY: 200 })

    expect(addLine()).toBeInTheDocument()
    expect(addLine()!.style.left).toBe('450px')
    expect(addLine()!.style.top).toBe('150px')
    expect(addLine()!.style.height).toBe('300px')
    expect(screen.getByText(strings.editor.addHere)).toBeInTheDocument()
  })

  it('shows nothing outside the bars, and nothing after the pointer leaves the page', () => {
    setup('add')
    const page = stubRect(0)

    fireEvent.pointerMove(page, { clientX: 50, clientY: 200 })
    expect(addLine()).toBeNull()

    fireEvent.pointerMove(page, { clientX: 450, clientY: 200 })
    fireEvent.pointerLeave(page, { clientX: 1300, clientY: 200 })
    expect(addLine()).toBeNull()
    expect(screen.queryByText(strings.editor.addHere)).toBeNull()
  })

  it('splits the bar under the pointer at that x on a click', async () => {
    const { user, onResult } = setup('add')
    const page = stubRect(0)

    await user.pointer({ keys: '[MouseLeft]', target: page, coords: { clientX: 450, clientY: 200 } })

    expect(onResult).toHaveBeenCalledTimes(1)
    expect(onResult).toHaveBeenCalledWith(addBarLine(doc, SHORT_PART_ID, 2, 450))
    expect(onResult.mock.calls[0][0].ok).toBe(true)
  })

  it('uses the bar numbers of the page that was clicked', () => {
    const { onResult } = setup('add')
    const page = stubRect(1)

    fireEvent.pointerDown(page, { clientX: 450, clientY: 200 })
    fireEvent.pointerUp(page, { clientX: 450, clientY: 200 })

    // Page 2 starts at bar 17 (the missed line is further down the page): its second box is bar 18.
    expect(onResult).toHaveBeenCalledWith(addBarLine(doc, SHORT_PART_ID, 18, 450))
  })

  it('removes the bar line on a click within reach of it, and ignores Shift', () => {
    const { onResult } = setup('add')
    const page = stubRect(0)

    fireEvent.pointerDown(page, { clientX: 365, clientY: 200, shiftKey: true })
    fireEvent.pointerUp(page, { clientX: 365, clientY: 200, shiftKey: true })

    expect(onResult).toHaveBeenCalledTimes(1)
    expect(onResult).toHaveBeenCalledWith(deleteBarLine(doc, SHORT_PART_ID, 1))
    expect(onResult.mock.calls[0][0].ok).toBe(true)
  })

  it('shows the delete highlight, not the dashed line, when the pointer is on a bar line', () => {
    setup('add')
    const page = stubRect(0)

    fireEvent.pointerMove(page, { clientX: 365, clientY: 200 })

    expect(deleteLine()).toBeInTheDocument()
    expect(deleteLine()!.style.left).toBe('358px')
    expect(addLine()).toBeNull()
    expect(screen.queryByText(strings.editor.addHere)).toBeNull()

    fireEvent.pointerMove(page, { clientX: 450, clientY: 200 })
    expect(deleteLine()).toBeNull()
    expect(addLine()).toBeInTheDocument()
  })

  it('splits just outside the reach of a line, and refuses a split too near the outer edge of a staff line', () => {
    const { onResult } = setup('add')
    const page = stubRect(0)

    // 9 px from the line at 360: out of reach, so a split (bar 2's box runs from 360).
    fireEvent.pointerDown(page, { clientX: 369, clientY: 200 })
    fireEvent.pointerUp(page, { clientX: 369, clientY: 200 })
    expect(onResult).toHaveBeenLastCalledWith(addBarLine(doc, SHORT_PART_ID, 2, 369))

    // 5 px inside the first edge of the line (x 100): not an editable line, and too narrow to split.
    fireEvent.pointerDown(page, { clientX: 105, clientY: 200 })
    fireEvent.pointerUp(page, { clientX: 105, clientY: 200 })
    expect(onResult).toHaveBeenLastCalledWith({ ok: false, reason: 'too-narrow' })
  })

  it('does nothing for a click outside the bars', () => {
    const { onResult } = setup('add')
    const page = stubRect(0)

    fireEvent.pointerDown(page, { clientX: 50, clientY: 200 })
    fireEvent.pointerUp(page, { clientX: 50, clientY: 200 })

    expect(onResult).not.toHaveBeenCalled()
  })

  it('does nothing when the pointer moved a long way between press and release (a scroll)', () => {
    const { onResult } = setup('add')
    const page = stubRect(0)

    fireEvent.pointerDown(page, { clientX: 450, clientY: 200 })
    fireEvent.pointerUp(page, { clientX: 450, clientY: 420 })

    expect(onResult).not.toHaveBeenCalled()
  })
})

describe('Delete bar line mode', () => {
  it('highlights the bar line the pointer is near', () => {
    setup('delete')
    const page = stubRect(0)

    fireEvent.pointerMove(page, { clientX: 365, clientY: 300 })

    expect(deleteLine()).toBeInTheDocument()
    expect(deleteLine()!.style.left).toBe('358px') // 4 px wide, centred on the line at 360
    expect(deleteLine()).toHaveClass('bg-problem')

    fireEvent.pointerMove(page, { clientX: 450, clientY: 300 })
    expect(deleteLine()).toBeNull()
  })

  it('removes the bar line on a click', () => {
    const { onResult } = setup('delete')
    const page = stubRect(0)

    fireEvent.pointerDown(page, { clientX: 365, clientY: 300 })
    fireEvent.pointerUp(page, { clientX: 365, clientY: 300 })

    expect(onResult).toHaveBeenCalledTimes(1)
    expect(onResult).toHaveBeenCalledWith(deleteBarLine(doc, SHORT_PART_ID, 1))
    expect(onResult.mock.calls[0][0].ok).toBe(true)
  })

  it('does nothing for a click inside a bar, away from the lines, and ignores Shift', () => {
    const { onResult } = setup('delete')
    const page = stubRect(0)

    fireEvent.pointerDown(page, { clientX: 450, clientY: 300, shiftKey: true })
    fireEvent.pointerUp(page, { clientX: 450, clientY: 300, shiftKey: true })

    expect(onResult).not.toHaveBeenCalled()
  })

  it('reaches no line where the part has none (the missed line inside the merged box)', () => {
    const { onResult } = setup('delete')
    // The merged box of bar 22 is on page 2, second line (y 530 to 830), x 360 to 880; the clarinet has a line at 620.
    const page = stubRect(1)

    fireEvent.pointerDown(page, { clientX: 620, clientY: 700 })
    fireEvent.pointerUp(page, { clientX: 620, clientY: 700 })

    expect(onResult).not.toHaveBeenCalled()
  })
})

describe('the layer', () => {
  it('drops what it showed when the mode changes', () => {
    const onResult = vi.fn()
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(COLUMN)
    const { rerender } = render(<Harness mode="add" onResult={onResult} />)
    fireEvent.pointerMove(stubRect(0), { clientX: 450, clientY: 200 })
    expect(addLine()).toBeInTheDocument()

    rerender(<Harness mode="delete" onResult={onResult} />)

    expect(addLine()).toBeNull()
    expect(deleteLine()).toBeNull()
  })

  it('keeps handles one size on screen at any zoom', () => {
    setup('move', 2)
    // At zoom 2 the page is drawn twice as big (scale 2), so image pixel 360 is screen pixel 720.
    const page = stubRect(0, 2)

    fireEvent.pointerMove(page, { clientX: 720, clientY: 600 })

    // A 6 px handle on screen is 3 image pixels at scale 2.
    expect(handle()!.style.width).toBe('3px')
  })
})
