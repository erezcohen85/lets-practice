import { fireEvent, render, renderHook, screen } from '@testing-library/react'
import { useEditorKeys } from './useEditorKeys'

function setup() {
  const handlers = { onMode: vi.fn(), onUndo: vi.fn(), onRedo: vi.fn() }
  const view = renderHook(() => useEditorKeys(handlers))
  return { ...handlers, ...view }
}

describe('useEditorKeys', () => {
  it('picks the mode with V, B and X, in either case', () => {
    const { onMode } = setup()

    fireEvent.keyDown(document.body, { key: 'v' })
    fireEvent.keyDown(document.body, { key: 'B' })
    fireEvent.keyDown(document.body, { key: 'x' })

    expect(onMode.mock.calls).toEqual([['move'], ['add'], ['delete']])
  })

  it('undoes with Cmd+Z and Ctrl+Z, and redoes with Shift+Cmd+Z, Ctrl+Shift+Z and Ctrl+Y', () => {
    const { onUndo, onRedo } = setup()

    fireEvent.keyDown(document.body, { key: 'z', metaKey: true })
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true })
    expect(onUndo).toHaveBeenCalledTimes(2)
    expect(onRedo).not.toHaveBeenCalled()

    fireEvent.keyDown(document.body, { key: 'Z', metaKey: true, shiftKey: true })
    fireEvent.keyDown(document.body, { key: 'Z', ctrlKey: true, shiftKey: true })
    fireEvent.keyDown(document.body, { key: 'y', ctrlKey: true })
    expect(onRedo).toHaveBeenCalledTimes(3)
    expect(onUndo).toHaveBeenCalledTimes(2)
  })

  it('stops the browser from handling a key it used, and leaves the others alone', () => {
    setup()

    expect(fireEvent.keyDown(document.body, { key: 'z', metaKey: true })).toBe(false)
    expect(fireEvent.keyDown(document.body, { key: 'v' })).toBe(false)
    expect(fireEvent.keyDown(document.body, { key: 'q' })).toBe(true)
  })

  it('leaves the mode keys to the browser with Cmd, Ctrl or Alt held (Cmd+X cuts, Cmd+B is bold)', () => {
    const { onMode } = setup()

    fireEvent.keyDown(document.body, { key: 'x', metaKey: true })
    fireEvent.keyDown(document.body, { key: 'b', ctrlKey: true })
    fireEvent.keyDown(document.body, { key: 'v', altKey: true })

    expect(onMode).not.toHaveBeenCalled()
  })

  it('fires no key while a text field has focus', () => {
    const { onMode, onUndo, onRedo } = setup()
    render(
      <>
        <input aria-label="name" />
        <textarea aria-label="notes" />
        <select aria-label="kind">
          <option>a</option>
        </select>
        <div role="textbox" contentEditable suppressContentEditableWarning aria-label="rich" />
      </>,
    )

    for (const name of ['name', 'notes', 'kind', 'rich']) {
      const field = screen.getByLabelText(name)
      field.focus()
      fireEvent.keyDown(field, { key: 'v' })
      fireEvent.keyDown(field, { key: 'z', metaKey: true })
      fireEvent.keyDown(field, { key: 'y', ctrlKey: true })
    }

    expect(onMode).not.toHaveBeenCalled()
    expect(onUndo).not.toHaveBeenCalled()
    expect(onRedo).not.toHaveBeenCalled()
  })

  it('still works with a button focused', () => {
    const { onMode } = setup()
    render(<button>press</button>)
    const button = screen.getByRole('button')
    button.focus()

    fireEvent.keyDown(button, { key: 'b' })

    expect(onMode).toHaveBeenCalledWith('add')
  })

  it('uses the newest handlers and stops listening when it unmounts', () => {
    const first = vi.fn()
    const second = vi.fn()
    const { rerender, unmount } = renderHook(({ onUndo }) => useEditorKeys({ onMode: vi.fn(), onUndo, onRedo: vi.fn() }), {
      initialProps: { onUndo: first },
    })
    rerender({ onUndo: second })

    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true })
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)

    unmount()
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true })
    expect(second).toHaveBeenCalledTimes(1)
  })
})
