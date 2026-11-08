import { act, render, screen } from '@testing-library/react'
import { stubPhoneWindow } from '@/test/phoneWindow'
import { PHONE_QUERY, usePhoneLayout } from './usePhoneLayout'

/** Whether a window of this size matches a query made of `(max-width)` and `(max-height)` tests, as a browser reads it. */
function matchesAt(query: string, width: number, height: number) {
  return query.split(',').some((alternative) =>
    alternative.split(' and ').every((test) => {
      const parsed = /\(max-(width|height):\s*([\d.]+)px\)/.exec(test)
      if (parsed === null) throw new Error(`Not a size test: ${test}`)
      return (parsed[1] === 'width' ? width : height) <= Number(parsed[2])
    }),
  )
}

function Probe() {
  return <p>{usePhoneLayout() ? 'phone' : 'not a phone'}</p>
}

afterEach(() => vi.unstubAllGlobals())

describe('the phone rule', () => {
  it.each([
    [320, 568],
    [360, 640],
    [390, 844],
    [430, 932],
    [568, 320],
    [667, 375],
    [844, 390],
    [932, 430],
    [956, 440],
  ])('takes a phone of %i x %i', (width, height) => {
    expect(matchesAt(PHONE_QUERY, width, height)).toBe(true)
  })

  it.each([
    [744, 1133],
    [768, 1024],
    [820, 1180],
    [1024, 768],
    [1133, 744],
    [1180, 820],
    [1280, 800],
    [1920, 1080],
    [600, 900],
    [1023, 500],
    [1024, 499],
    [1366, 450],
  ])('leaves %i x %i alone: an iPad, a computer, or just past an edge of the rule', (width, height) => {
    expect(matchesAt(PHONE_QUERY, width, height)).toBe(false)
  })
})

describe('usePhoneLayout', () => {
  it('is false where the browser has no matchMedia', () => {
    vi.stubGlobal('matchMedia', undefined)
    render(<Probe />)

    expect(screen.getByText('not a phone')).toBeInTheDocument()
  })

  it('follows the window as it changes', () => {
    const window = stubPhoneWindow(true)
    render(<Probe />)
    expect(screen.getByText('phone')).toBeInTheDocument()

    act(() => window.resize(false))

    expect(screen.getByText('not a phone')).toBeInTheDocument()
  })
})
