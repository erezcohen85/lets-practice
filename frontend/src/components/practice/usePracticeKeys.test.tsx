import { fireEvent, render } from '@testing-library/react'
import { usePracticeKeys } from './usePracticeKeys'

function setup() {
  const controls = { playPause: vi.fn(), restartLoop: vi.fn(), nextLoop: vi.fn() }
  function Harness() {
    usePracticeKeys(controls)
    return (
      <div>
        <input aria-label="field" />
        <textarea aria-label="notes" />
        <div role="slider" tabIndex={0} aria-label="slider" aria-valuenow={0} />
        <div role="menu" aria-label="menu">
          <button role="menuitemradio" aria-checked="false">
            item
          </button>
        </div>
        <button>plain</button>
      </div>
    )
  }
  const view = render(<Harness />)
  const el = (name: string) => view.getByLabelText(name)
  return { controls, view, el }
}

describe('usePracticeKeys', () => {
  it.each([
    [' ', 'playPause'],
    ['ArrowLeft', 'restartLoop'],
    ['PageUp', 'restartLoop'],
    ['ArrowRight', 'nextLoop'],
    ['PageDown', 'nextLoop'],
  ] as const)('%j calls %s once and keeps the browser from scrolling', (key, action) => {
    const { controls } = setup()

    const notCancelled = fireEvent.keyDown(document.body, { key })

    expect(notCancelled).toBe(false)
    expect(controls[action]).toHaveBeenCalledTimes(1)
    expect(Object.values(controls).reduce((sum, fn) => sum + fn.mock.calls.length, 0)).toBe(1)
  })

  it('ignores keys with a modifier held, and a key held down', () => {
    const { controls } = setup()

    fireEvent.keyDown(document.body, { key: 'ArrowRight', metaKey: true })
    fireEvent.keyDown(document.body, { key: 'ArrowRight', altKey: true })
    fireEvent.keyDown(document.body, { key: ' ', ctrlKey: true })
    fireEvent.keyDown(document.body, { key: 'ArrowRight', repeat: true })

    expect(controls.nextLoop).not.toHaveBeenCalled()
    expect(controls.playPause).not.toHaveBeenCalled()
  })

  it('ignores other keys', () => {
    const { controls } = setup()

    fireEvent.keyDown(document.body, { key: 'a' })
    fireEvent.keyDown(document.body, { key: 'Enter' })

    expect(Object.values(controls).every((fn) => fn.mock.calls.length === 0)).toBe(true)
  })

  it('leaves every key to a text field', () => {
    const { controls, el } = setup()

    for (const key of [' ', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown']) {
      fireEvent.keyDown(el('field'), { key })
      fireEvent.keyDown(el('notes'), { key })
    }

    expect(Object.values(controls).every((fn) => fn.mock.calls.length === 0)).toBe(true)
  })

  it('leaves the keys to a slider and to a menu', () => {
    const { controls, view, el } = setup()

    for (const key of [' ', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown']) {
      fireEvent.keyDown(el('slider'), { key })
      fireEvent.keyDown(view.getByRole('menuitemradio'), { key })
    }

    expect(Object.values(controls).every((fn) => fn.mock.calls.length === 0)).toBe(true)
  })

  it('plays on Space with a button focused by a pointer, and lets go of the button so it is not pressed too', () => {
    const { controls, view } = setup()
    const button = view.getByRole('button', { name: 'plain' })
    fireEvent.pointerDown(button)
    button.focus()

    const notCancelled = fireEvent.keyDown(button, { key: ' ' })

    expect(notCancelled).toBe(false)
    expect(controls.playPause).toHaveBeenCalledTimes(1)
    expect(button).not.toHaveFocus()
  })

  it('plays on Space with a pointer-focused control that cancels Space itself, and the control never sees the key', () => {
    const { controls, view } = setup()
    const button = view.getByRole('button', { name: 'plain' })
    const own = vi.fn((event: Event) => event.preventDefault())
    button.addEventListener('keydown', own)
    fireEvent.pointerDown(button)
    button.focus()

    fireEvent.keyDown(button, { key: ' ' })

    expect(controls.playPause).toHaveBeenCalledTimes(1)
    expect(own).not.toHaveBeenCalled()
  })

  it('keeps Space for a button focused with the keyboard, which it presses', () => {
    const { controls, view } = setup()
    const button = view.getByRole('button', { name: 'plain' })
    fireEvent.pointerDown(button)
    fireEvent.keyDown(document.body, { key: 'Tab' })
    button.focus()

    const notCancelled = fireEvent.keyDown(button, { key: ' ' })

    expect(notCancelled).toBe(true)
    expect(controls.playPause).not.toHaveBeenCalled()
    expect(button).toHaveFocus()
  })

  it('goes back to the pointer rule at the next press, and a pedal key does not make the focus a keyboard one', () => {
    const { controls, view } = setup()
    const button = view.getByRole('button', { name: 'plain' })
    fireEvent.keyDown(document.body, { key: 'Tab' })
    fireEvent.pointerDown(button)
    button.focus()

    fireEvent.keyDown(button, { key: 'ArrowRight' })
    fireEvent.keyDown(button, { key: ' ' })

    expect(controls.nextLoop).toHaveBeenCalledTimes(1)
    expect(controls.playPause).toHaveBeenCalledTimes(1)
  })

  it('still leaves the arrows and pedal keys working on a focused button', () => {
    const { controls, view } = setup()
    const button = view.getByRole('button', { name: 'plain' })

    fireEvent.keyDown(button, { key: 'ArrowRight' })
    fireEvent.keyDown(button, { key: 'PageUp' })

    expect(controls.nextLoop).toHaveBeenCalledTimes(1)
    expect(controls.restartLoop).toHaveBeenCalledTimes(1)
  })

  it('does not run a key that a control already handled', () => {
    const { controls, view } = setup()
    const button = view.getByRole('button', { name: 'plain' })
    button.addEventListener('keydown', (event) => event.preventDefault())

    fireEvent.keyDown(button, { key: 'ArrowRight' })

    expect(controls.nextLoop).not.toHaveBeenCalled()
  })

  it('stops listening when the page closes', () => {
    const { controls, view } = setup()

    view.unmount()
    fireEvent.keyDown(document.body, { key: ' ' })

    expect(controls.playPause).not.toHaveBeenCalled()
  })
})
