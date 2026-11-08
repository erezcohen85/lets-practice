import { accumulateZoom, classifyWheel, PINCH_STEP_PX, WHEEL_STEP_PX } from '@/components/waveform/dockWheel'

const wheel = (overrides: Partial<Parameters<typeof classifyWheel>[0]> = {}, zoomInSign: 1 | -1 = 1) =>
  classifyWheel({ deltaX: 0, deltaY: 0, deltaMode: 0, shiftKey: false, ctrlKey: false, ...overrides }, 1000, zoomInSign)

describe('classifyWheel', () => {
  it('pans on a sideways delta, in pixels', () => {
    expect(wheel({ deltaX: 30 })).toEqual({ kind: 'pan', px: 30 })
    expect(wheel({ deltaX: -12 })).toEqual({ kind: 'pan', px: -12 })
  })

  it('zooms on a vertical delta', () => {
    expect(wheel({ deltaY: 7 })).toEqual({ kind: 'zoom', amount: 7, pinch: false })
    expect(wheel({ deltaY: -7 })).toEqual({ kind: 'zoom', amount: -7, pinch: false })
  })

  it('lets the larger delta decide, so a diagonal swipe does one thing', () => {
    expect(wheel({ deltaX: 20, deltaY: 5 })).toEqual({ kind: 'pan', px: 20 })
    expect(wheel({ deltaX: 5, deltaY: 20 })).toEqual({ kind: 'zoom', amount: 20, pinch: false })
  })

  it('counts a line as 16 px and a page as the width of the dock', () => {
    expect(wheel({ deltaX: 2, deltaMode: 1 })).toEqual({ kind: 'pan', px: 32 })
    expect(wheel({ deltaY: 1, deltaMode: 1 })).toEqual({ kind: 'zoom', amount: 16, pinch: false })
    expect(wheel({ deltaX: 1, deltaMode: 2 })).toEqual({ kind: 'pan', px: 1000 })
  })

  it('pans on Shift with a vertical wheel', () => {
    expect(wheel({ deltaY: 40, shiftKey: true })).toEqual({ kind: 'pan', px: 40 })
  })

  it('turns the plain vertical wheel round with the sign, so the direction is one constant', () => {
    expect(wheel({ deltaY: 7 }, -1)).toEqual({ kind: 'zoom', amount: -7, pinch: false })
  })

  it('zooms a pinch (Ctrl) in when the fingers spread, which the browser reports as deltaY below 0', () => {
    expect(wheel({ deltaY: -12, ctrlKey: true })).toEqual({ kind: 'zoom', amount: 12, pinch: true })
    expect(wheel({ deltaY: 12, deltaX: 30, ctrlKey: true })).toEqual({ kind: 'zoom', amount: -12, pinch: true })
  })

  it('does not let the scroll direction sign touch a pinch', () => {
    expect(wheel({ deltaY: -12, ctrlKey: true }, -1)).toEqual(wheel({ deltaY: -12, ctrlKey: true }, 1))
  })

  it('ignores an event with no delta', () => {
    expect(wheel()).toBeNull()
    expect(wheel({ ctrlKey: true })).toBeNull()
  })
})

describe('accumulateZoom', () => {
  it('takes a step for every 10 px of a pinch, whose deltas are small', () => {
    expect(accumulateZoom(0, 6, PINCH_STEP_PX)).toEqual({ acc: 6, steps: 0 })
    expect(accumulateZoom(6, 6, PINCH_STEP_PX)).toEqual({ acc: 2, steps: 1 })
  })

  it('takes no step before the step size is reached, then one, keeping the rest', () => {
    const first = accumulateZoom(0, WHEEL_STEP_PX - 1, WHEEL_STEP_PX)
    expect(first).toEqual({ acc: WHEEL_STEP_PX - 1, steps: 0 })
    const second = accumulateZoom(first.acc, 5, WHEEL_STEP_PX)
    expect(second.steps).toBe(1)
    expect(second.acc).toBe(4)
  })

  it('takes several steps for a big delta, in either direction', () => {
    expect(accumulateZoom(0, 2 * WHEEL_STEP_PX, WHEEL_STEP_PX).steps).toBe(2)
    expect(accumulateZoom(0, -2 * WHEEL_STEP_PX, WHEEL_STEP_PX).steps).toBe(-2)
  })

  it('forgets what was gathered when the direction changes', () => {
    expect(accumulateZoom(30, -5, WHEEL_STEP_PX)).toEqual({ acc: -5, steps: 0 })
  })
})
