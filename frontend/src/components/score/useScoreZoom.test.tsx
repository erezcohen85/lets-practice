import { act, renderHook } from '@testing-library/react'
import { useScoreZoom, ZOOM_STEPS, zoomKeyDirection } from '@/components/score/useScoreZoom'

describe('useScoreZoom', () => {
  it('starts at 100 % and steps up and down the list, stopping at 50 and 200', () => {
    const { result } = renderHook(() => useScoreZoom())
    expect(result.current.zoom).toBe(1)
    expect(result.current.percent).toBe(100)

    act(() => result.current.zoomIn())
    expect(result.current.percent).toBe(ZOOM_STEPS[ZOOM_STEPS.indexOf(100) + 1])
    expect(result.current.zoom).toBeCloseTo(result.current.percent / 100)

    for (let i = 0; i < 20; i++) act(() => result.current.zoomIn())
    expect(result.current.percent).toBe(200)

    for (let i = 0; i < 30; i++) act(() => result.current.zoomOut())
    expect(result.current.percent).toBe(50)
  })

  it('reset goes back to 100 %', () => {
    const { result } = renderHook(() => useScoreZoom())
    act(() => result.current.zoomOut())
    act(() => result.current.reset())

    expect(result.current.percent).toBe(100)
  })

  it('has steps from 50 to 200 that include 100 and only rise', () => {
    expect(ZOOM_STEPS[0]).toBe(50)
    expect(ZOOM_STEPS[ZOOM_STEPS.length - 1]).toBe(200)
    expect(ZOOM_STEPS).toContain(100)
    expect([...ZOOM_STEPS].sort((a, b) => a - b)).toEqual([...ZOOM_STEPS])
  })
})

describe('zoomKeyDirection', () => {
  const key = (name: string, extra: Partial<KeyboardEventInit> = {}, target: EventTarget | null = document.body) => {
    const event = new KeyboardEvent('keydown', { key: name, ...extra })
    Object.defineProperty(event, 'target', { value: target })
    return zoomKeyDirection(event)
  }

  it('zooms in on + and =, out on - and the minus sign', () => {
    expect(key('+')).toBe(1)
    expect(key('=')).toBe(1)
    expect(key('-')).toBe(-1)
    expect(key('−')).toBe(-1)
  })

  it('ignores other keys and keys with Ctrl, Cmd or Alt (the browser zoom)', () => {
    expect(key('a')).toBe(0)
    expect(key('+', { ctrlKey: true })).toBe(0)
    expect(key('-', { metaKey: true })).toBe(0)
    expect(key('=', { altKey: true })).toBe(0)
  })

  it('leaves Shift + / - to the waveform, but not the numpad keys', () => {
    expect(key('+', { shiftKey: true })).toBe(0)
    expect(key('_', { shiftKey: true })).toBe(0)
    expect(key('-', { shiftKey: true })).toBe(0)
    expect(key('+', { shiftKey: true, code: 'NumpadAdd' })).toBe(1)
    expect(key('-', { shiftKey: true, code: 'NumpadSubtract' })).toBe(-1)
  })

  it('ignores keys typed in a text field, text area or editable element', () => {
    expect(key('+', {}, document.createElement('input'))).toBe(0)
    expect(key('-', {}, document.createElement('textarea'))).toBe(0)
    const editable = document.createElement('div')
    editable.setAttribute('contenteditable', 'true')
    expect(key('+', {}, editable)).toBe(0)
  })

  it('still zooms from a checkbox or a button', () => {
    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    expect(key('+', {}, checkbox)).toBe(1)
    expect(key('-', {}, document.createElement('button'))).toBe(-1)
  })
})
