import { render, screen } from '@testing-library/react'
import { NotConfiguredPage } from '@/pages/NotConfiguredPage'
import { strings } from '@/strings'

describe('NotConfiguredPage', () => {
  it('says the app has no backend yet and how to run the demo, without needing a router or a session', () => {
    render(<NotConfiguredPage />)

    expect(screen.getByRole('heading', { name: strings.common.notConfiguredTitle })).toBeInTheDocument()
    expect(screen.getByText(strings.common.notConfiguredText)).toBeInTheDocument()
    expect(screen.getByText(/VITE_USE_FAKES=1/)).toBeInTheDocument()
  })
})
