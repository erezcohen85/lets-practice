import { render, screen } from '@testing-library/react'
import { createFakes } from '@/lib/fakes'
import { ClientsProvider, type Clients } from '@/lib/clients'
import { useFeatures } from '@/lib/useFeatures'

function Probe() {
  const features = useFeatures()
  return <p>{Object.entries(features).map(([name, on]) => `${name}:${on ? 'on' : 'off'}`).join(' ')}</p>
}

function shown(features?: Clients['features']) {
  const { data, processor } = createFakes({ seed: 'empty' })
  render(
    <ClientsProvider clients={{ data, processor, ...(features === undefined ? {} : { features }) }}>
      <Probe />
    </ClientsProvider>,
  )
  return screen.getByText(/splitPdf/).textContent
}

describe('useFeatures', () => {
  it('has all six on when the clients say nothing', () => {
    expect(shown()).toBe('splitPdf:on boxCheck:on reprocess:on suggestName:on upload:on realign:on')
  })

  it('turns off only what the clients name', () => {
    expect(shown({ reprocess: false })).toBe('splitPdf:on boxCheck:on reprocess:off suggestName:on upload:on realign:on')
  })
})
